-- PURCH-FAST-EXEC-V1 BATCH D: MIN-mode RPCs for Purchase Returns
-- 3 functions: complete_purchase_return_unique_items_atomic, complete_purchase_return_general_atomic, void_purchase_return_atomic
-- MIN-mode: idempotency + basic insert/update, NO JE creation, NO inventory movements (deferred)
-- Idempotent: CREATE OR REPLACE, safe to re-run
-- Uses atomic_workflow_requests for idempotency (existing table)

-- ============================================================
-- 1. complete_purchase_return_unique_items_atomic(p_payload jsonb)
-- Creates a purchase return for unique jewelry items
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_purchase_return_unique_items_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_client_request_id text;
  v_return_id uuid;
  v_return_number text;
  v_branch_id uuid;
  v_invoice_id uuid;
  v_supplier_id uuid;
  v_return_date date;
  v_reason text;
  v_notes text;
  v_created_by uuid;
  v_item record;
  v_item_count int := 0;
  v_subtotal numeric := 0;
  v_tax_amount numeric := 0;
  v_total_amount numeric := 0;
  v_existing_result jsonb;
BEGIN
  -- Extract client_request_id for idempotency
  v_client_request_id := p_payload->>'client_request_id';
  IF v_client_request_id IS NULL OR v_client_request_id = '' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'client_request_id is required');
  END IF;

  -- Idempotency check via atomic_workflow_requests
  SELECT result_payload INTO v_existing_result
  FROM atomic_workflow_requests
  WHERE client_request_id = v_client_request_id
    AND workflow_type = 'purchase_return_unique'
    AND status = 'completed';

  IF v_existing_result IS NOT NULL THEN
    RETURN v_existing_result || jsonb_build_object('cached', true, 'idempotent', true);
  END IF;

  -- Register workflow request
  INSERT INTO atomic_workflow_requests (client_request_id, workflow_type, status, request_payload, created_at)
  VALUES (v_client_request_id, 'purchase_return_unique', 'in_progress', p_payload, NOW())
  ON CONFLICT (client_request_id) DO UPDATE SET status = 'in_progress', created_at = NOW();

  -- Extract return data
  v_branch_id := (p_payload->'return'->>'branch_id')::uuid;
  v_invoice_id := (p_payload->'return'->>'purchase_invoice_id')::uuid;
  v_supplier_id := NULLIF(p_payload->'return'->>'supplier_id', '')::uuid;
  v_return_date := COALESCE((p_payload->'return'->>'return_date')::date, CURRENT_DATE);
  v_reason := p_payload->'return'->>'reason';
  v_notes := p_payload->'return'->>'notes';
  v_created_by := NULLIF(p_payload->>'created_by', '')::uuid;

  IF v_branch_id IS NULL THEN
    UPDATE atomic_workflow_requests SET status = 'failed', error_code = 'VALIDATION', error_message = 'branch_id is required' WHERE client_request_id = v_client_request_id;
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'branch_id is required');
  END IF;
  IF v_invoice_id IS NULL THEN
    UPDATE atomic_workflow_requests SET status = 'failed', error_code = 'VALIDATION', error_message = 'purchase_invoice_id is required' WHERE client_request_id = v_client_request_id;
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'purchase_invoice_id is required');
  END IF;

  -- Generate return number
  BEGIN
    SELECT public.generate_purchase_return_number() INTO v_return_number;
  EXCEPTION WHEN OTHERS THEN
    v_return_number := 'PR-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || floor(random() * 9000 + 1000)::text;
  END;

  v_return_id := gen_random_uuid();

  -- Insert purchase_returns header
  INSERT INTO purchase_returns (
    id, return_number, purchase_type, purchase_invoice_id, supplier_id,
    branch_id, return_date, reason, notes, status,
    subtotal, tax_amount, total_amount,
    created_by, created_at, updated_at
  ) VALUES (
    v_return_id, v_return_number, 'unique', v_invoice_id, v_supplier_id,
    v_branch_id, v_return_date, v_reason, v_notes, 'posted',
    0, 0, 0,
    v_created_by, NOW(), NOW()
  );

  -- Insert return items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items')
  LOOP
    v_item_count := v_item_count + 1;
    
    DECLARE
      v_unit_price numeric := COALESCE((v_item.value->>'unit_price')::numeric, 0);
      v_tax_rate numeric := COALESCE((v_item.value->>'tax_rate')::numeric, 0);
      v_line_subtotal numeric;
      v_line_tax numeric;
      v_line_total numeric;
    BEGIN
      v_line_subtotal := v_unit_price;
      v_line_tax := v_line_subtotal * v_tax_rate;
      v_line_total := v_line_subtotal + v_line_tax;
      
      v_subtotal := v_subtotal + v_line_subtotal;
      v_tax_amount := v_tax_amount + v_line_tax;
      v_total_amount := v_total_amount + v_line_total;

      INSERT INTO purchase_return_items (
        id, purchase_return_id, jewelry_item_id, item_code, description,
        unit_price, tax_rate, gold_weight, karat_id,
        invoice_line_id, reason,
        created_at
      ) VALUES (
        gen_random_uuid(), v_return_id,
        NULLIF(v_item.value->>'item_id', '')::uuid,
        v_item.value->>'item_code',
        v_item.value->>'description',
        v_unit_price, v_tax_rate,
        (v_item.value->>'gold_weight')::numeric,
        NULLIF(v_item.value->>'karat_id', '')::uuid,
        NULLIF(v_item.value->>'invoice_line_id', '')::uuid,
        v_item.value->>'reason',
        NOW()
      );
    END;
  END LOOP;

  -- Update totals on header
  UPDATE purchase_returns
  SET subtotal = v_subtotal,
      tax_amount = v_tax_amount,
      total_amount = v_total_amount,
      updated_at = NOW()
  WHERE id = v_return_id;

  -- Build and store result
  DECLARE
    v_result jsonb;
  BEGIN
    v_result := jsonb_build_object(
      'success', true,
      'returnId', v_return_id,
      'returnNumber', v_return_number,
      'status', 'posted',
      'itemCount', v_item_count,
      'totals', jsonb_build_object(
        'subtotal', v_subtotal,
        'taxAmount', v_tax_amount,
        'totalAmount', v_total_amount
      ),
      'meta', jsonb_build_object(
        'workflowType', 'purchase_return_unique',
        'clientRequestId', v_client_request_id
      )
    );

    UPDATE atomic_workflow_requests
    SET status = 'completed', result_payload = v_result, completed_at = NOW()
    WHERE client_request_id = v_client_request_id;

    RETURN v_result;
  END;

