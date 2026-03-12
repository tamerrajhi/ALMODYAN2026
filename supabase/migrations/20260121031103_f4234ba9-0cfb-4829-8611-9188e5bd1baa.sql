-- ====================================================================
-- 6. complete_erp_credit_note_atomic - UNIFIED JE GENERATION
-- ====================================================================
CREATE OR REPLACE FUNCTION public.complete_erp_credit_note_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_client_request_id text;
  v_credit_note_id uuid;
  v_branch_id uuid;
  v_customer_id uuid;
  v_linked_invoice_id uuid;
  v_credit_note_date date;
  v_reason text;
  v_notes text;
  v_tax_rate numeric;
  v_is_draft boolean;
  v_lines jsonb;
  v_customer_record RECORD;
  v_cn_number text;
  v_je_id uuid;
  v_je_number text;
  v_subtotal numeric := 0;
  v_tax_amount numeric := 0;
  v_total_amount numeric := 0;
  v_line RECORD;
  v_line_subtotal numeric;
  v_line_tax numeric;
  v_ar_parent_id uuid;
  v_customer_account_id uuid;
  v_sales_returns_account_id uuid;
  v_vat_account_id uuid;
  v_begin_result jsonb;
  v_result_payload jsonb;
BEGIN
  v_client_request_id := p_payload->>'client_request_id';
  v_credit_note_id := (p_payload->>'credit_note_id')::uuid;
  v_branch_id := (p_payload->>'branch_id')::uuid;
  v_customer_id := (p_payload->>'customer_id')::uuid;
  v_linked_invoice_id := (p_payload->>'linked_invoice_id')::uuid;
  v_credit_note_date := COALESCE((p_payload->>'credit_note_date')::date, CURRENT_DATE);
  v_reason := p_payload->>'reason';
  v_notes := p_payload->>'notes';
  v_tax_rate := COALESCE((p_payload->>'tax_rate')::numeric, 0.15);
  v_is_draft := COALESCE((p_payload->>'is_draft')::boolean, false);
  v_lines := p_payload->'lines';

  IF v_client_request_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'MISSING_CLIENT_REQUEST_ID'); END IF;
  IF v_customer_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'MISSING_CUSTOMER_ID'); END IF;
  IF v_lines IS NULL OR jsonb_array_length(v_lines) = 0 THEN RETURN jsonb_build_object('success', false, 'error', 'MISSING_LINES'); END IF;

  v_begin_result := public.atomic_begin_request(v_client_request_id, 'erp_credit_note', p_payload, NULL);
  IF v_begin_result->>'status' = 'completed' THEN RETURN v_begin_result->'result'; END IF;
  IF v_begin_result->>'status' = 'failed' THEN RETURN v_begin_result->'result'; END IF;

  BEGIN
    v_ar_parent_id := get_system_account_id('RECEIVABLES_PARENT');
    v_sales_returns_account_id := get_system_account_id('SALES_RETURNS_CONTRA');
    v_vat_account_id := get_system_account_id('VAT_PAYABLE');
  EXCEPTION WHEN OTHERS THEN
    v_result_payload := jsonb_build_object('success', false, 'error', 'ACCOUNT_PREFLIGHT_FAILED', 'details', SQLERRM);
    PERFORM public.atomic_failed(v_client_request_id, 'erp_credit_note', v_result_payload, 'ACCOUNT_PREFLIGHT_FAILED', SQLERRM);
    RETURN v_result_payload;
  END;

  SELECT * INTO v_customer_record FROM customers WHERE id = v_customer_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'CUSTOMER_NOT_FOUND'); END IF;

  v_customer_account_id := COALESCE(v_customer_record.account_id, v_ar_parent_id);

  FOR v_line IN SELECT * FROM jsonb_to_recordset(v_lines) AS x(description text, qty numeric, unit_price numeric, tax_rate numeric)
  LOOP
    v_line_subtotal := COALESCE(v_line.qty, 1) * COALESCE(v_line.unit_price, 0);
    v_line_tax := v_line_subtotal * COALESCE(v_line.tax_rate, v_tax_rate);
    v_subtotal := v_subtotal + v_line_subtotal;
    v_tax_amount := v_tax_amount + v_line_tax;
  END LOOP;
  v_total_amount := v_subtotal + v_tax_amount;

  v_cn_number := public.generate_credit_note_number();

  IF v_is_draft THEN
    IF v_credit_note_id IS NOT NULL THEN
      UPDATE credit_notes SET customer_id = v_customer_id, branch_id = v_branch_id, credit_note_date = v_credit_note_date, reason = v_reason, notes = v_notes, subtotal = v_subtotal, tax_amount = v_tax_amount, total_amount = v_total_amount, invoice_id = v_linked_invoice_id, updated_at = now() WHERE id = v_credit_note_id;
      DELETE FROM credit_note_items WHERE credit_note_id = v_credit_note_id;
    ELSE
      v_credit_note_id := gen_random_uuid();
      INSERT INTO credit_notes (id, credit_note_number, customer_id, branch_id, credit_note_date, reason, notes, status, subtotal, tax_amount, total_amount, invoice_id)
      VALUES (v_credit_note_id, v_cn_number, v_customer_id, v_branch_id, v_credit_note_date, v_reason, v_notes, 'draft', v_subtotal, v_tax_amount, v_total_amount, v_linked_invoice_id);
    END IF;

    FOR v_line IN SELECT * FROM jsonb_to_recordset(v_lines) AS x(description text, qty numeric, unit_price numeric, tax_rate numeric)
    LOOP
      v_line_subtotal := COALESCE(v_line.qty, 1) * COALESCE(v_line.unit_price, 0);
      v_line_tax := v_line_subtotal * COALESCE(v_line.tax_rate, v_tax_rate);
      INSERT INTO credit_note_items (credit_note_id, description, quantity, unit_price, tax_rate, tax_amount, total_amount)
      VALUES (v_credit_note_id, v_line.description, COALESCE(v_line.qty, 1), COALESCE(v_line.unit_price, 0), COALESCE(v_line.tax_rate, v_tax_rate), v_line_tax, v_line_subtotal + v_line_tax);
    END LOOP;

    v_result_payload := jsonb_build_object('success', true, 'credit_note_id', v_credit_note_id, 'credit_note_number', v_cn_number, 'status', 'draft', 'total_amount', v_total_amount);
    PERFORM public.atomic_complete(v_client_request_id, 'erp_credit_note', v_result_payload);
    RETURN v_result_payload;
  END IF;

  v_je_id := gen_random_uuid();
  -- UNIFIED: Use standard generator
  v_je_number := public.generate_journal_entry_number();

  INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, status, branch_id, is_posted)
  VALUES (v_je_id, v_je_number, v_credit_note_date, 'credit_note', v_credit_note_id, 'Credit Note: ' || v_cn_number, v_total_amount, v_total_amount, 'posted', v_branch_id, true);

  IF v_sales_returns_account_id IS NOT NULL AND v_subtotal > 0 THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES (v_je_id, v_sales_returns_account_id, v_subtotal, 0, 'Sales returns - ' || v_cn_number);
  END IF;
  IF v_vat_account_id IS NOT NULL AND v_tax_amount > 0 THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES (v_je_id, v_vat_account_id, v_tax_amount, 0, 'VAT adjustment - ' || v_cn_number);
  END IF;
  IF v_customer_account_id IS NOT NULL AND v_total_amount > 0 THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES (v_je_id, v_customer_account_id, 0, v_total_amount, 'Credit to customer - ' || v_cn_number);
  END IF;

  IF v_credit_note_id IS NOT NULL THEN
    UPDATE credit_notes SET customer_id = v_customer_id, branch_id = v_branch_id, credit_note_date = v_credit_note_date, reason = v_reason, notes = v_notes, subtotal = v_subtotal, tax_amount = v_tax_amount, total_amount = v_total_amount, invoice_id = v_linked_invoice_id, journal_entry_id = v_je_id, status = 'posted', updated_at = now() WHERE id = v_credit_note_id;
    DELETE FROM credit_note_items WHERE credit_note_id = v_credit_note_id;
  ELSE
    v_credit_note_id := gen_random_uuid();
    INSERT INTO credit_notes (id, credit_note_number, customer_id, branch_id, credit_note_date, reason, notes, status, subtotal, tax_amount, total_amount, invoice_id, journal_entry_id)
    VALUES (v_credit_note_id, v_cn_number, v_customer_id, v_branch_id, v_credit_note_date, v_reason, v_notes, 'posted', v_subtotal, v_tax_amount, v_total_amount, v_linked_invoice_id, v_je_id);
  END IF;

  FOR v_line IN SELECT * FROM jsonb_to_recordset(v_lines) AS x(description text, qty numeric, unit_price numeric, tax_rate numeric)
  LOOP
    v_line_subtotal := COALESCE(v_line.qty, 1) * COALESCE(v_line.unit_price, 0);
    v_line_tax := v_line_subtotal * COALESCE(v_line.tax_rate, v_tax_rate);
    INSERT INTO credit_note_items (credit_note_id, description, quantity, unit_price, tax_rate, tax_amount, total_amount)
    VALUES (v_credit_note_id, v_line.description, COALESCE(v_line.qty, 1), COALESCE(v_line.unit_price, 0), COALESCE(v_line.tax_rate, v_tax_rate), v_line_tax, v_line_subtotal + v_line_tax);
  END LOOP;

  v_result_payload := jsonb_build_object('success', true, 'credit_note_id', v_credit_note_id, 'credit_note_number', v_cn_number, 'journal_entry_id', v_je_id, 'journal_entry_number', v_je_number, 'status', 'posted', 'total_amount', v_total_amount);
  PERFORM public.atomic_complete(v_client_request_id, 'erp_credit_note', v_result_payload);
  RETURN v_result_payload;

