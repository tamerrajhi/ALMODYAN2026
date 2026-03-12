-- =====================================================
-- ROOT FIX: Purchase Return Unique + pos_begin_request
-- Fix #1: RPC should NOT treat status='processing' as conflict
-- Fix #2: Sweeper TTL to abort stale requests with same payload_hash
-- =====================================================

-- ===========================================
-- FIX #1: complete_purchase_return_unique_items_atomic
-- Remove the incorrect "IF processing THEN conflict" logic
-- ===========================================
CREATE OR REPLACE FUNCTION public.complete_purchase_return_unique_items_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_client_request_id uuid;
  v_begin jsonb;
  v_workflow_type text := 'purchase_return_unique_create_atomic';

  v_return_id uuid;
  v_return_number text;

  v_supplier_id uuid;
  v_branch_id uuid;
  v_purchase_invoice_id uuid;
  v_return_date timestamptz;
  v_reason text;
  v_notes text;

  v_user_id uuid;
  v_user_name text;

  v_subtotal numeric := 0;
  v_tax_amount numeric := 0;
  v_total_amount numeric := 0;
  v_tax_rate numeric := 0.15;

  v_item jsonb;
  v_item_id uuid;
  v_item_cost numeric;
  v_item_desc text;

  v_je_id uuid;
  v_je_number text;

  v_inventory_account_id uuid;
  v_vat_input_account_id uuid;
  v_supplier_account_id uuid;
  
  v_movement_count int := 0;
  v_expected_count int := 0;
