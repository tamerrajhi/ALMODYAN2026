-- =====================================================
-- FIX: Payload parsing mismatch
-- UI sends: p_payload.return.{supplier_id, branch_id, purchase_invoice_id}
-- RPC was reading from root level
-- This fix reads from nested 'return' object with fallback
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
    -- ================================
    -- FIX: Extract header fields from nested 'return' object
    -- Primary: p_payload->'return'->>'field'
    -- Fallback: p_payload->>'field' (backward compatibility)
    -- ================================
    
    -- supplier_id: UI sends in return.supplier_id
    v_supplier_id := COALESCE(
        (p_payload->'return'->>'supplier_id')::UUID,
        (p_payload->>'supplier_id')::UUID
    );
    
    -- branch_id: UI sends in return.branch_id
    v_branch_id := COALESCE(
        (p_payload->'return'->>'branch_id')::UUID,
        (p_payload->>'branch_id')::UUID
    );
    
    -- linked_invoice_id: UI sends as return.purchase_invoice_id
    v_linked_invoice_id := COALESCE(
        (p_payload->'return'->>'purchase_invoice_id')::UUID,
        (p_payload->'return'->>'linked_invoice_id')::UUID,
        (p_payload->>'linked_invoice_id')::UUID
    );
    
    -- return_date: check nested first, then root
    v_return_date := COALESCE(
        (p_payload->'return'->>'return_date')::DATE,
        (p_payload->>'return_date')::DATE,
        CURRENT_DATE
    );
    
    -- return_number: check nested first, then root
    v_return_number := COALESCE(
        p_payload->'return'->>'return_number',
        p_payload->>'return_number'
    );
    
    -- notes: check nested first, then root
    v_notes := COALESCE(
        p_payload->'return'->>'notes',
        p_payload->>'notes'
    );
    
    -- reason: check nested first, then root
    v_reason := COALESCE(
        p_payload->'return'->>'reason',
        p_payload->>'reason'
    );
    
    -- items: always at root level
    v_items := p_payload->'items';
    
    -- ================================
    -- User name resolution using raw_user_meta_data
    -- ================================
    v_user_id := auth.uid();
    SELECT COALESCE(
        raw_user_meta_data->>'full_name',
        email,
        'System'
    ) INTO v_user_name
    FROM auth.users 
    WHERE id = v_user_id;
    
    IF v_user_name IS NULL THEN
        v_user_name := 'System';
    END IF;
    
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
        v_item_id := COALESCE(
            (v_item->>'item_id')::UUID,
            (v_item->>'id')::UUID
        );
        
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
        v_item_id := COALESCE(
            (v_item->>'item_id')::UUID,
            (v_item->>'id')::UUID
        );
        v_item_code := v_item->>'item_code';
        
        -- Get item details
        SELECT * INTO v_item_record FROM jewelry_items WHERE id = v_item_id;
        
        IF v_item_record IS NOT NULL THEN
            v_unit_price := COALESCE((v_item->>'unit_price')::NUMERIC, v_item_record.total_price, 0);
            v_gold_weight := v_item_record.gold_weight;
            
            -- Create return line
            INSERT INTO purchase_invoice_lines (
                invoice_id, line_number, product_id, 
                quantity, unit_price, total_price,
                gold_weight, description
            ) VALUES (
                v_return_id, v_line_number, v_item_id,
                1, v_unit_price, v_unit_price,
                v_gold_weight, COALESCE(v_item_code, v_item_record.item_code)
            );
            
            -- Update jewelry item status to returned
            UPDATE jewelry_items 
            SET sale_status = 'returned',
                is_available_for_sale = false,
                updated_at = NOW()
            WHERE id = v_item_id;
        END IF;
    END LOOP;
    
    -- Create journal entry
    SELECT 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || 
           LPAD((nextval('journal_entry_number_seq'))::TEXT, 4, '0')
    INTO v_je_number;
    
    INSERT INTO journal_entries (
        entry_number, entry_date, reference_type, reference_id,
        description, total_debit, total_credit, status, created_by
    ) VALUES (
        v_je_number, v_return_date, 'purchase_return', v_return_id,
        'Purchase Return: ' || v_return_number,
        v_total_amount, v_total_amount, 'posted', v_user_id
    ) RETURNING id INTO v_je_id;
    
    -- Debit: Accounts Payable (reduce liability)
    INSERT INTO journal_entry_lines (
        journal_entry_id, account_id, debit_amount, credit_amount, description
    ) VALUES (
        v_je_id, v_supplier_account_id, v_total_amount, 0,
        'Supplier payable reduction - Return ' || v_return_number
    );
    
    -- Credit: Inventory
    INSERT INTO journal_entry_lines (
        journal_entry_id, account_id, debit_amount, credit_amount, description
    ) VALUES (
        v_je_id, v_inventory_account_id, 0, v_subtotal,
        'Inventory reduction - Return ' || v_return_number
    );
    
    -- Credit: VAT Input (if applicable)
    IF v_tax_amount > 0 THEN
        INSERT INTO journal_entry_lines (
            journal_entry_id, account_id, debit_amount, credit_amount, description
        ) SELECT
            v_je_id, id, 0, v_tax_amount,
            'VAT Input reversal - Return ' || v_return_number
        FROM chart_of_accounts 
        WHERE account_code = '1501' AND is_active = true 
        LIMIT 1;
    END IF;
    
    -- Link journal entry to invoice
    UPDATE invoices SET journal_entry_id = v_je_id WHERE id = v_return_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'return_id', v_return_id,
        'return_number', v_return_number,
        'journal_entry_id', v_je_id
    );
    
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM
    );
END;
$function$;