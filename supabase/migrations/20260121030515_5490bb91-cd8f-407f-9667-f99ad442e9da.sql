-- Drop the conflicting function first
DROP FUNCTION IF EXISTS public.complete_sales_invoice_atomic(uuid);

-- Recreate with unified JE generation
CREATE OR REPLACE FUNCTION public.complete_sales_invoice_atomic(p_invoice_id uuid)
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
    v_revenue_account_id UUID;
    v_ar_account_id UUID;
    v_tax_account_id UUID;
    v_cogs_account_id UUID;
    v_user_id UUID;
    v_user_name TEXT;
    v_line RECORD;
    v_total_cogs NUMERIC := 0;
BEGIN
    SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id;
    
    IF v_invoice IS NULL THEN
        RAISE EXCEPTION 'Invoice not found: %', p_invoice_id;
    END IF;
    
    IF v_invoice.status = 'posted' THEN
        RETURN jsonb_build_object('success', true, 'message', 'Already posted', 'invoice_id', p_invoice_id);
    END IF;
    
    v_user_id := auth.uid();
    SELECT COALESCE(raw_user_meta_data->>'full_name', email, 'System') INTO v_user_name
    FROM auth.users WHERE id = v_user_id;
    
    SELECT id INTO v_inventory_account_id FROM chart_of_accounts WHERE account_code = '1301' AND is_active = true LIMIT 1;
    SELECT id INTO v_revenue_account_id FROM chart_of_accounts WHERE account_code = '4001' AND is_active = true LIMIT 1;
    SELECT id INTO v_cogs_account_id FROM chart_of_accounts WHERE account_code = '5001' AND is_active = true LIMIT 1;
    SELECT id INTO v_tax_account_id FROM chart_of_accounts WHERE account_code = '2102' AND is_active = true LIMIT 1;
    SELECT account_id INTO v_ar_account_id FROM customers WHERE id = v_invoice.customer_id;
    IF v_ar_account_id IS NULL THEN
        SELECT id INTO v_ar_account_id FROM chart_of_accounts WHERE account_code = '1201' AND is_active = true LIMIT 1;
    END IF;
    
    UPDATE invoices SET status = 'posted', remaining_amount = total_amount, updated_at = NOW() WHERE id = p_invoice_id;
    
    FOR v_line IN 
        SELECT sii.product_id, ji.cost_price
        FROM sales_invoice_items sii
        LEFT JOIN jewelry_items ji ON ji.id = sii.product_id
        WHERE sii.invoice_id = p_invoice_id AND sii.product_id IS NOT NULL
    LOOP
        UPDATE jewelry_items SET sale_status = 'sold', is_available_for_sale = false, updated_at = NOW() WHERE id = v_line.product_id;
        v_total_cogs := v_total_cogs + COALESCE(v_line.cost_price, 0);
    END LOOP;
    
    -- UNIFIED: Use standard generator
    v_je_number := public.generate_journal_entry_number();
    
    INSERT INTO journal_entries (entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, status, created_by, created_by_name, branch_id)
    VALUES (v_je_number, v_invoice.invoice_date, 'sales_invoice', p_invoice_id, 'Sales Invoice: ' || v_invoice.invoice_number, v_invoice.total_amount + v_total_cogs, v_invoice.total_amount + v_total_cogs, 'posted', v_user_id, v_user_name, v_invoice.branch_id)
    RETURNING id INTO v_je_id;
    
    IF v_ar_account_id IS NOT NULL AND v_invoice.total_amount > 0 THEN
        INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES (v_je_id, v_ar_account_id, v_invoice.total_amount, 0, 'Receivable from customer');
    END IF;
    IF v_revenue_account_id IS NOT NULL AND v_invoice.subtotal > 0 THEN
        INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES (v_je_id, v_revenue_account_id, 0, v_invoice.subtotal, 'Sales revenue');
    END IF;
    IF v_tax_account_id IS NOT NULL AND v_invoice.tax_amount > 0 THEN
        INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES (v_je_id, v_tax_account_id, 0, v_invoice.tax_amount, 'VAT collected');
    END IF;
    IF v_total_cogs > 0 THEN
        IF v_cogs_account_id IS NOT NULL THEN
            INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES (v_je_id, v_cogs_account_id, v_total_cogs, 0, 'Cost of goods sold');
        END IF;
        IF v_inventory_account_id IS NOT NULL THEN
            INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES (v_je_id, v_inventory_account_id, 0, v_total_cogs, 'Inventory reduction');
        END IF;
    END IF;
    
    UPDATE invoices SET journal_entry_id = v_je_id WHERE id = p_invoice_id;
    
    RETURN jsonb_build_object('success', true, 'invoice_id', p_invoice_id, 'journal_entry_id', v_je_id, 'journal_entry_number', v_je_number);
EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'complete_sales_invoice_atomic failed: %', SQLERRM;
END;
$function$;