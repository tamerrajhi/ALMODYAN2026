import { pool } from "./db";

const RPC_FUNCTIONS_SQL = `

-- =====================================================
-- 1. generate_serial
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_serial(p_prefix text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare
  v_seq bigint;
begin
  update public.serial_counters
     set next_seq = next_seq + 1,
         updated_at = now()
   where prefix = p_prefix
   returning (next_seq - 1) into v_seq;

  if v_seq is null then
    insert into public.serial_counters(prefix, next_seq)
    values (p_prefix, 2)
    on conflict (prefix) do update
      set next_seq = public.serial_counters.next_seq + 1,
          updated_at = now()
    returning (next_seq - 1) into v_seq;
  end if;

  return p_prefix || lpad(v_seq::text, 6, '0');
end;
$function$;

-- =====================================================
-- 2. normalize_prefix_from_stockcode
-- =====================================================
CREATE OR REPLACE FUNCTION public.normalize_prefix_from_stockcode(p_stockcode text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare
  v_raw text := nullif(trim(coalesce(p_stockcode,'')), '');
  v_prefix text;
begin
  if v_raw is null then
    raise exception 'Missing STOCKCODE/TYPE for serial generation';
  end if;

  v_prefix := upper(v_raw);

  if v_prefix not in ('FSETN','FSETE','FSETR','FSETB') then
    v_prefix := substring(v_prefix from 1 for 5);
  end if;

  if v_prefix not in ('FSETN','FSETE','FSETR','FSETB') then
    raise exception 'Unknown STOCKCODE/TYPE prefix: %', p_stockcode
      using errcode = '22023';
  end if;

  return v_prefix;
end;
$function$;

-- =====================================================
-- 3. parse_numeric_text (updated - handles non-breaking spaces)
-- =====================================================
CREATE OR REPLACE FUNCTION public.parse_numeric_text(p_text text)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_cleaned text;
BEGIN
  IF p_text IS NULL THEN RETURN 0; END IF;
  v_cleaned := trim(p_text);
  IF v_cleaned = '' THEN RETURN 0; END IF;
  v_cleaned := regexp_replace(v_cleaned, '[,\\s' || chr(160) || ']', '', 'g');
  IF v_cleaned = '' THEN RETURN 0; END IF;
  BEGIN
    RETURN v_cleaned::numeric;
  EXCEPTION WHEN OTHERS THEN
    RETURN 0;
  END;
END;
$function$;

-- =====================================================
-- 4. compute_unique_item_lock_state
-- =====================================================
CREATE OR REPLACE FUNCTION public.compute_unique_item_lock_state(p_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_item record;
  v_state text := 'OK';
  v_reason_ar text := 'متاح للتصحيح';
  v_evidence jsonb := '[]'::jsonb;
  v_sales_count int;
  v_return_count int;
  v_transfer_count int;
  v_general_return_count int;
  v_requisition_count int;
  v_last_movement_type text;
BEGIN
  SELECT id, sale_id, sold_at, status
  INTO v_item FROM unique_items WHERE id = p_item_id;

  IF v_item IS NULL THEN
    RETURN jsonb_build_object('state', 'LOCKED_UNKNOWN', 'reason_ar', 'القطعة غير موجودة', 'evidence', '[]'::jsonb);
  END IF;

  SELECT COUNT(*)::int INTO v_sales_count
  FROM sales_invoice_items WHERE jewelry_item_id = p_item_id;

  SELECT COUNT(*)::int INTO v_return_count
  FROM unique_purchase_return_items WHERE unique_item_id = p_item_id;

  SELECT COUNT(*)::int INTO v_transfer_count
  FROM transfer_items WHERE unique_item_id = p_item_id;

  SELECT COUNT(*)::int INTO v_general_return_count
  FROM purchase_return_items WHERE jewelry_item_id = p_item_id;

  SELECT COUNT(*)::int INTO v_requisition_count
  FROM purchase_requisition_items WHERE jewelry_item_id = p_item_id;

  SELECT movement_type INTO v_last_movement_type
  FROM unique_item_movements WHERE unique_item_id = p_item_id
  ORDER BY created_at DESC LIMIT 1;

  IF v_item.sale_id IS NOT NULL OR v_item.sold_at IS NOT NULL OR v_sales_count > 0 THEN
    v_state := 'LOCKED_SOLD';
    v_reason_ar := 'القطعة مباعة';
    v_evidence := jsonb_build_array(jsonb_build_object('type', 'sale', 'count', v_sales_count));
  ELSIF v_item.status = 'returned_to_supplier' OR v_return_count > 0 THEN
    v_state := 'LOCKED_RETURNED';
    v_reason_ar := 'القطعة مرتجعة';
    v_evidence := jsonb_build_array(jsonb_build_object('type', 'return', 'count', v_return_count));
  ELSIF v_last_movement_type = 'transfer' AND v_transfer_count > 0 THEN
    v_state := 'LOCKED_TRANSFERRED';
    v_reason_ar := 'القطعة منقولة لفرع آخر';
    v_evidence := jsonb_build_array(jsonb_build_object('type', 'transfer', 'count', v_transfer_count));
  ELSIF v_transfer_count > 0 OR v_general_return_count > 0 OR v_requisition_count > 0 THEN
    v_state := 'LOCKED_HAS_DOWNSTREAM';
    v_reason_ar := 'القطعة مرتبطة بمستندات أخرى';
    v_evidence := jsonb_build_array(jsonb_build_object('type', 'downstream',
      'transfers', v_transfer_count, 'general_returns', v_general_return_count, 'requisitions', v_requisition_count));
  END IF;

  RETURN jsonb_build_object('state', v_state, 'reason_ar', v_reason_ar, 'evidence', v_evidence);
END;
$function$;

-- =====================================================
-- 5. recompute_unique_invoice_status
-- =====================================================
CREATE OR REPLACE FUNCTION public.recompute_unique_invoice_status(p_unique_invoice_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_total int := 0;
  v_returned int := 0;
  v_effective text;
  v_current text;
  v_updated boolean := false;
BEGIN
  SELECT status INTO v_current
  FROM unique_purchase_invoices
  WHERE id = p_unique_invoice_id;

  IF v_current IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVOICE_NOT_FOUND',
      'invoice_id', p_unique_invoice_id
    );
  END IF;

  IF v_current IN ('voided','cancelled') THEN
    RETURN jsonb_build_object(
      'success', true,
      'invoice_id', p_unique_invoice_id,
      'effective_status', v_current,
      'updated', false,
      'skipped_reason', 'TERMINAL_STATUS'
    );
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM unique_items
  WHERE unique_invoice_id = p_unique_invoice_id;

  SELECT COUNT(*) INTO v_returned
  FROM unique_items
  WHERE unique_invoice_id = p_unique_invoice_id
    AND status = 'returned_to_supplier';

  IF v_total > 0 AND v_returned = v_total THEN
    v_effective := 'returned';
  ELSIF v_returned > 0 THEN
    v_effective := 'partial';
  ELSE
    v_effective := 'posted';
  END IF;

  IF v_effective IS DISTINCT FROM v_current THEN
    UPDATE unique_purchase_invoices
    SET status = v_effective
    WHERE id = p_unique_invoice_id;

    v_updated := true;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'invoice_id', p_unique_invoice_id,
    'total_items', v_total,
    'returned_items', v_returned,
    'effective_status', v_effective,
    'updated', v_updated
  );
END;
$function$;

-- =====================================================
-- 6. can_rebuild_unique_purchase_invoice
-- =====================================================
CREATE OR REPLACE FUNCTION public.can_rebuild_unique_purchase_invoice(p_invoice_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_inv RECORD;
  v_blockers jsonb := '[]'::jsonb;
  v_sold_count int;
  v_transferred_count int;
  v_returned_sale_count int;
  v_return_count int;
  v_downstream_movements int;
  v_purchase_in_count int;
BEGIN
  SELECT id, status, journal_entry_id, invoice_number
  INTO v_inv
  FROM unique_purchase_invoices
  WHERE id = p_invoice_id;

  IF v_inv IS NULL THEN
    RETURN jsonb_build_object('can_rebuild', false, 'blockers', jsonb_build_array('INVOICE_NOT_FOUND'));
  END IF;

  SELECT count(*) INTO v_sold_count
  FROM unique_items ui
  JOIN unique_purchase_invoice_items ii ON ii.unique_item_id = ui.id
  WHERE ii.unique_invoice_id = p_invoice_id
    AND ui.status = 'sold';
  IF v_sold_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'HAS_SOLD_ITEMS',
      'count', v_sold_count,
      'message_ar', 'يوجد ' || v_sold_count || ' قطعة مباعة'
    ));
  END IF;

  SELECT count(*) INTO v_transferred_count
  FROM unique_item_movements m
  JOIN unique_purchase_invoice_items ii ON ii.unique_item_id = m.unique_item_id
  WHERE ii.unique_invoice_id = p_invoice_id
    AND m.movement_type = 'transfer';
  IF v_transferred_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'HAS_TRANSFERS',
      'count', v_transferred_count,
      'message_ar', 'يوجد ' || v_transferred_count || ' حركة تحويل'
    ));
  END IF;

  SELECT count(*) INTO v_return_count
  FROM unique_purchase_returns
  WHERE unique_invoice_id = p_invoice_id
    AND status != 'voided';
  IF v_return_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'HAS_PURCHASE_RETURNS',
      'count', v_return_count,
      'message_ar', 'يوجد ' || v_return_count || ' مرتجع شراء'
    ));
  END IF;

  SELECT count(*) INTO v_returned_sale_count
  FROM unique_item_movements m
  JOIN unique_purchase_invoice_items ii ON ii.unique_item_id = m.unique_item_id
  WHERE ii.unique_invoice_id = p_invoice_id
    AND m.movement_type = 'sales_return_in';
  IF v_returned_sale_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'HAS_SALES_RETURNS',
      'count', v_returned_sale_count,
      'message_ar', 'يوجد ' || v_returned_sale_count || ' حركة مرتجع مبيعات'
    ));
  END IF;

  SELECT count(*) INTO v_purchase_in_count
  FROM unique_item_movements m
  WHERE m.reference_type = 'unique_purchase_invoice'
    AND m.reference_id = p_invoice_id
    AND m.movement_type = 'purchase_in';

  RETURN jsonb_build_object(
    'can_rebuild', (jsonb_array_length(v_blockers) = 0),
    'blockers', v_blockers,
    'invoice_number', v_inv.invoice_number,
    'status', v_inv.status,
    'has_journal', (v_inv.journal_entry_id IS NOT NULL),
    'purchase_in_movements', v_purchase_in_count
  );
END;
$function$;

-- =====================================================
-- 7. backfill_unique_invoice_status
-- =====================================================
CREATE OR REPLACE FUNCTION public.backfill_unique_invoice_status(p_dry_run boolean DEFAULT true, p_batch_size integer DEFAULT 200)
 RETURNS TABLE(invoice_id uuid, invoice_number text, old_status text, new_status text, total_items integer, returned_items integer, was_updated boolean)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_offset int := 0;
  v_batch_count int;
  v_rec record;
  v_total int;
  v_returned int;
  v_computed text;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _backfill_results (
    invoice_id uuid,
    invoice_number text,
    old_status text,
    new_status text,
    total_items int,
    returned_items int,
    was_updated boolean
  ) ON COMMIT DROP;

  TRUNCATE _backfill_results;

  LOOP
    v_batch_count := 0;

    FOR v_rec IN
      SELECT u.id, u.invoice_number, u.status
      FROM unique_purchase_invoices u
      WHERE u.status NOT IN ('voided', 'cancelled')
      ORDER BY u.id
      OFFSET v_offset
      LIMIT p_batch_size
    LOOP
      v_batch_count := v_batch_count + 1;

      SELECT COUNT(*) INTO v_total
      FROM unique_items
      WHERE unique_invoice_id = v_rec.id;

      SELECT COUNT(*) INTO v_returned
      FROM unique_items
      WHERE unique_invoice_id = v_rec.id
        AND status = 'returned_to_supplier';

      IF v_total = 0 THEN
        CONTINUE;
      END IF;

      IF v_returned = v_total THEN
        v_computed := 'returned';
      ELSIF v_returned > 0 THEN
        v_computed := 'partial';
      ELSE
        v_computed := 'posted';
      END IF;

      IF v_computed IS DISTINCT FROM v_rec.status THEN
        IF NOT p_dry_run THEN
          PERFORM public.recompute_unique_invoice_status(v_rec.id);
        END IF;

        INSERT INTO _backfill_results VALUES (
          v_rec.id, v_rec.invoice_number, v_rec.status,
          v_computed, v_total, v_returned, NOT p_dry_run
        );
      END IF;
    END LOOP;

    EXIT WHEN v_batch_count = 0;
    v_offset := v_offset + p_batch_size;
  END LOOP;

  RETURN QUERY SELECT * FROM _backfill_results;
END;
$function$;

`;

