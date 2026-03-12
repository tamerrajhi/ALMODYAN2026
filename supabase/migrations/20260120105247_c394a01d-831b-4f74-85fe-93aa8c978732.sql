-- FIX-P1: Payment Voucher Atomic - Bug Fixes
-- FIX-P1-01: core_workflow_success signature (3 args)
-- FIX-P1-02: FOR UPDATE locking in update loop
-- FIX-P1-03: touchedInvoices array append safety

CREATE OR REPLACE FUNCTION public.payment_voucher_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  -- Workflow management
  v_client_request_id text;
  v_workflow_status text;
  v_cached_result jsonb;
  v_payload_hash text;
  
  -- Payment fields
  v_payment_id uuid;
  v_payment_number text;
  v_payment_type text;
  v_party_type text;
  v_party_id uuid;
  v_amount numeric;
  v_payment_date date;
  v_payment_method text;
  v_reference_number text;
  v_notes text;
  v_branch_id uuid;
  v_created_by uuid;
  v_allow_unallocated boolean;
  
  -- Journal entry fields
  v_je_id uuid;
  v_je_number text;
  v_je_lines jsonb;
  
  -- Allocations
  v_allocations jsonb;
  v_alloc jsonb;
  v_alloc_invoice_id uuid;
  v_alloc_amount numeric;
  v_total_allocated numeric := 0;
  v_touched_invoices jsonb := '[]'::jsonb;
  
  -- Invoice validation
  v_invoice_supplier_id uuid;
  v_invoice_total_amount numeric;
  v_invoice_total_returned numeric;
  v_invoice_paid_amount numeric;
  v_canonical_remaining numeric;
  v_new_paid numeric;
  v_new_remaining numeric;
  v_new_status text;
  
  -- Result
  v_result jsonb;
