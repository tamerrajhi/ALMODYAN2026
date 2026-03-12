-- ============================================================
-- UNIQUE PURCHASE MODULE V1 — Atomic RPC Functions
-- Idempotent: CREATE OR REPLACE
-- ============================================================

-- ============================================================
-- 1. unique_purchase_supp_inv_precheck
--    Check if any SUPP INV already exists for a given supplier
-- ============================================================
CREATE OR REPLACE FUNCTION unique_purchase_supp_inv_precheck(
  p_supplier_id uuid,
  p_supp_invs text[]
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_existing text[];
BEGIN
  SELECT array_agg(upper(trim(supp_inv)))
  INTO v_existing
  FROM unique_purchase_invoices
  WHERE supplier_id = p_supplier_id
    AND status <> 'voided'
    AND supp_inv IS NOT NULL
    AND trim(supp_inv) <> ''
    AND upper(trim(supp_inv)) = ANY (
      SELECT upper(trim(unnest)) FROM unnest(p_supp_invs)
    );

  IF v_existing IS NOT NULL AND array_length(v_existing, 1) > 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'exists', to_jsonb(v_existing)
    );
  ELSE
    RETURN jsonb_build_object(
      'success', true,
      'exists', '[]'::jsonb
    );
  END IF;
END;
$$;