const RPC_IMPORT_EXCEL_SQL = `
-- =====================================================
-- 8. unique_purchase_import_excel_atomic (CRITICAL FIX)
-- =====================================================
CREATE OR REPLACE FUNCTION public.unique_purchase_import_excel_atomic(args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $func$
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
  v_prefix        text;
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
  v_tmp_text      text;
  v_retry         int;

  v_cached        jsonb;
  v_result        jsonb;
BEGIN
  v_wf_key := v_client_req_id || '::unique_import_excel';

  SELECT result_payload INTO v_cached
  FROM atomic_workflow_requests
  WHERE client_request_id = v_wf_key AND status = 'completed';
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  INSERT INTO atomic_workflow_requests (client_request_id, workflow_type, status, created_by)
  VALUES (v_wf_key, 'unique_import_excel', 'pending', v_created_by)
  ON CONFLICT (client_request_id) DO NOTHING;

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

  v_batch_no := 'UPB-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(nextval('public.upb_doc_seq')::text, 6, '0');
  INSERT INTO unique_purchase_batches (batch_no, supplier_id, branch_id, uploaded_file_name, status, created_by)
  VALUES (v_batch_no, v_supplier_id, v_branch_id, v_uploaded_file, 'importing', v_created_by)
  RETURNING id INTO v_batch_id;

  FOR v_file IN SELECT jsonb_array_elements(v_files)
  LOOP
    v_file_idx := v_file_idx + 1;
    v_supp_inv := v_file->>'supp_inv';
    v_inv_date := COALESCE((v_file->>'invoice_date')::date, CURRENT_DATE);

    v_inv_no := 'UINV-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(nextval('public.uinv_doc_seq')::text, 6, '0');

    v_subtotal := 0;
    FOR v_row IN SELECT jsonb_array_elements(v_file->'rows')
    LOOP
      v_item_cost := public.parse_numeric_text(v_row->'raw_row_json'->>'COST');
      v_subtotal := v_subtotal + v_item_cost;
    END LOOP;

    v_tax_amount := CASE WHEN v_vat_rate > 0 THEN ROUND(v_subtotal * v_vat_rate, 2) ELSE 0 END;
    v_total_amount := v_subtotal + v_tax_amount;

    v_je_no := 'JE-UIMP-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(nextval('public.je_uimp_doc_seq')::text, 6, '0');
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

    INSERT INTO unique_purchase_invoices (
      batch_id, supplier_id, branch_id, supp_inv, invoice_number, invoice_date,
      status, vat_rate, subtotal, tax_amount, total_amount,
      paid_amount, remaining_amount,
      journal_entry_id, created_by
    ) VALUES (
      v_batch_id, v_supplier_id, v_branch_id, v_supp_inv, v_inv_no, v_inv_date,
      'posted', v_vat_rate, v_subtotal, v_tax_amount, v_total_amount,
      0, v_total_amount,
      v_je_id, v_created_by
    ) RETURNING id INTO v_inv_id;

    UPDATE journal_entries SET reference_id = v_inv_id WHERE id = v_je_id;
    v_total_invoices := v_total_invoices + 1;

    v_line_no := 0;
    FOR v_row IN SELECT jsonb_array_elements(v_file->'rows')
    LOOP
      v_line_no := v_line_no + 1;
      v_item_cost := public.parse_numeric_text(v_row->'raw_row_json'->>'COST');

      v_item_id := NULL;
      FOR v_retry IN 1..5 LOOP
        v_prefix := public.normalize_prefix_from_stockcode(
          COALESCE(NULLIF(trim(v_row->'raw_row_json'->>'STOCKCODE'), ''),
                   NULLIF(trim(v_row->'raw_row_json'->>'TYPE'), ''))
        );
        v_serial := public.generate_serial(v_prefix);
        BEGIN
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
            public.parse_numeric_text(v_row->'raw_row_json'->>'TAG PRICE'),
            public.parse_numeric_text(v_row->'raw_row_json'->>'MINIMUM PRICE'),
            public.parse_numeric_text(v_row->'raw_row_json'->>'G'),
            public.parse_numeric_text(v_row->'raw_row_json'->>'D'),
            public.parse_numeric_text(v_row->'raw_row_json'->>'B'),
            0, 0, 0, 0, 0,
            v_row->'raw_row_json'->>'Rate Type',
            v_row->'raw_row_json'->>'Clarity',
            v_row->'raw_row_json'->>'Metal',
            v_row->'raw_row_json'->>'Stone',
            COALESCE(v_row->'raw_headers_json', '[]'::jsonb),
            COALESCE(v_row->'raw_values_json', '[]'::jsonb),
            v_row->'raw_row_json',
            v_created_by
          ) RETURNING id INTO v_item_id;
          EXIT;
        EXCEPTION WHEN unique_violation THEN
          IF v_retry = 5 THEN
            RAISE EXCEPTION 'فشل إنشاء رقم تسلسلي فريد بعد 5 محاولات';
          END IF;
        END;
      END LOOP;

      INSERT INTO unique_purchase_invoice_items (unique_invoice_id, unique_item_id, line_no, unit_cost, qty, line_total)
      VALUES (v_inv_id, v_item_id, v_line_no, v_item_cost, 1, v_item_cost);

      INSERT INTO unique_item_movements (unique_item_id, movement_type, to_branch_id, reference_type, reference_id, unit_cost, notes, created_by)
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
$func$;
`;

