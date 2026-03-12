-- =====================================================
-- Fix: Replace all jewelry_items.status → sale_status
-- Also set is_available_for_sale correctly
-- =====================================================

-- =====================================================
-- 1. Fix complete_purchase_invoice_atomic(p_payload jsonb)
-- =====================================================
CREATE OR REPLACE FUNCTION public.complete_purchase_invoice_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_invoice_id UUID;
    v_invoice_number TEXT;
    v_supplier_id UUID;
    v_branch_id UUID;
    v_invoice_date DATE;
    v_total_amount NUMERIC;
    v_tax_amount NUMERIC;
    v_subtotal NUMERIC;
    v_notes TEXT;
    v_payment_method TEXT;
    v_payment_status TEXT;
    v_due_date DATE;
    v_lines JSONB;
    v_line JSONB;
    v_line_id UUID;
    v_product_id UUID;
    v_product_code TEXT;
    v_quantity NUMERIC;
    v_unit_price NUMERIC;
    v_line_total NUMERIC;
    v_gold_weight NUMERIC;
    v_stones_weight NUMERIC;
    v_karat_id UUID;
    v_description TEXT;
    v_je_id UUID;
    v_je_number TEXT;
    v_inventory_account_id UUID;
    v_supplier_account_id UUID;
    v_tax_account_id UUID;
    v_line_number INT := 0;
    v_user_id UUID;
    v_user_name TEXT;
    v_created_by UUID;
    v_import_batch_id UUID;
    v_supplier_invoice_number TEXT;
    v_unique_items JSONB;
    v_unique_item JSONB;
    v_item_id UUID;
    v_item_code TEXT;
