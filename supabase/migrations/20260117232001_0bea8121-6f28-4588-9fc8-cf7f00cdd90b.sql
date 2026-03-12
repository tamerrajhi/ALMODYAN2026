-- ============================================================
-- PI-1: Purchase Invoice Atomic (Create/Post/Void)
-- Scope: Purchasing only. Follows canonical atomic RPC standard.
-- ============================================================

-- 1) Register workflow types for purchase invoice operations
INSERT INTO public.workflow_types (code, description, is_enabled)
VALUES 
  ('purchase_invoice_create_atomic', 'Atomic create purchase invoice with items', true),
  ('purchase_invoice_post_atomic', 'Atomic post purchase invoice with JE creation', true),
  ('purchase_invoice_void_atomic', 'Atomic void purchase invoice with JE reversal', true)
ON CONFLICT (code) DO UPDATE SET 
  description = EXCLUDED.description,
  is_enabled = true;

-- 2) Helper: Generate PI number with advisory lock
CREATE OR REPLACE FUNCTION public.generate_purchase_invoice_number_atomic()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    today_str TEXT;
    invoice_count INTEGER;
    lock_key BIGINT;
BEGIN
    today_str := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
    lock_key := ('x' || md5('PI-' || today_str))::bit(32)::int;
    
    PERFORM pg_advisory_xact_lock(lock_key);
    
    SELECT COUNT(*) + 1 INTO invoice_count
    FROM public.invoices
    WHERE invoice_number LIKE 'PI-' || today_str || '%'
    AND invoice_type = 'purchase';
    
    RETURN 'PI-' || today_str || '-' || LPAD(invoice_count::TEXT, 4, '0');
END;
$$;

