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
    v_expected_movement_count INT;
    v_actual_movement_count INT;
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
    -- CREATE purchase_returns header
    -- ================================
    INSERT INTO purchase_returns (
        return_number, supplier_id, branch_id, linked_invoice_id,
        return_date, return_type, status, subtotal, tax_amount, total_amount,
        notes, reason, created_by
    ) VALUES (
        v_return_number, v_supplier_id, v_branch_id, v_linked_invoice_id,
        v_return_date, 'unique_items', 'confirmed', 0, 0, 0,
        v_notes, v_reason, v_user_name
    ) RETURNING id INTO v_return_id;

    -- ================================
    -- Process each item
    -- ================================
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
        v_item_id := COALESCE((v_item->>'item_id')::UUID, (v_item->>'id')::UUID);

        -- Prefer payload unit_price (if present and > 0)
        v_unit_price := NULLIF((v_item->>'unit_price')::NUMERIC, 0);

        IF v_unit_price IS NULL THEN
            SELECT * INTO v_item_record FROM jewelry_items WHERE id = v_item_id;
            IF v_item_record IS NULL THEN
                RAISE EXCEPTION 'Item not found: %', v_item_id;
            END IF;
            v_unit_price := COALESCE(v_item_record.cost, v_item_record.tag_price, 0);
        ELSE
            SELECT * INTO v_item_record FROM jewelry_items WHERE id = v_item_id;
            IF v_item_record IS NULL THEN
                RAISE EXCEPTION 'Item not found: %', v_item_id;
            END IF;
        END IF;

        v_item_code := v_item_record.item_code;

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

        -- ================================
        -- Update jewelry item status + CLEAR branch_id (item exits branch)
        -- ================================
        UPDATE jewelry_items
           SET sale_status = 'returned',
               is_available_for_sale = false,
               branch_id = NULL,  -- Item exits branch on confirmed return
               updated_at = NOW()
         WHERE id = v_item_id
           AND (branch_id = v_branch_id OR branch_id IS NULL);  -- Only update if in same branch

        -- ================================
        -- INSERT item_movements (PURCHASE_RETURN) - Idempotent
        -- Uses unique index ux_item_movements_unique on (item_id, movement_type, reference_type, reference_id)
        -- FIX: Use purchase_return_id (FK to purchase_returns) instead of return_id (FK to sales returns)
        -- ================================
        INSERT INTO item_movements (
            item_id,
            movement_type,
            movement_date,
            reference_type,
            reference_id,
            reference_code,
            from_branch_id,
            performed_by,
            cost,
            notes,
            purchase_return_id
        ) VALUES (
            v_item_id,
            'PURCHASE_RETURN',
            NOW(),
            'purchase_return',
            v_return_id,
            v_return_number,
            v_branch_id,
            COALESCE(v_user_name, 'System'),
            COALESCE(v_item_record.cost, 0),
            'مرتجع مشتريات للمورد - ' || v_return_number,
            v_return_id
        )
        ON CONFLICT (item_id, movement_type, reference_type, reference_id) 
        WHERE reference_type IS NOT NULL AND reference_id IS NOT NULL
        DO NOTHING;

    END LOOP;

    -- ================================
    -- POST-CONDITION GUARD: Ensure movements match items
    -- ================================
    SELECT COUNT(*) INTO v_expected_movement_count
      FROM purchase_return_items
     WHERE return_id = v_return_id;

    SELECT COUNT(*) INTO v_actual_movement_count
      FROM item_movements
     WHERE reference_type = 'purchase_return'
       AND reference_id = v_return_id;

    IF v_actual_movement_count < v_expected_movement_count THEN
        RAISE EXCEPTION 'Movement mismatch: expected %, got %', v_expected_movement_count, v_actual_movement_count;
    END IF;

    -- ================================
    -- Update totals from line items
    -- ================================
    SELECT COALESCE(SUM(unit_price), 0),
           COALESCE(SUM(tax_amount), 0),
           COALESCE(SUM(total_amount), 0)
      INTO v_subtotal, v_tax_amount, v_total_amount
      FROM purchase_return_items
     WHERE return_id = v_return_id;

    UPDATE purchase_returns
       SET subtotal = v_subtotal,
           tax_amount = v_tax_amount,
           total_amount = v_total_amount
     WHERE id = v_return_id;

    -- ================================
    -- Create mirror invoice (type='purchase_return')
    -- ================================
    INSERT INTO invoices (
        invoice_type, invoice_number, party_id, party_type, branch_id,
        invoice_date, total_amount, tax_amount, subtotal,
        status, purchase_type, is_posted, notes
    ) VALUES (
        'purchase_return', v_return_number, v_supplier_id, 'supplier', v_branch_id,
        v_return_date, v_total_amount, v_tax_amount, v_subtotal,
        'posted', v_purchase_type, true, v_notes
    ) RETURNING id INTO v_invoice_mirror_id;

    -- Link return to mirror invoice
    UPDATE purchase_returns
       SET mirror_invoice_id = v_invoice_mirror_id
     WHERE id = v_return_id;

    -- ================================
    -- Create Journal Entry
    -- ================================
    v_je_number := 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD((EXTRACT(EPOCH FROM NOW())::BIGINT % 10000)::TEXT, 4, '0');

    INSERT INTO journal_entries (
        entry_number, entry_date, reference_type, reference_id, reference_number,
        description, total_debit, total_credit, branch_id, is_posted, created_by
    ) VALUES (
        v_je_number, v_return_date, 'purchase_return', v_return_id, v_return_number,
        'قيد مرتجع مشتريات - ' || v_return_number,
        v_total_amount, v_total_amount, v_branch_id, true, v_user_name
    ) RETURNING id INTO v_je_id;

    -- Credit Inventory (reduce asset)
    INSERT INTO journal_entry_lines (
        journal_entry_id, account_id, debit_amount, credit_amount, description, line_order
    ) VALUES (
        v_je_id, v_inventory_account_id, 0, v_subtotal, 'تخفيض المخزون - مرتجع', 1
    );

    -- Debit VAT Input (reduce receivable) - only if local
    IF v_tax_amount > 0 THEN
        INSERT INTO journal_entry_lines (
            journal_entry_id, account_id, debit_amount, credit_amount, description, line_order
        ) VALUES (
            v_je_id,
            (SELECT id FROM chart_of_accounts WHERE account_code = '1501' LIMIT 1),
            0, v_tax_amount,
            'تخفيض ضريبة المدخلات - مرتجع', 2
        );
    END IF;

    -- Debit Supplier account (reduce payable)
    INSERT INTO journal_entry_lines (
        journal_entry_id, account_id, debit_amount, credit_amount, description, line_order
    ) VALUES (
        v_je_id, v_supplier_account_id, v_total_amount, 0, 'تخفيض حساب المورد - مرتجع', 3
    );

    -- Link JE to return
    UPDATE purchase_returns
       SET journal_entry_id = v_je_id
     WHERE id = v_return_id;

    -- Create audit event
    INSERT INTO audit_events (entity_type, entity_id, entity_number, action, actor_id, branch_id, payload)
    VALUES ('purchase_return', v_return_id, v_return_number, 'create', v_user_id, v_branch_id, 
            jsonb_build_object('return_type', 'unique_items', 'total_amount', v_total_amount, 'item_count', jsonb_array_length(v_items)));

    RETURN jsonb_build_object(
        'success', true,
        'return_id', v_return_id,
        'return_number', v_return_number,
        'journal_entry_id', v_je_id,
        'journal_entry_number', v_je_number,
        'total_amount', v_total_amount,
        'tax_amount', v_tax_amount
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM,
        'error_code', SQLSTATE
    );
END;
$function$;