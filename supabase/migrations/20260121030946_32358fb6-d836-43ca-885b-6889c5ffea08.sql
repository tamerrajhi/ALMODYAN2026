-- ====================================================================
-- 3. complete_pos_credit_note_atomic - UNIFIED JE GENERATION
-- ====================================================================
CREATE OR REPLACE FUNCTION public.complete_pos_credit_note_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_client_request_id text;
  v_credit_note_id uuid;
  v_credit_note_number text;
  v_branch_id uuid;
  v_customer_id uuid;
  v_sale_id uuid;
  v_reason text;
  v_notes text;
  v_credit_note_date date;
  v_items jsonb;
  v_item record;
  v_is_draft boolean;
  v_subtotal numeric := 0;
  v_tax_amount numeric := 0;
  v_total_amount numeric := 0;
  v_total_cogs numeric := 0;
  v_line_total numeric;
  v_line_tax numeric;
  v_unit_cogs numeric;
  v_journal_entry_id uuid;
  v_journal_number text;
  v_inventory_account_id uuid;
  v_revenue_account_id uuid;
  v_ar_account_id uuid;
  v_cogs_account_id uuid;
  v_vat_account_id uuid;
  v_begin_result jsonb;
  v_result_payload jsonb;
  v_user_id uuid;
  v_user_name text;
BEGIN
  v_client_request_id := p_payload->>'client_request_id';
  v_branch_id := (p_payload->>'branch_id')::uuid;
  v_customer_id := (p_payload->>'customer_id')::uuid;
  v_sale_id := (p_payload->>'sale_id')::uuid;
  v_reason := p_payload->>'reason';
  v_notes := p_payload->>'notes';
  v_credit_note_date := COALESCE((p_payload->>'credit_note_date')::date, CURRENT_DATE);
  v_items := p_payload->'items';
  v_is_draft := COALESCE((p_payload->>'is_draft')::boolean, false);

  IF v_client_request_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'client_request_id is required'); END IF;
  IF v_branch_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'branch_id is required'); END IF;
  IF v_customer_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'customer_id is required'); END IF;
  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN RETURN jsonb_build_object('success', false, 'error', 'items array is required'); END IF;

  v_begin_result := public.atomic_begin_request(v_client_request_id, 'pos_credit_note', p_payload, NULL);
  IF v_begin_result->>'status' = 'completed' THEN RETURN v_begin_result->'result'; END IF;
  IF v_begin_result->>'status' = 'failed' THEN RETURN v_begin_result->'result'; END IF;

  v_user_id := auth.uid();
  SELECT COALESCE(raw_user_meta_data->>'full_name', email, 'System') INTO v_user_name FROM auth.users WHERE id = v_user_id;

  v_credit_note_number := public.generate_credit_note_number();
  v_credit_note_id := gen_random_uuid();

  SELECT id INTO v_inventory_account_id FROM chart_of_accounts WHERE account_code = '1301' AND is_active = true LIMIT 1;
  SELECT id INTO v_revenue_account_id FROM chart_of_accounts WHERE account_code = '4001' AND is_active = true LIMIT 1;
  SELECT id INTO v_cogs_account_id FROM chart_of_accounts WHERE account_code = '5001' AND is_active = true LIMIT 1;
  SELECT id INTO v_vat_account_id FROM chart_of_accounts WHERE account_code = '2102' AND is_active = true LIMIT 1;
  SELECT account_id INTO v_ar_account_id FROM customers WHERE id = v_customer_id;
  IF v_ar_account_id IS NULL THEN SELECT id INTO v_ar_account_id FROM chart_of_accounts WHERE account_code = '1201' AND is_active = true LIMIT 1; END IF;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(v_items) AS x(jewelry_item_id uuid, description text, quantity numeric, unit_price numeric, tax_rate numeric)
  LOOP
    v_line_total := COALESCE(v_item.quantity, 1) * COALESCE(v_item.unit_price, 0);
    v_line_tax := v_line_total * COALESCE(v_item.tax_rate, 0.15);
    v_subtotal := v_subtotal + v_line_total;
    v_tax_amount := v_tax_amount + v_line_tax;

    IF v_item.jewelry_item_id IS NOT NULL THEN
      SELECT COALESCE(cost_price, 0) INTO v_unit_cogs FROM jewelry_items WHERE id = v_item.jewelry_item_id;
      v_total_cogs := v_total_cogs + (COALESCE(v_unit_cogs, 0) * COALESCE(v_item.quantity, 1));
      UPDATE jewelry_items SET sale_status = 'available', is_available_for_sale = true, branch_id = v_branch_id, updated_at = NOW() WHERE id = v_item.jewelry_item_id;
    END IF;

    INSERT INTO credit_note_items (credit_note_id, jewelry_item_id, description, quantity, unit_price, tax_rate, tax_amount, total_amount)
    VALUES (v_credit_note_id, v_item.jewelry_item_id, v_item.description, COALESCE(v_item.quantity, 1), COALESCE(v_item.unit_price, 0), COALESCE(v_item.tax_rate, 0.15), v_line_tax, v_line_total + v_line_tax);
  END LOOP;

  v_total_amount := v_subtotal + v_tax_amount;

  IF NOT v_is_draft THEN
    -- UNIFIED: Use standard generator
    v_journal_number := public.generate_journal_entry_number();
    
    INSERT INTO journal_entries (entry_number, entry_date, reference_type, reference_id, description, is_posted, total_debit, total_credit, branch_id)
    VALUES (v_journal_number, v_credit_note_date, 'credit_note', v_credit_note_id, 'Credit Note: ' || v_credit_note_number, true, v_total_amount + v_total_cogs, v_total_amount + v_total_cogs, v_branch_id)
    RETURNING id INTO v_journal_entry_id;
    
    IF v_revenue_account_id IS NOT NULL AND v_subtotal > 0 THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES (v_journal_entry_id, v_revenue_account_id, v_subtotal, 0, 'Sales returns');
    END IF;
    IF v_vat_account_id IS NOT NULL AND v_tax_amount > 0 THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES (v_journal_entry_id, v_vat_account_id, v_tax_amount, 0, 'VAT on returns');
    END IF;
    IF v_ar_account_id IS NOT NULL AND v_total_amount > 0 THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES (v_journal_entry_id, v_ar_account_id, 0, v_total_amount, 'Credit to customer');
    END IF;
    IF v_total_cogs > 0 THEN
      IF v_inventory_account_id IS NOT NULL THEN
        INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES (v_journal_entry_id, v_inventory_account_id, v_total_cogs, 0, 'Inventory restored');
      END IF;
      IF v_cogs_account_id IS NOT NULL THEN
        INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES (v_journal_entry_id, v_cogs_account_id, 0, v_total_cogs, 'COGS reversal');
      END IF;
    END IF;
  END IF;

  INSERT INTO credit_notes (id, credit_note_number, customer_id, branch_id, sale_id, credit_note_date, reason, notes, status, subtotal, tax_amount, total_amount, journal_entry_id, credit_note_type, created_by)
  VALUES (v_credit_note_id, v_credit_note_number, v_customer_id, v_branch_id, v_sale_id, v_credit_note_date, v_reason, v_notes, CASE WHEN v_is_draft THEN 'draft' ELSE 'posted' END, v_subtotal, v_tax_amount, v_total_amount, v_journal_entry_id, 'pos', v_user_id);

  v_result_payload := jsonb_build_object('success', true, 'credit_note_id', v_credit_note_id, 'credit_note_number', v_credit_note_number, 'total_amount', v_total_amount, 'journal_entry_id', v_journal_entry_id);
  PERFORM public.atomic_complete(v_client_request_id, 'pos_credit_note', v_result_payload);
  RETURN v_result_payload;