-- 3) MAIN RPC: purchase_invoice_create_atomic
CREATE OR REPLACE FUNCTION public.purchase_invoice_create_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

    -- Insert invoice header (status = draft/pending)
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
        'pending', -- Draft status, not posted yet
        v_created_by,
        NOW()
    );

    -- Insert invoice lines
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
            v_line_tax_rate * 100, -- Store as percentage
            v_line_tax,
            v_line_total,
            COALESCE(v_item->>'item_type', 'jewelry'),
            (v_item->>'gl_account_id')::UUID,
            (v_item->>'cost_entry_id')::UUID,
            (v_item->>'warehouse_id')::UUID,
            v_item->>'line_notes'
        );
    END LOOP;

    -- Build result
    v_result := jsonb_build_object(
        'success', true,
        'invoiceId', v_invoice_id,
        'invoiceNumber', v_invoice_number,
        'status', 'pending',
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
$$;

-- 4) MAIN RPC: purchase_invoice_post_atomic
CREATE OR REPLACE FUNCTION public.purchase_invoice_post_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    WHERE account_code = '1310' OR account_name LIKE '%مخزون%' OR account_name_en LIKE '%Inventory%'
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

    -- Generate JE number
    v_je_id := gen_random_uuid();
    SELECT 'JE-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-' || LPAD((COUNT(*) + 1)::TEXT, 4, '0')
    INTO v_je_number
    FROM public.journal_entries
    WHERE entry_number LIKE 'JE-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '%';

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
        line_number,
        account_id,
        debit_amount,
        credit_amount,
        description
    ) VALUES (
        v_je_id,
        1,
        v_inventory_account_id,
        COALESCE(v_invoice.subtotal, 0),
        0,
        'مخزون - ' || v_invoice.invoice_number
    );

    -- JE Lines: Debit VAT (if any)
    IF COALESCE(v_invoice.tax_amount, 0) > 0 AND v_vat_account_id IS NOT NULL THEN
        INSERT INTO public.journal_entry_lines (
            journal_entry_id,
            line_number,
            account_id,
            debit_amount,
            credit_amount,
            description
        ) VALUES (
            v_je_id,
            2,
            v_vat_account_id,
            v_invoice.tax_amount,
            0,
            'ضريبة مدخلات - ' || v_invoice.invoice_number
        );
    END IF;

    -- JE Lines: Credit Payables
    INSERT INTO public.journal_entry_lines (
        journal_entry_id,
        line_number,
        account_id,
        debit_amount,
        credit_amount,
        description
    ) VALUES (
        v_je_id,
        CASE WHEN COALESCE(v_invoice.tax_amount, 0) > 0 AND v_vat_account_id IS NOT NULL THEN 3 ELSE 2 END,
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
$$;

-- 5) MAIN RPC: purchase_invoice_void_atomic
CREATE OR REPLACE FUNCTION public.purchase_invoice_void_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_client_request_id UUID;
    v_workflow_type TEXT := 'purchase_invoice_void_atomic';
    v_payload_hash TEXT;
    v_idempotency_check jsonb;
    v_invoice_id UUID;
    v_invoice RECORD;
    v_created_by TEXT;
    v_void_reason TEXT;
    v_void_date DATE;
    v_reversal_result jsonb;
    v_reversal_je_id UUID;
    v_reversal_je_number TEXT;
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
            'voided', true,
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

    -- Extract parameters
    v_invoice_id := (p_payload->>'invoice_id')::UUID;
    v_created_by := COALESCE(p_payload->>'created_by', 'system');
    v_void_reason := COALESCE(p_payload->>'void_reason', 'إلغاء');
    v_void_date := COALESCE((p_payload->>'void_date')::DATE, CURRENT_DATE);

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

    -- Check if already voided (idempotent return)
    IF v_invoice.status IN ('voided', 'cancelled') THEN
        v_result := jsonb_build_object(
            'success', true,
            'alreadyVoided', true,
            'invoiceId', v_invoice_id,
            'invoiceNumber', v_invoice.invoice_number,
            'voided', true
        );
        PERFORM core_workflow_success(v_client_request_id::TEXT, v_invoice_id, v_result);
        RETURN v_result;
    END IF;

    -- Check for payments
    IF COALESCE(v_invoice.paid_amount, 0) > 0 THEN
        PERFORM core_workflow_failed(v_client_request_id::TEXT, 'HAS_PAYMENTS', 'Invoice has payments');
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'HAS_PAYMENTS',
            'error', 'Cannot void invoice with payments. Reverse payments first or create a return.'
        );
    END IF;

    -- Reverse JE if exists
    IF v_invoice.journal_entry_id IS NOT NULL THEN
        v_reversal_result := reverse_journal_entry_atomic(
            v_invoice.journal_entry_id,
            v_invoice_id,
            'purchase_invoice_void',
            v_created_by,
            v_invoice.branch_id,
            'عكس قيد فاتورة: ' || v_invoice.invoice_number || ' - ' || v_void_reason
        );

        IF (v_reversal_result->>'success')::BOOLEAN THEN
            v_reversal_je_id := (v_reversal_result->>'reversalJournalEntryId')::UUID;
            v_reversal_je_number := v_reversal_result->>'reversalEntryNumber';
        END IF;
    END IF;

    -- Update invoice to voided
    UPDATE public.invoices
    SET 
        status = 'voided',
        notes = COALESCE(notes, '') || E'\n[ملغاة ' || v_void_date::TEXT || '] ' || v_void_reason,
        updated_at = NOW()
    WHERE id = v_invoice_id;

    -- Build result
    v_result := jsonb_build_object(
        'success', true,
        'invoiceId', v_invoice_id,
        'invoiceNumber', v_invoice.invoice_number,
        'voided', true,
        'voidReason', v_void_reason,
        'voidDate', v_void_date,
        'reversalJournalEntryId', v_reversal_je_id,
        'reversalEntryNumber', v_reversal_je_number,
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
$$;

-- 6) Grant permissions
GRANT EXECUTE ON FUNCTION public.purchase_invoice_create_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_invoice_create_atomic(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.purchase_invoice_post_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_invoice_post_atomic(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.purchase_invoice_void_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_invoice_void_atomic(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_purchase_invoice_number_atomic() TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_purchase_invoice_number_atomic() TO service_role;