BEGIN
    -- Extract header fields
    v_invoice_number := p_payload->>'invoice_number';
    v_supplier_id := (p_payload->>'supplier_id')::UUID;
    v_branch_id := (p_payload->>'branch_id')::UUID;
    v_invoice_date := COALESCE((p_payload->>'invoice_date')::DATE, CURRENT_DATE);
    v_total_amount := COALESCE((p_payload->>'total_amount')::NUMERIC, 0);
    v_tax_amount := COALESCE((p_payload->>'tax_amount')::NUMERIC, 0);
    v_subtotal := COALESCE((p_payload->>'subtotal')::NUMERIC, v_total_amount - v_tax_amount);
    v_notes := p_payload->>'notes';
    v_payment_method := COALESCE(p_payload->>'payment_method', 'credit');
    v_payment_status := COALESCE(p_payload->>'payment_status', 'unpaid');
    v_due_date := (p_payload->>'due_date')::DATE;
    v_lines := p_payload->'lines';
    v_created_by := (p_payload->>'created_by')::UUID;
    v_import_batch_id := (p_payload->>'import_batch_id')::UUID;
    v_supplier_invoice_number := p_payload->>'supplier_invoice_number';
    v_unique_items := p_payload->'unique_items';
    
    -- Get user info
    v_user_id := COALESCE(v_created_by, auth.uid());
    SELECT COALESCE(full_name, email, 'System') INTO v_user_name
    FROM auth.users WHERE id = v_user_id;
    
    -- Validate required fields
    IF v_supplier_id IS NULL THEN
        RAISE EXCEPTION 'supplier_id is required';
    END IF;
    
    IF v_branch_id IS NULL THEN
        RAISE EXCEPTION 'branch_id is required';
    END IF;
    
    -- Generate invoice number if not provided
    IF v_invoice_number IS NULL OR v_invoice_number = '' THEN
        v_invoice_number := 'PINV-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || 
                           LPAD((EXTRACT(EPOCH FROM NOW())::BIGINT % 10000)::TEXT, 4, '0');
    END IF;
    
    -- Get account IDs
    SELECT id INTO v_inventory_account_id FROM chart_of_accounts 
    WHERE account_code = '1301' AND is_active = true LIMIT 1;
    
    SELECT account_id INTO v_supplier_account_id FROM suppliers 
    WHERE id = v_supplier_id;
    
    IF v_supplier_account_id IS NULL THEN
        SELECT id INTO v_supplier_account_id FROM chart_of_accounts 
        WHERE account_code = '2101' AND is_active = true LIMIT 1;
    END IF;
    
    SELECT id INTO v_tax_account_id FROM chart_of_accounts 
    WHERE account_code = '2102' AND is_active = true LIMIT 1;
    
    -- Create invoice header
    INSERT INTO invoices (
        invoice_number, invoice_type, invoice_date, due_date,
        supplier_id, branch_id, subtotal, tax_amount, total_amount,
        status, payment_status, payment_method, notes, created_by,
        remaining_amount, import_batch_id, supplier_invoice_number
    ) VALUES (
        v_invoice_number, 'purchase', v_invoice_date, v_due_date,
        v_supplier_id, v_branch_id, v_subtotal, v_tax_amount, v_total_amount,
        'posted', v_payment_status, v_payment_method, v_notes, v_user_id,
        v_total_amount, v_import_batch_id, v_supplier_invoice_number
    ) RETURNING id INTO v_invoice_id;
    
    -- Create invoice lines
    IF v_lines IS NOT NULL AND jsonb_array_length(v_lines) > 0 THEN
        FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines)
        LOOP
            v_line_number := v_line_number + 1;
            v_product_id := (v_line->>'product_id')::UUID;
            v_product_code := v_line->>'product_code';
            v_quantity := COALESCE((v_line->>'quantity')::NUMERIC, 1);
            v_unit_price := COALESCE((v_line->>'unit_price')::NUMERIC, 0);
            v_line_total := COALESCE((v_line->>'total')::NUMERIC, v_quantity * v_unit_price);
            v_gold_weight := (v_line->>'gold_weight')::NUMERIC;
            v_stones_weight := (v_line->>'stones_weight')::NUMERIC;
            v_karat_id := (v_line->>'karat_id')::UUID;
            v_description := v_line->>'description';
            
            INSERT INTO purchase_invoice_lines (
                invoice_id, line_number, product_id, product_code,
                quantity, unit_price, total, gold_weight, stones_weight,
                karat_id, description
            ) VALUES (
                v_invoice_id, v_line_number, v_product_id, v_product_code,
                v_quantity, v_unit_price, v_line_total, v_gold_weight, v_stones_weight,
                v_karat_id, v_description
            );
        END LOOP;
    END IF;
    
    -- Process unique items (jewelry_items) - FIX: use sale_status instead of status
    IF v_unique_items IS NOT NULL AND jsonb_array_length(v_unique_items) > 0 THEN
        FOR v_unique_item IN SELECT * FROM jsonb_array_elements(v_unique_items)
        LOOP
            v_item_id := (v_unique_item->>'id')::UUID;
            v_item_code := v_unique_item->>'item_code';
            
            IF v_item_id IS NOT NULL THEN
                -- FIX: Changed status → sale_status, added is_available_for_sale
                UPDATE jewelry_items 
                SET sale_status = 'in_stock',
                    is_available_for_sale = true,
                    branch_id = v_branch_id,
                    updated_at = NOW()
                WHERE id = v_item_id;
            END IF;
        END LOOP;
    END IF;
    
    -- Create journal entry
    v_je_number := 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || 
                   LPAD((EXTRACT(EPOCH FROM NOW())::BIGINT % 10000)::TEXT, 4, '0');
    
    INSERT INTO journal_entries (
        entry_number, entry_date, reference_type, reference_id,
        description, total_debit, total_credit, status,
        created_by, created_by_name, branch_id
    ) VALUES (
        v_je_number, v_invoice_date, 'purchase_invoice', v_invoice_id,
        'Purchase Invoice: ' || v_invoice_number, v_total_amount, v_total_amount,
        'posted', v_user_id, v_user_name, v_branch_id
    ) RETURNING id INTO v_je_id;
    
    -- Debit Inventory
    IF v_inventory_account_id IS NOT NULL AND v_subtotal > 0 THEN
        INSERT INTO journal_entry_lines (
            journal_entry_id, account_id, debit_amount, credit_amount, description
        ) VALUES (
            v_je_id, v_inventory_account_id, v_subtotal, 0, 'Inventory from purchase'
        );
    END IF;
    
    -- Debit Tax
    IF v_tax_account_id IS NOT NULL AND v_tax_amount > 0 THEN
        INSERT INTO journal_entry_lines (
            journal_entry_id, account_id, debit_amount, credit_amount, description
        ) VALUES (
            v_je_id, v_tax_account_id, v_tax_amount, 0, 'VAT on purchase'
        );
    END IF;
    
    -- Credit Supplier
    IF v_supplier_account_id IS NOT NULL AND v_total_amount > 0 THEN
        INSERT INTO journal_entry_lines (
            journal_entry_id, account_id, debit_amount, credit_amount, description
        ) VALUES (
            v_je_id, v_supplier_account_id, 0, v_total_amount, 'Payable to supplier'
        );
    END IF;
    
    -- Link JE to invoice
    UPDATE invoices SET journal_entry_id = v_je_id WHERE id = v_invoice_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'invoice_id', v_invoice_id,
        'invoice_number', v_invoice_number,
        'journal_entry_id', v_je_id,
        'journal_entry_number', v_je_number
    );
    
EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'complete_purchase_invoice_atomic failed: %', SQLERRM;
END;
$function$;

-- =====================================================
-- 2. Fix complete_purchase_invoice_atomic(p_invoice_id uuid)
-- =====================================================
CREATE OR REPLACE FUNCTION public.complete_purchase_invoice_atomic(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    -- Get invoice
    SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id;
    
    IF v_invoice IS NULL THEN
        RAISE EXCEPTION 'Invoice not found: %', p_invoice_id;
    END IF;
    
    IF v_invoice.status = 'posted' THEN
        RETURN jsonb_build_object('success', true, 'message', 'Already posted', 'invoice_id', p_invoice_id);
    END IF;
    
    -- Get user info
    v_user_id := auth.uid();
    SELECT COALESCE(full_name, email, 'System') INTO v_user_name
    FROM auth.users WHERE id = v_user_id;
    
    -- Get account IDs
    SELECT id INTO v_inventory_account_id FROM chart_of_accounts 
    WHERE account_code = '1301' AND is_active = true LIMIT 1;
    
    SELECT account_id INTO v_supplier_account_id FROM suppliers 
    WHERE id = v_invoice.supplier_id;
    
    IF v_supplier_account_id IS NULL THEN
        SELECT id INTO v_supplier_account_id FROM chart_of_accounts 
        WHERE account_code = '2101' AND is_active = true LIMIT 1;
    END IF;
    
    SELECT id INTO v_tax_account_id FROM chart_of_accounts 
    WHERE account_code = '2102' AND is_active = true LIMIT 1;
    
    -- Update invoice status
    UPDATE invoices 
    SET status = 'posted', 
        remaining_amount = total_amount,
        updated_at = NOW()
    WHERE id = p_invoice_id;
    
    -- FIX: Update jewelry items - Changed status → sale_status, added is_available_for_sale
    FOR v_line IN 
        SELECT pil.product_id 
        FROM purchase_invoice_lines pil
        WHERE pil.invoice_id = p_invoice_id AND pil.product_id IS NOT NULL
    LOOP
        UPDATE jewelry_items 
        SET sale_status = 'available',
            is_available_for_sale = true,
            branch_id = v_invoice.branch_id,
            updated_at = NOW()
        WHERE id = v_line.product_id;
    END LOOP;
    
    -- Create journal entry
    v_je_number := 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || 
                   LPAD((EXTRACT(EPOCH FROM NOW())::BIGINT % 10000)::TEXT, 4, '0');
    
    INSERT INTO journal_entries (
        entry_number, entry_date, reference_type, reference_id,
        description, total_debit, total_credit, status,
        created_by, created_by_name, branch_id
    ) VALUES (
        v_je_number, v_invoice.invoice_date, 'purchase_invoice', p_invoice_id,
        'Purchase Invoice: ' || v_invoice.invoice_number, 
        v_invoice.total_amount, v_invoice.total_amount,
        'posted', v_user_id, v_user_name, v_invoice.branch_id
    ) RETURNING id INTO v_je_id;
    
    -- Create JE lines
    IF v_inventory_account_id IS NOT NULL AND v_invoice.subtotal > 0 THEN
        INSERT INTO journal_entry_lines (
            journal_entry_id, account_id, debit_amount, credit_amount, description
        ) VALUES (
            v_je_id, v_inventory_account_id, v_invoice.subtotal, 0, 'Inventory from purchase'
        );
    END IF;
    
    IF v_tax_account_id IS NOT NULL AND v_invoice.tax_amount > 0 THEN
        INSERT INTO journal_entry_lines (
            journal_entry_id, account_id, debit_amount, credit_amount, description
        ) VALUES (
            v_je_id, v_tax_account_id, v_invoice.tax_amount, 0, 'VAT on purchase'
        );
    END IF;
    
    IF v_supplier_account_id IS NOT NULL AND v_invoice.total_amount > 0 THEN
        INSERT INTO journal_entry_lines (
            journal_entry_id, account_id, debit_amount, credit_amount, description
        ) VALUES (
            v_je_id, v_supplier_account_id, 0, v_invoice.total_amount, 'Payable to supplier'
        );
    END IF;
    
    -- Link JE to invoice
    UPDATE invoices SET journal_entry_id = v_je_id WHERE id = p_invoice_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'invoice_id', p_invoice_id,
        'journal_entry_id', v_je_id,
        'journal_entry_number', v_je_number
    );
    
EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'complete_purchase_invoice_atomic failed: %', SQLERRM;
END;
$function$;

-- =====================================================
-- 3. Fix complete_purchase_return_unique_items_atomic(p_payload jsonb)
-- =====================================================
CREATE OR REPLACE FUNCTION public.complete_purchase_return_unique_items_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_return_id UUID;
    v_return_number TEXT;
    v_supplier_id UUID;
    v_branch_id UUID;
    v_linked_invoice_id UUID;
    v_return_date DATE;
    v_total_amount NUMERIC := 0;
    v_tax_amount NUMERIC := 0;
    v_subtotal NUMERIC := 0;
    v_notes TEXT;
    v_reason TEXT;
    v_items JSONB;
    v_item JSONB;
    v_item_id UUID;
    v_item_code TEXT;
    v_unit_price NUMERIC;
    v_gold_weight NUMERIC;
    v_line_number INT := 0;
    v_je_id UUID;
    v_je_number TEXT;
    v_inventory_account_id UUID;
    v_supplier_account_id UUID;
    v_user_id UUID;
    v_user_name TEXT;
    v_item_record RECORD;
BEGIN
    -- Extract header fields
    v_return_number := p_payload->>'return_number';
    v_supplier_id := (p_payload->>'supplier_id')::UUID;
    v_branch_id := (p_payload->>'branch_id')::UUID;
    v_linked_invoice_id := (p_payload->>'linked_invoice_id')::UUID;
    v_return_date := COALESCE((p_payload->>'return_date')::DATE, CURRENT_DATE);
    v_notes := p_payload->>'notes';
    v_reason := p_payload->>'reason';
    v_items := p_payload->'items';
    
    -- Get user info
    v_user_id := auth.uid();
    SELECT COALESCE(full_name, email, 'System') INTO v_user_name
    FROM auth.users WHERE id = v_user_id;
    
    -- Validate
    IF v_supplier_id IS NULL THEN
        RAISE EXCEPTION 'supplier_id is required';
    END IF;
    
    IF v_branch_id IS NULL THEN
        RAISE EXCEPTION 'branch_id is required';
    END IF;
    
    IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
        RAISE EXCEPTION 'At least one item is required';
    END IF;
    
    -- Generate return number if not provided
    IF v_return_number IS NULL OR v_return_number = '' THEN
        v_return_number := 'PRET-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || 
                          LPAD((EXTRACT(EPOCH FROM NOW())::BIGINT % 10000)::TEXT, 4, '0');
    END IF;
    
    -- Get account IDs
    SELECT id INTO v_inventory_account_id FROM chart_of_accounts 
    WHERE account_code = '1301' AND is_active = true LIMIT 1;
    
    SELECT account_id INTO v_supplier_account_id FROM suppliers 
    WHERE id = v_supplier_id;
    
    IF v_supplier_account_id IS NULL THEN
        SELECT id INTO v_supplier_account_id FROM chart_of_accounts 
        WHERE account_code = '2101' AND is_active = true LIMIT 1;
    END IF;
    
    -- Calculate totals from items
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
        v_item_id := (v_item->>'id')::UUID;
        
        -- Get item details
        SELECT * INTO v_item_record FROM jewelry_items WHERE id = v_item_id;
        
        IF v_item_record IS NOT NULL THEN
            v_unit_price := COALESCE((v_item->>'unit_price')::NUMERIC, v_item_record.total_price, 0);
            v_subtotal := v_subtotal + v_unit_price;
        END IF;
    END LOOP;
    
    v_tax_amount := v_subtotal * 0.15; -- 15% VAT
    v_total_amount := v_subtotal + v_tax_amount;
    
    -- Create return header (as invoice with type purchase_return)
    INSERT INTO invoices (
        invoice_number, invoice_type, invoice_date,
        supplier_id, branch_id, subtotal, tax_amount, total_amount,
        status, notes, created_by, linked_invoice_id
    ) VALUES (
        v_return_number, 'purchase_return', v_return_date,
        v_supplier_id, v_branch_id, v_subtotal, v_tax_amount, v_total_amount,
        'posted', COALESCE(v_reason, '') || COALESCE(' - ' || v_notes, ''), 
        v_user_id, v_linked_invoice_id
    ) RETURNING id INTO v_return_id;
    
    -- Create return lines and update items
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
        v_line_number := v_line_number + 1;
        v_item_id := (v_item->>'id')::UUID;
        v_item_code := v_item->>'item_code';
        
        -- Get item details
        SELECT * INTO v_item_record FROM jewelry_items WHERE id = v_item_id;
        
        IF v_item_record IS NOT NULL THEN
            v_unit_price := COALESCE((v_item->>'unit_price')::NUMERIC, v_item_record.total_price, 0);
            v_gold_weight := v_item_record.gold_weight;
            
            -- Create return line
            INSERT INTO purchase_invoice_lines (
                invoice_id, line_number, product_id, product_code,
                quantity, unit_price, total, gold_weight, description
            ) VALUES (
                v_return_id, v_line_number, v_item_id, v_item_code,
                1, v_unit_price, v_unit_price, v_gold_weight,
                'Return: ' || COALESCE(v_item_code, v_item_id::TEXT)
            );
            
            -- FIX: Update jewelry item - Changed status → sale_status, returned_to_supplier → returned
            UPDATE jewelry_items 
            SET sale_status = 'returned',
                is_available_for_sale = false,
                updated_at = NOW()
            WHERE id = v_item_id;
        END IF;
    END LOOP;
    
    -- Create journal entry (reverse of purchase)
    v_je_number := 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || 
                   LPAD((EXTRACT(EPOCH FROM NOW())::BIGINT % 10000)::TEXT, 4, '0');
    
    INSERT INTO journal_entries (
        entry_number, entry_date, reference_type, reference_id,
        description, total_debit, total_credit, status,
        created_by, created_by_name, branch_id
    ) VALUES (
        v_je_number, v_return_date, 'purchase_return', v_return_id,
        'Purchase Return: ' || v_return_number, v_total_amount, v_total_amount,
        'posted', v_user_id, v_user_name, v_branch_id
    ) RETURNING id INTO v_je_id;
    
    -- Debit Supplier (reduce payable)
    IF v_supplier_account_id IS NOT NULL AND v_total_amount > 0 THEN
        INSERT INTO journal_entry_lines (
            journal_entry_id, account_id, debit_amount, credit_amount, description
        ) VALUES (
            v_je_id, v_supplier_account_id, v_total_amount, 0, 'Reduce payable for return'
        );
    END IF;
    
    -- Credit Inventory
    IF v_inventory_account_id IS NOT NULL AND v_subtotal > 0 THEN
        INSERT INTO journal_entry_lines (
            journal_entry_id, account_id, debit_amount, credit_amount, description
        ) VALUES (
            v_je_id, v_inventory_account_id, 0, v_subtotal, 'Inventory returned to supplier'
        );
    END IF;
    
    -- Link JE to return
    UPDATE invoices SET journal_entry_id = v_je_id WHERE id = v_return_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'return_id', v_return_id,
        'return_number', v_return_number,
        'journal_entry_id', v_je_id,
        'journal_entry_number', v_je_number,
        'total_amount', v_total_amount
    );
    
EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'complete_purchase_return_unique_items_atomic failed: %', SQLERRM;
END;
$function$;

-- =====================================================
-- 4. Fix complete_sales_invoice_atomic(p_sale_id uuid)
-- =====================================================
CREATE OR REPLACE FUNCTION public.complete_sales_invoice_atomic(p_sale_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_sale RECORD;
    v_je_id UUID;
    v_je_number TEXT;
    v_cash_account_id UUID;
    v_receivable_account_id UUID;
    v_revenue_account_id UUID;
    v_cogs_account_id UUID;
    v_inventory_account_id UUID;
    v_tax_account_id UUID;
    v_user_id UUID;
    v_user_name TEXT;
    v_item RECORD;
    v_total_cost NUMERIC := 0;
BEGIN
    -- Get sale
    SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
    
    IF v_sale IS NULL THEN
        RAISE EXCEPTION 'Sale not found: %', p_sale_id;
    END IF;
    
    IF v_sale.status = 'completed' THEN
        RETURN jsonb_build_object('success', true, 'message', 'Already completed', 'sale_id', p_sale_id);
    END IF;
    
    -- Get user info
    v_user_id := auth.uid();
    SELECT COALESCE(full_name, email, 'System') INTO v_user_name
    FROM auth.users WHERE id = v_user_id;
    
    -- Get account IDs
    SELECT id INTO v_cash_account_id FROM chart_of_accounts 
    WHERE account_code = '1101' AND is_active = true LIMIT 1;
    
    SELECT id INTO v_receivable_account_id FROM chart_of_accounts 
    WHERE account_code = '1201' AND is_active = true LIMIT 1;
    
    SELECT id INTO v_revenue_account_id FROM chart_of_accounts 
    WHERE account_code = '4101' AND is_active = true LIMIT 1;
    
    SELECT id INTO v_cogs_account_id FROM chart_of_accounts 
    WHERE account_code = '5101' AND is_active = true LIMIT 1;
    
    SELECT id INTO v_inventory_account_id FROM chart_of_accounts 
    WHERE account_code = '1301' AND is_active = true LIMIT 1;
    
    SELECT id INTO v_tax_account_id FROM chart_of_accounts 
    WHERE account_code = '2102' AND is_active = true LIMIT 1;
    
    -- Update sale status
    UPDATE sales 
    SET status = 'completed',
        updated_at = NOW()
    WHERE id = p_sale_id;
    
    -- FIX: Update sold items - Changed status → sale_status, added is_available_for_sale
    FOR v_item IN 
        SELECT si.jewelry_item_id, ji.total_price as cost
        FROM sale_items si
        JOIN jewelry_items ji ON ji.id = si.jewelry_item_id
        WHERE si.sale_id = p_sale_id 
        AND si.jewelry_item_id IS NOT NULL
        AND ji.sale_status = 'available'  -- FIX: Changed from status to sale_status
    LOOP
        UPDATE jewelry_items 
        SET sale_status = 'sold',
            is_available_for_sale = false,
            updated_at = NOW()
        WHERE id = v_item.jewelry_item_id;
        
        v_total_cost := v_total_cost + COALESCE(v_item.cost, 0);
    END LOOP;
    
    -- Create journal entry
    v_je_number := 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || 
                   LPAD((EXTRACT(EPOCH FROM NOW())::BIGINT % 10000)::TEXT, 4, '0');
    
    INSERT INTO journal_entries (
        entry_number, entry_date, reference_type, reference_id,
        description, total_debit, total_credit, status,
        created_by, created_by_name, branch_id
    ) VALUES (
        v_je_number, v_sale.sale_date, 'sale', p_sale_id,
        'Sales Invoice: ' || v_sale.invoice_number, 
        v_sale.total_amount + v_total_cost, v_sale.total_amount + v_total_cost,
        'posted', v_user_id, v_user_name, v_sale.branch_id
    ) RETURNING id INTO v_je_id;
    
    -- Debit Cash/Receivable
    IF v_sale.payment_method = 'cash' THEN
        IF v_cash_account_id IS NOT NULL AND v_sale.total_amount > 0 THEN
            INSERT INTO journal_entry_lines (
                journal_entry_id, account_id, debit_amount, credit_amount, description
            ) VALUES (
                v_je_id, v_cash_account_id, v_sale.total_amount, 0, 'Cash received'
            );
        END IF;
    ELSE
        IF v_receivable_account_id IS NOT NULL AND v_sale.total_amount > 0 THEN
            INSERT INTO journal_entry_lines (
                journal_entry_id, account_id, debit_amount, credit_amount, description
            ) VALUES (
                v_je_id, v_receivable_account_id, v_sale.total_amount, 0, 'Receivable from customer'
            );
        END IF;
    END IF;
    
    -- Credit Revenue
    IF v_revenue_account_id IS NOT NULL AND v_sale.subtotal > 0 THEN
        INSERT INTO journal_entry_lines (
            journal_entry_id, account_id, debit_amount, credit_amount, description
        ) VALUES (
            v_je_id, v_revenue_account_id, 0, v_sale.subtotal, 'Sales revenue'
        );
    END IF;
    
    -- Credit Tax Payable
    IF v_tax_account_id IS NOT NULL AND v_sale.tax_amount > 0 THEN
        INSERT INTO journal_entry_lines (
            journal_entry_id, account_id, debit_amount, credit_amount, description
        ) VALUES (
            v_je_id, v_tax_account_id, 0, v_sale.tax_amount, 'VAT collected'
        );
    END IF;
    
    -- COGS entries
    IF v_total_cost > 0 THEN
        IF v_cogs_account_id IS NOT NULL THEN
            INSERT INTO journal_entry_lines (
                journal_entry_id, account_id, debit_amount, credit_amount, description
            ) VALUES (
                v_je_id, v_cogs_account_id, v_total_cost, 0, 'Cost of goods sold'
            );
        END IF;
        
        IF v_inventory_account_id IS NOT NULL THEN
            INSERT INTO journal_entry_lines (
                journal_entry_id, account_id, debit_amount, credit_amount, description
            ) VALUES (
                v_je_id, v_inventory_account_id, 0, v_total_cost, 'Inventory reduction'
            );
        END IF;
    END IF;
    
    -- Link JE to sale
    UPDATE sales SET journal_entry_id = v_je_id WHERE id = p_sale_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'sale_id', p_sale_id,
        'journal_entry_id', v_je_id,
        'journal_entry_number', v_je_number,
        'total_cost', v_total_cost
    );
    
EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'complete_sales_invoice_atomic failed: %', SQLERRM;
END;
$function$;

-- =====================================================
-- 5. Fix restore_inventory_on_return_delete()
-- =====================================================
CREATE OR REPLACE FUNCTION public.restore_inventory_on_return_delete()
RETURNS TRIGGER AS $$
DECLARE
    v_return_item RECORD;
BEGIN
    -- Only process for sales returns
    IF OLD.return_type != 'sales' THEN
        RETURN OLD;
    END IF;
    
    -- Restore items to available status
    FOR v_return_item IN 
        SELECT ri.jewelry_item_id 
        FROM return_items ri 
        WHERE ri.return_id = OLD.id 
        AND ri.jewelry_item_id IS NOT NULL
    LOOP
        -- FIX: Changed status → sale_status, sold → sold, added is_available_for_sale = false
        UPDATE jewelry_items 
        SET sale_status = 'sold',
            is_available_for_sale = false,
            updated_at = NOW()
        WHERE id = v_return_item.jewelry_item_id;
    END LOOP;
    
    RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Ensure trigger exists
DROP TRIGGER IF EXISTS restore_inventory_on_return_delete_trigger ON public.returns;
CREATE TRIGGER restore_inventory_on_return_delete_trigger
BEFORE DELETE ON public.returns
FOR EACH ROW
EXECUTE FUNCTION restore_inventory_on_return_delete();