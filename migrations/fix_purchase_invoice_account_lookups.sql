-- FIX-PURCH-INVOICE-LOOKUPS
-- Fix hardcoded wrong account codes in purchase_invoice_create_atomic:
--   Inventory: '1130','1137','1103' (non-existent) → branch-specific '<code>-1301' then fallback '1301'
--   Supplier AP: '2110','21010001','2100' (2110 is VAT Output!) → branch-specific '<code>-2101' then fallback '2101','2100'
-- DB ONLY — no schema changes, no routes, no UI.

CREATE OR REPLACE FUNCTION public.purchase_invoice_create_atomic(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_client_request_id UUID;
    v_workflow_type TEXT := 'purchase_invoice_create_atomic';
    v_idempotency_check jsonb;
    v_invoice_id UUID;
    v_invoice_number TEXT;
    v_supplier_id UUID;
    v_branch_id UUID;
    v_invoice_date DATE;
    v_due_date DATE;
    v_notes TEXT;
    v_supplier_invoice_no TEXT;
    v_created_by UUID;
    v_subtotal NUMERIC := 0;
    v_tax_amount NUMERIC := 0;
    v_total_amount NUMERIC := 0;
    v_items jsonb;
    v_item jsonb;
    v_line_qty NUMERIC;
    v_line_unit_price NUMERIC;
    v_line_total NUMERIC;
    v_result jsonb;
    v_je_id UUID;
    v_je_number TEXT;
    v_supplier_account_id UUID;
    v_inventory_account_id UUID;
    v_supplier_name TEXT;
    v_existing_invoice_id UUID;
    v_branch_code TEXT;  -- NEW: for branch-specific account lookup
BEGIN
    -- Extract and validate client_request_id
    v_client_request_id := (p_payload->>'client_request_id')::UUID;
    IF v_client_request_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'client_request_id is required');
    END IF;

    -- Idempotency check
    v_idempotency_check := begin_workflow_request(v_client_request_id::TEXT, v_workflow_type, p_payload);
    
    IF (v_idempotency_check->>'status') = 'succeeded' THEN
        RETURN jsonb_build_object('success', true, 'cached', true, 'invoiceId', v_idempotency_check->'result_payload'->>'invoiceId', 'invoiceNumber', v_idempotency_check->'result_payload'->>'invoiceNumber', 'journalEntryId', v_idempotency_check->'result_payload'->>'journalEntryId');
    END IF;
    IF (v_idempotency_check->>'status') = 'conflict' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'IDEMPOTENCY_CONFLICT', 'error', 'Same request ID used with different payload');
    END IF;
    IF (v_idempotency_check->>'status') = 'in_progress' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'IN_PROGRESS', 'error', 'Request already in progress');
    END IF;

    -- Extract basic fields
    v_supplier_id := (p_payload->'invoice'->>'supplier_id')::UUID;
    v_branch_id := (p_payload->'invoice'->>'branch_id')::UUID;
    v_invoice_date := COALESCE((p_payload->'invoice'->>'invoice_date')::DATE, CURRENT_DATE);
    v_due_date := COALESCE((p_payload->'invoice'->>'due_date')::DATE, v_invoice_date);
    v_notes := p_payload->'invoice'->>'notes';
    v_created_by := (p_payload->>'created_by_id')::UUID;
    v_items := p_payload->'items';

    -- ==========================================
    -- SUPP INV NORMALIZATION AND VALIDATION
    -- ==========================================
    v_supplier_invoice_no := upper(trim(p_payload->'invoice'->>'supplier_invoice_no'));

    -- REQUIRED validation: SUPP INV cannot be empty
    IF v_supplier_invoice_no IS NULL OR v_supplier_invoice_no = '' THEN
        PERFORM core_workflow_failed(v_client_request_id::TEXT, 'SUPP_INV_REQUIRED', 'Supplier invoice number is required');
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'SUPP_INV_REQUIRED',
            'message_ar', 'مرفوض: رقم فاتورة المورد (SUPP INV) مطلوب'
        );
    END IF;

    -- DUPLICATE validation: Check if SUPP INV already exists for same supplier (non-voided purchase invoices)
    SELECT id INTO v_existing_invoice_id
    FROM public.invoices
    WHERE invoice_type = 'purchase'
      AND supplier_id = v_supplier_id
      AND upper(trim(supplier_invoice_no)) = v_supplier_invoice_no
      AND status <> 'voided'
    LIMIT 1;

    IF v_existing_invoice_id IS NOT NULL THEN
        PERFORM core_workflow_failed(v_client_request_id::TEXT, 'SUPP_INV_DUPLICATE', 'Supplier invoice number already exists for this supplier');
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'SUPP_INV_DUPLICATE',
            'message_ar', 'مرفوض: رقم فاتورة المورد (SUPP INV) مكرر لنفس المورد — موجود بالفعل في النظام'
        );
    END IF;
    -- ==========================================

    -- Validate supplier_id
    IF v_supplier_id IS NULL THEN
        PERFORM core_workflow_failed(v_client_request_id::TEXT, 'VALIDATION', 'supplier_id is required');
        RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'supplier_id is required');
    END IF;

    -- Validate items
    IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
        PERFORM core_workflow_failed(v_client_request_id::TEXT, 'VALIDATION', 'At least one item is required');
        RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'At least one item is required');
    END IF;

    -- ==========================================
    -- FIXED: Account lookups — branch-specific first, then global fallback
    -- ==========================================

    -- Resolve branch code for branch-specific account lookup
    SELECT COALESCE(code::text, '') INTO v_branch_code
    FROM branches WHERE id = v_branch_id;

    -- Lookup supplier name
    SELECT name INTO v_supplier_name FROM suppliers WHERE id = v_supplier_id;

    -- Inventory account: branch-specific first, then global fallback
    SELECT id INTO v_inventory_account_id
    FROM chart_of_accounts
    WHERE account_code IN ((v_branch_code || '-1301'), '1301')
    ORDER BY CASE WHEN account_code = (v_branch_code || '-1301') THEN 0 ELSE 1 END
    LIMIT 1;

    -- Supplier AP account: branch-specific first, then global fallback
    SELECT id INTO v_supplier_account_id
    FROM chart_of_accounts
    WHERE account_code IN ((v_branch_code || '-2101'), '2101', '2100')
    ORDER BY CASE
      WHEN account_code = (v_branch_code || '-2101') THEN 0
      WHEN account_code = '2101' THEN 1
      ELSE 2
    END
    LIMIT 1;

    IF v_inventory_account_id IS NULL THEN
        PERFORM core_workflow_failed(v_client_request_id::TEXT, 'CONFIG_ERROR', 'Inventory account not found');
        RETURN jsonb_build_object('success', false, 'error_code', 'CONFIG_ERROR', 'error', 'حساب المخزون غير موجود — تأكد من وجود كود 1301 في دليل الحسابات', 'message_ar', 'حساب المخزون غير موجود — تأكد من وجود كود 1301 في دليل الحسابات');
    END IF;
    IF v_supplier_account_id IS NULL THEN
        PERFORM core_workflow_failed(v_client_request_id::TEXT, 'CONFIG_ERROR', 'Supplier AP account not found');
        RETURN jsonb_build_object('success', false, 'error_code', 'CONFIG_ERROR', 'error', 'حساب الذمم الدائنة للموردين غير موجود — تأكد من وجود كود 2101 في دليل الحسابات', 'message_ar', 'حساب الذمم الدائنة للموردين غير موجود — تأكد من وجود كود 2101 في دليل الحسابات');
    END IF;

    -- Generate invoice number and ID
    v_invoice_number := generate_purchase_invoice_number_atomic();
    v_invoice_id := gen_random_uuid();

    -- Calculate totals
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
        v_line_qty := COALESCE((v_item->>'qty')::NUMERIC, (v_item->>'quantity')::NUMERIC, 1);
        v_line_unit_price := COALESCE((v_item->>'unit_cost')::NUMERIC, (v_item->>'unit_price')::NUMERIC, 0);
        v_line_total := v_line_qty * v_line_unit_price;
        v_subtotal := v_subtotal + v_line_total;
    END LOOP;
    v_tax_amount := v_subtotal * 0.15;
    v_total_amount := v_subtotal + v_tax_amount;

    -- Create journal entry
    v_je_id := gen_random_uuid();
    v_je_number := generate_journal_entry_number();

    INSERT INTO journal_entries (id, entry_number, entry_date, description, reference_type, reference_id, is_posted, total_debit, total_credit, branch_id, created_by, created_at)
    VALUES (v_je_id, v_je_number, v_invoice_date, 'Purchase Invoice ' || v_invoice_number || ' - ' || COALESCE(v_supplier_name, 'Supplier'), 'purchase_invoice', v_invoice_id, true, v_total_amount, v_total_amount, v_branch_id, v_created_by, NOW());

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_inventory_account_id, v_subtotal, 0, 'Inventory - ' || v_invoice_number);

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_supplier_account_id, 0, v_total_amount, 'Supplier AP - ' || v_invoice_number);

    -- Insert invoice with NORMALIZED supplier_invoice_no
    INSERT INTO public.invoices (id, invoice_number, invoice_type, supplier_id, branch_id, invoice_date, due_date, notes, supplier_invoice_no, subtotal, tax_amount, total_amount, status, journal_entry_id, created_by, created_at)
    VALUES (v_invoice_id, v_invoice_number, 'purchase', v_supplier_id, v_branch_id, v_invoice_date, v_due_date, v_notes, v_supplier_invoice_no, v_subtotal, v_tax_amount, v_total_amount, 'posted', v_je_id, v_created_by, NOW());

    -- Insert invoice lines
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
        v_line_qty := COALESCE((v_item->>'qty')::NUMERIC, (v_item->>'quantity')::NUMERIC, 1);
        v_line_unit_price := COALESCE((v_item->>'unit_cost')::NUMERIC, (v_item->>'unit_price')::NUMERIC, 0);
        v_line_total := v_line_qty * v_line_unit_price;

        INSERT INTO public.purchase_invoice_lines (invoice_id, item_id, description, quantity, unit_price, total_price)
        VALUES (v_invoice_id, (v_item->>'item_id')::UUID, COALESCE(v_item->>'description', 'Item'), v_line_qty::INTEGER, v_line_unit_price, v_line_total);
    END LOOP;

    -- Build result
    v_result := jsonb_build_object('success', true, 'invoiceId', v_invoice_id, 'invoiceNumber', v_invoice_number, 'supplierInvoiceNo', v_supplier_invoice_no, 'journalEntryId', v_je_id, 'journalEntryNumber', v_je_number, 'status', 'posted', 'totals', jsonb_build_object('subtotal', v_subtotal, 'taxAmount', v_tax_amount, 'totalAmount', v_total_amount), 'itemsCount', jsonb_array_length(v_items));

    PERFORM core_workflow_success(v_client_request_id::TEXT, v_invoice_id, v_result);
    RETURN v_result;

EXCEPTION WHEN OTHERS THEN
    PERFORM core_workflow_failed(v_client_request_id::TEXT, 'DB_ERROR', SQLERRM);
    RETURN jsonb_build_object('success', false, 'error_code', 'DB_ERROR', 'error', SQLERRM);
END;
$function$;
