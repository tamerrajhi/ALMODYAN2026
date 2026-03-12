-- PI-1.1: Fix JE number generation in purchase_invoice_post_atomic to use atomic generator
CREATE OR REPLACE FUNCTION public.purchase_invoice_post_atomic(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_client_request_id UUID;
    v_workflow_type TEXT := 'purchase_invoice_post_atomic';
    v_payload_hash TEXT;
    v_idempotency_check jsonb;
    v_invoice_id UUID;
    v_invoice RECORD;
    v_supplier RECORD;
    v_je_id UUID;
    v_je_number TEXT;
    v_created_by TEXT;
    v_post_date DATE;
    v_description TEXT;
    v_lines_derived BOOLEAN := false;
    v_lines jsonb;
    v_line jsonb;
    v_line_number INTEGER := 0;
    v_total_debit NUMERIC := 0;
    v_total_credit NUMERIC := 0;
    v_inventory_account_id UUID;
    v_vat_account_id UUID;
    v_payables_account_id UUID;
    v_result jsonb;
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

    v_payload_hash := stable_payload_hash(p_payload - 'client_request_id');

    -- Idempotency gate
    v_idempotency_check := begin_workflow_request(v_client_request_id::TEXT, v_workflow_type, p_payload);
    
    IF (v_idempotency_check->>'status') = 'succeeded' THEN
        RETURN jsonb_build_object(
            'success', true,
            'cached', true,
            'invoiceId', v_idempotency_check->'result_payload'->>'invoiceId',
            'journalEntryId', v_idempotency_check->'result_payload'->>'journalEntryId',
            'journalEntryNumber', v_idempotency_check->'result_payload'->>'journalEntryNumber',
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
            'error', 'Same request ID used with different payload'
        );
    END IF;

    IF (v_idempotency_check->>'status') = 'in_progress' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'IN_PROGRESS',
            'error', 'Request already in progress'
        );
    END IF;

    -- Extract invoice_id
    v_invoice_id := (p_payload->>'invoice_id')::UUID;
    v_created_by := COALESCE(p_payload->>'created_by', 'system');
    v_post_date := COALESCE((p_payload->>'post_date')::DATE, CURRENT_DATE);
    v_description := COALESCE(p_payload->'journal'->>'description', 'قيد فاتورة مشتريات');

    IF v_invoice_id IS NULL THEN
        PERFORM core_workflow_failed(v_client_request_id::TEXT, 'VALIDATION', 'invoice_id is required');
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'VALIDATION',
            'error', 'invoice_id is required'
        );
    END IF;

    -- Lock and fetch invoice
    SELECT * INTO v_invoice
    FROM public.invoices
    WHERE id = v_invoice_id
    FOR UPDATE;

    IF v_invoice IS NULL THEN
        PERFORM core_workflow_failed(v_client_request_id::TEXT, 'NOT_FOUND', 'Invoice not found');
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'NOT_FOUND',
            'error', 'Invoice not found'
        );
    END IF;

    -- Check if already posted (idempotent return)
    IF v_invoice.journal_entry_id IS NOT NULL THEN
        -- Already posted, return existing JE info
        SELECT entry_number INTO v_je_number
        FROM public.journal_entries
        WHERE id = v_invoice.journal_entry_id;

        v_result := jsonb_build_object(
            'success', true,
            'alreadyPosted', true,
            'invoiceId', v_invoice_id,
            'invoiceNumber', v_invoice.invoice_number,
            'journalEntryId', v_invoice.journal_entry_id,
            'journalEntryNumber', v_je_number
        );
        PERFORM core_workflow_success(v_client_request_id::TEXT, v_invoice_id, v_result);
        RETURN v_result;
    END IF;

    -- Cannot post voided/cancelled invoice
    IF v_invoice.status IN ('voided', 'cancelled') THEN
        PERFORM core_workflow_failed(v_client_request_id::TEXT, 'INVALID_STATUS', 'Cannot post voided/cancelled invoice');
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_STATUS',
            'error', 'Cannot post voided or cancelled invoice'
        );
    END IF;

    -- Fetch supplier
    SELECT id, supplier_name, account_id INTO v_supplier
    FROM public.suppliers
    WHERE id = v_invoice.supplier_id;

    -- Determine accounts
    -- Try to get default accounts from system settings or chart_of_accounts
    SELECT id INTO v_inventory_account_id
    FROM public.chart_of_accounts
    WHERE account_code = '1103' OR account_code = '1310' OR account_name LIKE '%مخزون%' OR account_name_en LIKE '%Inventory%'
    ORDER BY CASE WHEN account_code = '1103' THEN 0 ELSE 1 END
    LIMIT 1;

    SELECT id INTO v_vat_account_id
    FROM public.chart_of_accounts
    WHERE account_code = '1420' OR account_name LIKE '%ضريبة مدخلات%' OR account_name_en LIKE '%Input VAT%'
    LIMIT 1;

    -- Payables account: prefer supplier's account, else find default
    v_payables_account_id := v_supplier.account_id;
    IF v_payables_account_id IS NULL THEN
        SELECT id INTO v_payables_account_id
        FROM public.chart_of_accounts
        WHERE account_code = '2110' OR account_name LIKE '%ذمم دائنة%' OR account_name_en LIKE '%Accounts Payable%'
        LIMIT 1;
    END IF;

    -- If still no accounts, fail with clear error
    IF v_inventory_account_id IS NULL OR v_payables_account_id IS NULL THEN
        PERFORM core_workflow_failed(v_client_request_id::TEXT, 'MISSING_ACCOUNT_MAPPING', 'Required accounts not configured');
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'MISSING_ACCOUNT_MAPPING',
            'error', 'Required GL accounts not configured. Need Inventory and Payables accounts.'
        );
    END IF;

    -- Generate JE number ATOMICALLY using the proper generator
    v_je_id := gen_random_uuid();
    v_je_number := generate_journal_entry_number();

    -- Calculate totals for JE
    v_total_debit := COALESCE(v_invoice.subtotal, 0) + COALESCE(v_invoice.tax_amount, 0);
    v_total_credit := v_total_debit;

    -- Create journal entry
    INSERT INTO public.journal_entries (
        id,
        entry_number,
        entry_date,
        reference_type,
        reference_id,
        description,
        total_debit,
        total_credit,
        branch_id,
        is_posted,
        posted_at,
        posted_by,
        created_by,
        created_at
    ) VALUES (
        v_je_id,
        v_je_number,
        v_post_date,
        'purchase_invoice',
        v_invoice_id,
        v_description || ' - ' || v_invoice.invoice_number || ' - ' || COALESCE(v_supplier.supplier_name, ''),
        v_total_debit,
        v_total_credit,
        v_invoice.branch_id,
        true,
        NOW(),
        v_created_by,
        v_created_by,
        NOW()
    );

    v_lines_derived := true;

    -- JE Lines: Debit Inventory
    INSERT INTO public.journal_entry_lines (
        journal_entry_id,
        account_id,
        debit_amount,
        credit_amount,
        description
    ) VALUES (
        v_je_id,
        v_inventory_account_id,
        COALESCE(v_invoice.subtotal, 0),
        0,
        'مخزون - ' || v_invoice.invoice_number
    );

    -- JE Lines: Debit VAT (if any)
    IF COALESCE(v_invoice.tax_amount, 0) > 0 AND v_vat_account_id IS NOT NULL THEN
        INSERT INTO public.journal_entry_lines (
            journal_entry_id,
            account_id,
            debit_amount,
            credit_amount,
            description
        ) VALUES (
            v_je_id,
            v_vat_account_id,
            v_invoice.tax_amount,
            0,
            'ضريبة مدخلات - ' || v_invoice.invoice_number
        );
    END IF;

    -- JE Lines: Credit Payables
    INSERT INTO public.journal_entry_lines (
        journal_entry_id,
        account_id,
        debit_amount,
        credit_amount,
        description
    ) VALUES (
        v_je_id,
        v_payables_account_id,
        0,
        v_total_credit,
        'ذمم دائنة - ' || COALESCE(v_supplier.supplier_name, '') || ' - ' || v_invoice.invoice_number
    );

    -- Update invoice with JE link and posted status
    UPDATE public.invoices
    SET 
        journal_entry_id = v_je_id,
        status = CASE 
            WHEN paid_amount >= total_amount THEN 'paid'
            WHEN paid_amount > 0 THEN 'partial'
            ELSE 'posted'
        END,
        updated_at = NOW()
    WHERE id = v_invoice_id;

    -- Build result
    v_result := jsonb_build_object(
        'success', true,
        'invoiceId', v_invoice_id,
        'invoiceNumber', v_invoice.invoice_number,
        'journalEntryId', v_je_id,
        'journalEntryNumber', v_je_number,
        'linesDerived', v_lines_derived,
        'posted', true,
        'totals', jsonb_build_object(
            'debit', v_total_debit,
            'credit', v_total_credit
        ),
        'meta', jsonb_build_object(
            'workflowType', v_workflow_type,
            'clientRequestId', v_client_request_id,
            'payloadHash', v_payload_hash
        )
    );

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

-- Also fix line_number column issue (it doesn't exist in journal_entry_lines)
-- Remove line_number from create_atomic too if present