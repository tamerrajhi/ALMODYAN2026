-- P-RET-UUID-TEXT-FIX: Correct type mismatch and column drift in complete_purchase_return_unique_items_atomic

CREATE OR REPLACE FUNCTION public.complete_purchase_return_unique_items_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_client_request_id uuid;  -- FIX #1: Changed from text to uuid
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
    -- FIX #2: Extract client_request_id with proper UUID cast
    v_client_request_id := NULLIF(p_payload->>'client_request_id','')::uuid;
    
    IF v_client_request_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'client_request_id is required', 'error_code', 'MISSING_REQUEST_ID');
    END IF;
    
    -- Check for existing request (idempotency) - FIX #3: Now uuid = uuid comparison works
    SELECT * INTO v_existing_request
    FROM pos_workflow_requests
    WHERE client_request_id = v_client_request_id
    AND workflow_type = 'purchase_return_unique_items';
    
    IF FOUND THEN
        IF v_existing_request.status = 'completed' THEN
            RETURN v_existing_request.result;  -- FIX #5: Changed from result_payload to result
        ELSIF v_existing_request.status = 'processing' THEN
            RETURN jsonb_build_object('success', false, 'error', 'Request is already being processed', 'error_code', 'CONCURRENT_LOCK');
        END IF;
    END IF;
    
    -- FIX #4: Register request with correct columns (payload_hash instead of request_payload)
    INSERT INTO pos_workflow_requests (
        client_request_id, workflow_type, status, payload_hash, entity_id
    ) VALUES (
        v_client_request_id,
        'purchase_return_unique_items',
        'processing',
        md5(COALESCE(p_payload::text, '')),
        NULL
    )
    ON CONFLICT (client_request_id)
    DO UPDATE SET
        status = 'processing',
        payload_hash = EXCLUDED.payload_hash;
    
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
    
    -- Generate return ID
    v_return_id := gen_random_uuid();
    
    -- Create purchase return header (FIX: use purchase_invoice_id instead of linked_invoice_id)
    INSERT INTO purchase_returns (
        id, return_number, supplier_id, branch_id, purchase_invoice_id,
        return_date, return_type, status, subtotal, tax_amount, total_amount,
        notes, reason, created_by
    ) VALUES (
        v_return_id,
        v_return_number,
        v_supplier_id,
        v_branch_id,
        v_linked_invoice_id,
        v_return_date,
        'unique_items',
        'completed',
        0, 0, 0,
        v_notes,
        v_reason,
        v_user_name
    );
    
    -- Process items
    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'items', '[]'::jsonb))
    LOOP
        v_item_id := (v_item.value->>'jewelry_item_id')::uuid;
        
        -- Get item details
        SELECT * INTO v_item_record FROM jewelry_items WHERE id = v_item_id;
        
        IF v_item_record.id IS NOT NULL THEN
            -- Create return item
            INSERT INTO purchase_return_items (
                purchase_return_id, jewelry_item_id, quantity, 
                unit_price, tax_rate, tax_amount, total_amount
            ) VALUES (
                v_return_id,
                v_item_id,
                1,
                COALESCE(v_item_record.cost, 0),
                15,
                COALESCE(v_item_record.cost, 0) * 0.15,
                COALESCE(v_item_record.cost, 0) * 1.15
            );
            
            -- Create item movement (FIX: use purchase_return_id, not return_id)
            INSERT INTO item_movements (
                jewelry_item_id, movement_type, reference_type, reference_id,
                from_branch_id, to_branch_id, from_status, to_status,
                notes, performed_by, purchase_return_id, return_id
            ) VALUES (
                v_item_id,
                'PURCHASE_RETURN',
                'purchase_return',
                v_return_id,
                v_branch_id,
                NULL,
                v_item_record.sale_status,
                'returned',
                'مرتجع مشتريات - ' || v_return_number,
                v_user_name,
                v_return_id,
                NULL
            );
            
            -- Update item status
            UPDATE jewelry_items 
            SET sale_status = 'returned',
                is_available_for_sale = false,
                branch_id = NULL,
                updated_at = now()
            WHERE id = v_item_id;
            
            v_total_amount := v_total_amount + COALESCE(v_item_record.cost, 0) * 1.15;
            v_items_processed := v_items_processed + 1;
        END IF;
    END LOOP;
    
    -- Update return totals
    UPDATE purchase_returns 
    SET subtotal = v_total_amount / 1.15,
        tax_amount = v_total_amount - (v_total_amount / 1.15),
        total_amount = v_total_amount
    WHERE id = v_return_id;
    
    -- Create journal entry
    v_journal_entry_id := gen_random_uuid();
    v_je_number := 'JE-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || LPAD(nextval('journal_entry_number_seq')::text, 4, '0');
    
    INSERT INTO journal_entries (
        id, entry_number, entry_date, description, source_type, source_id,
        branch_id, fiscal_year_id, status, total_debit, total_credit,
        created_by, posted_by, posted_at
    ) VALUES (
        v_journal_entry_id,
        v_je_number,
        v_return_date,
        'مرتجع مشتريات - ' || v_return_number,
        'purchase_return',
        v_return_id,
        v_branch_id,
        v_fiscal_year_id,
        'posted',
        v_total_amount,
        v_total_amount,
        v_user_name,
        v_user_name,
        now()
    );
    
    -- Debit: Accounts Payable (reduce liability)
    INSERT INTO journal_entry_lines (
        journal_entry_id, account_id, debit_amount, credit_amount, description
    ) VALUES (
        v_journal_entry_id, v_ap_account_id, v_total_amount, 0, 'مرتجع مشتريات - تخفيض ذمم الموردين'
    );
    
    -- Credit: Inventory (reduce asset)
    INSERT INTO journal_entry_lines (
        journal_entry_id, account_id, debit_amount, credit_amount, description
    ) VALUES (
        v_journal_entry_id, v_inventory_account_id, 0, v_total_amount, 'مرتجع مشتريات - تخفيض المخزون'
    );
    
    -- Link JE to return
    UPDATE purchase_returns SET journal_entry_id = v_journal_entry_id WHERE id = v_return_id;
    
    -- FIX #6: Mark as completed with correct column names (result instead of result_payload, entity_id populated)
    UPDATE pos_workflow_requests
    SET status = 'completed',
        entity_id = v_return_id,
        result = jsonb_build_object(
            'success', true,
            'return_id', v_return_id,
            'return_number', v_return_number,
            'journal_entry_id', v_journal_entry_id,
            'journal_entry_number', v_je_number,
            'total_amount', v_total_amount,
            'items_processed', v_items_processed
        ),
        error_code = NULL,
        error_message = NULL
    WHERE client_request_id = v_client_request_id;
    
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
    -- FIX #7: Use correct column names in exception handler
    UPDATE pos_workflow_requests
    SET status = 'failed',
        error_code = SQLSTATE,
        error_message = SQLERRM
    WHERE client_request_id = v_client_request_id;
    
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM,
        'error_code', SQLSTATE
    );
END;
$$;