EXCEPTION WHEN OTHERS THEN
  v_result_payload := jsonb_build_object('success', false, 'error', SQLERRM);
  PERFORM public.atomic_failed(v_client_request_id, 'pos_credit_note', v_result_payload, 'EXCEPTION', SQLERRM);
  RETURN v_result_payload;
END;
$function$;

-- ====================================================================
-- 4. complete_pos_sales_return_atomic - UNIFIED JE GENERATION
-- ====================================================================
CREATE OR REPLACE FUNCTION public.complete_pos_sales_return_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_client_request_id text;
  v_pos_return_id uuid;
  v_return_number text;
  v_branch_id uuid;
  v_customer_id uuid;
  v_original_sale_id uuid;
  v_issue_date date;
  v_notes text;
  v_reason text;
  v_items jsonb;
  v_item record;
  v_subtotal numeric := 0;
  v_tax_amount numeric := 0;
  v_total_amount numeric := 0;
  v_total_cogs numeric := 0;
  v_line_total numeric;
  v_line_tax numeric;
  v_unit_cogs numeric;
  v_je_number text;
  v_journal_entry_id uuid;
  v_inventory_account_id uuid;
  v_revenue_account_id uuid;
  v_ar_account_id uuid;
  v_cogs_account_id uuid;
  v_vat_account_id uuid;
  v_begin_result jsonb;
  v_result_payload jsonb;
  v_user_id uuid;
  v_user_name text;