EXCEPTION WHEN OTHERS THEN
  UPDATE atomic_workflow_requests
  SET status = 'failed', error_code = 'DB_ERROR', error_message = SQLERRM
  WHERE client_request_id = v_client_request_id;

  RETURN jsonb_build_object(
    'success', false,
    'error_code', 'DB_ERROR',
    'error', SQLERRM
  );
END;
$$;

-- ============================================================
-- 2. complete_purchase_return_general_atomic(p_payload jsonb)
-- Creates a purchase return for general (qty-based) items
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_purchase_return_general_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_client_request_id text;
  v_return_id uuid;
  v_return_number text;
  v_branch_id uuid;
  v_invoice_id uuid;
  v_supplier_id uuid;
  v_return_date date;
  v_reason text;
  v_notes text;
  v_created_by uuid;
  v_item record;
  v_line_count int := 0;
  v_subtotal numeric := 0;
  v_tax_amount numeric := 0;
  v_total_amount numeric := 0;
  v_existing_result jsonb;
BEGIN
  v_client_request_id := p_payload->>'client_request_id';
  IF v_client_request_id IS NULL OR v_client_request_id = '' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'client_request_id is required');
  END IF;

  -- Idempotency check
  SELECT result_payload INTO v_existing_result
  FROM atomic_workflow_requests
  WHERE client_request_id = v_client_request_id
    AND workflow_type = 'purchase_return_general'
    AND status = 'completed';

  IF v_existing_result IS NOT NULL THEN
    RETURN v_existing_result || jsonb_build_object('cached', true, 'idempotent', true);
  END IF;

  INSERT INTO atomic_workflow_requests (client_request_id, workflow_type, status, request_payload, created_at)
  VALUES (v_client_request_id, 'purchase_return_general', 'in_progress', p_payload, NOW())
  ON CONFLICT (client_request_id) DO UPDATE SET status = 'in_progress', created_at = NOW();

  v_branch_id := (p_payload->'return'->>'branch_id')::uuid;
  v_invoice_id := (p_payload->'return'->>'purchase_invoice_id')::uuid;
  v_supplier_id := NULLIF(p_payload->'return'->>'supplier_id', '')::uuid;
  v_return_date := COALESCE((p_payload->'return'->>'return_date')::date, CURRENT_DATE);
  v_reason := p_payload->'return'->>'reason';
  v_notes := p_payload->'return'->>'notes';
  v_created_by := NULLIF(p_payload->>'created_by', '')::uuid;

  IF v_branch_id IS NULL THEN
    UPDATE atomic_workflow_requests SET status = 'failed', error_code = 'VALIDATION', error_message = 'branch_id is required' WHERE client_request_id = v_client_request_id;
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'branch_id is required');
  END IF;
  IF v_invoice_id IS NULL THEN
    UPDATE atomic_workflow_requests SET status = 'failed', error_code = 'VALIDATION', error_message = 'purchase_invoice_id is required' WHERE client_request_id = v_client_request_id;
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'purchase_invoice_id is required');
  END IF;

  BEGIN
    SELECT public.generate_purchase_return_number() INTO v_return_number;
  EXCEPTION WHEN OTHERS THEN
    v_return_number := 'PR-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || floor(random() * 9000 + 1000)::text;
  END;

  v_return_id := gen_random_uuid();

  INSERT INTO purchase_returns (
    id, return_number, purchase_type, purchase_invoice_id, supplier_id,
    branch_id, return_date, reason, notes, status,
    subtotal, tax_amount, total_amount,
    created_by, created_at, updated_at
  ) VALUES (
    v_return_id, v_return_number, 'general', v_invoice_id, v_supplier_id,
    v_branch_id, v_return_date, v_reason, v_notes, 'posted',
    0, 0, 0,
    v_created_by, NOW(), NOW()
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items')
  LOOP
    v_line_count := v_line_count + 1;
    
    DECLARE
      v_qty numeric := COALESCE((v_item.value->>'qty')::numeric, 1);
      v_unit_price numeric := COALESCE((v_item.value->>'unit_price')::numeric, 0);
      v_tax_rate numeric := COALESCE((v_item.value->>'tax_rate')::numeric, 0.15);
      v_discount numeric := COALESCE((v_item.value->>'discount_amount')::numeric, 0);
      v_line_subtotal numeric;
      v_line_tax numeric;
      v_line_total numeric;
    BEGIN
      v_line_subtotal := (v_qty * v_unit_price) - v_discount;
      v_line_tax := v_line_subtotal * v_tax_rate;
      v_line_total := v_line_subtotal + v_line_tax;
      
      v_subtotal := v_subtotal + v_line_subtotal;
      v_tax_amount := v_tax_amount + v_line_tax;
      v_total_amount := v_total_amount + v_line_total;

      INSERT INTO purchase_return_lines (
        id, purchase_return_id, invoice_line_id,
        item_id, item_code, description, item_type,
        quantity, unit_price, tax_rate, discount_amount,
        subtotal, tax_amount, total_amount,
        reason, line_number,
        created_at
      ) VALUES (
        gen_random_uuid(), v_return_id,
        NULLIF(v_item.value->>'invoice_line_id', '')::uuid,
        NULLIF(v_item.value->>'item_id', '')::uuid,
        v_item.value->>'item_code',
        v_item.value->>'description',
        COALESCE(v_item.value->>'item_type', 'product'),
        v_qty, v_unit_price, v_tax_rate, v_discount,
        v_line_subtotal, v_line_tax, v_line_total,
        v_item.value->>'reason',
        v_line_count,
        NOW()
      );
    END;
  END LOOP;

  UPDATE purchase_returns
  SET subtotal = v_subtotal,
      tax_amount = v_tax_amount,
      total_amount = v_total_amount,
      updated_at = NOW()
  WHERE id = v_return_id;

  DECLARE
    v_result jsonb;
  BEGIN
    v_result := jsonb_build_object(
      'success', true,
      'returnId', v_return_id,
      'returnNumber', v_return_number,
      'status', 'posted',
      'lineCount', v_line_count,
      'totals', jsonb_build_object(
        'subtotal', v_subtotal,
        'taxAmount', v_tax_amount,
        'totalAmount', v_total_amount
      ),
      'meta', jsonb_build_object(
        'workflowType', 'purchase_return_general',
        'clientRequestId', v_client_request_id
      )
    );

    UPDATE atomic_workflow_requests
    SET status = 'completed', result_payload = v_result, completed_at = NOW()
    WHERE client_request_id = v_client_request_id;

    RETURN v_result;
  END;

EXCEPTION WHEN OTHERS THEN
  UPDATE atomic_workflow_requests
  SET status = 'failed', error_code = 'DB_ERROR', error_message = SQLERRM
  WHERE client_request_id = v_client_request_id;

  RETURN jsonb_build_object(
    'success', false,
    'error_code', 'DB_ERROR',
    'error', SQLERRM
  );
END;
$$;

-- ============================================================
-- 3. void_purchase_return_atomic(p_payload jsonb)
-- Voids a purchase return (sets status to 'voided')
-- Supports resolution by purchase_return_id, return_number, or invoice_id
-- ============================================================
CREATE OR REPLACE FUNCTION public.void_purchase_return_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_client_request_id text;
  v_purchase_return_id uuid;
  v_return_number text;
  v_invoice_id uuid;
  v_reason text;
  v_voided_by uuid;
  v_current_status text;
  v_return_type text;
  v_existing_result jsonb;
  v_found boolean := false;
BEGIN
  v_client_request_id := p_payload->>'client_request_id';
  IF v_client_request_id IS NULL OR v_client_request_id = '' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'client_request_id is required');
  END IF;

  -- Idempotency check
  SELECT result_payload INTO v_existing_result
  FROM atomic_workflow_requests
  WHERE client_request_id = v_client_request_id
    AND workflow_type = 'void_purchase_return'
    AND status = 'completed';

  IF v_existing_result IS NOT NULL THEN
    RETURN v_existing_result || jsonb_build_object('cached', true, 'idempotent', true);
  END IF;

  INSERT INTO atomic_workflow_requests (client_request_id, workflow_type, status, request_payload, created_at)
  VALUES (v_client_request_id, 'void_purchase_return', 'in_progress', p_payload, NOW())
  ON CONFLICT (client_request_id) DO UPDATE SET status = 'in_progress', created_at = NOW();

  -- Extract void data (supports both nested 'void' and flat format)
  IF p_payload ? 'void' THEN
    v_purchase_return_id := NULLIF(p_payload->'void'->>'purchase_return_id', '')::uuid;
    v_return_number := p_payload->'void'->>'return_number';
    v_invoice_id := NULLIF(p_payload->'void'->>'invoice_id', '')::uuid;
    v_reason := COALESCE(p_payload->'void'->>'reason', 'ملغي');
    v_voided_by := NULLIF(p_payload->'void'->>'voided_by', '')::uuid;
  ELSE
    v_purchase_return_id := NULLIF(p_payload->>'return_id', '')::uuid;
    v_return_number := p_payload->>'return_number';
    v_reason := COALESCE(p_payload->>'void_reason', 'ملغي');
    v_voided_by := NULLIF(p_payload->>'created_by', '')::uuid;
  END IF;

  -- Resolution: find the purchase_return record
  IF v_purchase_return_id IS NOT NULL THEN
    SELECT id, return_number, status, purchase_type
    INTO v_purchase_return_id, v_return_number, v_current_status, v_return_type
    FROM purchase_returns
    WHERE id = v_purchase_return_id;
    v_found := FOUND;
  END IF;

  IF NOT v_found AND v_return_number IS NOT NULL THEN
    SELECT id, return_number, status, purchase_type
    INTO v_purchase_return_id, v_return_number, v_current_status, v_return_type
    FROM purchase_returns
    WHERE return_number = v_return_number;
    v_found := FOUND;
  END IF;

  IF NOT v_found AND v_invoice_id IS NOT NULL THEN
    SELECT id, return_number, status, purchase_type
    INTO v_purchase_return_id, v_return_number, v_current_status, v_return_type
    FROM purchase_returns
    WHERE purchase_invoice_id = v_invoice_id
    ORDER BY created_at DESC
    LIMIT 1;
    v_found := FOUND;
  END IF;

  IF NOT v_found THEN
    UPDATE atomic_workflow_requests SET status = 'failed', error_code = 'NOT_FOUND', error_message = 'Purchase return not found' WHERE client_request_id = v_client_request_id;
    RETURN jsonb_build_object('success', false, 'error_code', 'NOT_FOUND', 'error', 'Purchase return not found');
  END IF;

  -- Already voided?
  IF v_current_status = 'voided' OR v_current_status = 'cancelled' THEN
    DECLARE
      v_result jsonb;
    BEGIN
      v_result := jsonb_build_object(
        'success', true,
        'already_voided', true,
        'idempotent', true,
        'purchase_return_id', v_purchase_return_id,
        'return_number', v_return_number,
        'return_type', v_return_type,
        'status', v_current_status
      );

      UPDATE atomic_workflow_requests
      SET status = 'completed', result_payload = v_result, completed_at = NOW()
      WHERE client_request_id = v_client_request_id;

      RETURN v_result;
    END;
  END IF;

  -- Void the return
  UPDATE purchase_returns
  SET status = 'voided',
      notes = COALESCE(notes, '') || E'\n[VOIDED] ' || v_reason,
      updated_at = NOW()
  WHERE id = v_purchase_return_id;

  DECLARE
    v_result jsonb;
  BEGIN
    v_result := jsonb_build_object(
      'success', true,
      'purchase_return_id', v_purchase_return_id,
      'return_number', v_return_number,
      'return_type', v_return_type,
      'status', 'voided',
      'already_voided', false,
      'meta', jsonb_build_object(
        'workflowType', 'void_purchase_return',
        'clientRequestId', v_client_request_id
      )
    );

    UPDATE atomic_workflow_requests
    SET status = 'completed', result_payload = v_result, completed_at = NOW()
    WHERE client_request_id = v_client_request_id;

    RETURN v_result;
  END;

EXCEPTION WHEN OTHERS THEN
  UPDATE atomic_workflow_requests
  SET status = 'failed', error_code = 'DB_ERROR', error_message = SQLERRM
  WHERE client_request_id = v_client_request_id;

  RETURN jsonb_build_object(
    'success', false,
    'error_code', 'DB_ERROR',
    'error', SQLERRM
  );
END;
$$;
