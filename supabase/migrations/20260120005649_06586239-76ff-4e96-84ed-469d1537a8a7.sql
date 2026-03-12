-- ============================================================
-- Phase 1: Update payment_voucher_atomic with Canonical Formula
-- Changes:
--   1. Validation loop: Use canonical remaining = total - returned - paid
--   2. Update loop: Use canonical formula (no GREATEST clamping)
--   3. Add validation guard: Fail if new_remaining < -0.01
-- ============================================================

CREATE OR REPLACE FUNCTION public.payment_voucher_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_client_request_id uuid;
  v_requested_by uuid;
  v_created_by text;
  v_workflow_status text;
  v_begin jsonb;
  v_payload_hash text;
  
  -- Payment fields
  v_payment_id uuid;
  v_payment_number text;
  v_payment_type text;
  v_payment_date date;
  v_amount numeric;
  v_payment_method text;
  v_supplier_id uuid;
  v_customer_id uuid;
  v_invoice_id uuid;
  v_bank_account text;
  v_check_number text;
  v_currency text;
  v_exchange_rate numeric;
  v_branch_id uuid;
  v_notes text;
  v_status text;
  
  -- SET-HB: Allow unallocated flag
  v_allow_unallocated boolean;
  
  -- Journal fields
  v_journal_entry_id uuid;
  v_journal_entry_number text;
  v_entry_date date;
  v_journal_description text;
  v_reference_type text;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  
  -- Lines
  v_lines jsonb;
  v_line jsonb;
  v_lines_derived boolean := false;
  
  -- SET-1: Allocations support
  v_allocations jsonb;
  v_alloc jsonb;
  v_alloc_invoice_id uuid;
  v_alloc_amount numeric;
  v_allocated_total numeric := 0;
  v_allocations_count integer := 0;
  v_touched_invoices jsonb := '[]'::jsonb;
  v_invoice_supplier_id uuid;
  v_invoice_remaining numeric;
  v_new_paid numeric;
  v_new_remaining numeric;
  v_new_status text;
  
  -- GAP-02: Canonical remaining calculation variables
  v_invoice_total_amount numeric;
  v_invoice_total_returned numeric;
  v_invoice_paid_amount numeric;
  v_canonical_remaining numeric;
  
  v_result jsonb;
