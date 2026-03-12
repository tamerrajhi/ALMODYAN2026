-- Stage-2B FIX: Correct reference_id type from TEXT to UUID in purchase_invoice_create_atomic

CREATE OR REPLACE FUNCTION public.purchase_invoice_create_atomic(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_client_request_id UUID;
    v_workflow_type TEXT := 'purchase_invoice_create_atomic';
    v_payload_hash TEXT;
    v_idempotency_check jsonb;
    v_invoice_id UUID;
    v_invoice_number TEXT;
    v_supplier_id UUID;
    v_branch_id UUID;
    v_invoice_date DATE;
    v_due_date DATE;
    v_notes TEXT;
    v_created_by TEXT;
    v_subtotal NUMERIC := 0;
    v_tax_amount NUMERIC := 0;
    v_total_amount NUMERIC := 0;
    v_items jsonb;
    v_item jsonb;
    v_line_qty NUMERIC;
    v_line_unit_price NUMERIC;
    v_line_tax_rate NUMERIC;
    v_line_discount NUMERIC;
    v_line_subtotal NUMERIC;
    v_line_tax NUMERIC;
    v_line_total NUMERIC;
    v_line_number INTEGER := 0;
    v_result jsonb;
    -- Journal Entry variables
    v_je_id UUID;
    v_je_number TEXT;
    v_supplier_account_id UUID;
    v_inventory_account_id UUID;
    v_vat_account_id UUID;
    v_supplier_name TEXT;
BEGIN
    -- Extract client_request_id
    v_client_request_id := (p_payload->>'client_request_id')::UUID;
    IF v_client_request_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'VALIDATION',
            'error', 'client_request_id is required'
        );
    END IF;

    -- Calculate payload hash (exclude request id for caching)
    v_payload_hash := stable_payload_hash(p_payload - 'client_request_id');

    -- Idempotency gate
    v_idempotency_check := begin_workflow_request(v_client_request_id::TEXT, v_workflow_type, p_payload);
    
    IF (v_idempotency_check->>'status') = 'succeeded' THEN
        RETURN jsonb_build_object(
            'success', true,
            'cached', true,
            'invoiceId', v_idempotency_check->'result_payload'->>'invoiceId',
            'invoiceNumber', v_idempotency_check->'result_payload'->>'invoiceNumber',
            'journalEntryId', v_idempotency_check->'result_payload'->>'journalEntryId',
            'meta', jsonb_build_object(
                'workflowType', v_workflow_type,
                'clientRequestId', v_client_request_id,
                'payloadHash', v_payload_hash
            )
        );
    END IF;

    IF (v_idempotency_check->>'status') = 'conflict' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'IDEMPOTENCY_CONFLICT',
            'error', 'Same request ID used with different payload',
            'meta', jsonb_build_object(
                'workflowType', v_workflow_type,
                'clientRequestId', v_client_request_id
            )
        );
    END IF;

    IF (v_idempotency_check->>'status') = 'in_progress' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'IN_PROGRESS',
            'error', 'Request already in progress',
            'meta', jsonb_build_object(
                'workflowType', v_workflow_type,
                'clientRequestId', v_client_request_id
            )
        );
    END IF;

    -- Extract invoice fields
    v_supplier_id := (p_payload->'invoice'->>'supplier_id')::UUID;
    v_branch_id := (p_payload->'invoice'->>'branch_id')::UUID;
    v_invoice_date := COALESCE((p_payload->'invoice'->>'invoice_date')::DATE, CURRENT_DATE);
    v_due_date := COALESCE((p_payload->'invoice'->>'due_date')::DATE, v_invoice_date);
    v_notes := p_payload->'invoice'->>'notes';
    v_created_by := COALESCE(p_payload->>'created_by', 'system');
    v_items := p_payload->'items';

    -- Validate required fields
    IF v_supplier_id IS NULL THEN
        PERFORM core_workflow_failed(v_client_request_id::TEXT, 'VALIDATION', 'supplier_id is required');
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'VALIDATION',
            'error', 'supplier_id is required'
        );
    END IF;

    IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
        PERFORM core_workflow_failed(v_client_request_id::TEXT, 'VALIDATION', 'At least one item is required');
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'VALIDATION',
            'error', 'At least one item is required'
        );
    END IF;

    -- Fetch supplier info for JE
    SELECT supplier_name, account_id INTO v_supplier_name, v_supplier_account_id
    FROM suppliers WHERE id = v_supplier_id;

    -- Get default accounts for JE
    SELECT id INTO v_inventory_account_id
    FROM chart_of_accounts WHERE account_code = '1137' LIMIT 1;

    SELECT id INTO v_vat_account_id
    FROM chart_of_accounts WHERE account_code = '2202' LIMIT 1;

    IF v_supplier_account_id IS NULL THEN
        SELECT id INTO v_supplier_account_id
        FROM chart_of_accounts WHERE account_code = '21010001' LIMIT 1;
    END IF;

    IF v_inventory_account_id IS NULL THEN
        PERFORM core_workflow_failed(v_client_request_id::TEXT, 'CONFIG_ERROR', 'Inventory account 1137 not found');
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'CONFIG_ERROR',
            'error', 'Inventory account 1137 not found'
        );
    END IF;

    IF v_supplier_account_id IS NULL THEN
        PERFORM core_workflow_failed(v_client_request_id::TEXT, 'CONFIG_ERROR', 'Supplier AP account not found');
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'CONFIG_ERROR',
            'error', 'Supplier AP account not found'
        );
    END IF;

    -- Generate invoice number atomically
    v_invoice_number := generate_purchase_invoice_number_atomic();
    v_invoice_id := gen_random_uuid();

    -- Calculate line totals first
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
        v_line_qty := COALESCE((v_item->>'qty')::NUMERIC, (v_item->>'quantity')::NUMERIC, 1);
        v_line_unit_price := COALESCE((v_item->>'unit_cost')::NUMERIC, (v_item->>'unit_price')::NUMERIC, 0);
        v_line_tax_rate := COALESCE((v_item->>'tax_rate')::NUMERIC, 0.15);
        v_line_discount := COALESCE((v_item->>'discount_amount')::NUMERIC, 0);
        
        v_line_subtotal := (v_line_qty * v_line_unit_price) - v_line_discount;
        v_line_tax := v_line_subtotal * v_line_tax_rate;
        v_line_total := v_line_subtotal + v_line_tax;
        
        v_subtotal := v_subtotal + v_line_subtotal;
        v_tax_amount := v_tax_amount + v_line_tax;
        v_total_amount := v_total_amount + v_line_total;
    END LOOP;

    -- ============================================
    -- CREATE JOURNAL ENTRY FIRST (Governance Rule)
    -- ============================================
    v_je_id := gen_random_uuid();
    v_je_number := generate_journal_entry_number();

    INSERT INTO journal_entries (
        id,
        entry_number,
        entry_date,
        description,
        reference_type,
        reference_id,
        is_posted,
        total_debit,
        total_credit,
        branch_id,
        created_by,
        created_at
    ) VALUES (
        v_je_id,
        v_je_number,
        v_invoice_date,
        'Purchase Invoice ' || v_invoice_number || ' - ' || COALESCE(v_supplier_name, 'Supplier'),
        'purchase_invoice',
        v_invoice_id,  -- UUID directly, not ::TEXT
        true,
        v_total_amount,
        v_total_amount,
        v_branch_id,
        v_created_by,
        NOW()
    );

    -- Insert JE Lines
    INSERT INTO journal_entry_lines (
        journal_entry_id,
        account_id,
        debit_amount,
        credit_amount,
        description
    ) VALUES (
        v_je_id,
        v_inventory_account_id,
        v_subtotal,
        0,
        'Inventory - ' || v_invoice_number
    );

    IF v_tax_amount > 0 AND v_vat_account_id IS NOT NULL THEN
        INSERT INTO journal_entry_lines (
            journal_entry_id,
            account_id,
            debit_amount,
            credit_amount,
            description
        ) VALUES (
            v_je_id,
            v_vat_account_id,
            v_tax_amount,
            0,
            'VAT Purchases - ' || v_invoice_number
        );
    END IF;

    INSERT INTO journal_entry_lines (
        journal_entry_id,
        account_id,
        debit_amount,
        credit_amount,
        description
    ) VALUES (
        v_je_id,
        v_supplier_account_id,
        0,
        v_total_amount,
        'Supplier AP - ' || v_invoice_number
    );

    -- Verify JE is balanced
    IF NOT EXISTS (
        SELECT 1 FROM journal_entry_lines 
        WHERE journal_entry_id = v_je_id
        GROUP BY journal_entry_id
        HAVING SUM(debit_amount) = SUM(credit_amount) AND SUM(debit_amount) = v_total_amount
    ) THEN
        RAISE EXCEPTION 'PI_ERR:UNBALANCED_JE:Journal entry is not balanced';
    END IF;

    -- ============================================
    -- INSERT INVOICE WITH JE LINK
    -- ============================================
    INSERT INTO public.invoices (
        id,
        invoice_number,
        invoice_type,
        purchase_type,
        supplier_id,
        branch_id,
        invoice_date,
        due_date,
        notes,
        subtotal,
        tax_amount,
        total_amount,
        paid_amount,
        remaining_amount,
        status,
        journal_entry_id,
        created_by,
        created_at
    ) VALUES (
        v_invoice_id,
        v_invoice_number,
        'purchase',
        COALESCE(p_payload->'invoice'->>'invoice_type', 'local'),
        v_supplier_id,
        v_branch_id,
        v_invoice_date,
        v_due_date,
        v_notes,
        v_subtotal,
        v_tax_amount,
        v_total_amount,
        0,
        v_total_amount,
        'posted',
        v_je_id,
        v_created_by,
        NOW()
    );

    -- Insert invoice lines
    v_line_number := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
        v_line_number := v_line_number + 1;
        v_line_qty := COALESCE((v_item->>'qty')::NUMERIC, (v_item->>'quantity')::NUMERIC, 1);
        v_line_unit_price := COALESCE((v_item->>'unit_cost')::NUMERIC, (v_item->>'unit_price')::NUMERIC, 0);
        v_line_tax_rate := COALESCE((v_item->>'tax_rate')::NUMERIC, 0.15);
        v_line_discount := COALESCE((v_item->>'discount_amount')::NUMERIC, 0);
        
        v_line_subtotal := (v_line_qty * v_line_unit_price) - v_line_discount;
        v_line_tax := v_line_subtotal * v_line_tax_rate;
        v_line_total := v_line_subtotal + v_line_tax;

        INSERT INTO public.purchase_invoice_lines (
            invoice_id,
            line_number,
            product_id,
            product_code,
            description,
            quantity,
            unit_price,
            discount_amount,
            subtotal,
            tax_rate,
            tax_amount,
            total_amount,
            item_type,
            gl_account_id,
            cost_entry_id,
            warehouse_id,
            notes
        ) VALUES (
            v_invoice_id,
            v_line_number,
            (v_item->>'item_id')::UUID,
            v_item->>'item_code',
            COALESCE(v_item->>'description', 'Item ' || v_line_number),
            v_line_qty,
            v_line_unit_price,
            v_line_discount,
            v_line_subtotal,
            v_line_tax_rate * 100,
            v_line_tax,
            v_line_total,
            COALESCE(v_item->>'item_type', 'jewelry'),
            (v_item->>'gl_account_id')::UUID,
            (v_item->>'cost_entry_id')::UUID,
            (v_item->>'warehouse_id')::UUID,
            v_item->>'line_notes'
        );
    END LOOP;

    -- Build result with journalEntryId
    v_result := jsonb_build_object(
        'success', true,
        'invoiceId', v_invoice_id,
        'invoiceNumber', v_invoice_number,
        'journalEntryId', v_je_id,
        'journalEntryNumber', v_je_number,
        'status', 'posted',
        'totals', jsonb_build_object(
            'subtotal', v_subtotal,
            'taxAmount', v_tax_amount,
            'totalAmount', v_total_amount
        ),
        'itemsCount', jsonb_array_length(v_items),
        'meta', jsonb_build_object(
            'workflowType', v_workflow_type,
            'clientRequestId', v_client_request_id,
            'payloadHash', v_payload_hash
        )
    );

    -- Mark workflow success
    PERFORM core_workflow_success(v_client_request_id::TEXT, v_invoice_id, v_result);

    RETURN v_result;

EXCEPTION WHEN OTHERS THEN
    PERFORM core_workflow_failed(v_client_request_id::TEXT, 'DB_ERROR', SQLERRM);
    RETURN jsonb_build_object(
        'success', false,
        'error_code', 'DB_ERROR',
        'error', SQLERRM
    );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.purchase_invoice_create_atomic(jsonb) TO authenticated;