BEGIN
  -- =========================
  -- 0) Parse + Validate client_request_id
  -- =========================
  v_client_request_id := NULLIF(p_payload->>'client_request_id','')::uuid;
  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'client_request_id is required', 'error_code', 'MISSING_REQUEST_ID');
  END IF;

  -- =========================
  -- 1) Canonical begin (idempotency)
  -- =========================
  BEGIN
    v_begin := pos_begin_request(v_client_request_id, v_workflow_type, p_payload);
  EXCEPTION WHEN OTHERS THEN
    -- Handle CONFLICT_IN_PROGRESS exception from pos_begin_request
    IF SQLERRM LIKE 'CONFLICT_IN_PROGRESS:%' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Request is already being processed', 'error_code', 'CONFLICT_IN_PROGRESS');
    END IF;
    -- Re-raise other exceptions
    RAISE;
  END;

  -- If already succeeded, return existing result (idempotent)
  IF COALESCE(v_begin->>'status','') = 'succeeded' AND v_begin ? 'result' THEN
    RETURN (v_begin->'result');
  END IF;

  -- NOTE: status='processing' means this is a NEW first-time call - proceed normally!
  -- Do NOT return conflict here - that was the bug.

  -- =========================
  -- 2) Extract header fields (nested return + fallback)
  -- =========================
  v_supplier_id := COALESCE((p_payload->'return'->>'supplier_id')::uuid, (p_payload->>'supplier_id')::uuid);
  v_branch_id   := COALESCE((p_payload->'return'->>'branch_id')::uuid,   (p_payload->>'branch_id')::uuid);
  v_purchase_invoice_id := COALESCE(
    (p_payload->'return'->>'purchase_invoice_id')::uuid,
    (p_payload->>'purchase_invoice_id')::uuid
  );

  v_return_date := COALESCE((p_payload->'return'->>'return_date')::timestamptz, (p_payload->>'return_date')::timestamptz, now());
  v_reason := COALESCE(p_payload->'return'->>'reason', p_payload->>'reason');
  v_notes  := COALESCE(p_payload->'return'->>'notes',  p_payload->>'notes');

  IF v_supplier_id IS NULL THEN
    PERFORM pos_fail_request(v_client_request_id, 'VALIDATION_ERROR', 'supplier_id is required');
    RETURN jsonb_build_object('success', false, 'error', 'supplier_id is required', 'error_code', 'VALIDATION_ERROR');
  END IF;
  IF v_branch_id IS NULL THEN
    PERFORM pos_fail_request(v_client_request_id, 'VALIDATION_ERROR', 'branch_id is required');
    RETURN jsonb_build_object('success', false, 'error', 'branch_id is required', 'error_code', 'VALIDATION_ERROR');
  END IF;

  IF p_payload->'items' IS NULL OR jsonb_typeof(p_payload->'items') <> 'array' OR jsonb_array_length(p_payload->'items') = 0 THEN
    PERFORM pos_fail_request(v_client_request_id, 'VALIDATION_ERROR', 'items array is required');
    RETURN jsonb_build_object('success', false, 'error', 'items array is required', 'error_code', 'VALIDATION_ERROR');
  END IF;

  -- =========================
  -- 3) Actor name
  -- =========================
  v_user_id := auth.uid();
  SELECT COALESCE(raw_user_meta_data->>'full_name', email, 'System')
    INTO v_user_name
    FROM auth.users
   WHERE id = v_user_id;
  IF v_user_name IS NULL THEN v_user_name := 'System'; END IF;

  -- =========================
  -- 4) Accounts (minimal, evidence-compatible)
  -- =========================
  SELECT id INTO v_inventory_account_id FROM chart_of_accounts WHERE account_code='1301' AND is_active=true LIMIT 1;
  SELECT id INTO v_vat_input_account_id FROM chart_of_accounts WHERE account_code='1501' AND is_active=true LIMIT 1;

  -- supplier account (best-effort): prefer suppliers.account_id if exists, else fallback 2101
  BEGIN
    SELECT account_id INTO v_supplier_account_id FROM suppliers WHERE id = v_supplier_id;
  EXCEPTION WHEN undefined_column THEN
    v_supplier_account_id := NULL;
  END;
  IF v_supplier_account_id IS NULL THEN
    SELECT id INTO v_supplier_account_id FROM chart_of_accounts WHERE account_code='2101' AND is_active=true LIMIT 1;
  END IF;

  IF v_inventory_account_id IS NULL OR v_vat_input_account_id IS NULL OR v_supplier_account_id IS NULL THEN
    PERFORM pos_fail_request(v_client_request_id, 'CONFIG_ERROR', 'Required accounting configuration missing');
    RETURN jsonb_build_object('success', false, 'error', 'Required accounting configuration (inventory/VAT/supplier accounts) missing', 'error_code', 'CONFIG_ERROR');
  END IF;

  -- =========================
  -- 5) Generate return number + create header
  -- =========================
  SELECT nextval('purchase_return_number_seq') INTO v_return_number;
  v_return_number := 'PR-' || LPAD(v_return_number::text, 6, '0');

  v_return_id := gen_random_uuid();

  INSERT INTO public.purchase_returns (
    id, return_number, return_type, supplier_id, branch_id,
    purchase_invoice_id, return_date, status,
    subtotal, tax_amount, total_amount,
    reason, notes,
    created_by, created_by_name, created_at, updated_at
  ) VALUES (
    v_return_id, v_return_number, 'unique', v_supplier_id, v_branch_id,
    v_purchase_invoice_id, v_return_date::date, 'completed',
    0, 0, 0,
    v_reason, v_notes,
    v_user_id, v_user_name, now(), now()
  );

  -- =========================
  -- 6) Process items
  -- =========================
  v_expected_count := jsonb_array_length(p_payload->'items');
  
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items')
  LOOP
    v_item_id := (v_item->>'jewelry_item_id')::uuid;

    -- Get item cost
    SELECT COALESCE(cost, 0), COALESCE(description, 'قطعة مرتجعة')
      INTO v_item_cost, v_item_desc
      FROM jewelry_items
     WHERE id = v_item_id;

    v_subtotal := v_subtotal + v_item_cost;

    -- Insert return item
    INSERT INTO public.purchase_return_items (
      id, purchase_return_id, jewelry_item_id,
      quantity, unit_price, total_price,
      created_at
    ) VALUES (
      gen_random_uuid(), v_return_id, v_item_id,
      1, v_item_cost, v_item_cost,
      now()
    );

    -- Update jewelry_item: clear branch, mark returned
    UPDATE public.jewelry_items
       SET branch_id = NULL,
           sale_status = 'returned',
           is_available_for_sale = false,
           updated_at = now()
     WHERE id = v_item_id;

    -- Insert movement with ON CONFLICT DO NOTHING (idempotent)
    INSERT INTO public.item_movements (
      id, item_id, movement_type, quantity, branch_id, reference_type,
      purchase_return_id, performed_by, notes, created_at
    ) VALUES (
      gen_random_uuid(), v_item_id, 'PURCHASE_RETURN', -1, v_branch_id, 'purchase_return',
      v_return_id, v_user_name, 'مرتجع مشتريات: ' || v_return_number, now()
    )
    ON CONFLICT DO NOTHING;
    
    -- Count successful movement
    GET DIAGNOSTICS v_movement_count = ROW_COUNT;
  END LOOP;

  -- =========================
  -- 7) Calculate tax + update header
  -- =========================
  v_tax_amount := ROUND(v_subtotal * v_tax_rate, 2);
  v_total_amount := v_subtotal + v_tax_amount;

  UPDATE public.purchase_returns
     SET subtotal = v_subtotal,
         tax_amount = v_tax_amount,
         total_amount = v_total_amount
   WHERE id = v_return_id;

  -- =========================
  -- 8) Create Journal Entry
  -- =========================
  v_je_number := generate_journal_entry_number();
  v_je_id := gen_random_uuid();

  INSERT INTO public.journal_entries (
    id, entry_number, entry_date, reference_type, reference_id,
    description, total_debit, total_credit, is_posted, branch_id,
    created_by, created_at
  ) VALUES (
    v_je_id, v_je_number, CURRENT_DATE, 'purchase_return', v_return_id,
    'قيد مرتجع مشتريات: ' || v_return_number,
    v_total_amount, v_total_amount, true, v_branch_id,
    v_user_id, now()
  );

  -- Debit: Supplier (reduce liability)
  INSERT INTO public.journal_entry_lines (
    id, journal_entry_id, account_id, debit_amount, credit_amount, description
  ) VALUES (
    gen_random_uuid(), v_je_id, v_supplier_account_id, v_total_amount, 0, 'ذمم موردين - مرتجع'
  );

  -- Credit: Inventory (reduce asset)
  INSERT INTO public.journal_entry_lines (
    id, journal_entry_id, account_id, debit_amount, credit_amount, description
  ) VALUES (
    gen_random_uuid(), v_je_id, v_inventory_account_id, 0, v_subtotal, 'مخزون - مرتجع'
  );

  -- Credit: VAT Input (reduce asset)
  INSERT INTO public.journal_entry_lines (
    id, journal_entry_id, account_id, debit_amount, credit_amount, description
  ) VALUES (
    gen_random_uuid(), v_je_id, v_vat_input_account_id, 0, v_tax_amount, 'ضريبة مدخلات - مرتجع'
  );

  -- Link JE to return
  UPDATE public.purchase_returns
     SET journal_entry_id = v_je_id
   WHERE id = v_return_id;

  -- =========================
  -- 9) Mark workflow succeeded
  -- =========================
  PERFORM pos_succeed_request(
    v_client_request_id,
    v_return_id,
    jsonb_build_object(
      'success', true,
      'return_id', v_return_id,
      'return_number', v_return_number,
      'journal_entry_id', v_je_id,
      'journal_entry_number', v_je_number,
      'total_amount', v_total_amount
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'return_id', v_return_id,
    'return_number', v_return_number,
    'journal_entry_id', v_je_id,
    'journal_entry_number', v_je_number,
    'total_amount', v_total_amount
  );

EXCEPTION WHEN OTHERS THEN
  -- Fail the workflow request if we have a valid client_request_id
  IF v_client_request_id IS NOT NULL THEN
    PERFORM pos_fail_request(v_client_request_id, SQLSTATE, SQLERRM);
  END IF;
  
  RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'error_code', SQLSTATE);