EXCEPTION WHEN OTHERS THEN
  v_result_payload := jsonb_build_object('success', false, 'error', SQLERRM);
  PERFORM public.atomic_failed(v_client_request_id, 'erp_credit_note', v_result_payload, 'EXCEPTION', SQLERRM);
  RETURN v_result_payload;
END;
$function$;

-- ====================================================================
-- 7. create_customer_receipt_atomic - UNIFIED JE GENERATION
-- ====================================================================
CREATE OR REPLACE FUNCTION public.create_customer_receipt_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_client_request_id text;
  v_receipt_id uuid;
  v_receipt_number text;
  v_customer_id uuid;
  v_branch_id uuid;
  v_invoice_id uuid;
  v_amount numeric;
  v_receipt_date date;
  v_payment_method text;
  v_notes text;
  v_customer_record RECORD;
  v_je_id uuid;
  v_je_number text;
  v_ar_account_id uuid;
  v_cash_account_id uuid;
  v_bank_account_id uuid;
  v_payment_account_id uuid;
  v_begin_result jsonb;
  v_result_payload jsonb;
  v_user_id uuid;
  v_user_name text;
BEGIN
  v_client_request_id := p_payload->>'client_request_id';
  v_customer_id := (p_payload->>'customer_id')::uuid;
  v_branch_id := (p_payload->>'branch_id')::uuid;
  v_invoice_id := (p_payload->>'invoice_id')::uuid;
  v_amount := COALESCE((p_payload->>'amount')::numeric, 0);
  v_receipt_date := COALESCE((p_payload->>'receipt_date')::date, CURRENT_DATE);
  v_payment_method := COALESCE(p_payload->>'payment_method', 'cash');
  v_notes := p_payload->>'notes';

  IF v_client_request_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'client_request_id is required'); END IF;
  IF v_customer_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'customer_id is required'); END IF;
  IF v_amount <= 0 THEN RETURN jsonb_build_object('success', false, 'error', 'amount must be positive'); END IF;

  v_begin_result := public.atomic_begin_request(v_client_request_id, 'customer_receipt', p_payload, NULL);
  IF v_begin_result->>'status' = 'completed' THEN RETURN v_begin_result->'result'; END IF;
  IF v_begin_result->>'status' = 'failed' THEN RETURN v_begin_result->'result'; END IF;

  v_user_id := auth.uid();
  SELECT COALESCE(raw_user_meta_data->>'full_name', email, 'System') INTO v_user_name FROM auth.users WHERE id = v_user_id;

  SELECT * INTO v_customer_record FROM customers WHERE id = v_customer_id;
  IF NOT FOUND THEN
    v_result_payload := jsonb_build_object('success', false, 'error', 'Customer not found');
    PERFORM public.atomic_failed(v_client_request_id, 'customer_receipt', v_result_payload, 'NOT_FOUND', 'Customer not found');
    RETURN v_result_payload;
  END IF;

  v_ar_account_id := v_customer_record.account_id;
  IF v_ar_account_id IS NULL THEN SELECT id INTO v_ar_account_id FROM chart_of_accounts WHERE account_code = '1201' AND is_active = true LIMIT 1; END IF;

  SELECT id INTO v_cash_account_id FROM chart_of_accounts WHERE account_code = '1101' AND is_active = true LIMIT 1;
  SELECT id INTO v_bank_account_id FROM chart_of_accounts WHERE account_code = '1102' AND is_active = true LIMIT 1;

  IF v_payment_method = 'cash' THEN v_payment_account_id := v_cash_account_id;
  ELSE v_payment_account_id := v_bank_account_id;
  END IF;

  v_receipt_id := gen_random_uuid();
  v_receipt_number := public.generate_receipt_number();

  -- UNIFIED: Use standard generator
  v_je_number := public.generate_journal_entry_number();
  
  INSERT INTO journal_entries (entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, status, is_posted, branch_id, created_by, created_by_name)
  VALUES (v_je_number, v_receipt_date, 'customer_receipt', v_receipt_id, 'Customer Receipt: ' || v_receipt_number, v_amount, v_amount, 'posted', true, v_branch_id, v_user_id, v_user_name)
  RETURNING id INTO v_je_id;

  IF v_payment_account_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES (v_je_id, v_payment_account_id, v_amount, 0, 'Cash/Bank received');
  END IF;
  IF v_ar_account_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES (v_je_id, v_ar_account_id, 0, v_amount, 'Customer receivable reduced');
  END IF;

  INSERT INTO customer_receipts (id, receipt_number, customer_id, branch_id, invoice_id, amount, receipt_date, payment_method, notes, status, journal_entry_id, created_by)
  VALUES (v_receipt_id, v_receipt_number, v_customer_id, v_branch_id, v_invoice_id, v_amount, v_receipt_date, v_payment_method, v_notes, 'posted', v_je_id, v_user_id);

  IF v_invoice_id IS NOT NULL THEN
    UPDATE invoices SET paid_amount = COALESCE(paid_amount, 0) + v_amount, remaining_amount = GREATEST(0, COALESCE(remaining_amount, total_amount) - v_amount), updated_at = NOW() WHERE id = v_invoice_id;
  END IF;

  v_result_payload := jsonb_build_object('success', true, 'receipt_id', v_receipt_id, 'receipt_number', v_receipt_number, 'amount', v_amount, 'journal_entry_id', v_je_id, 'journal_entry_number', v_je_number);
  PERFORM public.atomic_complete(v_client_request_id, 'customer_receipt', v_result_payload);
  RETURN v_result_payload;

EXCEPTION WHEN OTHERS THEN
  v_result_payload := jsonb_build_object('success', false, 'error', SQLERRM);
  PERFORM public.atomic_failed(v_client_request_id, 'customer_receipt', v_result_payload, 'EXCEPTION', SQLERRM);
  RETURN v_result_payload;
END;
$function$;