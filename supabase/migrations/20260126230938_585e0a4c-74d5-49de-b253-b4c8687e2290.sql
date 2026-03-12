-- P-RET-LINKCOL-DRIFT: Fix wrong column name in unique items RPC
-- Change: linked_invoice_id → purchase_invoice_id

CREATE OR REPLACE FUNCTION public.complete_purchase_return_unique_items_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_client_request_id text;
    v_return_id uuid;
    v_return_number text;
    v_supplier_id uuid;
    v_branch_id uuid;
    v_linked_invoice_id uuid;
    v_return_date date;
    v_reason text;
    v_notes text;
    v_user_name text;
    v_item record;
    v_item_id uuid;
    v_item_record record;
    v_journal_entry_id uuid;
    v_je_number text;
    v_total_amount numeric := 0;
    v_items_processed int := 0;
    v_ap_account_id uuid;
    v_inventory_account_id uuid;
    v_fiscal_year_id uuid;
    v_existing_request record;
BEGIN
    -- Extract client_request_id for idempotency
    v_client_request_id := p_payload->>'client_request_id';
    
    IF v_client_request_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'client_request_id is required', 'error_code', 'MISSING_REQUEST_ID');
    END IF;
    
    -- Check for existing request (idempotency)
    SELECT * INTO v_existing_request
    FROM pos_workflow_requests
    WHERE client_request_id = v_client_request_id
    AND workflow_type = 'purchase_return_unique_items';
    
    IF FOUND THEN
        IF v_existing_request.status = 'completed' THEN
            RETURN v_existing_request.result_payload;
        ELSIF v_existing_request.status = 'processing' THEN
            RETURN jsonb_build_object('success', false, 'error', 'Request is already being processed', 'error_code', 'CONCURRENT_LOCK');
        END IF;
    END IF;
    
    -- Register request
    INSERT INTO pos_workflow_requests (client_request_id, workflow_type, request_payload, status)
    VALUES (v_client_request_id, 'purchase_return_unique_items', p_payload, 'processing')
    ON CONFLICT (client_request_id, workflow_type) DO UPDATE SET status = 'processing';
    
    -- Extract return data (support nested 'return' object and root-level fallback)
    v_supplier_id := COALESCE(
        (p_payload->'return'->>'supplier_id')::uuid,
        (p_payload->>'supplier_id')::uuid
    );
    v_branch_id := COALESCE(
        (p_payload->'return'->>'branch_id')::uuid,
        (p_payload->>'branch_id')::uuid
    );
    v_linked_invoice_id := COALESCE(
        (p_payload->'return'->>'purchase_invoice_id')::uuid,
        (p_payload->>'purchase_invoice_id')::uuid
    );
    v_return_date := COALESCE(
        (p_payload->'return'->>'return_date')::date,
        (p_payload->>'return_date')::date,
        CURRENT_DATE
    );
    v_reason := COALESCE(
        p_payload->'return'->>'reason',
        p_payload->>'reason',
        'excess_quantity'
    );
    v_notes := COALESCE(
        p_payload->'return'->>'notes',
        p_payload->>'notes'
    );
    v_user_name := COALESCE(
        p_payload->>'created_by',
        'System'
    );
    
    -- Validate required fields
    IF v_supplier_id IS NULL THEN
        UPDATE pos_workflow_requests SET status = 'failed', error_message = 'supplier_id is required'
        WHERE client_request_id = v_client_request_id AND workflow_type = 'purchase_return_unique_items';
        RETURN jsonb_build_object('success', false, 'error', 'supplier_id is required', 'error_code', 'VALIDATION_ERROR');
    END IF;
    
    IF v_branch_id IS NULL THEN
        UPDATE pos_workflow_requests SET status = 'failed', error_message = 'branch_id is required'
        WHERE client_request_id = v_client_request_id AND workflow_type = 'purchase_return_unique_items';
        RETURN jsonb_build_object('success', false, 'error', 'branch_id is required', 'error_code', 'VALIDATION_ERROR');
    END IF;
    
    -- Get next return number
    SELECT nextval('purchase_return_number_seq') INTO v_return_number;
    v_return_number := 'P-RET-' || LPAD(v_return_number::text, 6, '0');
    
    -- Get accounting configuration
    SELECT id INTO v_ap_account_id FROM chart_of_accounts WHERE account_code = '2001' AND is_active = true LIMIT 1;
    SELECT id INTO v_inventory_account_id FROM chart_of_accounts WHERE account_code = '1301' AND is_active = true LIMIT 1;
    SELECT id INTO v_fiscal_year_id FROM fiscal_years WHERE is_active = true LIMIT 1;
    
    IF v_ap_account_id IS NULL OR v_inventory_account_id IS NULL THEN
        UPDATE pos_workflow_requests SET status = 'failed', error_message = 'Missing accounting configuration'
        WHERE client_request_id = v_client_request_id AND workflow_type = 'purchase_return_unique_items';
        RETURN jsonb_build_object('success', false, 'error', 'Missing accounting configuration (AP or Inventory account)', 'error_code', 'CONFIG_ERROR');
    END IF;
    
    -- Create purchase return record (FIX: use purchase_invoice_id instead of linked_invoice_id)
    INSERT INTO purchase_returns (
        return_number, supplier_id, branch_id, purchase_invoice_id,
        return_date, status, subtotal, tax_amount, total_amount,
        notes, reason, processed_by
    ) VALUES (
        v_return_number, v_supplier_id, v_branch_id, v_linked_invoice_id,
        v_return_date, 'confirmed', 0, 0, 0,
        v_notes, v_reason, v_user_name
    ) RETURNING id INTO v_return_id;
    
    -- Process each item
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items')
    LOOP
        v_item_id := (v_item.value->>'item_id')::uuid;
        
        -- Get item details
        SELECT * INTO v_item_record FROM jewelry_items WHERE id = v_item_id;
        
        IF NOT FOUND THEN
            CONTINUE;
        END IF;
        
        -- Calculate item value
        v_total_amount := v_total_amount + COALESCE(v_item_record.cost, 0);
        
        -- Create return item
        INSERT INTO purchase_return_items (
            purchase_return_id, jewelry_item_id, quantity, unit_price, tax_rate, tax_amount, total_amount
        ) VALUES (
            v_return_id, v_item_id, 1, COALESCE(v_item_record.cost, 0), 0, 0, COALESCE(v_item_record.cost, 0)
        );
        
        -- Update item status
        UPDATE jewelry_items 
        SET sale_status = 'returned',
            is_available_for_sale = false,
            branch_id = NULL
        WHERE id = v_item_id;
        
        -- Create inventory movement (FIX: use purchase_return_id instead of return_id)
        INSERT INTO item_movements (
            item_id, movement_type, movement_date, reference_type, reference_id, reference_code,
            from_branch_id, performed_by, cost, notes, purchase_return_id
        ) VALUES (
            v_item_id, 'PURCHASE_RETURN', NOW(), 'purchase_return', v_return_id, v_return_number,
            v_branch_id, COALESCE(v_user_name, 'System'), COALESCE(v_item_record.cost, 0),
            'مرتجع مشتريات للمورد - ' || v_return_number, v_return_id
        );
        
        v_items_processed := v_items_processed + 1;
    END LOOP;
    
    -- Validate at least one item processed
    IF v_items_processed = 0 THEN
        RAISE EXCEPTION 'No items were processed for return';
    END IF;
    
    -- Update return totals
    UPDATE purchase_returns 
    SET subtotal = v_total_amount, total_amount = v_total_amount
    WHERE id = v_return_id;
    
    -- Generate JE number
    SELECT nextval('journal_entry_number_seq') INTO v_je_number;
    v_je_number := 'JE-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-' || LPAD(v_je_number::text, 4, '0');
    
    -- Create journal entry
    INSERT INTO journal_entries (
        entry_number, entry_date, description, reference_type, reference_id,
        total_debit, total_credit, is_posted, fiscal_year_id, branch_id, created_by
    ) VALUES (
        v_je_number, CURRENT_DATE, 'قيد مرتجع مشتريات - ' || v_return_number,
        'purchase_return', v_return_id, v_total_amount, v_total_amount, true,
        v_fiscal_year_id, v_branch_id, v_user_name
    ) RETURNING id INTO v_journal_entry_id;
    
    -- Create JE lines: Debit AP, Credit Inventory
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description, line_order)
    VALUES 
        (v_journal_entry_id, v_ap_account_id, v_total_amount, 0, 'تخفيض ذمم موردين - مرتجع', 1),
        (v_journal_entry_id, v_inventory_account_id, 0, v_total_amount, 'خروج مخزون - مرتجع', 2);
    
    -- Link JE to return
    UPDATE purchase_returns SET journal_entry_id = v_journal_entry_id WHERE id = v_return_id;
    
    -- Mark request as completed
    UPDATE pos_workflow_requests 
    SET status = 'completed', 
        result_payload = jsonb_build_object(
            'success', true,
            'return_id', v_return_id,
            'return_number', v_return_number,
            'journal_entry_id', v_journal_entry_id,
            'journal_entry_number', v_je_number,
            'total_amount', v_total_amount,
            'items_processed', v_items_processed
        )
    WHERE client_request_id = v_client_request_id AND workflow_type = 'purchase_return_unique_items';
    
    RETURN jsonb_build_object(
        'success', true,
        'return_id', v_return_id,
        'return_number', v_return_number,
        'journal_entry_id', v_journal_entry_id,
        'journal_entry_number', v_je_number,
        'total_amount', v_total_amount,
        'items_processed', v_items_processed
    );

EXCEPTION WHEN OTHERS THEN
    -- Mark request as failed
    UPDATE pos_workflow_requests 
    SET status = 'failed', error_message = SQLERRM
    WHERE client_request_id = v_client_request_id AND workflow_type = 'purchase_return_unique_items';
    
    RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'error_code', SQLSTATE);
END;
$$;