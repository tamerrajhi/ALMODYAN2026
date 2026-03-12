-- ============================================================
-- FIX V2: args IS the payload (Group 3 handler unwraps p_payload)
-- ============================================================

CREATE OR REPLACE FUNCTION unique_purchase_import_excel_atomic(args jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_client_req_id text  := args->>'client_request_id';
  v_supplier_id   uuid  := (args->>'supplier_id')::uuid;
  v_branch_id     uuid  := (args->>'branch_id')::uuid;
  v_vat_rate      numeric := COALESCE((args->>'vat_rate')::numeric, 0);
  v_created_by    uuid  := NULLIF(args->>'created_by', '')::uuid;
  v_uploaded_file text  := args->>'uploaded_file_name';
  v_files         jsonb := args->'files';

  v_wf_key        text;
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
  v_wf_key := v_client_req_id || '::unique_import_excel';

  -- IDEMPOTENCY CHECK
  SELECT result_payload INTO v_cached
  FROM atomic_workflow_requests
  WHERE client_request_id = v_wf_key AND status = 'completed';
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  INSERT INTO atomic_workflow_requests (client_request_id, workflow_type, status, created_by)
  VALUES (v_wf_key, 'unique_import_excel', 'pending', v_created_by)
  ON CONFLICT (client_request_id) DO NOTHING;

  -- RESOLVE BRANCH CODE + ACCOUNT IDs
  SELECT code INTO v_branch_code FROM branches WHERE id = v_branch_id;
  IF v_branch_code IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_NOT_FOUND', 'message_ar', 'الفرع غير موجود');
  END IF;

  SELECT id INTO v_inv_acct_id FROM chart_of_accounts WHERE account_code = v_branch_code || '-1301';
  IF v_inv_acct_id IS NULL THEN
    SELECT id INTO v_inv_acct_id FROM chart_of_accounts WHERE account_code = '1301';
  END IF;
  IF v_inv_acct_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'CONFIG_ERROR', 'message_ar', 'حساب المخزون 1301 غير موجود');
  END IF;

  SELECT id INTO v_ap_acct_id FROM chart_of_accounts WHERE account_code = v_branch_code || '-2101';
  IF v_ap_acct_id IS NULL THEN
    SELECT id INTO v_ap_acct_id FROM chart_of_accounts WHERE account_code = '2101';
  END IF;
  IF v_ap_acct_id IS NULL THEN
    SELECT id INTO v_ap_acct_id FROM chart_of_accounts WHERE account_code = '2100';
  END IF;
  IF v_ap_acct_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'CONFIG_ERROR', 'message_ar', 'حساب الموردين 2101 غير موجود');
  END IF;

  IF v_vat_rate > 0 THEN
    SELECT id INTO v_vat_acct_id FROM chart_of_accounts WHERE account_code = v_branch_code || '-2105';
    IF v_vat_acct_id IS NULL THEN
      SELECT id INTO v_vat_acct_id FROM chart_of_accounts WHERE account_code = '2105';
    END IF;
    IF v_vat_acct_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'CONFIG_ERROR', 'message_ar', 'حساب ضريبة المدخلات 2105 غير موجود');
    END IF;
  END IF;

  -- CREATE BATCH
  v_batch_no := 'UPB-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('unique_serial_seq')::text, 4, '0');
  INSERT INTO unique_purchase_batches (batch_no, supplier_id, branch_id, uploaded_file_name, status, created_by)
  VALUES (v_batch_no, v_supplier_id, v_branch_id, v_uploaded_file, 'importing', v_created_by)
  RETURNING id INTO v_batch_id;

  -- PROCESS EACH FILE
  FOR v_file IN SELECT jsonb_array_elements(v_files)
  LOOP
    v_file_idx := v_file_idx + 1;
    v_supp_inv := v_file->>'supp_inv';
    v_inv_date := COALESCE((v_file->>'invoice_date')::date, CURRENT_DATE);

    v_inv_no := 'UINV-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('unique_serial_seq')::text, 4, '0');

    v_subtotal := 0;
    FOR v_row IN SELECT jsonb_array_elements(v_file->'rows')
    LOOP
      v_item_cost := COALESCE((v_row->'raw_row_json'->>'COST')::numeric, 0);
      v_subtotal := v_subtotal + v_item_cost;
    END LOOP;

    v_tax_amount := CASE WHEN v_vat_rate > 0 THEN ROUND(v_subtotal * v_vat_rate / 100, 2) ELSE 0 END;
    v_total_amount := v_subtotal + v_tax_amount;

    -- JOURNAL ENTRY
    v_je_no := 'JE-UIMP-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('unique_serial_seq')::text, 4, '0');
    INSERT INTO journal_entries (
      entry_number, entry_date, description, reference_type, branch_id,
      total_debit, total_credit, is_posted, posted_at, status, created_by
    ) VALUES (
      v_je_no, v_inv_date, 'استيراد فريد - فاتورة ' || v_inv_no,
      'unique_purchase_invoice', v_branch_id,
      v_total_amount, v_total_amount, true, now(), 'posted', v_created_by
    ) RETURNING id INTO v_je_id;

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_inv_acct_id, v_subtotal, 0, 'مخزون - استيراد فريد');
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_ap_acct_id, 0, v_total_amount, 'ذمم دائنة - استيراد فريد');
    IF v_vat_rate > 0 AND v_tax_amount > 0 THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
      VALUES (v_je_id, v_vat_acct_id, v_tax_amount, 0, 'ضريبة مدخلات - استيراد فريد');
    END IF;

    -- INVOICE
    INSERT INTO unique_purchase_invoices (
      batch_id, supplier_id, branch_id, supp_inv, invoice_number, invoice_date,
      status, vat_rate, subtotal, tax_amount, total_amount, journal_entry_id, created_by
    ) VALUES (
      v_batch_id, v_supplier_id, v_branch_id, v_supp_inv, v_inv_no, v_inv_date,
      'posted', v_vat_rate, v_subtotal, v_tax_amount, v_total_amount, v_je_id, v_created_by
    ) RETURNING id INTO v_inv_id;

    UPDATE journal_entries SET reference_id = v_inv_id WHERE id = v_je_id;
    v_total_invoices := v_total_invoices + 1;

    -- ITEMS + INVOICE_ITEMS + MOVEMENTS
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
        raw_headers_json, raw_values_json, raw_row_json, created_by
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

      INSERT INTO unique_purchase_invoice_items (unique_invoice_id, unique_item_id, line_no, unit_cost, qty, line_total)
      VALUES (v_inv_id, v_item_id, v_line_no, v_item_cost, 1, v_item_cost);

      INSERT INTO item_movements (item_id, movement_type, to_branch_id, reference_type, reference_id, unit_cost, notes, created_by)
      VALUES (v_item_id, 'purchase_in', v_branch_id, 'unique_purchase_invoice', v_inv_id, v_item_cost, 'استيراد فريد', v_created_by);

      v_total_items := v_total_items + 1;
    END LOOP;
  END LOOP;

  UPDATE unique_purchase_batches
  SET status = 'completed', rows_total = v_total_items, rows_imported = v_total_items
  WHERE id = v_batch_id;

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
  WHERE client_request_id = v_wf_key;

  RETURN v_result;