const RPC_REBUILD_SQL = `
-- =====================================================
-- 9. unique_purchase_invoice_rebuild_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.unique_purchase_invoice_rebuild_atomic(args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $func$
DECLARE
  v_invoice_id    uuid := (args->>'invoice_id')::uuid;
  v_supp_inv      text := args->>'supp_inv';
  v_invoice_date  date := NULLIF(args->>'invoice_date','')::date;
  v_notes         text := args->>'notes';
  v_vat_rate      numeric;
  v_updated_by    uuid := NULLIF(args->>'updated_by', '')::uuid;

  v_items_update  jsonb := COALESCE(args->'items_update', '[]'::jsonb);
  v_items_add     jsonb := COALESCE(args->'items_add', '[]'::jsonb);
  v_items_delete  jsonb := COALESCE(args->'items_delete', '[]'::jsonb);

  v_gate          jsonb;
  v_old_inv       RECORD;
  v_item          jsonb;
  v_item_id       uuid;
  v_item_cost     numeric;
  v_new_subtotal  numeric := 0;
  v_new_tax       numeric := 0;
  v_new_total     numeric := 0;
  v_line_no       int;
  v_serial        text;
  v_prefix        text;
  v_retry         int;
  v_del_status    text;

  v_inv_acct_id   uuid;
  v_ap_acct_id    uuid;
  v_vat_acct_id   uuid;
  v_branch_code   text;

  v_old_movement_count int;
  v_rebuilt_movement_count int;
  v_rebuilt_items_count int;

  v_je_number     text;
  v_remaining_item RECORD;
BEGIN
  v_gate := can_rebuild_unique_purchase_invoice(v_invoice_id);
  IF NOT (v_gate->>'can_rebuild')::boolean THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'REBUILD_BLOCKED',
      'blockers', v_gate->'blockers',
      'message_ar', 'لا يمكن إعادة بناء هذه الفاتورة - توجد مراجع مانعة'
    );
  END IF;

  SELECT * INTO v_old_inv FROM unique_purchase_invoices WHERE id = v_invoice_id;
  IF v_old_inv IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND', 'message_ar', 'الفاتورة غير موجودة');
  END IF;

  v_vat_rate := COALESCE(NULLIF(args->>'vat_rate','')::numeric, v_old_inv.vat_rate);

  SELECT count(*) INTO v_old_movement_count
  FROM unique_item_movements
  WHERE reference_type = 'unique_purchase_invoice'
    AND reference_id = v_invoice_id;

  DELETE FROM unique_item_movements
  WHERE reference_type = 'unique_purchase_invoice'
    AND reference_id = v_invoice_id;

  IF v_old_inv.journal_entry_id IS NOT NULL THEN
    UPDATE unique_purchase_invoices
    SET journal_entry_id = NULL
    WHERE id = v_invoice_id;

    DELETE FROM journal_entry_lines
    WHERE journal_entry_id = v_old_inv.journal_entry_id;

    DELETE FROM journal_entries
    WHERE id = v_old_inv.journal_entry_id;
  END IF;

  IF jsonb_array_length(v_items_delete) > 0 THEN
    FOR v_item IN SELECT jsonb_array_elements(v_items_delete)
    LOOP
      v_item_id := (v_item->>'item_id')::uuid;
      IF v_item_id IS NULL THEN v_item_id := (v_item #>> '{}')::uuid; END IF;

      SELECT status INTO v_del_status FROM unique_items WHERE id = v_item_id AND unique_invoice_id = v_invoice_id;
      IF v_del_status IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'ITEM_NOT_FOUND',
          'message_ar', 'القطعة المراد حذفها غير موجودة في هذه الفاتورة');
      END IF;
      IF v_del_status != 'in_stock' THEN
        RETURN jsonb_build_object('success', false, 'error', 'ITEM_NOT_IN_STOCK',
          'message_ar', 'لا يمكن حذف قطعة حالتها: ' || v_del_status);
      END IF;

      DELETE FROM unique_purchase_invoice_items WHERE unique_item_id = v_item_id AND unique_invoice_id = v_invoice_id;
      DELETE FROM unique_items WHERE id = v_item_id;
    END LOOP;
  END IF;

  IF jsonb_array_length(v_items_update) > 0 THEN
    FOR v_item IN SELECT jsonb_array_elements(v_items_update)
    LOOP
      v_item_id := (v_item->>'item_id')::uuid;
      v_item_cost := COALESCE((v_item->>'cost')::numeric, 0);

      UPDATE unique_items SET
        stockcode     = COALESCE(NULLIF(v_item->>'stockcode',''), stockcode),
        model         = COALESCE(v_item->>'model', model),
        description   = COALESCE(NULLIF(v_item->>'description',''), description),
        division      = COALESCE(v_item->>'division', division),
        supp_ref      = COALESCE(v_item->>'supp_ref', supp_ref),
        type          = COALESCE(v_item->>'type', type),
        cost          = v_item_cost,
        tag_price     = COALESCE((v_item->>'tag_price')::numeric, tag_price),
        minimum_price = COALESCE((v_item->>'minimum_price')::numeric, minimum_price),
        g_weight      = COALESCE((v_item->>'g_weight')::numeric, g_weight),
        d_weight      = COALESCE((v_item->>'d_weight')::numeric, d_weight),
        metal         = COALESCE(v_item->>'metal', metal),
        stone         = COALESCE(v_item->>'stone', stone)
      WHERE id = v_item_id AND unique_invoice_id = v_invoice_id;

      UPDATE unique_purchase_invoice_items SET unit_cost = v_item_cost, line_total = v_item_cost
      WHERE unique_invoice_id = v_invoice_id AND unique_item_id = v_item_id;
    END LOOP;
  END IF;

  IF jsonb_array_length(v_items_add) > 0 THEN
    SELECT COALESCE(MAX(line_no), 0) INTO v_line_no FROM unique_purchase_invoice_items WHERE unique_invoice_id = v_invoice_id;

    FOR v_item IN SELECT jsonb_array_elements(v_items_add)
    LOOP
      v_item_cost := COALESCE((v_item->>'cost')::numeric, 0);
      v_line_no := v_line_no + 1;
      v_item_id := NULL;

      FOR v_retry IN 1..5 LOOP
        v_prefix := public.normalize_prefix_from_stockcode(
          COALESCE(NULLIF(trim(COALESCE(v_item->>'stockcode','')), ''),
                   NULLIF(trim(COALESCE(v_item->>'type','')), ''))
        );
        v_serial := public.generate_serial(v_prefix);
        BEGIN
          INSERT INTO unique_items (
            serial_no, branch_id, supplier_id, batch_id, unique_invoice_id,
            stockcode, model, description, division, supp_ref, type,
            cost, tag_price, minimum_price, g_weight, d_weight, metal, stone,
            created_by, status
          ) VALUES (
            v_serial, v_old_inv.branch_id, v_old_inv.supplier_id, v_old_inv.batch_id, v_invoice_id,
            COALESCE(v_item->>'stockcode',''),
            COALESCE(v_item->>'model',''),
            COALESCE(v_item->>'description',''),
            COALESCE(v_item->>'division',''),
            COALESCE(v_item->>'supp_ref',''),
            COALESCE(v_item->>'type',''),
            v_item_cost,
            COALESCE((v_item->>'tag_price')::numeric, 0),
            COALESCE((v_item->>'minimum_price')::numeric, 0),
            COALESCE((v_item->>'g_weight')::numeric, 0),
            COALESCE((v_item->>'d_weight')::numeric, 0),
            COALESCE(v_item->>'metal',''),
            COALESCE(v_item->>'stone',''),
            v_updated_by,
            'in_stock'
          ) RETURNING id INTO v_item_id;
          EXIT;
        EXCEPTION WHEN unique_violation THEN
          IF v_retry = 5 THEN RAISE EXCEPTION 'فشل إنشاء رقم تسلسلي فريد بعد 5 محاولات'; END IF;
        END;
      END LOOP;

      INSERT INTO unique_purchase_invoice_items (unique_invoice_id, unique_item_id, line_no, unit_cost, qty, line_total)
      VALUES (v_invoice_id, v_item_id, v_line_no, v_item_cost, 1, v_item_cost);
    END LOOP;
  END IF;

  SELECT COALESCE(SUM(line_total), 0) INTO v_new_subtotal
  FROM unique_purchase_invoice_items WHERE unique_invoice_id = v_invoice_id;

  v_new_tax := CASE WHEN v_vat_rate > 0 THEN ROUND(v_new_subtotal * v_vat_rate, 2) ELSE 0 END;
  v_new_total := v_new_subtotal + v_new_tax;

  UPDATE unique_purchase_invoices SET
    supp_inv = COALESCE(NULLIF(v_supp_inv,''), supp_inv),
    invoice_date = COALESCE(v_invoice_date, invoice_date),
    notes = COALESCE(v_notes, notes),
    vat_rate = v_vat_rate,
    subtotal = v_new_subtotal,
    tax_amount = v_new_tax,
    total_amount = v_new_total,
    remaining_amount = v_new_total - COALESCE(v_old_inv.paid_amount, 0)
  WHERE id = v_invoice_id;

  v_rebuilt_movement_count := 0;
  FOR v_remaining_item IN
    SELECT ii.unique_item_id, ii.unit_cost
    FROM unique_purchase_invoice_items ii
    WHERE ii.unique_invoice_id = v_invoice_id
  LOOP
    INSERT INTO unique_item_movements (
      unique_item_id, movement_type, to_branch_id,
      reference_type, reference_id, unit_cost, notes, created_by
    ) VALUES (
      v_remaining_item.unique_item_id, 'purchase_in', v_old_inv.branch_id,
      'unique_purchase_invoice', v_invoice_id,
      v_remaining_item.unit_cost, 'إعادة بناء - فاتورة شراء', v_updated_by
    );
    v_rebuilt_movement_count := v_rebuilt_movement_count + 1;
  END LOOP;

  SELECT count(*) INTO v_rebuilt_items_count
  FROM unique_purchase_invoice_items WHERE unique_invoice_id = v_invoice_id;

  SELECT code INTO v_branch_code FROM branches WHERE id = v_old_inv.branch_id;

  SELECT id INTO v_inv_acct_id FROM chart_of_accounts WHERE account_code = v_branch_code || '-1301';
  IF v_inv_acct_id IS NULL THEN SELECT id INTO v_inv_acct_id FROM chart_of_accounts WHERE account_code = '1301'; END IF;

  SELECT id INTO v_ap_acct_id FROM chart_of_accounts WHERE account_code = v_branch_code || '-2101';
  IF v_ap_acct_id IS NULL THEN SELECT id INTO v_ap_acct_id FROM chart_of_accounts WHERE account_code = '2101'; END IF;
  IF v_ap_acct_id IS NULL THEN SELECT id INTO v_ap_acct_id FROM chart_of_accounts WHERE account_code = '2100'; END IF;

  IF v_vat_rate > 0 THEN
    SELECT id INTO v_vat_acct_id FROM chart_of_accounts WHERE account_code = v_branch_code || '-2105';
    IF v_vat_acct_id IS NULL THEN SELECT id INTO v_vat_acct_id FROM chart_of_accounts WHERE account_code = '2105'; END IF;
  END IF;

  SELECT generate_journal_entry_number() INTO v_je_number;

  INSERT INTO journal_entries (
    entry_number, entry_date, description, reference_type, reference_id,
    is_posted, posted_at, posted_by, branch_id,
    total_debit, total_credit, created_by, status
  ) VALUES (
    v_je_number,
    COALESCE(v_invoice_date, v_old_inv.invoice_date),
    'إعادة بناء قيد - فاتورة شراء فريدة ' || v_old_inv.invoice_number,
    'unique_purchase_invoice', v_invoice_id,
    true, now(), v_updated_by, v_old_inv.branch_id,
    v_new_total, v_new_total, v_updated_by, 'posted'
  ) RETURNING id INTO v_item_id;

  UPDATE unique_purchase_invoices SET journal_entry_id = v_item_id WHERE id = v_invoice_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
  VALUES (v_item_id, v_inv_acct_id, v_new_subtotal, 0, 'مخزون - استيراد فريد (إعادة بناء)');

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
  VALUES (v_item_id, v_ap_acct_id, 0, v_new_total, 'ذمم دائنة - استيراد فريد (إعادة بناء)');

  IF v_vat_rate > 0 AND v_new_tax > 0 AND v_vat_acct_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_item_id, v_vat_acct_id, v_new_tax, 0, 'ضريبة مدخلات - استيراد فريد (إعادة بناء)');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'invoice_id', v_invoice_id,
    'new_subtotal', v_new_subtotal,
    'new_tax', v_new_tax,
    'new_total', v_new_total,
    'items_updated', jsonb_array_length(v_items_update),
    'items_added', jsonb_array_length(v_items_add),
    'items_deleted', jsonb_array_length(v_items_delete),
    'old_movements_deleted', v_old_movement_count,
    'rebuilt_movements', v_rebuilt_movement_count,
    'rebuilt_items', v_rebuilt_items_count,
    'message_ar', 'تم إعادة بناء الفاتورة بنجاح'
  );
END;
$func$;
`;

