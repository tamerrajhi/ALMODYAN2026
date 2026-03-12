-- ================================================================
-- HOTFIX: Fix tax_rate convention in purchase_invoice_update_v2_atomic
-- Payload accepts percent (15), calculates with fraction (0.15), stores percent (15)
-- ================================================================
CREATE OR REPLACE FUNCTION public.purchase_invoice_update_v2_atomic(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_request_id UUID;
  v_begin JSONB;
  v_status TEXT;
  v_invoice_id UUID;
  v_invoice_number TEXT;
  v_invoice_type TEXT;
  v_invoice_status TEXT;
  v_branch_id UUID;
  v_journal_entry_id UUID;
  v_je_is_posted BOOLEAN;
  v_user_id UUID;
  v_user_branches UUID[];
  v_is_admin BOOLEAN;
  v_subtotal NUMERIC := 0;
  v_tax_amount NUMERIC := 0;
  v_total_amount NUMERIC := 0;
  v_lines_inserted INT := 0;
  v_line JSONB;
  v_line_number INT;
  v_line_qty NUMERIC;
  v_line_price NUMERIC;
  v_line_tax_rate_pct NUMERIC;  -- Stored as percent (15)
  v_line_tax_rate NUMERIC;       -- Fraction for calculations (0.15)
  v_line_discount NUMERIC;
  v_line_is_inclusive BOOLEAN;
  v_line_subtotal NUMERIC;
  v_line_tax NUMERIC;
  v_line_total NUMERIC;
  v_result JSONB;
BEGIN
  -- ================================================================
  -- A) Extract and validate client_request_id
  -- ================================================================
  v_client_request_id := (p_payload->>'client_request_id')::UUID;
  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_REQUEST_ID', 'error', 'client_request_id is required');
  END IF;

  -- ================================================================
  -- B) Idempotency check via begin_workflow_request
  -- ================================================================
  v_begin := public.begin_workflow_request(v_client_request_id, 'purchase_invoice_update_v2', p_payload);
  v_status := v_begin->>'status';

  IF v_status = 'succeeded' THEN
    RETURN v_begin->'cached_result';
  END IF;

  IF v_status = 'failed' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', COALESCE(v_begin->>'error_code', 'PREVIOUS_FAILURE'),
      'error', COALESCE(v_begin->>'error_message', 'Previous attempt failed')
    );
  END IF;

  IF v_status NOT IN ('processing', 'ok', 'retry') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'WORKFLOW_CONFLICT', 'status', v_status);
  END IF;

  -- ================================================================
  -- C) Extract invoice_id and fetch current state with FOR UPDATE
  -- ================================================================
  v_invoice_id := NULLIF(p_payload->'invoice'->>'id', '')::UUID;
  IF v_invoice_id IS NULL THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'invoice.id is required');
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'invoice.id is required');
  END IF;

  SELECT id, invoice_number, invoice_type, status, branch_id, journal_entry_id
  INTO v_invoice_id, v_invoice_number, v_invoice_type, v_invoice_status, v_branch_id, v_journal_entry_id
  FROM invoices
  WHERE id = v_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'INVOICE_NOT_FOUND', 'Invoice not found');
    RETURN jsonb_build_object('success', false, 'error_code', 'INVOICE_NOT_FOUND', 'error', 'Invoice not found');
  END IF;

  -- ================================================================
  -- D) Validate invoice type and status
  -- ================================================================
  IF v_invoice_type <> 'purchase' THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'INVALID_TYPE', 'Not a purchase invoice');
    RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_TYPE', 'error', 'Invoice is not a purchase invoice');
  END IF;

  IF v_invoice_status IN ('posted', 'voided', 'cancelled') THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'STATUS_LOCKED', 'Invoice status does not allow updates');
    RETURN jsonb_build_object('success', false, 'error_code', 'STATUS_LOCKED', 'error', 'Invoice status ' || v_invoice_status || ' does not allow updates');
  END IF;

  -- ================================================================
  -- E) Authorization check (SECURITY DEFINER requires explicit check)
  -- ================================================================
  v_user_id := auth.uid();
  
  v_is_admin := EXISTS (
    SELECT 1 FROM user_custom_roles ucr
    JOIN custom_roles cr ON cr.id = ucr.role_id
    WHERE ucr.user_id = v_user_id AND cr.role_name = 'admin'
  ) OR public.has_role(v_user_id, 'admin');

  IF NOT v_is_admin THEN
    SELECT array_agg(branch_id) INTO v_user_branches
    FROM user_branch_access
    WHERE user_id = v_user_id;

    IF v_user_branches IS NULL OR v_branch_id IS NULL OR NOT (v_branch_id = ANY(v_user_branches)) THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'ACCESS_DENIED', 'User does not have access to this branch');
      RETURN jsonb_build_object('success', false, 'error_code', 'ACCESS_DENIED', 'error', 'User does not have access to invoice branch');
    END IF;
  END IF;

  -- ================================================================
  -- F) JE posted check - block if journal entry is already posted
  -- ================================================================
  IF v_journal_entry_id IS NOT NULL THEN
    SELECT is_posted INTO v_je_is_posted
    FROM journal_entries
    WHERE id = v_journal_entry_id;

    IF v_je_is_posted = true THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'JE_POSTED', 'Cannot update invoice with posted journal entry');
      RETURN jsonb_build_object('success', false, 'error_code', 'JE_POSTED', 'error', 'Cannot update invoice - journal entry is already posted');
    END IF;
  END IF;

  -- ================================================================
  -- G) Update invoice header (branch_id NOT changed - security)
  -- ================================================================
  UPDATE invoices SET
    supplier_id = COALESCE(NULLIF(p_payload->'invoice'->>'supplier_id', '')::uuid, supplier_id),
    invoice_date = COALESCE(NULLIF(p_payload->'invoice'->>'invoice_date', '')::date, invoice_date),
    due_date = COALESCE(NULLIF(p_payload->'invoice'->>'due_date', '')::date, due_date),
    notes = COALESCE(p_payload->'invoice'->>'notes', notes),
    updated_at = now()
  WHERE id = v_invoice_id;

  -- ================================================================
  -- H) Atomic line replacement: DELETE all existing lines
  -- ================================================================
  DELETE FROM purchase_invoice_lines WHERE invoice_id = v_invoice_id;

  -- ================================================================
  -- I) Insert new lines from payload with proper calculations
  --    HOTFIX: tax_rate in payload is PERCENT (15), not fraction (0.15)
  -- ================================================================
  v_line_number := 0;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_payload->'items')
  LOOP
    v_line_number := v_line_number + 1;
    
    -- Extract line values
    v_line_qty := COALESCE((v_line->>'quantity')::numeric, 1);
    v_line_price := COALESCE((v_line->>'unit_price')::numeric, 0);
    v_line_discount := COALESCE((v_line->>'discount_amount')::numeric, 0);
    v_line_is_inclusive := COALESCE((v_line->>'is_inclusive')::boolean, false);
    
    -- HOTFIX: Accept tax_rate as percent (default 15), convert to fraction for calc
    v_line_tax_rate_pct := COALESCE((v_line->>'tax_rate')::numeric, 15);  -- Stored as percent
    v_line_tax_rate := v_line_tax_rate_pct / 100;                          -- Fraction for calculations

    -- Calculate line amounts using FRACTION (0.15)
    IF v_line_is_inclusive THEN
      -- Price includes tax: total = qty * price - discount
      v_line_total := v_line_qty * v_line_price - v_line_discount;
      v_line_tax := v_line_total * v_line_tax_rate / (1 + v_line_tax_rate);
      v_line_subtotal := v_line_total - v_line_tax;
    ELSE
      -- Price excludes tax: subtotal = qty * price - discount
      v_line_subtotal := v_line_qty * v_line_price - v_line_discount;
      v_line_tax := v_line_subtotal * v_line_tax_rate;
      v_line_total := v_line_subtotal + v_line_tax;
    END IF;

    -- Insert line: store tax_rate as PERCENT (no multiplication)
    INSERT INTO purchase_invoice_lines (
      invoice_id,
      line_number,
      product_id,
      cost_entry_id,
      item_type,
      product_code,
      description,
      quantity,
      unit_price,
      is_inclusive,
      discount_amount,
      subtotal,
      tax_rate,
      tax_amount,
      total_amount,
      gl_account_id,
      warehouse_account_id
    ) VALUES (
      v_invoice_id,
      COALESCE((v_line->>'line_number')::int, v_line_number),
      NULLIF(v_line->>'product_id', '')::uuid,
      NULLIF(v_line->>'cost_entry_id', '')::uuid,
      COALESCE(v_line->>'item_type', 'jewelry'),
      v_line->>'product_code',
      v_line->>'description',
      v_line_qty,
      v_line_price,
      v_line_is_inclusive,
      v_line_discount,
      v_line_subtotal,
      v_line_tax_rate_pct,  -- Store as percent (15), NOT multiplied
      v_line_tax,
      v_line_total,
      NULLIF(v_line->>'gl_account_id', '')::uuid,
      NULLIF(v_line->>'warehouse_account_id', '')::uuid
    );

    v_lines_inserted := v_lines_inserted + 1;
  END LOOP;

  -- ================================================================
  -- J) Recompute invoice totals from lines
  -- ================================================================
  SELECT COALESCE(SUM(subtotal), 0), COALESCE(SUM(tax_amount), 0), COALESCE(SUM(total_amount), 0)
  INTO v_subtotal, v_tax_amount, v_total_amount
  FROM purchase_invoice_lines
  WHERE invoice_id = v_invoice_id;

  UPDATE invoices SET
    subtotal = v_subtotal,
    tax_amount = v_tax_amount,
    total_amount = v_total_amount
  WHERE id = v_invoice_id;

  -- ================================================================
  -- K) Audit log
  -- ================================================================
  INSERT INTO audit_logs (action_type, entity_type, entity_id, entity_code, description, new_value)
  VALUES (
    'update',
    'purchase_invoice',
    v_invoice_id,
    v_invoice_number,
    'Invoice updated via purchase_invoice_update_v2_atomic RPC',
    jsonb_build_object(
      'lines_count', v_lines_inserted,
      'subtotal', v_subtotal,
      'tax_amount', v_tax_amount,
      'total_amount', v_total_amount
    )
  );

  -- ================================================================
  -- L) Build result and mark workflow as successful
  -- ================================================================
  v_result := jsonb_build_object(
    'success', true,
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'lines_count', v_lines_inserted,
    'subtotal', v_subtotal,
    'tax_amount', v_tax_amount,
    'total_amount', v_total_amount
  );

  PERFORM public.core_workflow_success(v_client_request_id, v_invoice_id, v_result);
  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  PERFORM public.core_workflow_failed(v_client_request_id, COALESCE(SQLSTATE, 'EXCEPTION'), SQLERRM);
  RETURN jsonb_build_object('success', false, 'error_code', 'EXCEPTION', 'error', SQLERRM);
END;
$$;