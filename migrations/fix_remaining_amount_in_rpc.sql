-- Fix: Add paid_amount and remaining_amount to unique_purchase_invoices INSERT in the RPC
-- Problem: When creating invoices, remaining_amount defaults to 0 instead of total_amount
-- Solution: Explicitly set paid_amount=0 and remaining_amount=v_total_amount

CREATE OR REPLACE FUNCTION unique_purchase_import_excel_atomic(args jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_request_id     text;
  v_supplier_id    uuid;
  v_branch_id      uuid;
  v_vat_rate       numeric;
  v_created_by     uuid;
  v_uploaded_file   text;
  v_files          jsonb;
  v_file           jsonb;
  v_batch_id       uuid;
  v_batch_no       text;
  v_inv_id         uuid;
  v_inv_no         text;
  v_supp_inv       text;
  v_inv_date       date;
  v_subtotal       numeric;
  v_tax_amount     numeric;
  v_total_amount   numeric;
  v_je_id          uuid;
  v_je_no          text;
  v_row            jsonb;
  v_serial         text;
  v_item_cost      numeric;
  v_line_no        integer;
  v_inv_acct_id    uuid;
  v_ap_acct_id     uuid;
  v_vat_acct_id    uuid;
  v_item_id        uuid;
  v_raw_headers    jsonb;
  v_raw_values     jsonb;
  v_raw_row_obj    jsonb;
  v_tag_price      numeric;
  v_min_price      numeric;
  v_g_weight       numeric;
  v_d_weight       numeric;
  v_b_weight       numeric;
  v_stockcode      text;
  v_model          text;
  v_description    text;
  v_division       text;
  v_type           text;
  v_metal          text;
  v_stone          text;
  v_supp_ref       text;
  v_cost_code      text;
  v_tag1           text;
  v_tag2           text;
  v_tag3           text;
  v_tag4           text;
  v_tag5           text;
  v_mq_weight      numeric;
  v_cs_weight      numeric;
  v_stone_weight   numeric;
  v_metal_weight   numeric;
  v_m_weight       numeric;
  v_rate_type      text;
  v_clarity        text;
  v_inv_ids        uuid[] := '{}';
  v_items_count    integer := 0;
  v_total_rows     integer := 0;
  v_dup_supp_invs  text[];
  v_all_supp_invs  text[];
BEGIN
  v_request_id   := args->>'client_request_id';
  v_supplier_id  := (args->>'supplier_id')::uuid;
  v_branch_id    := (args->>'branch_id')::uuid;
  v_vat_rate     := COALESCE((args->>'vat_rate')::numeric, 0.15);
  v_created_by   := (args->>'created_by')::uuid;
  v_uploaded_file := args->>'uploaded_file_name';
  v_files        := args->'files';

  IF v_request_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM atomic_workflow_requests WHERE client_request_id = v_request_id AND status = 'completed') THEN
      RETURN jsonb_build_object('success', true, 'idempotent', true, 'message', 'Already processed');
    END IF;
    INSERT INTO atomic_workflow_requests (client_request_id, workflow_type, status, request_payload)
    VALUES (v_request_id, 'unique_purchase_import_excel_atomic', 'processing', args)
    ON CONFLICT (client_request_id) DO NOTHING;
  END IF;

  SELECT array_agg(DISTINCT upper(trim(f->>'supp_inv')))
  INTO v_all_supp_invs
  FROM jsonb_array_elements(v_files) AS f
  WHERE f->>'supp_inv' IS NOT NULL
    AND trim(f->>'supp_inv') <> ''
    AND f->>'supp_inv' NOT LIKE 'IMPORT-%';

  IF v_all_supp_invs IS NOT NULL AND array_length(v_all_supp_invs, 1) > 0 THEN
    SELECT array_agg(upper(trim(supp_inv)))
    INTO v_dup_supp_invs
    FROM unique_purchase_invoices
    WHERE supplier_id = v_supplier_id
      AND status <> 'voided'
      AND supp_inv IS NOT NULL
      AND trim(supp_inv) <> ''
      AND upper(trim(supp_inv)) = ANY(v_all_supp_invs);

    IF v_dup_supp_invs IS NOT NULL AND array_length(v_dup_supp_invs, 1) > 0 THEN
      IF v_request_id IS NOT NULL THEN
        UPDATE atomic_workflow_requests SET status = 'failed', completed_at = now() WHERE client_request_id = v_request_id;
      END IF;
      RETURN jsonb_build_object(
        'success', false,
        'error', 'DUPLICATE_SUPP_INV',
        'message', 'فواتير مورد مكررة: ' || array_to_string(v_dup_supp_invs, ', '),
        'duplicates', to_jsonb(v_dup_supp_invs)
      );
    END IF;
  END IF;

  SELECT COALESCE(SUM(jsonb_array_length(f->'rows')), 0)
  INTO v_total_rows
  FROM jsonb_array_elements(v_files) AS f;

  SELECT id INTO v_inv_acct_id FROM chart_of_accounts WHERE account_code = '1300';
  IF v_inv_acct_id IS NULL THEN
    SELECT id INTO v_inv_acct_id FROM chart_of_accounts WHERE account_code LIKE '13%' LIMIT 1;
  END IF;
  SELECT id INTO v_ap_acct_id FROM chart_of_accounts WHERE account_code = '2100';
  IF v_ap_acct_id IS NULL THEN
    SELECT id INTO v_ap_acct_id FROM chart_of_accounts WHERE account_code LIKE '21%' LIMIT 1;
  END IF;
  SELECT id INTO v_vat_acct_id FROM chart_of_accounts WHERE account_code = '2105';
  IF v_vat_acct_id IS NULL THEN
    SELECT id INTO v_vat_acct_id FROM chart_of_accounts WHERE account_code LIKE '2105%' LIMIT 1;
  END IF;

  v_batch_no := 'UPB-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('unique_serial_seq')::text, 4, '0');
  INSERT INTO unique_purchase_batches (batch_no, supplier_id, branch_id, uploaded_file_name, status, rows_total, created_by)
  VALUES (v_batch_no, v_supplier_id, v_branch_id, v_uploaded_file, 'importing', v_total_rows, v_created_by)
  RETURNING id INTO v_batch_id;

  FOR v_file IN SELECT * FROM jsonb_array_elements(v_files)
  LOOP
    v_supp_inv := v_file->>'supp_inv';
    v_inv_date := COALESCE((v_file->>'invoice_date')::date, CURRENT_DATE);

    v_inv_no := 'UINV-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('unique_invoice_seq')::text, 4, '0');

    v_subtotal := 0;
    FOR v_row IN SELECT * FROM jsonb_array_elements(v_file->'rows')
    LOOP
      v_subtotal := v_subtotal + public.parse_numeric_text(v_row->'raw_row_json'->>'COST');
    END LOOP;

    v_tax_amount := CASE WHEN v_vat_rate > 0 THEN ROUND(v_subtotal * v_vat_rate, 2) ELSE 0 END;
    v_total_amount := v_subtotal + v_tax_amount;

    v_je_no := 'JE-UIMP-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('unique_serial_seq')::text, 4, '0');
    INSERT INTO journal_entries (
      entry_number, entry_date, description, reference_type, branch_id,
      total_debit, total_credit, is_posted, posted_at, status, created_by
    ) VALUES (
      v_je_no, v_inv_date, 'استيراد فاتورة فريدة ' || v_inv_no, 'unique_purchase', v_branch_id,
      v_total_amount, v_total_amount, true, now(), 'posted', v_created_by
    ) RETURNING id INTO v_je_id;

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_inv_acct_id, v_subtotal, 0, 'مخزون - استيراد ' || v_supp_inv);

    IF v_tax_amount > 0 AND v_vat_acct_id IS NOT NULL THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
      VALUES (v_je_id, v_vat_acct_id, v_tax_amount, 0, 'ضريبة مدخلات - استيراد ' || v_supp_inv);
    END IF;

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_ap_acct_id, 0, v_total_amount, 'ذمم موردين - استيراد ' || v_supp_inv);

    -- FIX: Include paid_amount=0 and remaining_amount=v_total_amount
    INSERT INTO unique_purchase_invoices (
      batch_id, invoice_number, supp_inv, supplier_id, branch_id,
      invoice_date, subtotal, tax_amount, total_amount, vat_rate,
      paid_amount, remaining_amount,
      journal_entry_id, status, created_by
    ) VALUES (
      v_batch_id, v_inv_no, v_supp_inv, v_supplier_id, v_branch_id,
      v_inv_date, v_subtotal, v_tax_amount, v_total_amount, v_vat_rate,
      0, v_total_amount,
      v_je_id, 'posted', v_created_by
    ) RETURNING id INTO v_inv_id;

    v_inv_ids := v_inv_ids || v_inv_id;

    v_line_no := 0;
    FOR v_row IN SELECT * FROM jsonb_array_elements(v_file->'rows')
    LOOP
      v_line_no := v_line_no + 1;
      v_items_count := v_items_count + 1;
      v_serial := 'SN-' || lpad(nextval('unique_item_serial_seq')::text, 8, '0');
      v_item_cost := public.parse_numeric_text(v_row->'raw_row_json'->>'COST');
      v_tag_price := public.parse_numeric_text(v_row->'raw_row_json'->>'TAG PRICE');
      v_min_price := public.parse_numeric_text(v_row->'raw_row_json'->>'MINIMUM PRICE');
      v_g_weight  := public.parse_numeric_text(v_row->'raw_row_json'->>'G');
      v_d_weight  := public.parse_numeric_text(v_row->'raw_row_json'->>'D');
      v_b_weight  := public.parse_numeric_text(v_row->'raw_row_json'->>'B');
      v_mq_weight := public.parse_numeric_text(v_row->'raw_row_json'->>'MQ');
      v_cs_weight := public.parse_numeric_text(v_row->'raw_row_json'->>'CS');
      v_stone_weight := public.parse_numeric_text(v_row->'raw_row_json'->>'STONE');
      v_metal_weight := public.parse_numeric_text(v_row->'raw_row_json'->>'METAL');
      v_m_weight  := public.parse_numeric_text(v_row->'raw_row_json'->>'M');

      v_stockcode   := NULLIF(TRIM(v_row->'raw_row_json'->>'STOCKCODE'), '');
      v_model       := NULLIF(TRIM(v_row->'raw_row_json'->>'MODEL'), '');
      v_description := NULLIF(TRIM(v_row->'raw_row_json'->>'DESCRIPTION'), '');
      v_division    := NULLIF(TRIM(v_row->'raw_row_json'->>'DIVISION'), '');
      v_type        := NULLIF(TRIM(v_row->'raw_row_json'->>'TYPE'), '');
      v_metal       := NULLIF(TRIM(v_row->'raw_row_json'->>'METAL'), '');
      v_stone       := NULLIF(TRIM(v_row->'raw_row_json'->>'STONE'), '');
      v_supp_ref    := NULLIF(TRIM(v_row->'raw_row_json'->>'SUPP.REF'), '');
      v_cost_code   := NULLIF(TRIM(v_row->'raw_row_json'->>'COST CODE'), '');
      v_tag1        := NULLIF(TRIM(v_row->'raw_row_json'->>'TAG1'), '');
      v_tag2        := NULLIF(TRIM(v_row->'raw_row_json'->>'TAG2'), '');
      v_tag3        := NULLIF(TRIM(v_row->'raw_row_json'->>'TAG3'), '');
      v_tag4        := NULLIF(TRIM(v_row->'raw_row_json'->>'TAG4'), '');
      v_tag5        := NULLIF(TRIM(v_row->'raw_row_json'->>'TAG5'), '');
      v_rate_type   := NULLIF(TRIM(v_row->'raw_row_json'->>'RATE TYPE'), '');
      v_clarity     := NULLIF(TRIM(v_row->'raw_row_json'->>'CLARITY'), '');

      v_raw_headers := v_row->'raw_headers_json';
      v_raw_values  := v_row->'raw_values_json';
      v_raw_row_obj := v_row->'raw_row_json';

      INSERT INTO unique_items (
        serial_no, batch_id, unique_invoice_id, supplier_id, branch_id,
        stockcode, model, description, division, type, metal, stone,
        supp_ref, cost_code, tag1, tag2, tag3, tag4, tag5,
        cost, tag_price, minimum_price,
        g_weight, d_weight, b_weight,
        mq_weight, cs_weight, stone_weight, metal_weight, m_weight,
        rate_type, clarity,
        raw_headers_json, raw_values_json, raw_row_json,
        created_by
      ) VALUES (
        v_serial, v_batch_id, v_inv_id, v_supplier_id, v_branch_id,
        v_stockcode, v_model, v_description, v_division, v_type, v_metal, v_stone,
        v_supp_ref, v_cost_code, v_tag1, v_tag2, v_tag3, v_tag4, v_tag5,
        v_item_cost, v_tag_price, v_min_price,
        v_g_weight, v_d_weight, v_b_weight,
        v_mq_weight, v_cs_weight, v_stone_weight, v_metal_weight, v_m_weight,
        v_rate_type, v_clarity,
        v_raw_headers, v_raw_values, v_raw_row_obj,
        v_created_by
      ) RETURNING id INTO v_item_id;

      INSERT INTO unique_purchase_invoice_items (unique_invoice_id, unique_item_id, line_no, unit_cost, qty, line_total)
      VALUES (v_inv_id, v_item_id, v_line_no, v_item_cost, 1, v_item_cost);

      INSERT INTO unique_item_movements (unique_item_id, movement_type, from_branch_id, to_branch_id, reference_id, reference_type, notes, created_by)
      VALUES (v_item_id, 'purchase_in', NULL, v_branch_id, v_inv_id, 'unique_purchase_invoice', 'استيراد أولي - ' || v_serial, v_created_by);
    END LOOP;
  END LOOP;

  UPDATE unique_purchase_batches 
  SET status = 'completed', 
      rows_imported = v_items_count, 
      rows_total = v_total_rows
  WHERE id = v_batch_id;

  IF v_request_id IS NOT NULL THEN
    UPDATE atomic_workflow_requests SET status = 'completed', completed_at = now() WHERE client_request_id = v_request_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', v_batch_id,
    'batch_no', v_batch_no,
    'invoice_ids', to_jsonb(v_inv_ids),
    'invoices_created', array_length(v_inv_ids, 1),
    'items_created', v_items_count,
    'items_failed', 0
  );
END;
$$;