BEGIN
  -- ============================================================
  -- 1. EXTRACT & VALIDATE PAYLOAD
  -- ============================================================
  v_client_request_id := p_payload->>'clientRequestId';
  IF v_client_request_id IS NULL OR v_client_request_id = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'clientRequestId is required'
    );
  END IF;
  
  -- Extract payment fields
  v_payment_type := COALESCE(p_payload->>'paymentType', 'payment');
  v_party_type := p_payload->>'partyType';
  v_party_id := (p_payload->>'partyId')::uuid;
  v_amount := (p_payload->>'amount')::numeric;
  v_payment_date := COALESCE((p_payload->>'paymentDate')::date, CURRENT_DATE);
  v_payment_method := COALESCE(p_payload->>'paymentMethod', 'cash');
  v_reference_number := p_payload->>'referenceNumber';
  v_notes := p_payload->>'notes';
  v_branch_id := (p_payload->>'branchId')::uuid;
  v_created_by := COALESCE((p_payload->>'createdBy')::uuid, auth.uid());
  v_allow_unallocated := COALESCE((p_payload->>'allowUnallocated')::boolean, false);
  
  -- Extract allocations and JE lines
  v_allocations := COALESCE(p_payload->'allocations', '[]'::jsonb);
  v_je_lines := p_payload->'journalLines';
  
  -- Basic validation
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'Amount must be positive'
    );
  END IF;
  
  IF v_party_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'Party ID is required'
    );
  END IF;
  
  -- ============================================================
  -- 2. IDEMPOTENCY CHECK via Workflow Ledger
  -- ============================================================
  v_payload_hash := md5(p_payload::text);
  
  SELECT status, result INTO v_workflow_status, v_cached_result
  FROM public.pos_workflow_requests
  WHERE client_request_id = v_client_request_id
    AND workflow_type = 'payment_voucher_atomic';
  
  IF v_workflow_status = 'succeeded' THEN
    RETURN v_cached_result;
  ELSIF v_workflow_status = 'processing' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'IN_PROGRESS',
      'error', 'Request is already being processed'
    );
  ELSIF v_workflow_status IS NOT NULL THEN
    -- Check for payload hash mismatch (idempotency conflict)
    IF v_cached_result->>'payload_hash' IS DISTINCT FROM v_payload_hash THEN
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'IDEMPOTENCY_CONFLICT',
        'error', 'Request ID reused with different payload'
      );
    END IF;
  END IF;
  
  -- Begin workflow
  SELECT status INTO v_workflow_status
  FROM public.begin_workflow_request(
    v_client_request_id,
    'payment_voucher_atomic',
    p_payload
  );
  
  IF v_workflow_status = 'succeeded' THEN
    SELECT result INTO v_cached_result
    FROM public.pos_workflow_requests
    WHERE client_request_id = v_client_request_id
      AND workflow_type = 'payment_voucher_atomic';
    RETURN v_cached_result;
  ELSIF v_workflow_status NOT IN ('ok', 'processing') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'WORKFLOW_ERROR',
      'error', 'Failed to begin workflow: ' || COALESCE(v_workflow_status, 'unknown')
    );
  END IF;
  
  -- ============================================================
  -- 3. HARD BLOCK: Supplier payments MUST have allocations
  -- ============================================================
  IF v_party_type = 'supplier' 
     AND jsonb_array_length(v_allocations) = 0 
     AND NOT v_allow_unallocated THEN
    PERFORM public.core_workflow_failed(
      v_client_request_id,
      'VALIDATION',
      'Supplier payments require invoice allocations'
    );
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'سندات صرف الموردين تتطلب توزيع على فواتير'
    );
  END IF;
  
  -- ============================================================
  -- 4. VALIDATE ALLOCATIONS (if any)
  -- ============================================================
  IF jsonb_array_length(v_allocations) > 0 THEN
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(v_allocations)
    LOOP
      v_alloc_invoice_id := (v_alloc->>'invoiceId')::uuid;
      v_alloc_amount := (v_alloc->>'amount')::numeric;
      
      IF v_alloc_invoice_id IS NULL OR v_alloc_amount IS NULL OR v_alloc_amount <= 0 THEN
        PERFORM public.core_workflow_failed(
          v_client_request_id,
          'VALIDATION',
          'Invalid allocation entry'
        );
        RETURN jsonb_build_object(
          'success', false,
          'error_code', 'VALIDATION',
          'error', 'بيانات التوزيع غير صالحة'
        );
      END IF;
      
      -- Lock and validate invoice
      SELECT 
        supplier_id,
        COALESCE(total_amount, 0),
        COALESCE(total_returned_amount, 0),
        COALESCE(paid_amount, 0)
      INTO 
        v_invoice_supplier_id,
        v_invoice_total_amount,
        v_invoice_total_returned,
        v_invoice_paid_amount
      FROM public.invoices
      WHERE id = v_alloc_invoice_id
      FOR UPDATE;
      
      IF NOT FOUND THEN
        PERFORM public.core_workflow_failed(
          v_client_request_id,
          'VALIDATION',
          'Invoice not found: ' || v_alloc_invoice_id::text
        );
        RETURN jsonb_build_object(
          'success', false,
          'error_code', 'VALIDATION',
          'error', 'الفاتورة غير موجودة: ' || v_alloc_invoice_id::text
        );
      END IF;
      
      -- Verify supplier match
      IF v_party_type = 'supplier' AND v_invoice_supplier_id IS DISTINCT FROM v_party_id THEN
        PERFORM public.core_workflow_failed(
          v_client_request_id,
          'VALIDATION',
          'Invoice supplier mismatch'
        );
        RETURN jsonb_build_object(
          'success', false,
          'error_code', 'VALIDATION',
          'error', 'المورد في الفاتورة لا يطابق المورد المحدد'
        );
      END IF;
      
      -- Compute canonical remaining and validate allocation doesn't exceed it
      v_canonical_remaining := COALESCE(v_invoice_total_amount, 0) 
                             - v_invoice_total_returned 
                             - v_invoice_paid_amount;
      
      IF v_alloc_amount > v_canonical_remaining + 0.01 THEN
        PERFORM public.core_workflow_failed(
          v_client_request_id,
          'VALIDATION',
          'Allocation exceeds invoice remaining: ' || v_alloc_invoice_id::text
        );
        RETURN jsonb_build_object(
          'success', false,
          'error_code', 'VALIDATION',
          'error', 'مبلغ التوزيع يتجاوز المتبقي في الفاتورة: ' || v_alloc_invoice_id::text
        );
      END IF;
      
      v_total_allocated := v_total_allocated + v_alloc_amount;
    END LOOP;
    
    -- Validate total allocation matches payment amount
    IF ABS(v_total_allocated - v_amount) > 0.01 THEN
      PERFORM public.core_workflow_failed(
        v_client_request_id,
        'VALIDATION',
        'Total allocations do not match payment amount'
      );
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'VALIDATION',
        'error', 'مجموع التوزيعات لا يطابق مبلغ السداد'
      );
    END IF;
  END IF;
  
  -- ============================================================
  -- 5. GENERATE PAYMENT NUMBER
  -- ============================================================
  IF v_payment_type = 'receipt' THEN
    SELECT public.generate_next_code('receipt_voucher') INTO v_payment_number;
  ELSE
    SELECT public.generate_next_code('payment_voucher') INTO v_payment_number;
  END IF;
  
  -- ============================================================
  -- 6. DERIVE JOURNAL LINES (if not provided)
  -- ============================================================
  IF v_je_lines IS NULL OR jsonb_array_length(v_je_lines) = 0 THEN
    SELECT public.derive_payment_voucher_lines(
      v_payment_type,
      v_party_type,
      v_party_id,
      v_amount,
      v_payment_method,
      v_branch_id
    ) INTO v_je_lines;
    
    IF v_je_lines IS NULL OR jsonb_array_length(v_je_lines) < 2 THEN
      PERFORM public.core_workflow_failed(
        v_client_request_id,
        'VALIDATION',
        'Failed to derive journal lines'
      );
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'VALIDATION',
        'error', 'فشل في اشتقاق القيود المحاسبية - تحقق من إعدادات الحسابات'
      );
    END IF;
  END IF;
  
  -- ============================================================
  -- 7. CREATE JOURNAL ENTRY
  -- ============================================================
  SELECT public.generate_next_code('journal_entry') INTO v_je_number;
  v_je_id := gen_random_uuid();
  
  INSERT INTO public.journal_entries (
    id,
    entry_number,
    entry_date,
    reference_type,
    reference_id,
    description,
    status,
    created_by,
    branch_id
  ) VALUES (
    v_je_id,
    v_je_number,
    v_payment_date,
    CASE WHEN v_payment_type = 'receipt' THEN 'receipt_voucher' ELSE 'payment_voucher' END,
    NULL, -- Will update after payment created
    CASE 
      WHEN v_payment_type = 'receipt' THEN 'سند قبض رقم ' || v_payment_number
      ELSE 'سند صرف رقم ' || v_payment_number
    END,
    'posted',
    v_created_by,
    v_branch_id
  );
  
  -- Insert journal entry lines
  INSERT INTO public.journal_entry_lines (
    journal_entry_id,
    account_id,
    debit_amount,
    credit_amount,
    description,
    cost_center_id
  )
  SELECT 
    v_je_id,
    (line->>'accountId')::uuid,
    COALESCE((line->>'debit')::numeric, 0),
    COALESCE((line->>'credit')::numeric, 0),
    line->>'description',
    (line->>'costCenterId')::uuid
  FROM jsonb_array_elements(v_je_lines) AS line;
  
  -- ============================================================
  -- 8. CREATE PAYMENT RECORD
  -- ============================================================
  v_payment_id := gen_random_uuid();
  
  INSERT INTO public.payments (
    id,
    payment_number,
    payment_type,
    payment_date,
    amount,
    payment_method,
    supplier_id,
    customer_id,
    reference_number,
    notes,
    status,
    journal_entry_id,
    branch_id,
    created_by
  ) VALUES (
    v_payment_id,
    v_payment_number,
    v_payment_type,
    v_payment_date,
    v_amount,
    v_payment_method,
    CASE WHEN v_party_type = 'supplier' THEN v_party_id ELSE NULL END,
    CASE WHEN v_party_type = 'customer' THEN v_party_id ELSE NULL END,
    v_reference_number,
    v_notes,
    'posted',
    v_je_id,
    v_branch_id,
    v_created_by
  );
  
  -- Update JE reference
  UPDATE public.journal_entries
  SET reference_id = v_payment_id
  WHERE id = v_je_id;
  
  -- ============================================================
  -- 9. PROCESS ALLOCATIONS & UPDATE INVOICES
  -- ============================================================
  IF jsonb_array_length(v_allocations) > 0 THEN
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(v_allocations)
    LOOP
      v_alloc_invoice_id := (v_alloc->>'invoiceId')::uuid;
      v_alloc_amount := (v_alloc->>'amount')::numeric;
      
      -- Create allocation record
      INSERT INTO public.supplier_payment_allocations (
        payment_id,
        invoice_id,
        allocated_amount,
        created_at
      ) VALUES (
        v_payment_id,
        v_alloc_invoice_id,
        v_alloc_amount,
        now()
      );
      
      -- FIX-P1-02: Lock invoice row with FOR UPDATE before updating
      SELECT 
        COALESCE(total_amount, 0),
        COALESCE(total_returned_amount, 0),
        COALESCE(paid_amount, 0)
      INTO 
        v_invoice_total_amount,
        v_invoice_total_returned,
        v_invoice_paid_amount
      FROM public.invoices
      WHERE id = v_alloc_invoice_id
      FOR UPDATE;
      
      -- Compute new values using canonical formula (NO CLAMPING)
      v_new_paid := v_invoice_paid_amount + v_alloc_amount;
      v_new_remaining := COALESCE(v_invoice_total_amount, 0) 
                       - v_invoice_total_returned 
                       - v_new_paid;
      
      -- Validation guard: prevent negative remaining
      IF v_new_remaining < -0.01 THEN
        PERFORM public.core_workflow_failed(
          v_client_request_id,
          'VALIDATION',
          'Payment allocations exceed invoice allowable balance (consider returns). Invoice: ' || v_alloc_invoice_id::text
        );
        RETURN jsonb_build_object(
          'success', false,
          'error_code', 'VALIDATION',
          'error', 'توزيعات السداد تتجاوز الرصيد المسموح للفاتورة (مع مراعاة المرتجعات).'
        );
      END IF;
      
      -- Determine new status
      IF v_new_remaining <= 0.01 THEN
        v_new_status := 'paid';
      ELSIF v_new_paid > 0.01 THEN
        v_new_status := 'partial';
      ELSE
        v_new_status := 'posted';
      END IF;
      
      -- Update invoice with canonical values (NO GREATEST clamping)
      UPDATE public.invoices
      SET 
        paid_amount = v_new_paid,
        remaining_amount = v_new_remaining,
        status = v_new_status,
        updated_at = now()
      WHERE id = v_alloc_invoice_id;
      
      -- FIX-P1-03: Use jsonb_build_array for proper array concatenation
      v_touched_invoices := v_touched_invoices || jsonb_build_array(
        jsonb_build_object(
          'invoiceId', v_alloc_invoice_id,
          'allocatedAmount', v_alloc_amount,
          'newPaidAmount', v_new_paid,
          'newRemainingAmount', v_new_remaining,
          'newStatus', v_new_status
        )
      );
    END LOOP;
  END IF;
  
  -- ============================================================
  -- 10. BUILD RESULT & COMPLETE WORKFLOW
  -- ============================================================
  v_result := jsonb_build_object(
    'success', true,
    'paymentId', v_payment_id,
    'paymentNumber', v_payment_number,
    'journalEntryId', v_je_id,
    'journalEntryNumber', v_je_number,
    'touchedInvoices', v_touched_invoices,
    'meta', jsonb_build_object(
      'workflowType', 'payment_voucher_atomic',
      'clientRequestId', v_client_request_id,
      'payloadHash', v_payload_hash
    )
  );
  
  -- FIX-P1-01: core_workflow_success requires 3 arguments (request_id, entity_id, result)
  PERFORM public.core_workflow_success(v_client_request_id, v_payment_id, v_result);
  
  RETURN v_result;
  
EXCEPTION WHEN OTHERS THEN
  PERFORM public.core_workflow_failed(
    v_client_request_id,
    'DB_ERROR',
    SQLERRM
  );
  RETURN jsonb_build_object(
    'success', false,
    'error_code', 'DB_ERROR',
    'error', SQLERRM
  );
END;
$function$;

-- Ensure grants remain restricted
REVOKE ALL ON FUNCTION public.payment_voucher_atomic(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payment_voucher_atomic(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.payment_voucher_atomic(jsonb) TO authenticated;

COMMENT ON FUNCTION public.payment_voucher_atomic IS 'FIX-P1: Corrected core_workflow_success signature, added FOR UPDATE locking, fixed array concatenation';