-- jsonb overload for Group 3 handler
CREATE OR REPLACE FUNCTION unique_purchase_supp_inv_precheck(args jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  RETURN unique_purchase_supp_inv_precheck(
    (args->>'p_supplier_id')::uuid,
    ARRAY(SELECT jsonb_array_elements_text(args->'p_supp_invs'))
  );
END;
$$;

-- ============================================================
-- 2. unique_purchase_import_excel_atomic
--    Single-transaction import: batch + invoices + items + movements + JE
-- ============================================================
CREATE OR REPLACE FUNCTION unique_purchase_import_excel_atomic(args jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_payload       jsonb := args->'p_payload';
  v_client_req_id text  := v_payload->>'client_request_id';
  v_supplier_id   uuid  := (v_payload->>'supplier_id')::uuid;
  v_branch_id     uuid  := (v_payload->>'branch_id')::uuid;
  v_vat_rate      numeric := COALESCE((v_payload->>'vat_rate')::numeric, 0);
  v_created_by    uuid  := NULLIF(v_payload->>'created_by', '')::uuid;
  v_uploaded_file text  := v_payload->>'uploaded_file_name';
  v_files         jsonb := v_payload->'files';

  v_branch_code   text;
  v_batch_id      uuid;
  v_batch_no      text;
  v_total_items   int := 0;
  v_total_invoices int := 0;

  v_inv_acct_id   uuid;
  v_ap_acct_id    uuid;
  v_vat_acct_id   uuid;

  v_file          jsonb;
  v_row           jsonb;
  v_file_idx      int := 0;
  v_row_idx       int;
  v_serial        text;
  v_item_id       uuid;
  v_inv_id        uuid;
  v_inv_no        text;
  v_supp_inv      text;
  v_inv_date      date;
  v_subtotal      numeric;
  v_tax_amount    numeric;
  v_total_amount  numeric;
  v_je_id         uuid;
  v_je_no         text;
  v_line_no       int;
  v_item_cost     numeric;

  v_cached        jsonb;
  v_result        jsonb;
BEGIN
  -- ==========================================
  -- IDEMPOTENCY CHECK
  -- ==========================================
  SELECT result_payload INTO v_cached
  FROM atomic_workflow_requests
  WHERE client_request_id = v_client_req_id
    AND workflow_type = 'unique_import_excel'
    AND status = 'completed';

  IF v_cached IS NOT NULL THEN
    RETURN v_cached;
  END IF;

  -- Register workflow
  INSERT INTO atomic_workflow_requests (client_request_id, workflow_type, status, created_by)
  VALUES (v_client_req_id, 'unique_import_excel', 'pending', v_created_by)
  ON CONFLICT (client_request_id, workflow_type) DO NOTHING;

  -- ==========================================
  -- RESOLVE BRANCH CODE + ACCOUNT IDs
  -- ==========================================
  SELECT code INTO v_branch_code FROM branches WHERE id = v_branch_id;
  IF v_branch_code IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_NOT_FOUND', 'message_ar', 'الفرع غير موجود');
  END IF;

  -- Inventory account: <BR>-1301 else 1301
  SELECT id INTO v_inv_acct_id FROM chart_of_accounts
  WHERE account_code = v_branch_code || '-1301';
  IF v_inv_acct_id IS NULL THEN
    SELECT id INTO v_inv_acct_id FROM chart_of_accounts WHERE account_code = '1301';
  END IF;
  IF v_inv_acct_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'CONFIG_ERROR', 'message_ar', 'حساب المخزون 1301 غير موجود');
  END IF;

  -- AP account: <BR>-2101 else 2101 else 2100
  SELECT id INTO v_ap_acct_id FROM chart_of_accounts
  WHERE account_code = v_branch_code || '-2101';
  IF v_ap_acct_id IS NULL THEN
    SELECT id INTO v_ap_acct_id FROM chart_of_accounts WHERE account_code = '2101';
  END IF;
  IF v_ap_acct_id IS NULL THEN
    SELECT id INTO v_ap_acct_id FROM chart_of_accounts WHERE account_code = '2100';
  END IF;
  IF v_ap_acct_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'CONFIG_ERROR', 'message_ar', 'حساب الموردين 2101 غير موجود');
  END IF;

  -- VAT input account (only needed if vat_rate > 0): <BR>-2105 else 2105
  IF v_vat_rate > 0 THEN
    SELECT id INTO v_vat_acct_id FROM chart_of_accounts
    WHERE account_code = v_branch_code || '-2105';
    IF v_vat_acct_id IS NULL THEN
      SELECT id INTO v_vat_acct_id FROM chart_of_accounts WHERE account_code = '2105';
    END IF;
    IF v_vat_acct_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'CONFIG_ERROR', 'message_ar', 'حساب ضريبة المدخلات 2105 غير موجود');
    END IF;
  END IF;

  -- ==========================================
  -- CREATE BATCH
  -- ==========================================
  v_batch_no := 'UPB-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('unique_serial_seq')::text, 4, '0');
  INSERT INTO unique_purchase_batches (batch_no, supplier_id, branch_id, uploaded_file_name, status, created_by)
  VALUES (v_batch_no, v_supplier_id, v_branch_id, v_uploaded_file, 'importing', v_created_by)
  RETURNING id INTO v_batch_id;

  -- ==========================================
  -- PROCESS EACH FILE → ONE INVOICE PER FILE
  -- ==========================================
  FOR v_file IN SELECT jsonb_array_elements(v_files)
  LOOP
    v_file_idx := v_file_idx + 1;
    v_supp_inv := v_file->>'supp_inv';
    v_inv_date := COALESCE((v_file->>'invoice_date')::date, CURRENT_DATE);

    -- Generate invoice number
    v_inv_no := 'UINV-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('unique_serial_seq')::text, 4, '0');

    -- Calculate subtotal from rows
    v_subtotal := 0;
    v_row_idx := 0;
    FOR v_row IN SELECT jsonb_array_elements(v_file->'rows')
    LOOP
      v_row_idx := v_row_idx + 1;
      -- Extract cost from raw_row_json
      v_item_cost := COALESCE(
        (v_row->'raw_row_json'->>'COST')::numeric,
        0
      );
      v_subtotal := v_subtotal + v_item_cost;
    END LOOP;

    v_tax_amount := CASE WHEN v_vat_rate > 0 THEN ROUND(v_subtotal * v_vat_rate / 100, 2) ELSE 0 END;
    v_total_amount := v_subtotal + v_tax_amount;

    -- ==========================================
    -- CREATE JOURNAL ENTRY
    -- ==========================================
    v_je_no := 'JE-UIMP-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('unique_serial_seq')::text, 4, '0');
    INSERT INTO journal_entries (
      entry_number, entry_date, description, reference_type, branch_id,
      total_debit, total_credit, is_posted, posted_at, status, created_by
    ) VALUES (
      v_je_no, v_inv_date,
      'استيراد فريد - فاتورة ' || v_inv_no,
      'unique_purchase_invoice', v_branch_id,
      v_total_amount, v_total_amount,
      true, now(), 'posted', v_created_by
    ) RETURNING id INTO v_je_id;

    -- JE Line 1: Debit Inventory
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_inv_acct_id, v_subtotal, 0, 'مخزون - استيراد فريد');

    -- JE Line 2: Credit AP
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_ap_acct_id, 0, v_total_amount, 'ذمم دائنة - استيراد فريد');

    -- JE Line 3: Debit VAT Input (only if vat_rate > 0)
    IF v_vat_rate > 0 AND v_tax_amount > 0 THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
      VALUES (v_je_id, v_vat_acct_id, v_tax_amount, 0, 'ضريبة مدخلات - استيراد فريد');
    END IF;

    -- ==========================================
    -- CREATE INVOICE
    -- ==========================================
    INSERT INTO unique_purchase_invoices (
      batch_id, supplier_id, branch_id, supp_inv, invoice_number, invoice_date,
      status, vat_rate, subtotal, tax_amount, total_amount,
      journal_entry_id, created_by
    ) VALUES (
      v_batch_id, v_supplier_id, v_branch_id, v_supp_inv, v_inv_no, v_inv_date,
      'posted', v_vat_rate, v_subtotal, v_tax_amount, v_total_amount,
      v_je_id, v_created_by
    ) RETURNING id INTO v_inv_id;

    -- Update JE reference_id to invoice
    UPDATE journal_entries SET reference_id = v_inv_id WHERE id = v_je_id;

    v_total_invoices := v_total_invoices + 1;

    -- ==========================================
    -- CREATE ITEMS + INVOICE_ITEMS + MOVEMENTS
    -- ==========================================
    v_line_no := 0;
    FOR v_row IN SELECT jsonb_array_elements(v_file->'rows')
    LOOP
      v_line_no := v_line_no + 1;
      v_serial := 'SN-' || lpad(nextval('unique_serial_seq')::text, 8, '0');
      v_item_cost := COALESCE((v_row->'raw_row_json'->>'COST')::numeric, 0);

      INSERT INTO unique_items (
        serial_no, branch_id, supplier_id, batch_id, unique_invoice_id,
        stockcode, model, description, division, supp_ref, type, cost_code,
        tag1, tag2, tag3, tag4, tag5,
        cost, tag_price, minimum_price,
        g_weight, d_weight, b_weight, mq_weight, cs_weight,
        stone_weight, metal_weight, m_weight,
        rate_type, clarity, metal, stone,
        raw_headers_json, raw_values_json, raw_row_json,
        created_by
      ) VALUES (
        v_serial, v_branch_id, v_supplier_id, v_batch_id, v_inv_id,
        v_row->'raw_row_json'->>'STOCKCODE',
        v_row->'raw_row_json'->>'MODEL',
        v_row->'raw_row_json'->>'DESCRIPTION',
        v_row->'raw_row_json'->>'DIVISION',
        v_row->'raw_row_json'->>'SUPP.REF',
        v_row->'raw_row_json'->>'TYPE',
        v_row->'raw_row_json'->>'COST CODE',
        v_row->'raw_row_json'->>'TAG1',
        v_row->'raw_row_json'->>'TAG2',
        v_row->'raw_row_json'->>'TAG3',
        v_row->'raw_row_json'->>'TAG4',
        v_row->'raw_row_json'->>'TAG5',
        v_item_cost,
        COALESCE((v_row->'raw_row_json'->>'TAG PRICE')::numeric, 0),
        COALESCE((v_row->'raw_row_json'->>'MINIMUM PRICE')::numeric, 0),
        COALESCE((v_row->'raw_row_json'->>'G')::numeric, 0),
        COALESCE((v_row->'raw_row_json'->>'D')::numeric, 0),
        COALESCE((v_row->'raw_row_json'->>'B')::numeric, 0),
        COALESCE((v_row->'raw_row_json'->>'MQ')::numeric, 0),
        COALESCE((v_row->'raw_row_json'->>'CS')::numeric, 0),
        COALESCE((v_row->'raw_row_json'->>'STONE')::numeric, 0),
        COALESCE((v_row->'raw_row_json'->>'METAL')::numeric, 0),
        COALESCE((v_row->'raw_row_json'->>'M')::numeric, 0),
        v_row->'raw_row_json'->>'RATE TYPE',
        v_row->'raw_row_json'->>'CLARITY',
        v_row->'raw_row_json'->>'METAL',
        v_row->'raw_row_json'->>'STONE',
        COALESCE(v_row->'raw_headers_json', '[]'::jsonb),
        COALESCE(v_row->'raw_values_json', '[]'::jsonb),
        v_row->'raw_row_json',
        v_created_by
      ) RETURNING id INTO v_item_id;

      -- Invoice line item
      INSERT INTO unique_purchase_invoice_items (unique_invoice_id, unique_item_id, line_no, unit_cost, qty, line_total)
      VALUES (v_inv_id, v_item_id, v_line_no, v_item_cost, 1, v_item_cost);

      -- Item movement: purchase_in
      INSERT INTO item_movements (item_id, movement_type, to_branch_id, reference_type, reference_id, unit_cost, notes, created_by)
      VALUES (v_item_id, 'purchase_in', v_branch_id, 'unique_purchase_invoice', v_inv_id, v_item_cost, 'استيراد فريد', v_created_by);

      v_total_items := v_total_items + 1;
    END LOOP;
  END LOOP;

  -- ==========================================
  -- UPDATE BATCH STATUS
  -- ==========================================
  UPDATE unique_purchase_batches
  SET status = 'completed',
      rows_total = v_total_items,
      rows_imported = v_total_items
  WHERE id = v_batch_id;

  -- ==========================================
  -- BUILD RESULT + CACHE
  -- ==========================================
  v_result := jsonb_build_object(
    'success', true,
    'batch_id', v_batch_id,
    'batch_no', v_batch_no,
    'items_created', v_total_items,
    'items_failed', 0,
    'invoices_created', v_total_invoices
  );

  UPDATE atomic_workflow_requests
  SET status = 'completed', result_payload = v_result, completed_at = now()
  WHERE client_request_id = v_client_req_id AND workflow_type = 'unique_import_excel';

  RETURN v_result;