const RPC_RETURN_SQL = `
-- =====================================================
-- 10. unique_purchase_return_create_atomic (updated)
-- =====================================================
CREATE OR REPLACE FUNCTION public.unique_purchase_return_create_atomic(args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $func$
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
  IF v_client_req_id IS NULL OR length(trim(v_client_req_id)) = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'MISSING_CLIENT_REQUEST_ID',
      'error', 'client_request_id مطلوب لإنشاء المرتجع'
    );
  END IF;

  v_wf_key := v_client_req_id || '::unique_purchase_return';

  SELECT result_payload INTO v_cached
  FROM atomic_workflow_requests
  WHERE client_request_id = v_wf_key AND status = 'completed';
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  INSERT INTO atomic_workflow_requests (client_request_id, workflow_type, status, created_by)
  VALUES (v_wf_key, 'unique_purchase_return', 'pending', v_created_by)
  ON CONFLICT (client_request_id) DO NOTHING;

  SELECT code INTO v_branch_code FROM branches WHERE id = v_branch_id;
  IF v_branch_code IS NULL THEN
    v_result := jsonb_build_object('success', false, 'error_code', 'BRANCH_NOT_FOUND', 'error', 'الفرع غير موجود');
    UPDATE atomic_workflow_requests SET status = 'completed', result_payload = v_result, completed_at = now() WHERE client_request_id = v_wf_key;
    RETURN v_result;
  END IF;

  SELECT id INTO v_inv_acct_id FROM chart_of_accounts WHERE account_code = v_branch_code || '-1301';
  IF v_inv_acct_id IS NULL THEN
    SELECT id INTO v_inv_acct_id FROM chart_of_accounts WHERE account_code = '1301';
  END IF;
  IF v_inv_acct_id IS NULL THEN
    v_result := jsonb_build_object('success', false, 'error_code', 'CONFIG_ERROR', 'error', 'حساب المخزون 1301 غير موجود');
    UPDATE atomic_workflow_requests SET status = 'completed', result_payload = v_result, completed_at = now() WHERE client_request_id = v_wf_key;
    RETURN v_result;
  END IF;

  SELECT id INTO v_ap_acct_id FROM chart_of_accounts WHERE account_code = v_branch_code || '-2101';
  IF v_ap_acct_id IS NULL THEN
    SELECT id INTO v_ap_acct_id FROM chart_of_accounts WHERE account_code = '2101';
  END IF;
  IF v_ap_acct_id IS NULL THEN
    SELECT id INTO v_ap_acct_id FROM chart_of_accounts WHERE account_code = '2100';
  END IF;
  IF v_ap_acct_id IS NULL THEN
    v_result := jsonb_build_object('success', false, 'error_code', 'CONFIG_ERROR', 'error', 'حساب الموردين 2101 غير موجود');
    UPDATE atomic_workflow_requests SET status = 'completed', result_payload = v_result, completed_at = now() WHERE client_request_id = v_wf_key;
    RETURN v_result;
  END IF;

  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
    v_result := jsonb_build_object('success', false, 'error_code', 'NO_ITEMS', 'error', 'لم يتم تحديد قطع للإرجاع');
    UPDATE atomic_workflow_requests SET status = 'completed', result_payload = v_result, completed_at = now() WHERE client_request_id = v_wf_key;
    RETURN v_result;
  END IF;

  v_return_no := 'UPR-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(nextval('public.upr_doc_seq')::text, 6, '0');

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

    INSERT INTO unique_item_movements (unique_item_id, movement_type, from_branch_id, reference_type, reference_id, unit_cost, created_by)
    VALUES (v_item_id, 'purchase_return_out', v_branch_id, 'unique_purchase_return', v_return_id, v_unit_cost, v_created_by);

    UPDATE unique_items SET status = 'returned_to_supplier' WHERE id = v_item_id;
  END LOOP;

  UPDATE unique_purchase_returns SET subtotal = v_subtotal, total_amount = v_subtotal WHERE id = v_return_id;

  v_je_no := 'JE-UPR-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(nextval('public.je_doc_seq')::text, 6, '0');
  INSERT INTO journal_entries (
    entry_number, entry_date, description, reference_type, reference_id,
    branch_id, total_debit, total_credit, is_posted, posted_at, status, created_by
  ) VALUES (
    v_je_no, CURRENT_DATE, 'مرتجع شراء فريد - ' || v_return_no,
    'unique_purchase_return', v_return_id,
    v_branch_id, v_subtotal, v_subtotal, true, now(), 'posted', v_created_by
  ) RETURNING id INTO v_je_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
  VALUES (v_je_id, v_ap_acct_id, v_subtotal, 0, 'تخفيض ذمم دائنة');

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
  VALUES (v_je_id, v_inv_acct_id, 0, v_subtotal, 'مرتجع مخزون');

  UPDATE unique_purchase_returns SET journal_entry_id = v_je_id WHERE id = v_return_id;

  IF v_invoice_id IS NOT NULL THEN
    PERFORM public.recompute_unique_invoice_status(v_invoice_id);
  END IF;

  v_result := jsonb_build_object(
    'success', true,
    'return_id', v_return_id,
    'return_number', v_return_no,
    'journal_entry_id', v_je_id,
    'journal_entry_number', v_je_no,
    'items_returned', jsonb_array_length(v_items),
    'subtotal', v_subtotal,
    'total_amount', v_subtotal,
    'status', 'posted'
  );

  UPDATE atomic_workflow_requests
  SET status = 'completed', result_payload = v_result, completed_at = now()
  WHERE client_request_id = v_wf_key;

  RETURN v_result;
END;
$func$;

-- =====================================================
-- 11. unique_purchase_return_void_atomic (updated)
-- =====================================================
CREATE OR REPLACE FUNCTION public.unique_purchase_return_void_atomic(args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $func$
DECLARE
  v_payload        jsonb := args->'p_payload';
  v_client_req_id  text  := v_payload->>'client_request_id';
  v_return_id      uuid  := (v_payload->>'return_id')::uuid;
  v_void_reason    text  := v_payload->>'void_reason';
  v_created_by     uuid  := NULLIF(v_payload->>'created_by', '')::uuid;

  v_wf_key         text  := v_client_req_id || '::unique_purchase_return_void';
  v_return_rec     record;
  v_je_id          uuid;
  v_rev_je_id      uuid;
  v_rev_je_no      text;
  v_cached         jsonb;
  v_result         jsonb;
BEGIN
  SELECT result_payload INTO v_cached
  FROM atomic_workflow_requests
  WHERE client_request_id = v_wf_key AND status = 'completed';
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
    v_rev_je_no := 'JE-VUPR-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(nextval('public.je_doc_seq')::text, 6, '0');
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

  PERFORM public.recompute_unique_invoice_status(v_return_rec.unique_invoice_id);

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
$func$;
`;

