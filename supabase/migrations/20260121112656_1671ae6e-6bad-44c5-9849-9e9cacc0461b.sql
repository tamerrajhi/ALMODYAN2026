-- =============================================================================
-- RADICAL FIX: Unique Purchase Return - Correct Table Routing + Dynamic Tax
--
-- Problems fixed:
-- 1. Returns were inserted into 'invoices' table → showed as "Quantities" type
-- 2. Tax was hardcoded at 15% → should be 0% for import invoices
--
-- Solution:
-- 1. Insert into 'purchase_returns' table (for unique items)
-- 2. Insert items into 'purchase_return_items' table
-- 3. Read purchase_type from linked invoice → set tax accordingly
-- 4. Create invoice mirror for accounting integration
-- =============================================================================

CREATE OR REPLACE FUNCTION public.complete_purchase_return_unique_items_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_return_id UUID;
    v_invoice_mirror_id UUID;
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
    v_item_tax_rate NUMERIC;
    v_item_tax_amount NUMERIC;
    v_item_total NUMERIC;
    v_je_id UUID;
    v_je_number TEXT;
    v_inventory_account_id UUID;
    v_supplier_account_id UUID;
    v_user_id UUID;
    v_user_name TEXT;
    v_item_record RECORD;
    v_purchase_type TEXT;
    v_tax_rate NUMERIC;