BEGIN
  -- ====================
  -- PARSE PAYLOAD
  -- ====================
  v_client_request_id := NULLIF(p_payload->>'client_request_id', '')::uuid;
  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'client_request_id is required'
    );
  END IF;
  
  v_requested_by := NULLIF(p_payload->>'requested_by', '')::uuid;
  v_created_by := p_payload->>'created_by';
  
  -- ====================
  -- CANONICAL IDEMPOTENCY
  -- ====================
  v_payload_hash := public.stable_payload_hash(p_payload);
  v_begin := public.begin_workflow_request(v_client_request_id, 'payment_voucher_atomic', p_payload);
  v_workflow_status := v_begin->>'status';
  
  IF v_workflow_status = 'succeeded' THEN
    RETURN v_begin->'cached_result';
  ELSIF v_workflow_status = 'conflict' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'IDEMPOTENCY_CONFLICT',
      'error', 'Same client_request_id used with different payload'
    );
  ELSIF v_workflow_status = 'in_progress' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'IN_PROGRESS',
      'error', 'Request is already being processed'
    );
  END IF;
  -- Continue for 'ok' or 'retry'
  
  -- ====================
  -- EXTRACT PAYMENT FIELDS
  -- ====================
  v_payment_type := p_payload->'payment'->>'payment_type';
  v_payment_date := COALESCE((p_payload->'payment'->>'payment_date')::date, CURRENT_DATE);
  v_amount := (p_payload->'payment'->>'amount')::numeric;
  v_payment_method := COALESCE(p_payload->'payment'->>'payment_method', 'cash');
  v_supplier_id := NULLIF(p_payload->'payment'->>'supplier_id', '')::uuid;
  v_customer_id := NULLIF(p_payload->'payment'->>'customer_id', '')::uuid;
  v_invoice_id := NULLIF(p_payload->'payment'->>'invoice_id', '')::uuid;
  v_bank_account := p_payload->'payment'->>'bank_account';
  v_check_number := p_payload->'payment'->>'check_number';
  v_currency := COALESCE(p_payload->'payment'->>'currency', 'SAR');
  v_exchange_rate := COALESCE((p_payload->'payment'->>'exchange_rate')::numeric, 1);
  v_branch_id := NULLIF(p_payload->'payment'->>'branch_id', '')::uuid;
  v_notes := p_payload->'payment'->>'notes';
  v_status := COALESCE(p_payload->'payment'->>'status', 'posted');
  
  -- SET-1: Extract allocations array
  v_allocations := p_payload->'allocations';
  
  -- SET-HB: Extract allow_unallocated flag (admin escape hatch)
  v_allow_unallocated := COALESCE((p_payload->>'allow_unallocated')::boolean, false);
  
  -- ====================
  -- EXTRACT JOURNAL FIELDS
  -- ====================
  v_entry_date := COALESCE((p_payload->'journal'->>'entry_date')::date, v_payment_date);
  v_journal_description := p_payload->'journal'->>'description';
  v_reference_type := COALESCE(p_payload->'journal'->>'reference_type', 'payment');
  v_lines := p_payload->'lines';
  
  -- ====================
  -- VALIDATIONS (basic)
  -- ====================
  IF v_payment_type IS NULL OR v_payment_type = '' THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'payment_type is required');
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'payment_type is required'
    );
  END IF;
  
  IF v_amount IS NULL OR v_amount <= 0 THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'amount must be > 0');
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'amount must be > 0'
    );
  END IF;
  
  -- ====================
  -- SET-HB: HARD BLOCK - Supplier payments require allocations
  -- ====================
  -- Only applies to supplier payments (payment_type='payment' AND supplier_id IS NOT NULL)
  -- Customer receipts (payment_type='receipt' OR customer_id IS NOT NULL) are NOT affected
  -- Exception: allow_unallocated=true (admin escape hatch for advance payments)
  IF v_payment_type = 'payment' AND v_supplier_id IS NOT NULL THEN
    IF (v_allocations IS NULL OR jsonb_array_length(v_allocations) = 0) THEN
      IF NOT v_allow_unallocated THEN
        PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'Supplier payments require allocations');
        RETURN jsonb_build_object(
          'success', false,
          'error_code', 'VALIDATION',
          'error', 'سند صرف المورد يتطلب توزيع على فواتير (allocations). لإنشاء دفعة مقدمة، يجب تفعيل خيار allow_unallocated.'
        );
      END IF;
    END IF;
  END IF;
  
  -- ====================
  -- SET-1: VALIDATE ALLOCATIONS (if provided)
  -- GAP-02: Use canonical remaining = total - returned - paid
  -- ====================
  IF v_allocations IS NOT NULL AND jsonb_array_length(v_allocations) > 0 THEN
    -- Validate each allocation
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(v_allocations)
    LOOP
      v_alloc_invoice_id := NULLIF(v_alloc->>'invoice_id', '')::uuid;
      v_alloc_amount := (v_alloc->>'amount')::numeric;
      
      -- Amount must be positive
      IF v_alloc_amount IS NULL OR v_alloc_amount <= 0 THEN
        PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'Allocation amount must be > 0');
        RETURN jsonb_build_object(
          'success', false,
          'error_code', 'VALIDATION',
          'error', 'مبلغ التوزيع يجب أن يكون أكبر من صفر'
        );
      END IF;
      
      -- Invoice must exist
      IF v_alloc_invoice_id IS NULL THEN
        PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'Allocation invoice_id is required');
        RETURN jsonb_build_object(
          'success', false,
          'error_code', 'VALIDATION',
          'error', 'معرف الفاتورة مطلوب في التوزيع'
        );
      END IF;
      
      -- Invoice must exist and lock row for update
      -- GAP-02: Fetch all fields needed for canonical calculation
      SELECT 
        supplier_id, 
        total_amount,
        COALESCE(total_returned_amount, 0),
        COALESCE(paid_amount, 0)
      INTO 
        v_invoice_supplier_id, 
        v_invoice_total_amount,
        v_invoice_total_returned,
        v_invoice_paid_amount
      FROM public.invoices 
      WHERE id = v_alloc_invoice_id
      FOR UPDATE; -- Lock the row
      
      IF v_invoice_supplier_id IS NULL THEN
        PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'Invoice not found: ' || v_alloc_invoice_id::text);
        RETURN jsonb_build_object(
          'success', false,
          'error_code', 'VALIDATION',
          'error', 'الفاتورة غير موجودة: ' || v_alloc_invoice_id::text
        );
      END IF;
      
      -- For supplier payments, verify supplier match
      IF v_payment_type = 'payment' AND v_supplier_id IS NOT NULL AND v_invoice_supplier_id != v_supplier_id THEN
        PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'Invoice supplier mismatch');
        RETURN jsonb_build_object(
          'success', false,
          'error_code', 'VALIDATION',
          'error', 'الفاتورة لا تنتمي لنفس المورد'
        );
      END IF;
      
      -- GAP-02: Compute canonical allowable remaining
      -- Formula: total - returned - paid
      v_canonical_remaining := COALESCE(v_invoice_total_amount, 0) 
                             - v_invoice_total_returned 
                             - v_invoice_paid_amount;
      
      -- Allocation should not exceed canonical remaining (allow small tolerance)
      IF v_alloc_amount > v_canonical_remaining + 0.01 THEN
        PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 
          'Allocation exceeds allowable remaining: ' || v_alloc_amount || ' > ' || v_canonical_remaining);
        RETURN jsonb_build_object(
          'success', false,
          'error_code', 'VALIDATION',
          'error', 'مبلغ التوزيع يتجاوز المتبقي للفاتورة (بعد احتساب المرتجعات): ' || v_alloc_amount || ' > ' || v_canonical_remaining
        );
      END IF;
      
      v_allocated_total := v_allocated_total + v_alloc_amount;
      v_allocations_count := v_allocations_count + 1;
    END LOOP;
    
    -- Total allocations must not exceed payment amount
    IF v_allocated_total > v_amount + 0.01 THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'Allocations total exceeds payment amount');
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'VALIDATION',
        'error', 'إجمالي التوزيعات يتجاوز مبلغ الدفعة'
      );
    END IF;
  END IF;
  
  -- ====================
  -- PV-3B: LINES DERIVATION (if not provided)
  -- ====================
  IF v_lines IS NULL OR jsonb_array_length(v_lines) = 0 THEN
    -- Derive lines from DB
    BEGIN
      v_lines := public.derive_payment_voucher_lines(p_payload->'payment');
      v_lines_derived := true;
    EXCEPTION WHEN OTHERS THEN
      -- Capture derivation error and fail workflow
      PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', SQLERRM);
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'VALIDATION',
        'error', SQLERRM
      );
    END;
    
    -- Final check after derivation
    IF v_lines IS NULL OR jsonb_array_length(v_lines) = 0 THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'Failed to derive journal lines');
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'VALIDATION',
        'error', 'Failed to derive journal lines - check account mappings'
      );
    END IF;
  END IF;
  
  -- ====================
  -- VALIDATE LINE TOTALS (whether provided or derived)
  -- ====================
  SELECT 
    COALESCE(SUM((line->>'debit_amount')::numeric), 0),
    COALESCE(SUM((line->>'credit_amount')::numeric), 0)
  INTO v_total_debit, v_total_credit
  FROM jsonb_array_elements(v_lines) AS line;
  
  IF v_total_debit <= 0 OR v_total_credit <= 0 THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'Both debit and credit totals must be > 0');
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'Both debit and credit totals must be > 0'
    );
  END IF;
  
  IF v_total_debit <> v_total_credit THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'Lines must be balanced: debit=' || v_total_debit || ' credit=' || v_total_credit);
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'القيود يجب أن تكون متوازنة: مدين=' || v_total_debit || ' دائن=' || v_total_credit
    );
  END IF;
  
  -- ====================
  -- GENERATE PAYMENT NUMBER
  -- ====================
  v_payment_number := public.generate_payment_voucher_number();
  IF v_payment_number IS NULL OR v_payment_number = '' THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'Failed to generate payment number');
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'فشل توليد رقم سند الصرف'
    );
  END IF;
  
  -- ====================
  -- CREATE PAYMENT RECORD
  -- ====================
  -- NOTE: invoice_id is kept NULL to favor the allocations model (SET-1)
  INSERT INTO public.payments (
    id,
    payment_number,
    payment_type,
    payment_date,
    amount,
    payment_method,
    supplier_id,
    customer_id,
    invoice_id,  -- NULL per SET-1 canonical model
    bank_account,
    check_number,
    currency,
    exchange_rate,
    branch_id,
    notes,
    status,
    created_by,
    created_at
  ) VALUES (
    gen_random_uuid(),
    v_payment_number,
    v_payment_type,
    v_payment_date,
    v_amount,
    v_payment_method,
    v_supplier_id,
    v_customer_id,
    NULL,  -- Always NULL per SET-1
    v_bank_account,
    v_check_number,
    v_currency,
    v_exchange_rate,
    v_branch_id,
    v_notes,
    v_status,
    v_created_by,
    now()
  )
  RETURNING id INTO v_payment_id;
  
  -- ====================
  -- SET-1: CREATE ALLOCATIONS AND UPDATE INVOICES
  -- GAP-02: Use canonical formula (no GREATEST clamping)
  -- ====================
  IF v_allocations IS NOT NULL AND jsonb_array_length(v_allocations) > 0 THEN
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(v_allocations)
    LOOP
      v_alloc_invoice_id := (v_alloc->>'invoice_id')::uuid;
      v_alloc_amount := (v_alloc->>'amount')::numeric;
      
      -- Insert allocation record
      INSERT INTO public.supplier_payment_allocations (
        payment_id,
        invoice_id,
        amount,
        created_at
      ) VALUES (
        v_payment_id,
        v_alloc_invoice_id,
        v_alloc_amount,
        now()
      );
      
      -- GAP-02: Fetch current invoice state for canonical calculation
      SELECT 
        total_amount,
        COALESCE(total_returned_amount, 0),
        COALESCE(paid_amount, 0)
      INTO 
        v_invoice_total_amount,
        v_invoice_total_returned,
        v_invoice_paid_amount
      FROM public.invoices 
      WHERE id = v_alloc_invoice_id;
      
      -- Compute new values using canonical formula
      v_new_paid := v_invoice_paid_amount + v_alloc_amount;
      v_new_remaining := COALESCE(v_invoice_total_amount, 0) 
                       - v_invoice_total_returned 
                       - v_new_paid;
      
      -- GAP-02: Validation guard - fail if new_remaining < -0.01
      -- This prevents creating inconsistent invoice states
      IF v_new_remaining < -0.01 THEN
        PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 
          'Payment allocations exceed invoice allowable balance (consider returns). Invoice: ' || v_alloc_invoice_id::text);
        RETURN jsonb_build_object(
          'success', false,
          'error_code', 'VALIDATION',
          'error', 'توزيعات السداد تتجاوز الرصيد المسموح للفاتورة (مع مراعاة المرتجعات).'
        );
      END IF;
      
      -- Determine new status based on remaining
      IF v_new_remaining <= 0.01 THEN
        v_new_status := 'paid';
      ELSIF v_new_paid > 0 THEN
        v_new_status := 'partial';
      ELSE
        v_new_status := 'posted';
      END IF;
      
      -- Update invoice with canonical values (no GREATEST clamping)
      UPDATE public.invoices
      SET 
        paid_amount = v_new_paid,
        remaining_amount = v_new_remaining,
        status = v_new_status,
        updated_at = now()
      WHERE id = v_alloc_invoice_id;
      
      -- Add to touched invoices result
      v_touched_invoices := v_touched_invoices || jsonb_build_object(
        'invoiceId', v_alloc_invoice_id,
        'allocatedAmount', v_alloc_amount,
        'newPaidAmount', v_new_paid,
        'newRemainingAmount', v_new_remaining,
        'newStatus', v_new_status
      );
    END LOOP;
  END IF;
  
  -- ====================
  -- GENERATE JOURNAL ENTRY NUMBER
  -- ====================
  v_journal_entry_number := public.generate_journal_entry_number(v_branch_id);
  IF v_journal_entry_number IS NULL OR v_journal_entry_number = '' THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'Failed to generate journal entry number');
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'فشل توليد رقم القيد'
    );
  END IF;
  
  -- ====================
  -- CREATE JOURNAL ENTRY
  -- ====================
  v_journal_description := COALESCE(v_journal_description, 
    CASE WHEN v_payment_type = 'receipt' THEN 'سند قبض' ELSE 'سند صرف' END || ' - ' || v_payment_number
  );
  
  INSERT INTO public.journal_entries (
    id,
    entry_number,
    entry_date,
    description,
    reference_type,
    reference_id,
    total_debit,
    total_credit,
    is_posted,
    is_balanced,
    created_by,
    branch_id,
    created_at
  ) VALUES (
    gen_random_uuid(),
    v_journal_entry_number,
    v_entry_date,
    v_journal_description,
    v_reference_type,
    v_payment_id,
    v_total_debit,
    v_total_credit,
    true,
    true,
    v_created_by,
    v_branch_id,
    now()
  )
  RETURNING id INTO v_journal_entry_id;
  
  -- ====================
  -- CREATE JOURNAL ENTRY LINES
  -- ====================
  INSERT INTO public.journal_entry_lines (
    journal_entry_id,
    account_id,
    debit_amount,
    credit_amount,
    description,
    created_at
  )
  SELECT
    v_journal_entry_id,
    (line->>'account_id')::uuid,
    COALESCE((line->>'debit_amount')::numeric, 0),
    COALESCE((line->>'credit_amount')::numeric, 0),
    line->>'description',
    now()
  FROM jsonb_array_elements(v_lines) AS line;
  
  -- ====================
  -- LINK PAYMENT TO JOURNAL ENTRY
  -- ====================
  UPDATE public.payments
  SET journal_entry_id = v_journal_entry_id
  WHERE id = v_payment_id;
  
  -- ====================
  -- SUCCESS
  -- ====================
  v_result := jsonb_build_object(
    'success', true,
    'paymentId', v_payment_id,
    'paymentNumber', v_payment_number,
    'journalEntryId', v_journal_entry_id,
    'journalEntryNumber', v_journal_entry_number,
    'linesDerived', v_lines_derived,
    'allocationsCount', v_allocations_count,
    'touchedInvoices', v_touched_invoices
  );
  
  PERFORM public.core_workflow_success(v_client_request_id, v_result);
  
  RETURN v_result;
END;
$$;

-- Ensure proper grants (already done in previous migration but confirm)
REVOKE ALL ON FUNCTION public.payment_voucher_atomic(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payment_voucher_atomic(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.payment_voucher_atomic(jsonb) TO authenticated;

-- Add comment documenting the canonical formula
COMMENT ON FUNCTION public.payment_voucher_atomic(jsonb) IS 
'Atomic payment voucher creation with canonical remaining formula: remaining = total - returned - paid. 
GAP-02 compliant. Does NOT clamp remaining to 0 - negative values are validation failures.
Tolerance: 0.01 SAR.';