const RPC_CORRECTION_SQL = `
-- =====================================================
-- 12. purchase_correction_group_create_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.purchase_correction_group_create_atomic(args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $func$
DECLARE
  v_client_req_id  text := args->>'client_request_id';
  v_created_by     uuid := NULLIF(args->>'created_by', '')::uuid;
  v_parent_inv_id  uuid := (args->>'parent_unique_invoice_id')::uuid;
  v_notes          text := args->>'notes';
  v_actions        jsonb := args->'actions';

  v_wf_key         text;
  v_cached         jsonb;
  v_inv_status     text;
  v_group_id       uuid;
  v_corr_no        text;
  v_action         jsonb;
  v_action_id      uuid;
  v_seq            int;
  v_action_type    text;
  v_source_id      uuid;
  v_lock_snap      jsonb;
  v_result         jsonb;
BEGIN
  v_wf_key := v_client_req_id || '::purchase_correction_create';

  SELECT result_payload INTO v_cached
  FROM atomic_workflow_requests WHERE client_request_id = v_wf_key AND status = 'completed';
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  INSERT INTO atomic_workflow_requests (client_request_id, workflow_type, status, created_by)
  VALUES (v_wf_key, 'purchase_correction_create', 'pending', v_created_by)
  ON CONFLICT (client_request_id) DO NOTHING;

  SELECT status INTO v_inv_status FROM unique_purchase_invoices WHERE id = v_parent_inv_id;
  IF v_inv_status IS NULL THEN
    v_result := jsonb_build_object('success', false, 'error', 'INVOICE_NOT_FOUND', 'message_ar', 'الفاتورة غير موجودة');
    UPDATE atomic_workflow_requests SET status = 'completed', result_payload = v_result, completed_at = now() WHERE client_request_id = v_wf_key;
    RETURN v_result;
  END IF;
  IF v_inv_status NOT IN ('posted', 'partial') THEN
    v_result := jsonb_build_object('success', false, 'error', 'INVOICE_NOT_ELIGIBLE',
      'message_ar', 'حالة الفاتورة (' || v_inv_status || ') لا تسمح بالتصحيح');
    UPDATE atomic_workflow_requests SET status = 'completed', result_payload = v_result, completed_at = now() WHERE client_request_id = v_wf_key;
    RETURN v_result;
  END IF;

  IF v_actions IS NULL OR jsonb_array_length(v_actions) = 0 THEN
    v_result := jsonb_build_object('success', false, 'error', 'NO_ACTIONS', 'message_ar', 'لم يتم تحديد أي إجراءات');
    UPDATE atomic_workflow_requests SET status = 'completed', result_payload = v_result, completed_at = now() WHERE client_request_id = v_wf_key;
    RETURN v_result;
  END IF;

  v_corr_no := 'UCOR-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(nextval('public.ucor_doc_seq')::text, 6, '0');

  INSERT INTO purchase_correction_groups (
    correction_number, parent_unique_invoice_id, status, notes,
    client_request_id, created_by
  ) VALUES (
    v_corr_no, v_parent_inv_id, 'draft', v_notes,
    v_client_req_id, v_created_by
  ) RETURNING id INTO v_group_id;

  FOR v_action IN SELECT jsonb_array_elements(v_actions)
  LOOP
    v_seq := (v_action->>'sequence_no')::int;
    v_action_type := v_action->>'action_type';
    v_source_id := NULLIF(v_action->>'source_unique_item_id', '')::uuid;

    v_lock_snap := NULL;
    IF v_source_id IS NOT NULL THEN
      v_lock_snap := compute_unique_item_lock_state(v_source_id);
    END IF;

    INSERT INTO purchase_correction_actions (
      group_id, sequence_no, action_type, source_unique_item_id,
      new_item_data, lock_state_snapshot, result_status
    ) VALUES (
      v_group_id, v_seq, v_action_type, v_source_id,
      v_action->'new_item_data', v_lock_snap, 'pending'
    );
  END LOOP;

  v_result := jsonb_build_object(
    'success', true,
    'group_id', v_group_id,
    'correction_number', v_corr_no,
    'actions_count', jsonb_array_length(v_actions),
    'status', 'draft'
  );

  UPDATE atomic_workflow_requests
  SET status = 'completed', result_payload = v_result, completed_at = now()
  WHERE client_request_id = v_wf_key;

  RETURN v_result;
END;
$func$;
`;

