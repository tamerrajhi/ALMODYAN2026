-- =========================================================
-- P-RET-CANONICAL-WRITERS — Root Fix for Unique Purchase Return
-- Uses ONLY canonical workflow writers (no direct pos_workflow_requests writes)
-- =========================================================

CREATE OR REPLACE FUNCTION public.complete_purchase_return_unique_items_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_request_id uuid;
  v_begin jsonb;
  v_workflow_type text := 'purchase_return_unique_items';

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
  v_begin := pos_begin_request(v_client_request_id, v_workflow_type, p_payload);

  -- expected: {idempotent, status, entity_id?, result?, retry?}
  IF COALESCE(v_begin->>'status','') = 'succeeded' AND v_begin ? 'result' THEN
    -- already completed earlier
    RETURN (v_begin->'result');
  END IF;

  IF COALESCE(v_begin->>'status','') = 'processing' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request is already being processed', 'error_code', 'CONCURRENT_LOCK');
  END IF;

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

  IF v_inventory_account_id IS NULL OR v_supplier_account_id IS NULL THEN
    PERFORM pos_fail_request(v_client_request_id, 'CONFIG_ERROR', 'Missing COA accounts (inventory or supplier/AP)');
    RETURN jsonb_build_object('success', false, 'error', 'Missing COA accounts (inventory or supplier/AP)', 'error_code', 'CONFIG_ERROR');
  END IF;

  -- =========================
  -- 5) Create purchase_returns header
  -- =========================
  v_return_id := gen_random_uuid();
  SELECT 'P-RET-' || LPAD(nextval('purchase_return_number_seq')::text, 6, '0')
    INTO v_return_number;

  INSERT INTO purchase_returns (
    id, return_number, return_date, supplier_id, purchase_invoice_id, branch_id,
    subtotal, tax_amount, total_amount, reason, notes, status, processed_by
  ) VALUES (
    v_return_id, v_return_number, v_return_date, v_supplier_id, v_purchase_invoice_id, v_branch_id,
    0, 0, 0, v_reason, v_notes, 'confirmed', v_user_name
  );

  -- =========================
  -- 6) Process items
  -- =========================
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items')
  LOOP
    v_item_id := COALESCE(
      NULLIF(v_item->>'item_id','')::uuid,
      NULLIF(v_item->>'jewelry_item_id','')::uuid,
      NULLIF(v_item->>'id','')::uuid
    );

    IF v_item_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(cost, 0), COALESCE(item_code, description, 'ITEM') 
      INTO v_item_cost, v_item_desc
      FROM jewelry_items
     WHERE id = v_item_id;

    -- subtotal accum
    v_subtotal := v_subtotal + v_item_cost;

    INSERT INTO purchase_return_items (
      return_id, jewelry_item_id, description,
      quantity, unit_price, tax_rate, tax_amount, total_amount, weight_grams
    ) VALUES (
      v_return_id, v_item_id, v_item_desc,
      1, v_item_cost, v_tax_rate, (v_item_cost * v_tax_rate), (v_item_cost * (1+v_tax_rate)),
      NULL
    );

    -- movements: IMPORTANT: item_movements.item_id, purchase_return_id set, return_id MUST stay NULL
    INSERT INTO item_movements (
      item_id, movement_type, from_branch_id,
      reference_type, reference_id, performed_by, cost,
      purchase_return_id, return_id
    ) VALUES (
      v_item_id, 'PURCHASE_RETURN', v_branch_id,
      'purchase_return', v_return_id, v_user_name, v_item_cost,
      v_return_id, NULL
    );

    -- Update jewelry item status
    UPDATE jewelry_items
       SET sale_status = 'returned',
           is_available_for_sale = false,
           branch_id = NULL,
           updated_at = now()
     WHERE id = v_item_id;

  END LOOP;

  v_tax_amount := (v_subtotal * v_tax_rate);
  v_total_amount := v_subtotal + v_tax_amount;

  UPDATE purchase_returns
     SET subtotal = v_subtotal,
         tax_amount = v_tax_amount,
         total_amount = v_total_amount
   WHERE id = v_return_id;

  -- =========================
  -- 7) Journal entry (schema-compatible)
  -- =========================
  v_je_id := gen_random_uuid();
  v_je_number := 'JE-' || to_char(current_date,'YYYYMMDD') || '-' || LPAD((extract(epoch from now())::bigint % 10000)::text, 4, '0');

  INSERT INTO journal_entries (
    id, entry_number, entry_date, description,
    reference_type, reference_id,
    is_posted, total_debit, total_credit, branch_id
  ) VALUES (
    v_je_id, v_je_number, current_date, 'قيد مرتجع مشتريات - ' || v_return_number,
    'purchase_return', v_return_id,
    true, v_total_amount, v_total_amount, v_branch_id
  );

  -- Debit supplier/AP (reduce payable) total
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
  VALUES (v_je_id, v_supplier_account_id, v_total_amount, 0, 'تخفيض ذمم الموردين - مرتجع مشتريات');

  -- Credit inventory subtotal
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
  VALUES (v_je_id, v_inventory_account_id, 0, v_subtotal, 'تخفيض المخزون - مرتجع مشتريات');

  -- Credit VAT input (if any)
  IF v_tax_amount > 0 AND v_vat_input_account_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_vat_input_account_id, 0, v_tax_amount, 'تخفيض ضريبة المدخلات - مرتجع مشتريات');
  END IF;

  UPDATE purchase_returns
     SET journal_entry_id = v_je_id
   WHERE id = v_return_id;

  -- =========================
  -- 8) Canonical succeed
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
      'subtotal', v_subtotal,
      'tax_amount', v_tax_amount,
      'total_amount', v_total_amount
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'return_id', v_return_id,
    'return_number', v_return_number,
    'journal_entry_id', v_je_id,
    'journal_entry_number', v_je_number,
    'subtotal', v_subtotal,
    'tax_amount', v_tax_amount,
    'total_amount', v_total_amount
  );

EXCEPTION WHEN OTHERS THEN
  PERFORM pos_fail_request(v_client_request_id, SQLSTATE, SQLERRM);
  RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'error_code', SQLSTATE);
END;
$$;

-- Ensure proper grants
REVOKE ALL ON FUNCTION public.complete_purchase_return_unique_items_atomic(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_purchase_return_unique_items_atomic(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_unique_items_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_unique_items_atomic(jsonb) TO service_role;