BEGIN
    -- Extract header fields (nested return + legacy fallback)
    v_supplier_id := COALESCE((p_payload->'return'->>'supplier_id')::UUID, (p_payload->>'supplier_id')::UUID);
    v_branch_id := COALESCE((p_payload->'return'->>'branch_id')::UUID, (p_payload->>'branch_id')::UUID);
    v_linked_invoice_id := COALESCE(
        (p_payload->'return'->>'purchase_invoice_id')::UUID,
        (p_payload->'return'->>'linked_invoice_id')::UUID,
        (p_payload->>'linked_invoice_id')::UUID
    );
    v_return_date := COALESCE((p_payload->'return'->>'return_date')::DATE, (p_payload->>'return_date')::DATE, CURRENT_DATE);
    v_return_number := COALESCE(p_payload->'return'->>'return_number', p_payload->>'return_number');
    v_notes := COALESCE(p_payload->'return'->>'notes', p_payload->>'notes');
    v_reason := COALESCE(p_payload->'return'->>'reason', p_payload->>'reason');
    v_items := p_payload->'items';

    -- User name
    v_user_id := auth.uid();
    SELECT COALESCE(raw_user_meta_data->>'full_name', email, 'System')
      INTO v_user_name
      FROM auth.users
     WHERE id = v_user_id;
    IF v_user_name IS NULL THEN v_user_name := 'System'; END IF;

    -- Validate required fields
    IF v_supplier_id IS NULL THEN RAISE EXCEPTION 'supplier_id is required'; END IF;
    IF v_branch_id IS NULL THEN RAISE EXCEPTION 'branch_id is required'; END IF;
    IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN RAISE EXCEPTION 'At least one item is required'; END IF;

    -- Generate return number if not provided
    IF v_return_number IS NULL OR v_return_number = '' THEN
        v_return_number := 'PRET-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD((EXTRACT(EPOCH FROM NOW())::BIGINT % 10000)::TEXT, 4, '0');
    END IF;

    -- ================================
    -- READ PURCHASE TYPE FROM LINKED INVOICE
    -- import = 0% tax, local = 15% tax
    -- ================================
    v_purchase_type := 'local';
    IF v_linked_invoice_id IS NOT NULL THEN
        SELECT COALESCE(purchase_type, 'local')
          INTO v_purchase_type
          FROM invoices
         WHERE id = v_linked_invoice_id;
    END IF;
    
    -- Set tax rate based on purchase type
    IF v_purchase_type = 'import' THEN
        v_tax_rate := 0;
    ELSE
        v_tax_rate := 0.15;
    END IF;

    -- Accounts
    SELECT id INTO v_inventory_account_id
      FROM chart_of_accounts
     WHERE account_code = '1301' AND is_active = true
     LIMIT 1;

    SELECT account_id INTO v_supplier_account_id
      FROM suppliers
     WHERE id = v_supplier_id;

    IF v_supplier_account_id IS NULL THEN
        SELECT id INTO v_supplier_account_id
          FROM chart_of_accounts
         WHERE account_code = '2101' AND is_active = true
         LIMIT 1;
    END IF;

    -- ================================
    -- Calculate totals from items
    -- ================================
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
        v_item_id := COALESCE((v_item->>'item_id')::UUID, (v_item->>'id')::UUID);

        -- Prefer payload unit_price (if present and > 0)
        v_unit_price := NULLIF((v_item->>'unit_price')::NUMERIC, 0);

        IF v_unit_price IS NULL THEN
            SELECT * INTO v_item_record FROM jewelry_items WHERE id = v_item_id;
            IF v_item_record IS NULL THEN
                RAISE EXCEPTION 'Purchase Return item not found: %', v_item_id;
            END IF;
            v_unit_price := COALESCE(v_item_record.cost, 0);
        END IF;

        IF v_unit_price <= 0 THEN
            RAISE EXCEPTION 'Purchase Return item unit_price/cost is zero. item_id=%, payload_unit_price=%',
                v_item_id, (v_item->>'unit_price');
        END IF;

        v_subtotal := v_subtotal + v_unit_price;
    END LOOP;

    -- FAIL-FAST GUARD: Prevent zero-value returns
    IF v_subtotal <= 0 THEN
        RAISE EXCEPTION 'Purchase Return subtotal is zero. Check item unit_price/cost mapping.';
    END IF;

    -- Calculate tax based on purchase type
    v_tax_amount := v_subtotal * v_tax_rate;
    v_total_amount := v_subtotal + v_tax_amount;

    -- ================================
    -- INSERT INTO purchase_returns TABLE (CORRECT TABLE FOR UNIQUE ITEMS)
    -- ================================
    INSERT INTO purchase_returns (
        return_number, return_date, supplier_id, branch_id,
        purchase_invoice_id, subtotal, tax_amount, total_amount,
        status, reason, notes, processed_by, purchase_type
    ) VALUES (
        v_return_number, v_return_date, v_supplier_id, v_branch_id,
        v_linked_invoice_id, v_subtotal, v_tax_amount, v_total_amount,
        'confirmed', v_reason, v_notes, v_user_name, v_purchase_type
    ) RETURNING id INTO v_return_id;

    -- ================================
    -- INSERT ITEMS INTO purchase_return_items TABLE
    -- ================================
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
        v_item_id := COALESCE((v_item->>'item_id')::UUID, (v_item->>'id')::UUID);
        v_item_code := v_item->>'item_code';

        -- Ensure item exists for status updates
        SELECT * INTO v_item_record FROM jewelry_items WHERE id = v_item_id;
        IF v_item_record IS NULL THEN
            RAISE EXCEPTION 'Purchase Return item not found (line creation): %', v_item_id;
        END IF;

        v_unit_price := NULLIF((v_item->>'unit_price')::NUMERIC, 0);
        IF v_unit_price IS NULL THEN
            v_unit_price := COALESCE(v_item_record.cost, 0);
        END IF;

        IF v_unit_price <= 0 THEN
            RAISE EXCEPTION 'Purchase Return item unit_price/cost is zero (line creation). item_id=%', v_item_id;
        END IF;

        -- Calculate item-level tax based on purchase type
        v_item_tax_rate := v_tax_rate;
        v_item_tax_amount := v_unit_price * v_item_tax_rate;
        v_item_total := v_unit_price + v_item_tax_amount;

        INSERT INTO purchase_return_items (
            return_id, jewelry_item_id, description,
            quantity, unit_price, tax_rate, tax_amount, total_amount, weight_grams
        ) VALUES (
            v_return_id, v_item_id, COALESCE(v_item_code, v_item_record.item_code, v_item_record.description),
            1, v_unit_price, v_item_tax_rate, v_item_tax_amount, v_item_total,
            v_item_record.g_weight
        );

        -- Update jewelry item status
        UPDATE jewelry_items
           SET sale_status = 'returned',
               is_available_for_sale = false,
               updated_at = NOW()
         WHERE id = v_item_id;
    END LOOP;

    -- ================================
    -- JOURNAL ENTRY (Same logic but with dynamic tax)
    -- ================================
    v_je_number := public.generate_journal_entry_number();

    INSERT INTO journal_entries (
        entry_number, entry_date, reference_type, reference_id,
        description, total_debit, total_credit, is_posted, created_by
    ) VALUES (
        v_je_number, v_return_date, 'purchase_return', v_return_id,
        'Purchase Return: ' || v_return_number,
        v_total_amount, v_total_amount, true, v_user_id
    ) RETURNING id INTO v_je_id;

    -- Debit: AP (Supplier payable reduction)
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_supplier_account_id, v_total_amount, 0, 'Supplier payable reduction - Return ' || v_return_number);

    -- Credit: Inventory
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_inventory_account_id, 0, v_subtotal, 'Inventory reduction - Return ' || v_return_number);

    -- Credit: VAT Input (only if tax > 0, i.e., not import)
    IF v_tax_amount > 0 THEN
        INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
        SELECT v_je_id, id, 0, v_tax_amount, 'VAT Input reversal - Return ' || v_return_number
          FROM chart_of_accounts
         WHERE account_code = '1501' AND is_active = true
         LIMIT 1;
    END IF;

    -- Link journal entry to purchase return
    UPDATE purchase_returns SET journal_entry_id = v_je_id WHERE id = v_return_id;

    -- ================================
    -- CREATE INVOICE MIRROR (for accounting reports compatibility)
    -- ================================
    INSERT INTO invoices (
        invoice_number, invoice_type, invoice_date,
        supplier_id, branch_id, subtotal, tax_amount, total_amount,
        status, notes, created_by, linked_invoice_id, journal_entry_id, purchase_type
    ) VALUES (
        v_return_number, 'purchase_return', v_return_date,
        v_supplier_id, v_branch_id, v_subtotal, v_tax_amount, v_total_amount,
        'posted', COALESCE(v_reason, '') || COALESCE(' - ' || v_notes, ''),
        v_user_id, v_linked_invoice_id, v_je_id, v_purchase_type
    ) RETURNING id INTO v_invoice_mirror_id;

    RETURN jsonb_build_object(
        'success', true,
        'return_id', v_return_id,
        'return_number', v_return_number,
        'journal_entry_id', v_je_id,
        'journal_entry_number', v_je_number,
        'subtotal', v_subtotal,
        'tax_amount', v_tax_amount,
        'total_amount', v_total_amount,
        'purchase_type', v_purchase_type,
        'invoice_mirror_id', v_invoice_mirror_id
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;