const RPC_POS_SALE_SQL_PART1 = `
-- =====================================================
-- 13. complete_pos_sale_atomic (updated with seller_profile_id)
-- =====================================================
CREATE OR REPLACE FUNCTION public.complete_pos_sale_atomic(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $func$
DECLARE
  v_client_request_id uuid;
  v_branch_id uuid;
  v_customer_id uuid;
  v_payment_method text;
  v_cash_amount numeric;
  v_card_amount numeric;
  v_discount_amount numeric;
  v_notes text;
  v_sold_by text;
  v_bank_account_code text;
  v_items jsonb;
  v_items_count int;
  v_seller_profile_id uuid;

  v_existing RECORD;
  v_ui RECORD;

  v_subtotal numeric := 0;
  v_taxable_base numeric;
  v_tax_amount numeric;
  v_final_amount numeric;
  v_total_cost numeric := 0;

  v_sale_id uuid;
  v_sale_code text;
  v_invoice_id uuid;
  v_invoice_number text;
  v_je_id uuid;
  v_je_number text;

  v_cash_account_id uuid;
  v_bank_account_id uuid;
  v_inventory_account_id uuid;
  v_cogs_account_id uuid;
  v_sales_revenue_account_id uuid;
  v_vat_output_account_id uuid;

  v_total_debit numeric := 0;
  v_total_credit numeric := 0;

  v_result jsonb;
  v_item_ids uuid[];
  v_payment_number text;
  i int;
BEGIN
  v_client_request_id := (p_payload->>'client_request_id')::uuid;
  v_branch_id := (p_payload->>'branch_id')::uuid;
  v_customer_id := NULLIF(p_payload->>'customer_id', '')::uuid;
  v_payment_method := COALESCE(p_payload->>'payment_method', 'cash');
  v_cash_amount := COALESCE((p_payload->>'cash_amount')::numeric, 0);
  v_card_amount := COALESCE((p_payload->>'card_amount')::numeric, 0);
  v_discount_amount := COALESCE((p_payload->>'discount_amount')::numeric, 0);
  v_notes := p_payload->>'notes';
  v_sold_by := p_payload->>'sold_by';
  v_bank_account_code := p_payload->>'bank_account_code';
  v_items := p_payload->'items';
  v_items_count := jsonb_array_length(v_items);
  v_seller_profile_id := NULLIF(p_payload->>'seller_profile_id', '')::uuid;

  IF v_seller_profile_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'SELLER_REQUIRED',
      'error', 'يجب تحديد البائع لإتمام عملية البيع');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_seller_profile_id AND is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_SELLER',
      'error', 'البائع المحدد غير موجود أو غير نشط');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM profiles p
    JOIN user_branches ub ON ub.user_id = p.user_id
    WHERE p.id = v_seller_profile_id
      AND ub.branch_id = v_branch_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'SELLER_NOT_IN_BRANCH',
      'error', 'البائع غير مسجل في هذا الفرع');
  END IF;

  SELECT * INTO v_existing FROM pos_workflow_requests WHERE client_request_id = v_client_request_id;
  IF FOUND AND v_existing.status = 'succeeded' AND v_existing.result IS NOT NULL THEN
    RETURN v_existing.result || jsonb_build_object('idempotent', true, 'message', 'عملية مكررة - تم تنفيذها سابقاً');
  END IF;
  IF NOT FOUND THEN
    INSERT INTO pos_workflow_requests (client_request_id, workflow_type, status, created_at, updated_at)
    VALUES (v_client_request_id, 'pos_sale', 'processing', now(), now())
    ON CONFLICT (client_request_id) DO NOTHING;
  END IF;

  v_item_ids := ARRAY(SELECT (jsonb_array_elements(v_items)->>'jewelry_item_id')::uuid);

  FOR v_ui IN
    SELECT id, branch_id, sold_at, sale_id, cost, status
    FROM unique_items WHERE id = ANY(v_item_ids) FOR UPDATE
  LOOP
    IF v_ui.sold_at IS NOT NULL OR v_ui.sale_id IS NOT NULL OR v_ui.status = 'returned_to_supplier' THEN
      UPDATE pos_workflow_requests SET status='failed', error_code='ITEM_NOT_SELLABLE',
        error_message='القطعة مباعة مسبقاً', updated_at=now()
      WHERE client_request_id = v_client_request_id;
      RETURN jsonb_build_object('success', false, 'error_code', 'ITEM_NOT_SELLABLE',
        'error', 'القطعة مباعة مسبقاً - لا يمكن بيعها مرة أخرى');
    END IF;
    IF v_ui.branch_id != v_branch_id THEN
      UPDATE pos_workflow_requests SET status='failed', error_code='BRANCH_MISMATCH',
        error_message='القطعة ليست في الفرع المحدد', updated_at=now()
      WHERE client_request_id = v_client_request_id;
      RETURN jsonb_build_object('success', false, 'error_code', 'BRANCH_MISMATCH',
        'error', 'القطعة ليست في الفرع الحالي');
    END IF;
    v_total_cost := v_total_cost + v_ui.cost;
  END LOOP;

  IF array_length(v_item_ids, 1) != (SELECT count(*) FROM unique_items WHERE id = ANY(v_item_ids)) THEN
    UPDATE pos_workflow_requests SET status='failed', error_code='ITEM_NOT_FOUND',
      error_message='قطعة غير موجودة', updated_at=now()
    WHERE client_request_id = v_client_request_id;
    RETURN jsonb_build_object('success', false, 'error_code', 'ITEM_NOT_FOUND',
      'error', 'قطعة أو أكثر غير موجودة في النظام');
  END IF;

  FOR i IN 0..v_items_count-1 LOOP
    v_subtotal := v_subtotal + COALESCE((v_items->i->>'unit_price')::numeric, 0);
  END LOOP;

  v_taxable_base := GREATEST(v_subtotal - v_discount_amount, 0);
  v_tax_amount := ROUND(v_taxable_base * 0.15, 2);
  v_final_amount := v_taxable_base + v_tax_amount;

  SELECT account_id INTO v_cash_account_id FROM branch_coa_accounts WHERE branch_id = v_branch_id AND template_code = 'CASH';
  SELECT account_id INTO v_bank_account_id FROM branch_coa_accounts WHERE branch_id = v_branch_id AND template_code = 'BANK';
  SELECT account_id INTO v_inventory_account_id FROM branch_coa_accounts WHERE branch_id = v_branch_id AND template_code = 'INVENTORY';
  SELECT account_id INTO v_cogs_account_id FROM branch_coa_accounts WHERE branch_id = v_branch_id AND template_code = 'COGS';
  SELECT account_id INTO v_sales_revenue_account_id FROM branch_coa_accounts WHERE branch_id = v_branch_id AND template_code = 'SALES_REVENUE';
  SELECT account_id INTO v_vat_output_account_id FROM branch_coa_accounts WHERE branch_id = v_branch_id AND template_code = 'VAT_OUTPUT';

  IF v_sales_revenue_account_id IS NULL OR v_inventory_account_id IS NULL OR v_cogs_account_id IS NULL THEN
    UPDATE pos_workflow_requests SET status='failed', error_code='MISSING_ACCOUNTS',
      error_message='حسابات الفرع غير مكتملة', updated_at=now()
    WHERE client_request_id = v_client_request_id;
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_ACCOUNTS',
      'error', 'حسابات الفرع المحاسبية غير مكتملة - تواصل مع مدير النظام');
  END IF;

  IF v_payment_method = 'cash' THEN
    IF v_cash_account_id IS NULL THEN
      UPDATE pos_workflow_requests SET status='failed', error_code='MISSING_ACCOUNTS',
        error_message='حساب الصندوق النقدي غير موجود', updated_at=now()
      WHERE client_request_id = v_client_request_id;
      RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_ACCOUNTS',
        'error', 'حساب الصندوق النقدي غير مُعرّف للفرع');
    END IF;
  ELSIF v_payment_method = 'card' OR v_payment_method = 'bank_transfer' THEN
    IF v_bank_account_id IS NULL THEN
      UPDATE pos_workflow_requests SET status='failed', error_code='MISSING_ACCOUNTS',
        error_message='حساب البنك غير موجود', updated_at=now()
      WHERE client_request_id = v_client_request_id;
      RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_ACCOUNTS',
        'error', 'حساب البنك غير مُعرّف للفرع');
    END IF;
  ELSIF v_payment_method LIKE 'split:%' THEN
    IF v_cash_amount + v_card_amount != v_final_amount THEN
      UPDATE pos_workflow_requests SET status='failed', error_code='PAYMENT_MISMATCH',
        error_message='مجموع المبالغ المقسمة لا يساوي المبلغ الإجمالي', updated_at=now()
      WHERE client_request_id = v_client_request_id;
      RETURN jsonb_build_object('success', false, 'error_code', 'PAYMENT_MISMATCH',
        'error', 'مجموع النقد والبطاقة (' || (v_cash_amount + v_card_amount) || ') لا يساوي الإجمالي (' || v_final_amount || ')');
    END IF;
    IF v_cash_amount > 0 AND v_cash_account_id IS NULL THEN
      UPDATE pos_workflow_requests SET status='failed', error_code='MISSING_ACCOUNTS',
        error_message='حساب الصندوق النقدي غير موجود', updated_at=now()
      WHERE client_request_id = v_client_request_id;
      RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_ACCOUNTS',
        'error', 'حساب الصندوق النقدي غير مُعرّف للفرع');
    END IF;
    IF v_card_amount > 0 AND v_bank_account_id IS NULL THEN
      UPDATE pos_workflow_requests SET status='failed', error_code='MISSING_ACCOUNTS',
        error_message='حساب البنك غير موجود', updated_at=now()
      WHERE client_request_id = v_client_request_id;
      RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_ACCOUNTS',
        'error', 'حساب البنك غير مُعرّف للفرع');
    END IF;
  ELSIF v_payment_method = 'credit' THEN
    UPDATE pos_workflow_requests SET status='failed', error_code='UNSUPPORTED_PAYMENT_METHOD',
      error_message='البيع الآجل غير مدعوم حالياً', updated_at=now()
    WHERE client_request_id = v_client_request_id;
    RETURN jsonb_build_object('success', false, 'error_code', 'UNSUPPORTED_PAYMENT_METHOD',
      'error', 'البيع الآجل غير مدعوم حالياً');
  END IF;

  v_sale_code := 'SAL-' || to_char(now(), 'YYYYMMDD') || '-' || LPAD(
    (COALESCE((SELECT COUNT(*) FROM sales WHERE sale_code LIKE 'SAL-' || to_char(now(), 'YYYYMMDD') || '-%'), 0) + 1)::text, 4, '0');
  v_invoice_number := generate_invoice_number('sales'::text);
  v_je_number := generate_journal_entry_number();

  INSERT INTO sales (sale_code, sale_date, customer_id, branch_id, subtotal, tax_amount, discount_amount, total_amount, status, notes, created_at, seller_profile_id)
  VALUES (v_sale_code, now(), v_customer_id, v_branch_id, v_subtotal, v_tax_amount, v_discount_amount, v_final_amount, 'completed', v_notes, now(), v_seller_profile_id)
  RETURNING id INTO v_sale_id;

  INSERT INTO journal_entries (entry_number, entry_date, description, reference_type, reference_id, is_posted, posted_at, branch_id, total_debit, total_credit, created_at, status)
  VALUES (v_je_number, now(), 'قيد بيع نقاط بيع - ' || v_sale_code, 'sale', v_sale_id, true, now(), v_branch_id, 0, 0, now(), 'posted')
  RETURNING id INTO v_je_id;

  INSERT INTO invoices (invoice_number, invoice_type, invoice_date, status, customer_id, branch_id, subtotal, tax_amount, discount_amount, total_amount, journal_entry_id, sale_id, paid_amount, remaining_amount, zatca_status, created_at, seller_profile_id)
  VALUES (v_invoice_number, 'sales', now(), 'posted', v_customer_id, v_branch_id, v_subtotal, v_tax_amount, v_discount_amount, v_final_amount, v_je_id, v_sale_id, v_final_amount, 0, 'pending', now(), v_seller_profile_id)
  RETURNING id INTO v_invoice_id;

  UPDATE sales SET invoice_id = v_invoice_id, journal_entry_id = v_je_id WHERE id = v_sale_id;

  FOR i IN 0..v_items_count-1 LOOP
    INSERT INTO sales_invoice_items (invoice_id, jewelry_item_id, quantity, unit_price, total_price)
    VALUES (v_invoice_id, (v_items->i->>'jewelry_item_id')::uuid, 1,
            (v_items->i->>'unit_price')::numeric, (v_items->i->>'unit_price')::numeric);
  END LOOP;

  UPDATE unique_items SET sold_at = now(), sale_id = v_sale_id, status = 'sold' WHERE id = ANY(v_item_ids);

  FOR i IN 0..v_items_count-1 LOOP
    INSERT INTO unique_item_movements (
      unique_item_id, movement_type, from_branch_id, to_branch_id,
      reference_type, reference_id, unit_cost, notes, created_at
    ) VALUES (
      (v_items->i->>'jewelry_item_id')::uuid,
      'sale_out',
      v_branch_id,
      NULL,
      'invoice',
      v_invoice_id,
      (SELECT cost FROM unique_items WHERE id = (v_items->i->>'jewelry_item_id')::uuid),
      'بيع نقاط بيع - ' || v_sale_code,
      now()
    );
  END LOOP;

  IF v_payment_method = 'cash' THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_cash_account_id, v_final_amount, 0, 'تحصيل نقدي - ' || v_sale_code);
    v_total_debit := v_total_debit + v_final_amount;
  ELSIF v_payment_method = 'card' OR v_payment_method = 'bank_transfer' THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_bank_account_id, v_final_amount, 0, 'تحصيل بطاقة/تحويل - ' || v_sale_code);
    v_total_debit := v_total_debit + v_final_amount;
  ELSIF v_payment_method LIKE 'split:%' THEN
    IF v_cash_amount > 0 THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
      VALUES (v_je_id, v_cash_account_id, v_cash_amount, 0, 'تحصيل نقدي (مقسم) - ' || v_sale_code);
      v_total_debit := v_total_debit + v_cash_amount;
    END IF;
    IF v_card_amount > 0 THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
      VALUES (v_je_id, v_bank_account_id, v_card_amount, 0, 'تحصيل بطاقة (مقسم) - ' || v_sale_code);
      v_total_debit := v_total_debit + v_card_amount;
    END IF;
  END IF;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
  VALUES (v_je_id, v_sales_revenue_account_id, 0, v_taxable_base, 'إيراد مبيعات - ' || v_sale_code);
  v_total_credit := v_total_credit + v_taxable_base;

  IF v_tax_amount > 0 AND v_vat_output_account_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_vat_output_account_id, 0, v_tax_amount, 'ضريبة مخرجات - ' || v_sale_code);
    v_total_credit := v_total_credit + v_tax_amount;
  END IF;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
  VALUES (v_je_id, v_cogs_account_id, v_total_cost, 0, 'تكلفة بضاعة مباعة - ' || v_sale_code);
  v_total_debit := v_total_debit + v_total_cost;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
  VALUES (v_je_id, v_inventory_account_id, 0, v_total_cost, 'تخفيض مخزون - ' || v_sale_code);
  v_total_credit := v_total_credit + v_total_cost;

  UPDATE journal_entries SET total_debit = v_total_debit, total_credit = v_total_credit WHERE id = v_je_id;

  v_payment_number := generate_payment_number();
  INSERT INTO payments (payment_number, payment_date, payment_type, amount, payment_method, reference_type, reference_id, customer_id, branch_id, notes, status, created_at, seller_profile_id)
  VALUES (v_payment_number, now(), 'receipt', v_final_amount, v_payment_method, 'invoice', v_invoice_id, v_customer_id, v_branch_id,
    'سداد فاتورة بيع - ' || v_invoice_number, 'completed', now(), v_seller_profile_id);

  v_result := jsonb_build_object(
    'success', true,
    'sale_id', v_sale_id,
    'sale_code', v_sale_code,
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'journal_entry_id', v_je_id,
    'journal_entry_number', v_je_number,
    'subtotal', v_subtotal,
    'tax_amount', v_tax_amount,
    'discount_amount', v_discount_amount,
    'final_amount', v_final_amount,
    'total_cost', v_total_cost,
    'items_sold', v_items_count,
    'payment_method', v_payment_method,
    'payment_number', v_payment_number
  );

  UPDATE pos_workflow_requests
  SET status = 'succeeded', result = v_result, updated_at = now()
  WHERE client_request_id = v_client_request_id;

  RETURN v_result;
END;
$func$;
`;

