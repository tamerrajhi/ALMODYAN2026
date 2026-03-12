-- SET-1: Extend payment_voucher_atomic to support allocations
-- This makes supplier_payment_allocations the source of truth for invoice paid/remaining amounts

-- Step 1: Ensure unique constraint on supplier_payment_allocations (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'supplier_payment_allocations_payment_invoice_unique'
  ) THEN
    ALTER TABLE public.supplier_payment_allocations
    ADD CONSTRAINT supplier_payment_allocations_payment_invoice_unique 
    UNIQUE (payment_id, invoice_id);
  END IF;
END $$;

-- Step 2: Create or replace the enhanced payment_voucher_atomic function
CREATE OR REPLACE FUNCTION public.payment_voucher_atomic(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
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
  -- SET-1: VALIDATE ALLOCATIONS (if provided)
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
      
      -- Invoice must exist and belong to the same supplier (for payment type)
      SELECT supplier_id, remaining_amount 
      INTO v_invoice_supplier_id, v_invoice_remaining
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
      
      -- Allocation should not exceed remaining (allow small tolerance)
      IF v_alloc_amount > v_invoice_remaining + 0.01 THEN
        PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'Allocation exceeds remaining: ' || v_alloc_amount || ' > ' || v_invoice_remaining);
        RETURN jsonb_build_object(
          'success', false,
          'error_code', 'VALIDATION',
          'error', 'مبلغ التوزيع يتجاوز المتبقي للفاتورة: ' || v_alloc_amount || ' > ' || v_invoice_remaining
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
      'error', 'Journal lines must be balanced (debit=' || v_total_debit || ', credit=' || v_total_credit || ')'
    );
  END IF;
  
  -- ====================
  -- GENERATE PAYMENT NUMBER (with advisory lock)
  -- ====================
  PERFORM pg_advisory_xact_lock(hashtext(v_payment_type || '-' || to_char(CURRENT_DATE, 'YYYYMMDD')));
  SELECT public.generate_payment_number(v_payment_type) INTO v_payment_number;
  
  -- ====================
  -- INSERT PAYMENT (invoice_id stays NULL - allocations are the source of truth)
  -- ====================
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
    invoice_id,
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
    v_payment_id,
    v_payment_number,
    v_payment_type,
    v_payment_date,
    v_amount,
    v_payment_method,
    v_supplier_id,
    v_customer_id,
    NULL, -- SET-1: Always NULL - allocations are source of truth
    v_bank_account,
    v_check_number,
    v_currency,
    v_exchange_rate,
    v_branch_id,
    v_notes,
    v_status,
    v_created_by,
    now()
  );
  
  -- ====================
  -- SET-1: INSERT ALLOCATIONS AND UPDATE INVOICES
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
        amount
      ) VALUES (
        v_payment_id,
        v_alloc_invoice_id,
        v_alloc_amount
      );
      
      -- Update invoice paid/remaining/status
      UPDATE public.invoices
      SET 
        paid_amount = COALESCE(paid_amount, 0) + v_alloc_amount,
        remaining_amount = GREATEST(0, COALESCE(remaining_amount, total_amount) - v_alloc_amount),
        status = CASE
          WHEN COALESCE(remaining_amount, total_amount) - v_alloc_amount <= 0.01 THEN 'paid'
          WHEN COALESCE(paid_amount, 0) + v_alloc_amount > 0 THEN 'partial'
          ELSE status
        END,
        updated_at = now()
      WHERE id = v_alloc_invoice_id
      RETURNING paid_amount, remaining_amount, status INTO v_new_paid, v_new_remaining, v_new_status;
      
      -- Track touched invoices for result
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
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'generate_journal_entry_number') THEN
    SELECT public.generate_journal_entry_number() INTO v_journal_entry_number;
  ELSE
    v_journal_entry_number := v_payment_number;
  END IF;
  
  -- ====================
  -- INSERT JOURNAL ENTRY
  -- ====================
  v_journal_entry_id := gen_random_uuid();
  
  INSERT INTO public.journal_entries (
    id,
    entry_number,
    entry_date,
    description,
    reference_type,
    reference_id,
    branch_id,
    created_by,
    created_at,
    is_posted,
    posted_at,
    posted_by,
    total_debit,
    total_credit
  ) VALUES (
    v_journal_entry_id,
    v_journal_entry_number,
    v_entry_date,
    COALESCE(v_journal_description, 'سند ' || CASE v_payment_type WHEN 'payment' THEN 'صرف' ELSE 'قبض' END || ' - ' || v_payment_number),
    v_reference_type,
    v_payment_id,
    v_branch_id,
    v_created_by,
    now(),
    true,
    now(),
    v_requested_by,
    v_total_debit,
    v_total_credit
  );
  
  -- ====================
  -- INSERT JOURNAL ENTRY LINES
  -- ====================
  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines)
  LOOP
    INSERT INTO public.journal_entry_lines (
      journal_entry_id,
      account_id,
      debit_amount,
      credit_amount,
      description
    ) VALUES (
      v_journal_entry_id,
      (v_line->>'account_id')::uuid,
      COALESCE((v_line->>'debit_amount')::numeric, 0),
      COALESCE((v_line->>'credit_amount')::numeric, 0),
      v_line->>'description'
    );
  END LOOP;
  
  -- ====================
  -- UPDATE PAYMENT WITH JOURNAL LINK
  -- ====================
  UPDATE public.payments
  SET journal_entry_id = v_journal_entry_id
  WHERE id = v_payment_id;
  
  -- ====================
  -- SUCCESS RESULT (with SET-1 allocations info)
  -- ====================
  v_result := jsonb_build_object(
    'success', true,
    'paymentId', v_payment_id,
    'paymentNumber', v_payment_number,
    'journalEntryId', v_journal_entry_id,
    'journalEntryNumber', v_journal_entry_number,
    'totalDebit', v_total_debit,
    'totalCredit', v_total_credit,
    'linesDerived', v_lines_derived,
    'allocatedTotal', v_allocated_total,
    'unallocatedRemainder', v_amount - v_allocated_total,
    'allocationsCount', v_allocations_count,
    'touchedInvoices', v_touched_invoices,
    'meta', jsonb_build_object(
      'workflowType', 'payment_voucher_atomic',
      'clientRequestId', v_client_request_id,
      'payloadHash', v_payload_hash
    )
  );
  
  -- Mark workflow as succeeded (correct signature: uuid, uuid, jsonb)
  PERFORM public.core_workflow_success(v_client_request_id, v_payment_id, v_result);
  
  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  -- Catch any unexpected errors
  PERFORM public.core_workflow_failed(v_client_request_id, 'DB_ERROR', SQLERRM);
  RETURN jsonb_build_object(
    'success', false,
    'error_code', 'DB_ERROR',
    'error', SQLERRM
  );
END;
$function$;

-- Step 3: Grant execution to authenticated role only
GRANT EXECUTE ON FUNCTION public.payment_voucher_atomic(jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.payment_voucher_atomic(jsonb) FROM anon;

-- Step 4: Add comments for documentation
COMMENT ON FUNCTION public.payment_voucher_atomic(jsonb) IS 
'SET-1 Enhanced: Atomic payment voucher creation with invoice allocations support.
Payload now accepts optional allocations[] array:
{
  "client_request_id": "uuid",
  "payment": { ... },
  "journal": { ... },
  "allocations": [
    {"invoice_id": "uuid", "amount": 100.00}
  ]
}
When allocations are provided:
1. Inserts into supplier_payment_allocations
2. Updates invoices.paid_amount and remaining_amount
3. Updates invoice status (paid/partial)
All within a single atomic transaction.';