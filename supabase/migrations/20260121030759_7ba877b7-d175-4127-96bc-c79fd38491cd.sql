-- ====================================================================
-- PHASE 2 CONTINUATION: Fix remaining 7 functions
-- ====================================================================

-- 1. complete_purchase_invoice_atomic(uuid) - overload 1
CREATE OR REPLACE FUNCTION public.complete_purchase_invoice_atomic(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_invoice RECORD;
    v_je_id UUID;
    v_je_number TEXT;
    v_inventory_account_id UUID;
    v_supplier_account_id UUID;
    v_tax_account_id UUID;
    v_user_id UUID;
    v_user_name TEXT;
    v_line RECORD;
BEGIN
    SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id;
    IF v_invoice IS NULL THEN
        RAISE EXCEPTION 'Invoice not found: %', p_invoice_id;
    END IF;
    IF v_invoice.status = 'posted' THEN
        RETURN jsonb_build_object('success', true, 'message', 'Already posted', 'invoice_id', p_invoice_id);
    END IF;
    
    v_user_id := auth.uid();
    SELECT COALESCE(raw_user_meta_data->>'full_name', email, 'System') INTO v_user_name FROM auth.users WHERE id = v_user_id;
    
    SELECT id INTO v_inventory_account_id FROM chart_of_accounts WHERE account_code = '1301' AND is_active = true LIMIT 1;
    SELECT account_id INTO v_supplier_account_id FROM suppliers WHERE id = v_invoice.supplier_id;
    IF v_supplier_account_id IS NULL THEN
        SELECT id INTO v_supplier_account_id FROM chart_of_accounts WHERE account_code = '2101' AND is_active = true LIMIT 1;
    END IF;
    SELECT id INTO v_tax_account_id FROM chart_of_accounts WHERE account_code = '2102' AND is_active = true LIMIT 1;
    
    UPDATE invoices SET status = 'posted', remaining_amount = total_amount, updated_at = NOW() WHERE id = p_invoice_id;
    
    FOR v_line IN SELECT pil.product_id FROM purchase_invoice_lines pil WHERE pil.invoice_id = p_invoice_id AND pil.product_id IS NOT NULL
    LOOP
        UPDATE jewelry_items SET sale_status = 'available', is_available_for_sale = true, branch_id = v_invoice.branch_id, updated_at = NOW() WHERE id = v_line.product_id;
    END LOOP;
    
    -- UNIFIED: Use standard generator
    v_je_number := public.generate_journal_entry_number();
    
    INSERT INTO journal_entries (entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, status, created_by, created_by_name, branch_id)
    VALUES (v_je_number, v_invoice.invoice_date, 'purchase_invoice', p_invoice_id, 'Purchase Invoice: ' || v_invoice.invoice_number, v_invoice.total_amount, v_invoice.total_amount, 'posted', v_user_id, v_user_name, v_invoice.branch_id)
    RETURNING id INTO v_je_id;
    
    IF v_inventory_account_id IS NOT NULL AND v_invoice.subtotal > 0 THEN
        INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES (v_je_id, v_inventory_account_id, v_invoice.subtotal, 0, 'Inventory from purchase');
    END IF;
    IF v_tax_account_id IS NOT NULL AND v_invoice.tax_amount > 0 THEN
        INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES (v_je_id, v_tax_account_id, v_invoice.tax_amount, 0, 'VAT on purchase');
    END IF;
    IF v_supplier_account_id IS NOT NULL AND v_invoice.total_amount > 0 THEN
        INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES (v_je_id, v_supplier_account_id, 0, v_invoice.total_amount, 'Payable to supplier');
    END IF;
    
    UPDATE invoices SET journal_entry_id = v_je_id WHERE id = p_invoice_id;
    
    RETURN jsonb_build_object('success', true, 'invoice_id', p_invoice_id, 'journal_entry_id', v_je_id, 'journal_entry_number', v_je_number);
EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'complete_purchase_invoice_atomic failed: %', SQLERRM;
END;
$function$;

-- 2. complete_purchase_invoice_atomic(jsonb) - overload 2
CREATE OR REPLACE FUNCTION public.complete_purchase_invoice_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_invoice_id UUID;
    v_invoice RECORD;
    v_je_id UUID;
    v_je_number TEXT;
    v_inventory_account_id UUID;
    v_supplier_account_id UUID;
    v_tax_account_id UUID;
    v_user_id UUID;
    v_user_name TEXT;
    v_line RECORD;
    v_client_request_id TEXT;
    v_begin_result JSONB;
    v_result_payload JSONB;
BEGIN
    v_invoice_id := (p_payload->>'invoice_id')::UUID;
    v_client_request_id := p_payload->>'client_request_id';
    
    IF v_invoice_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'invoice_id is required');
    END IF;
    
    IF v_client_request_id IS NOT NULL THEN
        v_begin_result := public.atomic_begin_request(v_client_request_id, 'purchase_invoice_post', p_payload, NULL);
        IF v_begin_result->>'status' = 'completed' THEN RETURN v_begin_result->'result'; END IF;
        IF v_begin_result->>'status' = 'failed' THEN RETURN v_begin_result->'result'; END IF;
    END IF;
    
    SELECT * INTO v_invoice FROM invoices WHERE id = v_invoice_id;
    IF v_invoice IS NULL THEN
        v_result_payload := jsonb_build_object('success', false, 'error', 'Invoice not found');
        IF v_client_request_id IS NOT NULL THEN PERFORM public.atomic_failed(v_client_request_id, 'purchase_invoice_post', v_result_payload, 'NOT_FOUND', 'Invoice not found'); END IF;
        RETURN v_result_payload;
    END IF;
    
    IF v_invoice.status = 'posted' THEN
        v_result_payload := jsonb_build_object('success', true, 'message', 'Already posted', 'invoice_id', v_invoice_id);
        IF v_client_request_id IS NOT NULL THEN PERFORM public.atomic_complete(v_client_request_id, 'purchase_invoice_post', v_result_payload); END IF;
        RETURN v_result_payload;
    END IF;
    
    v_user_id := auth.uid();
    SELECT COALESCE(raw_user_meta_data->>'full_name', email, 'System') INTO v_user_name FROM auth.users WHERE id = v_user_id;
    
    SELECT id INTO v_inventory_account_id FROM chart_of_accounts WHERE account_code = '1301' AND is_active = true LIMIT 1;
    SELECT account_id INTO v_supplier_account_id FROM suppliers WHERE id = v_invoice.supplier_id;
    IF v_supplier_account_id IS NULL THEN
        SELECT id INTO v_supplier_account_id FROM chart_of_accounts WHERE account_code = '2101' AND is_active = true LIMIT 1;
    END IF;
    SELECT id INTO v_tax_account_id FROM chart_of_accounts WHERE account_code = '2102' AND is_active = true LIMIT 1;
    
    UPDATE invoices SET status = 'posted', remaining_amount = total_amount, updated_at = NOW() WHERE id = v_invoice_id;
    
    FOR v_line IN SELECT pil.product_id FROM purchase_invoice_lines pil WHERE pil.invoice_id = v_invoice_id AND pil.product_id IS NOT NULL
    LOOP
        UPDATE jewelry_items SET sale_status = 'available', is_available_for_sale = true, branch_id = v_invoice.branch_id, updated_at = NOW() WHERE id = v_line.product_id;
    END LOOP;
    
    -- UNIFIED: Use standard generator
    v_je_number := public.generate_journal_entry_number();
    
    INSERT INTO journal_entries (entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, status, created_by, created_by_name, branch_id)
    VALUES (v_je_number, v_invoice.invoice_date, 'purchase_invoice', v_invoice_id, 'Purchase Invoice: ' || v_invoice.invoice_number, v_invoice.total_amount, v_invoice.total_amount, 'posted', v_user_id, v_user_name, v_invoice.branch_id)
    RETURNING id INTO v_je_id;
    
    IF v_inventory_account_id IS NOT NULL AND v_invoice.subtotal > 0 THEN
        INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES (v_je_id, v_inventory_account_id, v_invoice.subtotal, 0, 'Inventory from purchase');
    END IF;
    IF v_tax_account_id IS NOT NULL AND v_invoice.tax_amount > 0 THEN
        INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES (v_je_id, v_tax_account_id, v_invoice.tax_amount, 0, 'VAT on purchase');
    END IF;
    IF v_supplier_account_id IS NOT NULL AND v_invoice.total_amount > 0 THEN
        INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES (v_je_id, v_supplier_account_id, 0, v_invoice.total_amount, 'Payable to supplier');
    END IF;
    
    UPDATE invoices SET journal_entry_id = v_je_id WHERE id = v_invoice_id;
    
    v_result_payload := jsonb_build_object('success', true, 'invoice_id', v_invoice_id, 'journal_entry_id', v_je_id, 'journal_entry_number', v_je_number);
    IF v_client_request_id IS NOT NULL THEN PERFORM public.atomic_complete(v_client_request_id, 'purchase_invoice_post', v_result_payload); END IF;
    RETURN v_result_payload;
EXCEPTION WHEN OTHERS THEN
    IF v_client_request_id IS NOT NULL THEN
        PERFORM public.atomic_failed(v_client_request_id, 'purchase_invoice_post', jsonb_build_object('success', false, 'error', SQLERRM), 'EXCEPTION', SQLERRM);
    END IF;
    RAISE EXCEPTION 'complete_purchase_invoice_atomic failed: %', SQLERRM;
END;
$function$;