const RPC_CORRECTION_EXECUTE_SQL = `
-- =====================================================
-- 14. purchase_correction_execute_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.purchase_correction_execute_atomic(args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $func$
DECLARE
  v_client_req_id  text := args->>'client_request_id';
  v_group_id       uuid := (args->>'group_id')::uuid;
  v_created_by     uuid := NULLIF(args->>'created_by', '')::uuid;

  v_wf_key         text;
  v_cached         jsonb;
  v_group          record;
  v_parent_inv     record;
  v_branch_code    text;

  v_inv_acct_id    uuid;
  v_ap_acct_id     uuid;
  v_vat_acct_id    uuid;

  v_action         record;
  v_current_lock   jsonb;
  v_lock_state     text;

  v_return_id      uuid;
  v_return_no      text;
  v_return_subtotal numeric := 0;
  v_return_items   int := 0;
  v_je_id          uuid;
  v_je_no          text;

  v_addon_inv_id   uuid;
  v_addon_inv_no   text;
  v_addon_subtotal numeric := 0;
  v_addon_items    int := 0;
  v_addon_je_id    uuid;
  v_addon_je_no    text;
  v_new_item_id    uuid;
  v_new_serial     text;
  v_new_data       jsonb;
  v_item_cost      numeric;
  v_line_no        int;

  v_total_removed  numeric := 0;
  v_total_added    numeric := 0;
  v_cnt_removed    int := 0;
  v_cnt_added      int := 0;
  v_cnt_edited     int := 0;
  v_unit_cost      numeric;

  v_result         jsonb;
BEGIN
  v_wf_key := v_client_req_id || '::purchase_correction_execute';

  SELECT result_payload INTO v_cached
  FROM atomic_workflow_requests WHERE client_request_id = v_wf_key AND status = 'completed';
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  INSERT INTO atomic_workflow_requests (client_request_id, workflow_type, status, created_by)
  VALUES (v_wf_key, 'purchase_correction_execute', 'pending', v_created_by)
  ON CONFLICT (client_request_id) DO NOTHING;

  SELECT * INTO v_group FROM purchase_correction_groups WHERE id = v_group_id FOR UPDATE;
  IF v_group IS NULL THEN
    v_result := jsonb_build_object('success', false, 'error', 'GROUP_NOT_FOUND', 'message_ar', 'مجموعة التصحيح غير موجودة');
    UPDATE atomic_workflow_requests SET status = 'completed', result_payload = v_result, completed_at = now() WHERE client_request_id = v_wf_key;
    RETURN v_result;
  END IF;
  IF v_group.status <> 'draft' THEN
    v_result := jsonb_build_object('success', false, 'error', 'INVALID_STATUS',
      'message_ar', 'حالة المجموعة (' || v_group.status || ') لا تسمح بالتنفيذ. يجب أن تكون مسودة.');
    UPDATE atomic_workflow_requests SET status = 'completed', result_payload = v_result, completed_at = now() WHERE client_request_id = v_wf_key;
    RETURN v_result;
  END IF;

  UPDATE purchase_correction_groups SET status = 'submitted' WHERE id = v_group_id;

  SELECT * INTO v_parent_inv FROM unique_purchase_invoices WHERE id = v_group.parent_unique_invoice_id;
  IF v_parent_inv IS NULL OR v_parent_inv.status NOT IN ('posted', 'partial') THEN
    UPDATE purchase_correction_groups SET status = 'failed', error_message = 'الفاتورة الأصلية غير صالحة' WHERE id = v_group_id;
    v_result := jsonb_build_object('success', false, 'error', 'PARENT_INVALID', 'message_ar', 'الفاتورة الأصلية غير صالحة أو ملغاة');
    UPDATE atomic_workflow_requests SET status = 'completed', result_payload = v_result, completed_at = now() WHERE client_request_id = v_wf_key;
    RETURN v_result;
  END IF;

  SELECT code INTO v_branch_code FROM branches WHERE id = v_parent_inv.branch_id;
  IF v_branch_code IS NULL THEN
    UPDATE purchase_correction_groups SET status = 'failed', error_message = 'الفرع غير موجود' WHERE id = v_group_id;
    v_result := jsonb_build_object('success', false, 'error', 'BRANCH_NOT_FOUND', 'message_ar', 'الفرع غير موجود');
    UPDATE atomic_workflow_requests SET status = 'completed', result_payload = v_result, completed_at = now() WHERE client_request_id = v_wf_key;
    RETURN v_result;
  END IF;

  SELECT id INTO v_inv_acct_id FROM chart_of_accounts WHERE account_code = v_branch_code || '-1301';
  IF v_inv_acct_id IS NULL THEN
    SELECT id INTO v_inv_acct_id FROM chart_of_accounts WHERE account_code = '1301';
  END IF;
  IF v_inv_acct_id IS NULL THEN
    UPDATE purchase_correction_groups SET status = 'failed', error_message = 'حساب المخزون 1301 غير موجود' WHERE id = v_group_id;
    v_result := jsonb_build_object('success', false, 'error', 'CONFIG_ERROR', 'message_ar', 'حساب المخزون 1301 غير موجود');
    UPDATE atomic_workflow_requests SET status = 'completed', result_payload = v_result, completed_at = now() WHERE client_request_id = v_wf_key;
    RETURN v_result;
  END IF;

  SELECT id INTO v_ap_acct_id FROM chart_of_accounts WHERE account_code = v_branch_code || '-2101';
  IF v_ap_acct_id IS NULL THEN
    SELECT id INTO v_ap_acct_id FROM chart_of_accounts WHERE account_code = '2101';
  END IF;
  IF v_ap_acct_id IS NULL THEN
    SELECT id INTO v_ap_acct_id FROM chart_of_accounts WHERE account_code = '2100';
  END IF;
  IF v_ap_acct_id IS NULL THEN
    UPDATE purchase_correction_groups SET status = 'failed', error_message = 'حساب الموردين 2101 غير موجود' WHERE id = v_group_id;
    v_result := jsonb_build_object('success', false, 'error', 'CONFIG_ERROR', 'message_ar', 'حساب الموردين 2101 غير موجود');
    UPDATE atomic_workflow_requests SET status = 'completed', result_payload = v_result, completed_at = now() WHERE client_request_id = v_wf_key;
    RETURN v_result;
  END IF;

  FOR v_action IN
    SELECT * FROM purchase_correction_actions
    WHERE group_id = v_group_id AND action_type IN ('remove', 'edit_remove')
    ORDER BY sequence_no
  LOOP
    IF v_action.source_unique_item_id IS NULL THEN
      UPDATE purchase_correction_groups SET status = 'failed', error_message = 'إجراء حذف بدون قطعة مصدر (seq=' || v_action.sequence_no || ')' WHERE id = v_group_id;
      UPDATE purchase_correction_actions SET result_status = 'failed', result_error = 'missing source_unique_item_id' WHERE id = v_action.id;
      v_result := jsonb_build_object('success', false, 'error', 'MISSING_SOURCE', 'message_ar', 'إجراء حذف بدون قطعة مصدر');
      UPDATE atomic_workflow_requests SET status = 'completed', result_payload = v_result, completed_at = now() WHERE client_request_id = v_wf_key;
      RETURN v_result;
    END IF;

    PERFORM 1 FROM unique_items WHERE id = v_action.source_unique_item_id FOR UPDATE;
    v_current_lock := compute_unique_item_lock_state(v_action.source_unique_item_id);
    v_lock_state := v_current_lock->>'state';

    IF v_lock_state <> 'OK' THEN
      UPDATE purchase_correction_groups SET status = 'failed',
        error_message = 'القطعة مقفلة: ' || v_lock_state || ' (seq=' || v_action.sequence_no || ')' WHERE id = v_group_id;
      UPDATE purchase_correction_actions SET result_status = 'failed',
        result_error = 'lock_state_changed: ' || v_lock_state WHERE id = v_action.id;
      v_result := jsonb_build_object('success', false, 'error', 'LOCK_STATE_CHANGED',
        'message_ar', 'تغيرت حالة القفل للقطعة (الحالة: ' || v_lock_state || ')',
        'sequence_no', v_action.sequence_no,
        'current_lock', v_current_lock);
      UPDATE atomic_workflow_requests SET status = 'completed', result_payload = v_result, completed_at = now() WHERE client_request_id = v_wf_key;
      RETURN v_result;
    END IF;
  END LOOP;

  SELECT COUNT(*)::int INTO v_return_items
  FROM purchase_correction_actions
  WHERE group_id = v_group_id AND action_type IN ('remove', 'edit_remove');

  IF v_return_items > 0 THEN
    v_return_no := 'UPR-COR-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(nextval('public.upr_doc_seq')::text, 6, '0');

    INSERT INTO unique_purchase_returns (
      return_number, supplier_id, branch_id, unique_invoice_id,
      return_date, status, reason, created_by
    ) VALUES (
      v_return_no, v_parent_inv.supplier_id, v_parent_inv.branch_id, v_parent_inv.id,
      CURRENT_DATE, 'posted', 'تصحيح مشتريات - ' || v_group.correction_number, v_created_by
    ) RETURNING id INTO v_return_id;

    v_return_subtotal := 0;
    v_line_no := 0;

    FOR v_action IN
      SELECT * FROM purchase_correction_actions
      WHERE group_id = v_group_id AND action_type IN ('remove', 'edit_remove')
      ORDER BY sequence_no
    LOOP
      v_line_no := v_line_no + 1;
      SELECT cost INTO v_unit_cost FROM unique_items WHERE id = v_action.source_unique_item_id;
      v_return_subtotal := v_return_subtotal + COALESCE(v_unit_cost, 0);

      INSERT INTO unique_purchase_return_items (unique_return_id, unique_item_id, unit_cost, qty, line_total)
      VALUES (v_return_id, v_action.source_unique_item_id, COALESCE(v_unit_cost, 0), 1, COALESCE(v_unit_cost, 0));

      INSERT INTO unique_item_movements (unique_item_id, movement_type, from_branch_id, reference_type, reference_id, unit_cost, notes, created_by)
      VALUES (v_action.source_unique_item_id, 'purchase_return_out', v_parent_inv.branch_id, 'unique_purchase_return', v_return_id, v_unit_cost, 'تصحيح - حذف', v_created_by);

      UPDATE unique_items SET status = 'returned_to_supplier' WHERE id = v_action.source_unique_item_id;

      UPDATE purchase_correction_actions SET result_status = 'applied' WHERE id = v_action.id;

      IF v_action.action_type = 'remove' THEN v_cnt_removed := v_cnt_removed + 1;
      ELSE v_cnt_edited := v_cnt_edited + 1; END IF;
    END LOOP;

    UPDATE unique_purchase_returns SET subtotal = v_return_subtotal, total_amount = v_return_subtotal WHERE id = v_return_id;

    v_je_no := 'JE-COR-R-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(nextval('public.je_doc_seq')::text, 6, '0');
    INSERT INTO journal_entries (
      entry_number, entry_date, description, reference_type, reference_id,
      branch_id, total_debit, total_credit, is_posted, posted_at, status, created_by
    ) VALUES (
      v_je_no, CURRENT_DATE, 'تصحيح مشتريات (حذف) - ' || v_group.correction_number,
      'unique_purchase_return', v_return_id,
      v_parent_inv.branch_id, v_return_subtotal, v_return_subtotal, true, now(), 'posted', v_created_by
    ) RETURNING id INTO v_je_id;

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_inv_acct_id, 0, v_return_subtotal, 'تصحيح - مرتجع مخزون');
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_ap_acct_id, v_return_subtotal, 0, 'تصحيح - تخفيض ذمم دائنة');

    UPDATE unique_purchase_returns SET journal_entry_id = v_je_id WHERE id = v_return_id;

    v_total_removed := v_return_subtotal;

    INSERT INTO purchase_correction_artifacts (group_id, artifact_type, artifact_ref_table, artifact_ref_id, artifact_ref_number, amount)
    VALUES (v_group_id, 'return', 'unique_purchase_returns', v_return_id, v_return_no, v_return_subtotal);
    INSERT INTO purchase_correction_artifacts (group_id, artifact_type, artifact_ref_table, artifact_ref_id, artifact_ref_number, amount)
    VALUES (v_group_id, 'journal_entry', 'journal_entries', v_je_id, v_je_no, v_return_subtotal);
  END IF;

  SELECT COUNT(*)::int INTO v_addon_items
  FROM purchase_correction_actions
  WHERE group_id = v_group_id AND action_type IN ('add', 'edit_add');

  IF v_addon_items > 0 THEN
    v_addon_inv_no := 'UINV-COR-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(nextval('public.uinv_doc_seq')::text, 6, '0');
    v_addon_subtotal := 0;
    v_line_no := 0;

    INSERT INTO unique_purchase_invoices (
      batch_id, supplier_id, branch_id, supp_inv, invoice_number, invoice_date,
      status, vat_rate, subtotal, tax_amount, total_amount,
      paid_amount, remaining_amount,
      notes, created_by
    ) VALUES (
      v_parent_inv.batch_id, v_parent_inv.supplier_id, v_parent_inv.branch_id,
      NULL, v_addon_inv_no, CURRENT_DATE,
      'posted', 0, 0, 0, 0,
      0, 0,
      'فاتورة إضافية - تصحيح ' || v_group.correction_number, v_created_by
    ) RETURNING id INTO v_addon_inv_id;

    FOR v_action IN
      SELECT * FROM purchase_correction_actions
      WHERE group_id = v_group_id AND action_type IN ('add', 'edit_add')
      ORDER BY sequence_no
    LOOP
      v_line_no := v_line_no + 1;
      v_new_data := v_action.new_item_data;

      IF v_new_data IS NULL THEN
        UPDATE purchase_correction_actions SET result_status = 'failed', result_error = 'missing new_item_data' WHERE id = v_action.id;
        UPDATE purchase_correction_groups SET status = 'failed', error_message = 'بيانات القطعة الجديدة مفقودة (seq=' || v_action.sequence_no || ')' WHERE id = v_group_id;
        RAISE EXCEPTION 'missing new_item_data for action seq=%', v_action.sequence_no;
      END IF;

      v_item_cost := COALESCE((v_new_data->>'cost')::numeric, 0);
      v_addon_subtotal := v_addon_subtotal + v_item_cost;

      v_new_serial := COALESCE(
        NULLIF(trim(v_new_data->>'serial_no'), ''),
        public.generate_serial(
          public.normalize_prefix_from_stockcode(
            COALESCE(NULLIF(trim(v_new_data->>'stockcode'), ''), NULLIF(trim(v_new_data->>'type'), ''))
          )
        )
      );

      INSERT INTO unique_items (
        serial_no, branch_id, supplier_id, batch_id, unique_invoice_id,
        stockcode, model, description, type, metal, stone,
        cost, tag_price, g_weight, d_weight, b_weight,
        created_by
      ) VALUES (
        v_new_serial, v_parent_inv.branch_id, v_parent_inv.supplier_id, v_parent_inv.batch_id, v_addon_inv_id,
        v_new_data->>'stockcode', v_new_data->>'model', v_new_data->>'description',
        v_new_data->>'type', v_new_data->>'metal', v_new_data->>'stone',
        v_item_cost,
        COALESCE((v_new_data->>'tag_price')::numeric, 0),
        COALESCE((v_new_data->>'g_weight')::numeric, 0),
        COALESCE((v_new_data->>'d_weight')::numeric, 0),
        COALESCE((v_new_data->>'b_weight')::numeric, 0),
        v_created_by
      ) RETURNING id INTO v_new_item_id;

      INSERT INTO unique_purchase_invoice_items (unique_invoice_id, unique_item_id, line_no, unit_cost, qty, line_total)
      VALUES (v_addon_inv_id, v_new_item_id, v_line_no, v_item_cost, 1, v_item_cost);

      INSERT INTO unique_item_movements (unique_item_id, movement_type, to_branch_id, reference_type, reference_id, unit_cost, notes, created_by)
      VALUES (v_new_item_id, 'purchase_in', v_parent_inv.branch_id, 'unique_purchase_invoice', v_addon_inv_id, v_item_cost, 'تصحيح - إضافة', v_created_by);

      UPDATE purchase_correction_actions SET result_status = 'applied' WHERE id = v_action.id;

      IF v_action.action_type = 'add' THEN v_cnt_added := v_cnt_added + 1;
      END IF;
    END LOOP;

    UPDATE unique_purchase_invoices
    SET subtotal = v_addon_subtotal, total_amount = v_addon_subtotal,
        remaining_amount = v_addon_subtotal
    WHERE id = v_addon_inv_id;

    v_addon_je_no := 'JE-COR-A-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(nextval('public.je_doc_seq')::text, 6, '0');
    INSERT INTO journal_entries (
      entry_number, entry_date, description, reference_type, reference_id,
      branch_id, total_debit, total_credit, is_posted, posted_at, status, created_by
    ) VALUES (
      v_addon_je_no, CURRENT_DATE, 'تصحيح مشتريات (إضافة) - ' || v_group.correction_number,
      'unique_purchase_invoice', v_addon_inv_id,
      v_parent_inv.branch_id, v_addon_subtotal, v_addon_subtotal, true, now(), 'posted', v_created_by
    ) RETURNING id INTO v_addon_je_id;

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_addon_je_id, v_inv_acct_id, v_addon_subtotal, 0, 'تصحيح - إضافة مخزون');
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_addon_je_id, v_ap_acct_id, 0, v_addon_subtotal, 'تصحيح - زيادة ذمم دائنة');

    UPDATE unique_purchase_invoices SET journal_entry_id = v_addon_je_id WHERE id = v_addon_inv_id;

    v_total_added := v_addon_subtotal;

    INSERT INTO purchase_correction_artifacts (group_id, artifact_type, artifact_ref_table, artifact_ref_id, artifact_ref_number, amount)
    VALUES (v_group_id, 'addon_invoice', 'unique_purchase_invoices', v_addon_inv_id, v_addon_inv_no, v_addon_subtotal);
    INSERT INTO purchase_correction_artifacts (group_id, artifact_type, artifact_ref_table, artifact_ref_id, artifact_ref_number, amount)
    VALUES (v_group_id, 'journal_entry', 'journal_entries', v_addon_je_id, v_addon_je_no, v_addon_subtotal);
  END IF;

  UPDATE purchase_correction_groups SET
    status = 'applied',
    total_removed = v_total_removed,
    total_added = v_total_added,
    net_change = v_total_added - v_total_removed,
    items_removed = v_cnt_removed,
    items_added = v_cnt_added,
    items_edited = v_cnt_edited,
    applied_at = now()
  WHERE id = v_group_id;

  PERFORM public.recompute_unique_invoice_status(v_parent_inv.id);

  v_result := jsonb_build_object(
    'success', true,
    'group_id', v_group_id,
    'correction_number', v_group.correction_number,
    'status', 'applied',
    'items_removed', v_cnt_removed,
    'items_added', v_cnt_added,
    'items_edited', v_cnt_edited,
    'total_removed', v_total_removed,
    'total_added', v_total_added,
    'net_change', v_total_added - v_total_removed,
    'return_number', v_return_no,
    'addon_invoice_number', v_addon_inv_no
  );

  UPDATE atomic_workflow_requests
  SET status = 'completed', result_payload = v_result, completed_at = now()
  WHERE client_request_id = v_wf_key;

  RETURN v_result;
END;
$func$;
`;