BEGIN
  v_client_request_id := p_payload->>'client_request_id';
  v_branch_id := (p_payload->>'branch_id')::uuid;
  v_customer_id := (p_payload->>'customer_id')::uuid;
  v_original_sale_id := (p_payload->>'original_sale_id')::uuid;
  v_issue_date := COALESCE((p_payload->>'issue_date')::date, CURRENT_DATE);
  v_notes := p_payload->>'notes';
  v_reason := p_payload->>'reason';
  v_items := p_payload->'items';

  IF v_client_request_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'client_request_id is required'); END IF;
  IF v_branch_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'branch_id is required'); END IF;
  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN RETURN jsonb_build_object('success', false, 'error', 'items array is required'); END IF;

  v_begin_result := public.atomic_begin_request(v_client_request_id, 'pos_sales_return', p_payload, NULL);
  IF v_begin_result->>'status' = 'completed' THEN RETURN v_begin_result->'result'; END IF;
  IF v_begin_result->>'status' = 'failed' THEN RETURN v_begin_result->'result'; END IF;

  v_user_id := auth.uid();
  SELECT COALESCE(raw_user_meta_data->>'full_name', email, 'System') INTO v_user_name FROM auth.users WHERE id = v_user_id;

  v_pos_return_id := gen_random_uuid();
  v_return_number := public.generate_pos_sales_return_number();

  SELECT id INTO v_inventory_account_id FROM chart_of_accounts WHERE account_code = '1301' AND is_active = true LIMIT 1;
  SELECT id INTO v_revenue_account_id FROM chart_of_accounts WHERE account_code = '4001' AND is_active = true LIMIT 1;
  SELECT id INTO v_cogs_account_id FROM chart_of_accounts WHERE account_code = '5001' AND is_active = true LIMIT 1;
  SELECT id INTO v_vat_account_id FROM chart_of_accounts WHERE account_code = '2102' AND is_active = true LIMIT 1;
  IF v_customer_id IS NOT NULL THEN SELECT account_id INTO v_ar_account_id FROM customers WHERE id = v_customer_id; END IF;
  IF v_ar_account_id IS NULL THEN SELECT id INTO v_ar_account_id FROM chart_of_accounts WHERE account_code = '1201' AND is_active = true LIMIT 1; END IF;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(v_items) AS x(jewelry_item_id uuid, description text, quantity numeric, unit_price numeric, tax_rate numeric)
  LOOP
    v_line_total := COALESCE(v_item.quantity, 1) * COALESCE(v_item.unit_price, 0);
    v_line_tax := v_line_total * COALESCE(v_item.tax_rate, 0.15);
    v_subtotal := v_subtotal + v_line_total;
    v_tax_amount := v_tax_amount + v_line_tax;

    IF v_item.jewelry_item_id IS NOT NULL THEN
      SELECT COALESCE(cost_price, 0) INTO v_unit_cogs FROM jewelry_items WHERE id = v_item.jewelry_item_id;
      v_total_cogs := v_total_cogs + (COALESCE(v_unit_cogs, 0) * COALESCE(v_item.quantity, 1));
      UPDATE jewelry_items SET sale_status = 'available', is_available_for_sale = true, branch_id = v_branch_id, updated_at = NOW() WHERE id = v_item.jewelry_item_id;
    END IF;

    INSERT INTO return_items (return_id, jewelry_item_id, quantity, unit_price, return_reason)
    VALUES (v_pos_return_id, v_item.jewelry_item_id, COALESCE(v_item.quantity, 1), COALESCE(v_item.unit_price, 0), v_reason);
  END LOOP;

  v_total_amount := v_subtotal + v_tax_amount;

  -- UNIFIED: Use standard generator
  v_je_number := public.generate_journal_entry_number();
  
  INSERT INTO journal_entries (entry_number, entry_date, reference_type, reference_id, description, is_posted, total_debit, total_credit, branch_id)
  VALUES (v_je_number, v_issue_date, 'pos_sales_return', v_pos_return_id, 'POS Sales Return: ' || v_return_number, true, v_total_amount + v_total_cogs, v_total_amount + v_total_cogs, v_branch_id)
  RETURNING id INTO v_journal_entry_id;

  IF v_revenue_account_id IS NOT NULL AND v_subtotal > 0 THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES (v_journal_entry_id, v_revenue_account_id, v_subtotal, 0, 'Sales returns');
  END IF;
  IF v_vat_account_id IS NOT NULL AND v_tax_amount > 0 THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES (v_journal_entry_id, v_vat_account_id, v_tax_amount, 0, 'VAT on returns');
  END IF;
  IF v_ar_account_id IS NOT NULL AND v_total_amount > 0 THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES (v_journal_entry_id, v_ar_account_id, 0, v_total_amount, 'Credit to customer');
  END IF;
  IF v_total_cogs > 0 THEN
    IF v_inventory_account_id IS NOT NULL THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES (v_journal_entry_id, v_inventory_account_id, v_total_cogs, 0, 'Inventory restored');
    END IF;
    IF v_cogs_account_id IS NOT NULL THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES (v_journal_entry_id, v_cogs_account_id, 0, v_total_cogs, 'COGS reversal');
    END IF;
  END IF;

  INSERT INTO returns (id, return_code, return_type, original_sale_id, branch_id, customer_id, return_date, reason, notes, total_amount, status, journal_entry_id, created_by)
  VALUES (v_pos_return_id, v_return_number, 'pos_return', v_original_sale_id, v_branch_id, v_customer_id, v_issue_date, v_reason, v_notes, v_total_amount, 'completed', v_journal_entry_id, v_user_id);

  v_result_payload := jsonb_build_object('success', true, 'return_id', v_pos_return_id, 'return_number', v_return_number, 'total_amount', v_total_amount, 'journal_entry_id', v_journal_entry_id);
  PERFORM public.atomic_complete(v_client_request_id, 'pos_sales_return', v_result_payload);
  RETURN v_result_payload;