END;
$$;

-- Return create: args IS the payload
CREATE OR REPLACE FUNCTION unique_purchase_return_create_atomic(args jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_client_req_id  text  := args->>'client_request_id';
  v_supplier_id    uuid  := (args->>'supplier_id')::uuid;
  v_branch_id      uuid  := (args->>'branch_id')::uuid;
  v_invoice_id     uuid  := NULLIF(args->>'unique_invoice_id', '')::uuid;
  v_reason         text  := args->>'reason';
  v_items          jsonb := args->'items';
  v_created_by     uuid  := NULLIF(args->>'created_by', '')::uuid;

  v_wf_key         text;
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
  v_wf_key := v_client_req_id || '::unique_purchase_return';

  SELECT result_payload INTO v_cached
  FROM atomic_workflow_requests WHERE client_request_id = v_wf_key AND status = 'completed';
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  INSERT INTO atomic_workflow_requests (client_request_id, workflow_type, status, created_by)
  VALUES (v_wf_key, 'unique_purchase_return', 'pending', v_created_by)
  ON CONFLICT (client_request_id) DO NOTHING;

  SELECT code INTO v_branch_code FROM branches WHERE id = v_branch_id;
  IF v_branch_code IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_NOT_FOUND');
  END IF;

  SELECT id INTO v_inv_acct_id FROM chart_of_accounts WHERE account_code = v_branch_code || '-1301';
  IF v_inv_acct_id IS NULL THEN
    SELECT id INTO v_inv_acct_id FROM chart_of_accounts WHERE account_code = '1301';
  END IF;

  SELECT id INTO v_ap_acct_id FROM chart_of_accounts WHERE account_code = v_branch_code || '-2101';
  IF v_ap_acct_id IS NULL THEN
    SELECT id INTO v_ap_acct_id FROM chart_of_accounts WHERE account_code = '2101';
  END IF;
  IF v_ap_acct_id IS NULL THEN
    SELECT id INTO v_ap_acct_id FROM chart_of_accounts WHERE account_code = '2100';
  END IF;

  v_return_no := 'UPR-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('unique_serial_seq')::text, 4, '0');

  INSERT INTO unique_purchase_returns (
    return_number, supplier_id, branch_id, unique_invoice_id,
    return_date, status, reason, created_by
  ) VALUES (
    v_return_no, v_supplier_id, v_branch_id, v_invoice_id,
    CURRENT_DATE, 'posted', v_reason, v_created_by
  ) RETURNING id INTO v_return_id;

  FOR v_item IN SELECT jsonb_array_elements(v_items)
  LOOP
    v_item_id := (v_item->>'unique_item_id')::uuid;
    SELECT cost INTO v_unit_cost FROM unique_items WHERE id = v_item_id;
    v_subtotal := v_subtotal + COALESCE(v_unit_cost, 0);

    INSERT INTO unique_purchase_return_items (unique_return_id, unique_item_id, unit_cost, qty, line_total)
    VALUES (v_return_id, v_item_id, COALESCE(v_unit_cost, 0), 1, COALESCE(v_unit_cost, 0));

    INSERT INTO item_movements (item_id, movement_type, from_branch_id, reference_type, reference_id, unit_cost, created_by)
    VALUES (v_item_id, 'purchase_return_out', v_branch_id, 'unique_purchase_return', v_return_id, v_unit_cost, v_created_by);
  END LOOP;

  UPDATE unique_purchase_returns SET subtotal = v_subtotal, total_amount = v_subtotal WHERE id = v_return_id;

  v_je_no := 'JE-UPR-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('unique_serial_seq')::text, 4, '0');
  INSERT INTO journal_entries (
    entry_number, entry_date, description, reference_type, reference_id,
    branch_id, total_debit, total_credit, is_posted, posted_at, status, created_by
  ) VALUES (
    v_je_no, CURRENT_DATE, 'مرتجع شراء فريد - ' || v_return_no,
    'unique_purchase_return', v_return_id,
    v_branch_id, v_subtotal, v_subtotal, true, now(), 'posted', v_created_by
  ) RETURNING id INTO v_je_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
  VALUES (v_je_id, v_inv_acct_id, 0, v_subtotal, 'مرتجع مخزون');
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
  WHERE client_request_id = v_wf_key;

  RETURN v_result;
END;
$$;

-- Return void: args IS the payload
CREATE OR REPLACE FUNCTION unique_purchase_return_void_atomic(args jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_client_req_id  text  := args->>'client_request_id';
  v_return_id      uuid  := (args->>'return_id')::uuid;
  v_void_reason    text  := args->>'void_reason';
  v_created_by     uuid  := NULLIF(args->>'created_by', '')::uuid;

  v_wf_key         text;
  v_return_rec     record;
  v_je_id          uuid;
  v_rev_je_id      uuid;
  v_rev_je_no      text;
  v_cached         jsonb;
  v_result         jsonb;
BEGIN
  v_wf_key := v_client_req_id || '::unique_purchase_return_void';

  SELECT result_payload INTO v_cached
  FROM atomic_workflow_requests WHERE client_request_id = v_wf_key AND status = 'completed';
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  INSERT INTO atomic_workflow_requests (client_request_id, workflow_type, status, created_by)
  VALUES (v_wf_key, 'unique_purchase_return_void', 'pending', v_created_by)
  ON CONFLICT (client_request_id) DO NOTHING;

  SELECT * INTO v_return_rec FROM unique_purchase_returns WHERE id = v_return_id;
  IF v_return_rec IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND', 'message_ar', 'المرتجع غير موجود');
  END IF;
  IF v_return_rec.status = 'voided' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_VOIDED', 'message_ar', 'المرتجع ملغي مسبقاً');
  END IF;

  v_je_id := v_return_rec.journal_entry_id;

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

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    SELECT v_rev_je_id, account_id, credit_amount, debit_amount, 'عكس: ' || COALESCE(description, '')
    FROM journal_entry_lines WHERE journal_entry_id = v_je_id;

    UPDATE journal_entries SET reversed_by_je_id = v_rev_je_id, voided_at = now(), void_reason = v_void_reason
    WHERE id = v_je_id;
  END IF;

  UPDATE unique_purchase_returns SET status = 'voided' WHERE id = v_return_id;

  v_result := jsonb_build_object(
    'success', true,
    'return_id', v_return_id,
    'reversal_je_id', v_rev_je_id
  );

  UPDATE atomic_workflow_requests
  SET status = 'completed', result_payload = v_result, completed_at = now()
  WHERE client_request_id = v_wf_key;

  RETURN v_result;
END;
$$;