const MIGRATION_VERSION = "2026-02-17-rpc-sync-v3";

export async function runRpcSync(): Promise<void> {
  const client = await pool.connect();
  try {
    const versionCheck = await client.query(
      `SELECT 1 FROM atomic_workflow_requests WHERE client_request_id = $1 AND status = 'completed' LIMIT 1`,
      [`migration::${MIGRATION_VERSION}`]
    );

    if (versionCheck.rows.length > 0) {
      console.log(`[rpcSync] Migration ${MIGRATION_VERSION} already applied, skipping`);
      return;
    }

    console.log(`[rpcSync] Applying migration ${MIGRATION_VERSION} to ${(await client.query('SELECT current_database()')).rows[0].current_database}...`);

    const sqlBlocks = [
      RPC_FUNCTIONS_SQL,
      RPC_IMPORT_EXCEL_SQL,
      RPC_REBUILD_SQL,
      RPC_RETURN_SQL,
      RPC_CORRECTION_SQL,
      RPC_POS_SALE_SQL_PART1,
      RPC_CORRECTION_EXECUTE_SQL,
    ];

    for (let i = 0; i < sqlBlocks.length; i++) {
      await client.query(sqlBlocks[i]);
      console.log(`[rpcSync] Block ${i + 1}/${sqlBlocks.length} applied`);
    }

    await client.query(
      `INSERT INTO atomic_workflow_requests (client_request_id, workflow_type, status, completed_at)
       VALUES ($1, 'migration', 'completed', now())
       ON CONFLICT (client_request_id) DO NOTHING`,
      [`migration::${MIGRATION_VERSION}`]
    );

    console.log(`[rpcSync] Migration ${MIGRATION_VERSION} completed successfully`);
  } catch (err: any) {
    console.error(`[rpcSync] Migration failed:`, err.message);
    throw err;
  } finally {
    client.release();
  }
}