EXCEPTION WHEN OTHERS THEN
  v_result_payload := jsonb_build_object('success', false, 'error', SQLERRM);
  PERFORM public.atomic_failed(v_client_request_id, 'pos_sales_return', v_result_payload, 'EXCEPTION', SQLERRM);
  RETURN v_result_payload;
END;
$function$;

-- ====================================================================
-- 5. complete_sales_return_atomic - UNIFIED JE GENERATION
-- ====================================================================
CREATE OR REPLACE FUNCTION public.complete_sales_return_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_client_request_id text;
  v_return_id uuid;
  v_return_number text;
  v_branch_id uuid;
  v_customer_id uuid;
  v_original_invoice_id uuid;
  v_issue_date date;
  v_notes text;
  v_reason text;
  v_items jsonb;
  v_item record;
  v_subtotal numeric := 0;
  v_tax_amount numeric := 0;
  v_total_amount numeric := 0;
  v_total_cogs numeric := 0;
  v_line_total numeric;
  v_line_tax numeric;
  v_unit_cogs numeric;
  v_je_number text;
  v_journal_entry_id uuid;
  v_inventory_account_id uuid;
  v_revenue_account_id uuid;
  v_ar_account_id uuid;
  v_cogs_account_id uuid;
  v_vat_account_id uuid;
  v_begin_result jsonb;
  v_result_payload jsonb;
  v_user_id uuid;
  v_user_name text;
