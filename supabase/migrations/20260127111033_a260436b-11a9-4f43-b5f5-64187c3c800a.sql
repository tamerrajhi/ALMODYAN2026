-- =============================================================================
-- DRIFT-CLOSEOUT PATCH: Fix column name mismatches in RPC
-- =============================================================================

CREATE OR REPLACE FUNCTION public.complete_purchase_return_unique_items_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    IF SQLERRM LIKE 'CONFLICT_IN_PROGRESS:%' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Request is already being processed', 'error_code', 'CONFLICT_IN_PROGRESS');
    END IF;
    RAISE;
  END;

  IF COALESCE(v_begin->>'status','') = 'succeeded' AND v_begin ? 'result' THEN
    RETURN (v_begin->'result');
  END IF;

  -- =========================
  -- 2) Extract header fields
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
  -- 4) DYNAMIC ACCOUNTS (No Hardcode!)
  -- =========================
  v_inventory_account_id := get_branch_account_id(v_branch_id, 'inventory');
  v_vat_input_account_id := get_branch_account_id(v_branch_id, 'vat_input');
  
  BEGIN
    SELECT account_id INTO v_supplier_account_id FROM suppliers WHERE id = v_supplier_id;
  EXCEPTION WHEN undefined_column THEN
    v_supplier_account_id := NULL;
  END;
  
  IF v_supplier_account_id IS NULL THEN
    v_supplier_account_id := get_branch_account_id(v_branch_id, 'ap_supplier');
  END IF;

  -- Validate REQUIRED accounts (inventory + supplier)
  IF v_inventory_account_id IS NULL OR v_supplier_account_id IS NULL THEN
    PERFORM pos_fail_request(v_client_request_id, 'CONFIG_ERROR', 
      format('Missing accounting config: inventory=%s, supplier=%s for branch %s',
        COALESCE(v_inventory_account_id::text, 'NULL'),
        COALESCE(v_supplier_account_id::text, 'NULL'),
        COALESCE(v_branch_id::text, 'NULL')
      ));
    RETURN jsonb_build_object('success', false, 
      'error', 'Missing required accounting configuration (inventory or supplier account)', 
      'error_code', 'CONFIG_ERROR');
  END IF;

  -- =========================
  -- 5) Generate return number + create header
  -- =========================
  SELECT nextval('purchase_return_number_seq') INTO v_return_number;
  v_return_number := 'PR-' || LPAD(v_return_number::text, 6, '0');

  v_return_id := gen_random_uuid();

  -- FIXED: Use actual columns: purchase_type (not return_type), processed_by (not created_by)
  INSERT INTO public.purchase_returns (
    id, return_number, purchase_type, supplier_id, branch_id,
    purchase_invoice_id, return_date, status,
    subtotal, tax_amount, total_amount,
    reason, notes,
    processed_by, created_at, updated_at
  ) VALUES (
    v_return_id, v_return_number, 'unique', v_supplier_id, v_branch_id,
    v_purchase_invoice_id, v_return_date::date, 'completed',
    0, 0, 0,
    v_reason, v_notes,
    v_user_name, now(), now()
  );

  -- =========================
  -- 6) Process items
  -- =========================
  v_expected_count := jsonb_array_length(p_payload->'items');
  
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items')
  LOOP
    v_item_id := (v_item->>'jewelry_item_id')::uuid;

    SELECT COALESCE(cost, 0), COALESCE(description, 'قطعة مرتجعة')
      INTO v_item_cost, v_item_desc
      FROM jewelry_items
     WHERE id = v_item_id;

    v_subtotal := v_subtotal + v_item_cost;

    -- FIXED: Use actual columns: return_id (not purchase_return_id), total_amount (not total_price)
    INSERT INTO public.purchase_return_items (
      id, return_id, jewelry_item_id,
      description, quantity, unit_price, 
      discount_amount, tax_rate, tax_amount, total_amount,
      created_at
    ) VALUES (
      gen_random_uuid(), v_return_id, v_item_id,
      v_item_desc, 1, v_item_cost,
      0, v_tax_rate, ROUND(v_item_cost * v_tax_rate, 2), ROUND(v_item_cost * (1 + v_tax_rate), 2),
      now()
    );

    UPDATE public.jewelry_items
       SET branch_id = NULL,
           status = 'returned_to_supplier',
           updated_at = now()
     WHERE id = v_item_id;

    -- FIXED: Use actual column: item_id (not jewelry_item_id)
    INSERT INTO public.item_movements (
      id, item_id, movement_type,
      from_branch_id, to_branch_id,
      movement_date, performed_by, notes,
      purchase_return_id, cost, created_at
    ) VALUES (
      gen_random_uuid(), v_item_id, 'purchase_return',
      v_branch_id, NULL,
      now(), v_user_name, 'مرتجع مشتريات - ' || v_return_number,
      v_return_id, v_item_cost, now()
    );
    
    v_movement_count := v_movement_count + 1;
  END LOOP;

  -- Verify all movements created
  IF v_movement_count <> v_expected_count THEN
    PERFORM pos_fail_request(v_client_request_id, 'MOVEMENT_ERROR', 
      format('Movement count mismatch: expected %s, created %s', v_expected_count, v_movement_count));
    RAISE EXCEPTION 'Movement count mismatch';
  END IF;

  -- Calculate tax
  v_tax_amount := ROUND(v_subtotal * v_tax_rate, 2);
  v_total_amount := v_subtotal + v_tax_amount;

  -- Update return header with totals
  UPDATE public.purchase_returns
     SET subtotal = v_subtotal,
         tax_amount = v_tax_amount,
         total_amount = v_total_amount,
         updated_at = now()
   WHERE id = v_return_id;

  -- =========================
  -- 7) Create Journal Entry
  -- =========================
  v_je_number := generate_journal_entry_number();
  v_je_id := gen_random_uuid();

  INSERT INTO public.journal_entries (
    id, entry_number, entry_date, description,
    reference_type, reference_id,
    total_debit, total_credit, is_posted,
    branch_id, created_by, created_at
  ) VALUES (
    v_je_id, v_je_number, now()::date,
    'مرتجع مشتريات قطع فريدة - ' || v_return_number,
    'purchase_return', v_return_id,
    v_total_amount, v_total_amount, true,
    v_branch_id, v_user_id, now()
  );

  -- JE Lines:
  -- Debit: Supplier/AP (reduce liability)
  INSERT INTO public.journal_entry_lines (
    id, journal_entry_id, account_id,
    debit_amount, credit_amount, description
  ) VALUES (
    gen_random_uuid(), v_je_id, v_supplier_account_id,
    v_total_amount, 0, 'تخفيض ذمم المورد - مرتجع مشتريات'
  );

  -- Credit: Inventory (reduce asset)
  INSERT INTO public.journal_entry_lines (
    id, journal_entry_id, account_id,
    debit_amount, credit_amount, description
  ) VALUES (
    gen_random_uuid(), v_je_id, v_inventory_account_id,
    0, v_subtotal, 'تخفيض المخزون - مرتجع مشتريات'
  );

  -- Credit: VAT Input (reduce asset) - ONLY if tax > 0 AND vat account exists
  IF v_tax_amount > 0 THEN
    IF v_vat_input_account_id IS NULL THEN
      PERFORM pos_fail_request(v_client_request_id, 'CONFIG_ERROR', 
        format('VAT amount is %s but no VAT Input account configured for branch %s', 
          v_tax_amount, COALESCE(v_branch_id::text, 'NULL')));
      RAISE EXCEPTION 'VAT account required but not configured';
    END IF;
    
    INSERT INTO public.journal_entry_lines (
      id, journal_entry_id, account_id,
      debit_amount, credit_amount, description
    ) VALUES (
      gen_random_uuid(), v_je_id, v_vat_input_account_id,
      0, v_tax_amount, 'تخفيض ضريبة المدخلات - مرتجع مشتريات'
    );
  END IF;

  -- Link JE to return
  UPDATE public.purchase_returns
     SET journal_entry_id = v_je_id,
         updated_at = now()
   WHERE id = v_return_id;

  -- =========================
  -- 8) Audit Event
  -- =========================
  INSERT INTO public.audit_events (
    entity_type, entity_id, entity_number,
    action, actor_id, branch_id, payload
  ) VALUES (
    'purchase_return_unique', v_return_id, v_return_number,
    'created', v_user_id, v_branch_id,
    jsonb_build_object(
      'return_number', v_return_number,
      'supplier_id', v_supplier_id,
      'total_amount', v_total_amount,
      'items_count', v_expected_count,
      'journal_entry_id', v_je_id,
      'accounts_used', jsonb_build_object(
        'inventory', v_inventory_account_id,
        'vat_input', v_vat_input_account_id,
        'supplier', v_supplier_account_id
      )
    )
  );

  -- =========================
  -- 9) Mark success
  -- =========================
  PERFORM pos_succeed_request(v_client_request_id, v_return_id, jsonb_build_object(
    'success', true,
    'return_id', v_return_id,
    'return_number', v_return_number,
    'journal_entry_id', v_je_id,
    'total_amount', v_total_amount
  ));

  RETURN jsonb_build_object(
    'success', true,
    'return_id', v_return_id,
    'return_number', v_return_number,
    'journal_entry_id', v_je_id,
    'subtotal', v_subtotal,
    'tax_amount', v_tax_amount,
    'total_amount', v_total_amount,
    'items_processed', v_expected_count
  );

EXCEPTION WHEN OTHERS THEN
  PERFORM pos_fail_request(v_client_request_id, 'UNEXPECTED_ERROR', SQLERRM);
  RAISE;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_unique_items_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_unique_items_atomic(jsonb) TO service_role;