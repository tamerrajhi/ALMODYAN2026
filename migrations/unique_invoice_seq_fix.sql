-- Migration: Dedicated sequence for UINV- invoice numbering
-- Problem: UINV-, SN-, JE-, UPB- all shared unique_serial_seq causing gaps in invoice numbers
-- Fix: Create separate sequence for invoice numbers only

-- 1. Create dedicated invoice sequence starting after the last used UINV number (idempotent)
DO $$
DECLARE
  v_max_suffix integer;
  v_current_val bigint;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM '[0-9]+$') AS integer)), 0)
    INTO v_max_suffix
    FROM unique_purchase_invoices;

  IF NOT EXISTS (SELECT 1 FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'unique_invoice_seq') THEN
    EXECUTE format('CREATE SEQUENCE unique_invoice_seq START %s', v_max_suffix + 1);
  ELSE
    SELECT last_value INTO v_current_val FROM unique_invoice_seq;
    IF v_current_val < v_max_suffix + 1 THEN
      PERFORM setval('unique_invoice_seq', v_max_suffix, true);
    END IF;
  END IF;
END $$;

-- 2. Replace the RPC to use unique_invoice_seq for UINV- numbers
CREATE OR REPLACE FUNCTION unique_purchase_import_excel_atomic(args jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $fn$
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
  v_row            record;
  v_serial         text;
  v_item_cost      numeric;
  v_line_no        integer;
  v_inv_acct_id    uuid;
  v_ap_acct_id     uuid;
  v_vat_acct_id    uuid;
  v_row_idx        integer;
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
  v_inv_ids        uuid[] := '{}';
BEGIN
  -- Extract args
  v_request_id   := args->>'client_request_id';
  v_supplier_id  := (args->>'supplier_id')::uuid;
  v_branch_id    := (args->>'branch_id')::uuid;
  v_vat_rate     := COALESCE((args->>'vat_rate')::numeric, 0.15);
  v_created_by   := (args->>'created_by')::uuid;
  v_uploaded_file := args->>'uploaded_file_name';
  v_files        := args->'files';

  -- Idempotency check
  IF v_request_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM atomic_workflow_requests WHERE client_request_id = v_request_id AND status = 'completed') THEN
      RETURN jsonb_build_object('ok', true, 'idempotent', true, 'message', 'Already processed');
    END IF;
    INSERT INTO atomic_workflow_requests (client_request_id, function_name, status, args_snapshot)
    VALUES (v_request_id, 'unique_purchase_import_excel_atomic', 'processing', args)
    ON CONFLICT (client_request_id) DO NOTHING;
  END IF;

  -- Lookup account IDs
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

  -- Create batch (uses shared unique_serial_seq — batch numbers don't need strict sequencing)
  v_batch_no := 'UPB-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('unique_serial_seq')::text, 4, '0');
  INSERT INTO unique_purchase_batches (batch_no, supplier_id, branch_id, uploaded_file_name, status, created_by)
  VALUES (v_batch_no, v_supplier_id, v_branch_id, v_uploaded_file, 'importing', v_created_by)
  RETURNING id INTO v_batch_id;

  -- Loop files
  FOR v_file IN SELECT jsonb_array_elements(v_files)
  LOOP
    v_supp_inv := v_file->>'supp_inv';
    v_inv_date := COALESCE((v_file->>'invoice_date')::date, CURRENT_DATE);

    -- *** DEDICATED invoice sequence for sequential UINV- numbers ***
    v_inv_no := 'UINV-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('unique_invoice_seq')::text, 4, '0');

    -- Subtotal loop — uses parse_numeric_text for comma tolerance
    v_subtotal := 0;
    FOR v_row IN SELECT jsonb_array_elements(v_file->'rows')
    LOOP
      v_subtotal := v_subtotal + public.parse_numeric_text(v_row->'raw_row_json'->>'COST');
    END LOOP;

    v_tax_amount := CASE WHEN v_vat_rate > 0 THEN ROUND(v_subtotal * v_vat_rate, 2) ELSE 0 END;
    v_total_amount := v_subtotal + v_tax_amount;

    -- JE number (uses shared unique_serial_seq — JE numbers don't need strict sequencing)
    v_je_no := 'JE-UIMP-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('unique_serial_seq')::text, 4, '0');
    INSERT INTO journal_entries (
      entry_number, entry_date, description, reference_type, branch_id,
      total_debit, total_credit, is_posted, posted_at, status, created_by
    ) VALUES (
      v_je_no, v_inv_date, 'استيراد فاتورة فريدة ' || v_inv_no, 'unique_purchase', v_branch_id,
      v_total_amount, v_total_amount, true, now(), 'posted', v_created_by
    ) RETURNING id INTO v_je_id;

    -- JE lines: Inventory debit (subtotal)
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description, line_order)
    VALUES (v_je_id, v_inv_acct_id, v_subtotal, 0, 'مخزون - استيراد ' || v_supp_inv, 1);

    -- JE lines: VAT debit (if applicable)
    IF v_tax_amount > 0 AND v_vat_acct_id IS NOT NULL THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description, line_order)
      VALUES (v_je_id, v_vat_acct_id, v_tax_amount, 0, 'ضريبة مدخلات - استيراد ' || v_supp_inv, 2);
    END IF;

    -- JE lines: AP credit (total)
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description, line_order)
    VALUES (v_je_id, v_ap_acct_id, 0, v_total_amount, 'ذمم موردين - استيراد ' || v_supp_inv, 3);

    -- Insert invoice
    INSERT INTO unique_purchase_invoices (
      batch_id, invoice_number, supp_inv, supplier_id, branch_id,
      invoice_date, subtotal, tax_amount, total_amount, vat_rate,
      journal_entry_id, status, created_by
    ) VALUES (
      v_batch_id, v_inv_no, v_supp_inv, v_supplier_id, v_branch_id,
      v_inv_date, v_subtotal, v_tax_amount, v_total_amount, v_vat_rate,
      v_je_id, 'posted', v_created_by
    ) RETURNING id INTO v_inv_id;

    v_inv_ids := v_inv_ids || v_inv_id;

    -- Insert items (serial numbers use shared unique_serial_seq — SN numbers don't need strict sequencing)
    v_line_no := 0;
    FOR v_row IN SELECT jsonb_array_elements(v_file->'rows')
    LOOP
      v_line_no := v_line_no + 1;
      v_serial := 'SN-' || lpad(nextval('unique_serial_seq')::text, 8, '0');
      -- All numeric fields use parse_numeric_text for comma/space tolerance
      v_item_cost := public.parse_numeric_text(v_row->'raw_row_json'->>'COST');
      v_tag_price := public.parse_numeric_text(v_row->'raw_row_json'->>'TAG PRICE');
      v_min_price := public.parse_numeric_text(v_row->'raw_row_json'->>'MINIMUM PRICE');
      v_g_weight  := public.parse_numeric_text(v_row->'raw_row_json'->>'G');
      v_d_weight  := public.parse_numeric_text(v_row->'raw_row_json'->>'D');
      v_b_weight  := public.parse_numeric_text(v_row->'raw_row_json'->>'B');

      v_stockcode   := NULLIF(TRIM(v_row->'raw_row_json'->>'STOCKCODE'), '');
      v_model       := NULLIF(TRIM(v_row->'raw_row_json'->>'MODEL'), '');
      v_description := NULLIF(TRIM(v_row->'raw_row_json'->>'DESCRIPTION'), '');
      v_division    := NULLIF(TRIM(v_row->'raw_row_json'->>'DIVISION'), '');
      v_type        := NULLIF(TRIM(v_row->'raw_row_json'->>'TYPE'), '');
      v_metal       := NULLIF(TRIM(v_row->'raw_row_json'->>'METAL'), '');
      v_stone       := NULLIF(TRIM(v_row->'raw_row_json'->>'STONE'), '');

      v_raw_headers := v_row->'raw_headers_json';
      v_raw_values  := v_row->'raw_values_json';
      v_raw_row_obj := v_row->'raw_row_json';

      INSERT INTO unique_items (
        serial_no, unique_invoice_id, supplier_id, branch_id,
        stockcode, model, description, division, type, metal, stone,
        cost, tag_price, minimum_price,
        g_weight, d_weight, b_weight,
        raw_headers_json, raw_values_json, raw_row_json,
        created_by
      ) VALUES (
        v_serial, v_inv_id, v_supplier_id, v_branch_id,
        v_stockcode, v_model, v_description, v_division, v_type, v_metal, v_stone,
        v_item_cost, v_tag_price, v_min_price,
        v_g_weight, v_d_weight, v_b_weight,
        v_raw_headers, v_raw_values, v_raw_row_obj,
        v_created_by
      ) RETURNING id INTO v_item_id;

      -- Movement record
      INSERT INTO unique_item_movements (unique_item_id, movement_type, from_branch_id, to_branch_id, reference_id, reference_type, notes, created_by)
      VALUES (v_item_id, 'purchase_in', NULL, v_branch_id, v_inv_id, 'unique_purchase_invoice', 'استيراد أولي - ' || v_serial, v_created_by);
    END LOOP;
  END LOOP;

  -- Update batch status
  UPDATE unique_purchase_batches SET status = 'completed' WHERE id = v_batch_id;

  -- Mark idempotency as completed
  IF v_request_id IS NOT NULL THEN
    UPDATE atomic_workflow_requests SET status = 'completed', completed_at = now() WHERE client_request_id = v_request_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'batch_id', v_batch_id,
    'batch_no', v_batch_no,
    'invoice_ids', to_jsonb(v_inv_ids)
  );
END;
$fn$;