BEGIN
  v_client_request_id := p_payload->>'client_request_id';
  v_branch_id := (p_payload->>'branch_id')::uuid;
  v_customer_id := (p_payload->>'customer_id')::uuid;
  v_original_invoice_id := (p_payload->>'original_invoice_id')::uuid;
  v_issue_date := COALESCE((p_payload->>'issue_date')::date, CURRENT_DATE);
  v_notes := p_payload->>'notes';
  v_reason := p_payload->>'reason';
  v_items := p_payload->'items';

  IF v_client_request_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'client_request_id is required'); END IF;
  IF v_branch_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'branch_id is required'); END IF;
  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN RETURN jsonb_build_object('success', false, 'error', 'items array is required'); END IF;

  v_begin_result := public.atomic_begin_request(v_client_request_id, 'sales_return', p_payload, NULL);
  IF v_begin_result->>'status' = 'completed' THEN RETURN v_begin_result->'result'; END IF;
  IF v_begin_result->>'status' = 'failed' THEN RETURN v_begin_result->'result'; END IF;

  v_user_id := auth.uid();
  SELECT COALESCE(raw_user_meta_data->>'full_name', email, 'System') INTO v_user_name FROM auth.users WHERE id = v_user_id;

  v_return_id := gen_random_uuid();
  v_return_number := public.generate_sales_return_number();

  SELECT id INTO v_inventory_account_id FROM chart_of_accounts WHERE account_code = '1301' AND is_active = true LIMIT 1;
  SELECT id INTO v_revenue_account_id FROM chart_of_accounts WHERE account_code = '4001' AND is_active = true LIMIT 1;
  SELECT id INTO v_cogs_account_id FROM chart_of_accounts WHERE account_code = '5001' AND is_active = true LIMIT 1;
  SELECT id INTO v_vat_account_id FROM chart_of_accounts WHERE account_code = '2102' AND is_active = true LIMIT 1;
  IF v_customer_id IS NOT NULL THEN SELECT account_id INTO v_ar_account_id FROM customers WHERE id = v_customer_id; END IF;
  IF v_ar_account_id IS NULL THEN SELECT id INTO v_ar_account_id FROM chart_of_accounts WHERE account_code = '1201' AND is_active = true LIMIT 1; END IF;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(v_items) AS x(jewelry_item_id uuid, description text, quantity numeric, unit_price numeric, tax_rate numeric)
  LOOP
    v_line_total := COALESCE(v_item.quantity, 1) * COALESCE(v_item.unit_price, 0);
    v_line_tax := v_line_total * COALESCE(v_item.tax_rate, 0.15);
    v_subtotal := v_subtotal + v_line_total;
    v_tax_amount := v_tax_amount + v_line_tax;

    IF v_item.jewelry_item_id IS NOT NULL THEN
      SELECT COALESCE(cost_price, 0) INTO v_unit_cogs FROM jewelry_items WHERE id = v_item.jewelry_item_id;
      v_total_cogs := v_total_cogs + (COALESCE(v_unit_cogs, 0) * COALESCE(v_item.quantity, 1));
      UPDATE jewelry_items SET sale_status = 'available', is_available_for_sale = true, branch_id = v_branch_id, updated_at = NOW() WHERE id = v_item.jewelry_item_id;
    END IF;

    INSERT INTO return_items (return_id, jewelry_item_id, quantity, unit_price, return_reason)
    VALUES (v_return_id, v_item.jewelry_item_id, COALESCE(v_item.quantity, 1), COALESCE(v_item.unit_price, 0), v_reason);
  END LOOP;

  v_total_amount := v_subtotal + v_tax_amount;

  -- UNIFIED: Use standard generator
  v_je_number := public.generate_journal_entry_number();
  
  INSERT INTO journal_entries (entry_number, entry_date, reference_type, reference_id, description, is_posted, total_debit, total_credit, branch_id)
  VALUES (v_je_number, v_issue_date, 'sales_return', v_return_id, 'Sales Return: ' || v_return_number, true, v_total_amount + v_total_cogs, v_total_amount + v_total_cogs, v_branch_id)
  RETURNING id INTO v_journal_entry_id;

  IF v_revenue_account_id IS NOT NULL AND v_subtotal > 0 THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES (v_journal_entry_id, v_revenue_account_id, v_subtotal, 0, 'Sales returns');
  END IF;
  IF v_vat_account_id IS NOT NULL AND v_tax_amount > 0 THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES (v_journal_entry_id, v_vat_account_id, v_tax_amount, 0, 'VAT on returns');
  END IF;
  IF v_ar_account_id IS NOT NULL AND v_total_amount > 0 THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES (v_journal_entry_id, v_ar_account_id, 0, v_total_amount, 'Credit to customer');
  END IF;
  IF v_total_cogs > 0 THEN
    IF v_inventory_account_id IS NOT NULL THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES (v_journal_entry_id, v_inventory_account_id, v_total_cogs, 0, 'Inventory restored');
    END IF;
    IF v_cogs_account_id IS NOT NULL THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES (v_journal_entry_id, v_cogs_account_id, 0, v_total_cogs, 'COGS reversal');
    END IF;
  END IF;

  INSERT INTO returns (id, return_code, return_type, original_invoice_id, branch_id, customer_id, return_date, reason, notes, total_amount, status, journal_entry_id, created_by)
  VALUES (v_return_id, v_return_number, 'sales_return', v_original_invoice_id, v_branch_id, v_customer_id, v_issue_date, v_reason, v_notes, v_total_amount, 'completed', v_journal_entry_id, v_user_id);

  v_result_payload := jsonb_build_object('success', true, 'return_id', v_return_id, 'return_number', v_return_number, 'total_amount', v_total_amount, 'journal_entry_id', v_journal_entry_id);
  PERFORM public.atomic_complete(v_client_request_id, 'sales_return', v_result_payload);
  RETURN v_result_payload;

EXCEPTION WHEN OTHERS THEN
  v_result_payload := jsonb_build_object('success', false, 'error', SQLERRM);
  PERFORM public.atomic_failed(v_client_request_id, 'sales_return', v_result_payload, 'EXCEPTION', SQLERRM);
  RETURN v_result_payload;
END;
$function$;