END;
$$;

-- ============================================================
-- 3. unique_purchase_return_create_atomic
-- ============================================================
CREATE OR REPLACE FUNCTION unique_purchase_return_create_atomic(args jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_payload        jsonb := args->'p_payload';
  v_client_req_id  text  := v_payload->>'client_request_id';
  v_supplier_id    uuid  := (v_payload->>'supplier_id')::uuid;
  v_branch_id      uuid  := (v_payload->>'branch_id')::uuid;
  v_invoice_id     uuid  := NULLIF(v_payload->>'unique_invoice_id', '')::uuid;
  v_reason         text  := v_payload->>'reason';
  v_items          jsonb := v_payload->'items';
  v_created_by     uuid  := NULLIF(v_payload->>'created_by', '')::uuid;

  v_branch_code    text;
  v_return_id      uuid;
  v_return_no      text;
  v_subtotal       numeric := 0;
  v_item           jsonb;
  v_item_id        uuid;
  v_unit_cost      numeric;
  v_je_id          uuid;
  v_je_no          text;
  v_inv_acct_id    uuid;
  v_ap_acct_id     uuid;
  v_cached         jsonb;
  v_result         jsonb;
BEGIN
  -- Idempotency
  SELECT result_payload INTO v_cached
  FROM atomic_workflow_requests
  WHERE client_request_id = v_client_req_id
    AND workflow_type = 'unique_purchase_return'
    AND status = 'completed';
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  INSERT INTO atomic_workflow_requests (client_request_id, workflow_type, status, created_by)
  VALUES (v_client_req_id, 'unique_purchase_return', 'pending', v_created_by)
  ON CONFLICT (client_request_id, workflow_type) DO NOTHING;

  -- Resolve branch code
  SELECT code INTO v_branch_code FROM branches WHERE id = v_branch_id;
  IF v_branch_code IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_NOT_FOUND');
  END IF;

  -- Resolve accounts
  SELECT id INTO v_inv_acct_id FROM chart_of_accounts
  WHERE account_code = v_branch_code || '-1301';
  IF v_inv_acct_id IS NULL THEN
    SELECT id INTO v_inv_acct_id FROM chart_of_accounts WHERE account_code = '1301';
  END IF;

  SELECT id INTO v_ap_acct_id FROM chart_of_accounts
  WHERE account_code = v_branch_code || '-2101';
  IF v_ap_acct_id IS NULL THEN
    SELECT id INTO v_ap_acct_id FROM chart_of_accounts WHERE account_code = '2101';
  END IF;
  IF v_ap_acct_id IS NULL THEN
    SELECT id INTO v_ap_acct_id FROM chart_of_accounts WHERE account_code = '2100';
  END IF;

  -- Generate return number
  v_return_no := 'UPR-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('unique_serial_seq')::text, 4, '0');

  -- Create return header
  INSERT INTO unique_purchase_returns (
    return_number, supplier_id, branch_id, unique_invoice_id,
    return_date, status, reason, created_by
  ) VALUES (
    v_return_no, v_supplier_id, v_branch_id, v_invoice_id,
    CURRENT_DATE, 'posted', v_reason, v_created_by
  ) RETURNING id INTO v_return_id;

  -- Process items
  FOR v_item IN SELECT jsonb_array_elements(v_items)
  LOOP
    v_item_id := (v_item->>'unique_item_id')::uuid;
    SELECT cost INTO v_unit_cost FROM unique_items WHERE id = v_item_id;
    v_subtotal := v_subtotal + COALESCE(v_unit_cost, 0);

    INSERT INTO unique_purchase_return_items (unique_return_id, unique_item_id, unit_cost, qty, line_total)
    VALUES (v_return_id, v_item_id, COALESCE(v_unit_cost, 0), 1, COALESCE(v_unit_cost, 0));

    -- Movement: purchase_return_out
    INSERT INTO item_movements (item_id, movement_type, from_branch_id, reference_type, reference_id, unit_cost, created_by)
    VALUES (v_item_id, 'purchase_return_out', v_branch_id, 'unique_purchase_return', v_return_id, v_unit_cost, v_created_by);
  END LOOP;

  -- Update return totals
  UPDATE unique_purchase_returns
  SET subtotal = v_subtotal, total_amount = v_subtotal
  WHERE id = v_return_id;

  -- JE: reverse of purchase (Credit inventory, Debit AP)
  v_je_no := 'JE-UPR-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('unique_serial_seq')::text, 4, '0');
  INSERT INTO journal_entries (
    entry_number, entry_date, description, reference_type, reference_id,
    branch_id, total_debit, total_credit, is_posted, posted_at, status, created_by
  ) VALUES (
    v_je_no, CURRENT_DATE, 'مرتجع شراء فريد - ' || v_return_no,
    'unique_purchase_return', v_return_id,
    v_branch_id, v_subtotal, v_subtotal, true, now(), 'posted', v_created_by
  ) RETURNING id INTO v_je_id;

  -- Credit Inventory
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
  VALUES (v_je_id, v_inv_acct_id, 0, v_subtotal, 'مرتجع مخزون');

  -- Debit AP
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
  VALUES (v_je_id, v_ap_acct_id, v_subtotal, 0, 'تخفيض ذمم دائنة');

  UPDATE unique_purchase_returns SET journal_entry_id = v_je_id WHERE id = v_return_id;

  v_result := jsonb_build_object(
    'success', true,
    'return_id', v_return_id,
    'return_number', v_return_no,
    'items_returned', jsonb_array_length(v_items),
    'total_amount', v_subtotal
  );

  UPDATE atomic_workflow_requests
  SET status = 'completed', result_payload = v_result, completed_at = now()
  WHERE client_request_id = v_client_req_id AND workflow_type = 'unique_purchase_return';

  RETURN v_result;
END;
$$;

-- ============================================================
-- 4. unique_purchase_return_void_atomic
-- ============================================================
CREATE OR REPLACE FUNCTION unique_purchase_return_void_atomic(args jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_payload        jsonb := args->'p_payload';
  v_client_req_id  text  := v_payload->>'client_request_id';
  v_return_id      uuid  := (v_payload->>'return_id')::uuid;
  v_void_reason    text  := v_payload->>'void_reason';
  v_created_by     uuid  := NULLIF(v_payload->>'created_by', '')::uuid;

  v_return_rec     record;
  v_je_id          uuid;
  v_rev_je_id      uuid;
  v_rev_je_no      text;
  v_cached         jsonb;
  v_result         jsonb;
BEGIN
  -- Idempotency
  SELECT result_payload INTO v_cached
  FROM atomic_workflow_requests
  WHERE client_request_id = v_client_req_id
    AND workflow_type = 'unique_purchase_return_void'
    AND status = 'completed';
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  INSERT INTO atomic_workflow_requests (client_request_id, workflow_type, status, created_by)
  VALUES (v_client_req_id, 'unique_purchase_return_void', 'pending', v_created_by)
  ON CONFLICT (client_request_id, workflow_type) DO NOTHING;

  -- Fetch return
  SELECT * INTO v_return_rec FROM unique_purchase_returns WHERE id = v_return_id;
  IF v_return_rec IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND', 'message_ar', 'المرتجع غير موجود');
  END IF;
  IF v_return_rec.status = 'voided' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_VOIDED', 'message_ar', 'المرتجع ملغي مسبقاً');
  END IF;

  v_je_id := v_return_rec.journal_entry_id;

  -- Create reversal JE if original exists
  IF v_je_id IS NOT NULL THEN
    v_rev_je_no := 'JE-VUPR-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('unique_serial_seq')::text, 4, '0');
    INSERT INTO journal_entries (
      entry_number, entry_date, description, reference_type, reference_id,
      branch_id, total_debit, total_credit, is_posted, posted_at, status,
      reversal_of_je_id, created_by
    ) VALUES (
      v_rev_je_no, CURRENT_DATE,
      'إلغاء مرتجع - ' || v_return_rec.return_number,
      'unique_purchase_return_void', v_return_id,
      v_return_rec.branch_id, v_return_rec.subtotal, v_return_rec.subtotal,
      true, now(), 'posted', v_je_id, v_created_by
    ) RETURNING id INTO v_rev_je_id;

    -- Reverse lines (swap debit/credit)
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    SELECT v_rev_je_id, account_id, credit_amount, debit_amount, 'عكس: ' || COALESCE(description, '')
    FROM journal_entry_lines WHERE journal_entry_id = v_je_id;

    -- Mark original JE
    UPDATE journal_entries SET reversed_by_je_id = v_rev_je_id, voided_at = now(), void_reason = v_void_reason
    WHERE id = v_je_id;
  END IF;

  -- Void the return
  UPDATE unique_purchase_returns
  SET status = 'voided'
  WHERE id = v_return_id;

  v_result := jsonb_build_object(
    'success', true,
    'return_id', v_return_id,
    'reversal_je_id', v_rev_je_id
  );

  UPDATE atomic_workflow_requests
  SET status = 'completed', result_payload = v_result, completed_at = now()
  WHERE client_request_id = v_client_req_id AND workflow_type = 'unique_purchase_return_void';

  RETURN v_result;
END;
$$;