END;
$function$;

-- ===========================================
-- FIX #2: pos_begin_request with Sweeper TTL
-- Abort stale processing requests with same workflow_type + payload_hash
-- ===========================================
CREATE OR REPLACE FUNCTION public.pos_begin_request(
  p_client_request_id uuid, 
  p_workflow_type text, 
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_payload_hash text;
  v_existing record;
  v_stale_ttl interval := interval '120 seconds';
BEGIN
  -- Compute payload hash for idempotency
  v_payload_hash := md5(p_payload::text);
  
  -- ===========================================
  -- SWEEPER: Abort stale processing requests for SAME workflow_type + payload_hash
  -- This handles cases where UI generates new client_request_id each time
  -- ===========================================
  UPDATE public.pos_workflow_requests
  SET status = 'failed',
      error_code = 'ABORTED_STALE',
      error_message = 'Auto-aborted by sweeper: stale processing exceeded TTL',
      updated_at = now()
  WHERE workflow_type = p_workflow_type
    AND payload_hash = v_payload_hash
    AND status = 'processing'
    AND (now() - created_at) > v_stale_ttl;
  
  -- Check for existing request by client_request_id
  SELECT status, entity_id, result, created_at, payload_hash
  INTO v_existing
  FROM public.pos_workflow_requests 
  WHERE client_request_id = p_client_request_id;
  
  IF FOUND THEN
    -- Idempotency: if succeeded, return existing result
    IF v_existing.status = 'succeeded' THEN
      RETURN jsonb_build_object(
        'idempotent', true,
        'status', 'succeeded',
        'entity_id', v_existing.entity_id,
        'result', v_existing.result
      );
    END IF;
    
    -- If processing, check if stale (TTL expired for same client_request_id)
    IF v_existing.status = 'processing' THEN
      IF (now() - v_existing.created_at) > v_stale_ttl THEN
        -- Auto-abort stale request
        UPDATE public.pos_workflow_requests
        SET status = 'failed',
            error_code = 'ABORTED_STALE',
            error_message = 'Auto-aborted: processing exceeded TTL of 120 seconds',
            updated_at = now()
        WHERE client_request_id = p_client_request_id;
        
        -- Update to new processing state
        UPDATE public.pos_workflow_requests
        SET status = 'processing',
            payload_hash = v_payload_hash,
            error_code = NULL,
            error_message = NULL,
            updated_at = now()
        WHERE client_request_id = p_client_request_id;
        
        RETURN jsonb_build_object('idempotent', false, 'status', 'processing', 'retry', true, 'stale_aborted', true);
      ELSE
        -- Still within TTL, raise conflict exception
        RAISE EXCEPTION 'CONFLICT_IN_PROGRESS: Request % is already processing', p_client_request_id;
      END IF;
    END IF;
    
    -- If failed, allow retry by updating to processing
    IF v_existing.status = 'failed' THEN
      UPDATE public.pos_workflow_requests
      SET status = 'processing',
          payload_hash = v_payload_hash,
          error_code = NULL,
          error_message = NULL,
          updated_at = now()
      WHERE client_request_id = p_client_request_id;
      
      RETURN jsonb_build_object('idempotent', false, 'status', 'processing', 'retry', true);
    END IF;
  END IF;
  
  -- Insert new request
  INSERT INTO public.pos_workflow_requests (
    client_request_id,
    workflow_type,
    status,
    payload_hash,
    created_at,
    updated_at
  ) VALUES (
    p_client_request_id,
    p_workflow_type,
    'processing',
    v_payload_hash,
    now(),
    now()
  );
  
  RETURN jsonb_build_object('idempotent', false, 'status', 'processing', 'retry', false);
END;
$function$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_unique_items_atomic(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pos_begin_request(uuid, text, jsonb) TO authenticated, service_role;