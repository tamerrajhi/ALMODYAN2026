-- RESTORE-PV-ATOMIC-CANONICAL: Restore payment_voucher_atomic to canonical contract
-- Fixes: Contract mismatch (snake_case), Schema (amount column), keeps Fix-P1

CREATE OR REPLACE FUNCTION public.payment_voucher_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  -- Idempotency
  v_client_request_id uuid;
  v_payload_hash text;
  v_begin jsonb;
  v_begin_status text;
  v_cached_result jsonb;
  
  -- Payment extraction (from nested payment object)
  v_payment jsonb;
  v_payment_type text;
  v_payment_date date;
  v_amount numeric;
  v_payment_method text;
  v_supplier_id uuid;
  v_customer_id uuid;
  v_invoice_id uuid;  -- kept NULL per allocations model
  v_branch_id uuid;
  v_notes text;
  v_status text;
  v_currency text;
  v_exchange_rate numeric;
  
  -- Journal extraction (from nested journal object)
  v_journal jsonb;
  v_entry_date date;
  v_description text;
  v_reference_type text;
  
  -- Hard block
  v_allow_unallocated boolean;
  v_allocations jsonb;
  
  -- Generated values
  v_payment_id uuid;
  v_payment_number text;
  v_journal_entry_id uuid;
  v_journal_number text;
  v_je_lines jsonb;
  
  -- Allocation processing
  v_alloc jsonb;
  v_alloc_invoice_id uuid;
  v_alloc_amount numeric;
  v_invoice_total_amount numeric;
  v_invoice_total_returned numeric;
  v_invoice_paid_amount numeric;
  v_canonical_remaining numeric;
  v_new_paid numeric;
  v_new_remaining numeric;
  v_new_status text;
  v_touched_invoices jsonb := '[]'::jsonb;
  
  -- Result
  v_result jsonb;
BEGIN
  -- ═══════════════════════════════════════════════════════════════
  -- A) CANONICAL CONTRACT: Extract from snake_case nested payload
  -- ═══════════════════════════════════════════════════════════════
  
  -- Client request ID (uuid)
  v_client_request_id := (p_payload->>'client_request_id')::uuid;
  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'client_request_id is required'
    );
  END IF;
  
  -- Payment object extraction
  v_payment := p_payload->'payment';
  IF v_payment IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'payment object is required'
    );
  END IF;
  
  v_payment_type := v_payment->>'payment_type';
  v_payment_date := COALESCE((v_payment->>'payment_date')::date, CURRENT_DATE);
  v_amount := COALESCE((v_payment->>'amount')::numeric, 0);
  v_payment_method := COALESCE(v_payment->>'payment_method', 'cash');
  v_supplier_id := (v_payment->>'supplier_id')::uuid;
  v_customer_id := (v_payment->>'customer_id')::uuid;
  v_invoice_id := NULL;  -- Always NULL per allocations model
  v_branch_id := (v_payment->>'branch_id')::uuid;
  v_notes := v_payment->>'notes';
  v_status := COALESCE(v_payment->>'status', 'posted');
  v_currency := COALESCE(v_payment->>'currency', 'SAR');
  v_exchange_rate := COALESCE((v_payment->>'exchange_rate')::numeric, 1);
  
  -- Journal object extraction
  v_journal := p_payload->'journal';
  IF v_journal IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'journal object is required'
    );
  END IF;
  
  v_entry_date := COALESCE((v_journal->>'entry_date')::date, v_payment_date);
  v_description := v_journal->>'description';
  v_reference_type := COALESCE(v_journal->>'reference_type', 'payment_voucher');
  
  -- Allocations array (at root level)
  v_allocations := p_payload->'allocations';
  v_allow_unallocated := COALESCE((p_payload->>'allow_unallocated')::boolean, false);
  
  -- ═══════════════════════════════════════════════════════════════
  -- C) SET-HB HARD BLOCK: Supplier payments require allocations
  -- ═══════════════════════════════════════════════════════════════
  IF v_payment_type = 'payment' AND v_supplier_id IS NOT NULL THEN
    IF (v_allocations IS NULL OR jsonb_array_length(v_allocations) = 0) AND NOT v_allow_unallocated THEN
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'HARD_BLOCK',
        'error', 'Supplier payments require invoice allocations (Hard Block active since 2026-01-19)'
      );
    END IF;
  END IF;
  
  -- ═══════════════════════════════════════════════════════════════
  -- B) CANONICAL IDEMPOTENCY
  -- ═══════════════════════════════════════════════════════════════
  v_payload_hash := public.stable_payload_hash(p_payload);
  v_begin := public.begin_workflow_request(v_client_request_id, 'payment_voucher_atomic', p_payload);
  v_begin_status := v_begin->>'status';
  
  -- Handle idempotency statuses
  IF v_begin_status = 'succeeded' THEN
    -- Return cached result
    SELECT result_payload INTO v_cached_result
    FROM public.pos_workflow_requests
    WHERE client_request_id = v_client_request_id::text
      AND workflow_type = 'payment_voucher_atomic';
    RETURN COALESCE(v_cached_result, jsonb_build_object(
      'success', true,
      'cached', true,
      'message', 'Previously completed'
    ));
  ELSIF v_begin_status = 'conflict' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'IDEMPOTENCY_CONFLICT',
      'error', 'Payload changed for existing request ID'
    );
  ELSIF v_begin_status = 'in_progress' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'IN_PROGRESS',
      'error', 'Request is currently being processed'
    );
  ELSIF v_begin_status NOT IN ('ok', 'retry') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'WORKFLOW_ERROR',
      'error', 'Unexpected workflow status: ' || v_begin_status
    );
  END IF;
  
  -- ═══════════════════════════════════════════════════════════════
  -- D) GAP-02: VALIDATE ALLOCATIONS (Canonical Remaining Formula)
  -- ═══════════════════════════════════════════════════════════════
  IF v_allocations IS NOT NULL AND jsonb_array_length(v_allocations) > 0 THEN
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(v_allocations)
    LOOP
      v_alloc_invoice_id := (v_alloc->>'invoice_id')::uuid;
      v_alloc_amount := (v_alloc->>'amount')::numeric;
      
      IF v_alloc_invoice_id IS NULL OR v_alloc_amount IS NULL OR v_alloc_amount <= 0 THEN
        PERFORM public.core_workflow_failed(
          v_client_request_id,
          'VALIDATION',
          'Invalid allocation: invoice_id and positive amount required'
        );
        RETURN jsonb_build_object(
          'success', false,
          'error_code', 'VALIDATION',
          'error', 'Invalid allocation: invoice_id and positive amount required'
        );
      END IF;
      
      -- Fetch invoice for validation (no lock yet, just validation)
      SELECT 
        COALESCE(total_amount, 0),
        COALESCE(total_returned_amount, 0),
        COALESCE(paid_amount, 0)
      INTO v_invoice_total_amount, v_invoice_total_returned, v_invoice_paid_amount
      FROM public.invoices
      WHERE id = v_alloc_invoice_id;
      
      IF NOT FOUND THEN
        PERFORM public.core_workflow_failed(
          v_client_request_id,
          'VALIDATION',
          'Invoice not found: ' || v_alloc_invoice_id::text
        );
        RETURN jsonb_build_object(
          'success', false,
          'error_code', 'VALIDATION',
          'error', 'Invoice not found: ' || v_alloc_invoice_id::text
        );
      END IF;
      
      -- GAP-02: Canonical remaining formula
      v_canonical_remaining := v_invoice_total_amount 
                             - v_invoice_total_returned 
                             - v_invoice_paid_amount;
      
      -- Validate allocation doesn't exceed remaining (with small tolerance)
      IF v_alloc_amount > v_canonical_remaining + 0.01 THEN
        PERFORM public.core_workflow_failed(
          v_client_request_id,
          'VALIDATION',
          format('Allocation %.2f exceeds remaining %.2f for invoice %s', 
                 v_alloc_amount, v_canonical_remaining, v_alloc_invoice_id::text)
        );
        RETURN jsonb_build_object(
          'success', false,
          'error_code', 'VALIDATION',
          'error', format('Allocation %.2f exceeds remaining %.2f for invoice %s', 
                         v_alloc_amount, v_canonical_remaining, v_alloc_invoice_id::text)
        );
      END IF;
    END LOOP;
  END IF;
  
  -- ═══════════════════════════════════════════════════════════════
  -- MAIN TRANSACTION BLOCK
  -- ═══════════════════════════════════════════════════════════════
  BEGIN
    -- Generate payment number
    SELECT public.generate_next_code('PV') INTO v_payment_number;
    
    -- Create payment record
    INSERT INTO public.payments (
      payment_number,
      payment_type,
      payment_date,
      amount,
      payment_method,
      supplier_id,
      customer_id,
      invoice_id,
      branch_id,
      notes,
      status,
      currency,
      exchange_rate,
      created_by
    ) VALUES (
      v_payment_number,
      v_payment_type,
      v_payment_date,
      v_amount,
      v_payment_method,
      v_supplier_id,
      v_customer_id,
      NULL,  -- Always NULL per allocations model
      v_branch_id,
      v_notes,
      v_status,
      v_currency,
      v_exchange_rate,
      auth.uid()
    ) RETURNING id INTO v_payment_id;
    
    -- Derive journal entry lines
    v_je_lines := public.derive_payment_voucher_lines(
      v_payment_type,
      v_supplier_id,
      v_customer_id,
      v_amount,
      v_branch_id
    );
    
    -- Generate journal entry number
    SELECT public.generate_next_code('JE') INTO v_journal_number;
    
    -- Create journal entry
    INSERT INTO public.journal_entries (
      entry_number,
      entry_date,
      description,
      reference_type,
      reference_id,
      status,
      total_debit,
      total_credit,
      created_by
    ) VALUES (
      v_journal_number,
      v_entry_date,
      COALESCE(v_description, v_payment_type || ' - ' || v_payment_number),
      v_reference_type,
      v_payment_id,
      'posted',
      v_amount,
      v_amount,
      auth.uid()
    ) RETURNING id INTO v_journal_entry_id;
    
    -- Insert journal entry lines
    INSERT INTO public.journal_entry_lines (
      journal_entry_id,
      account_id,
      debit_amount,
      credit_amount,
      description
    )
    SELECT
      v_journal_entry_id,
      (line->>'account_id')::uuid,
      COALESCE((line->>'debit_amount')::numeric, 0),
      COALESCE((line->>'credit_amount')::numeric, 0),
      line->>'description'
    FROM jsonb_array_elements(v_je_lines) AS line;
    
    -- Link payment to journal entry
    UPDATE public.payments
    SET journal_entry_id = v_journal_entry_id
    WHERE id = v_payment_id;
    
    -- ═══════════════════════════════════════════════════════════════
    -- F) ALLOCATIONS INSERT + UPDATE (with FOR UPDATE locking)
    -- ═══════════════════════════════════════════════════════════════
    IF v_allocations IS NOT NULL AND jsonb_array_length(v_allocations) > 0 THEN
      FOR v_alloc IN SELECT * FROM jsonb_array_elements(v_allocations)
      LOOP
        v_alloc_invoice_id := (v_alloc->>'invoice_id')::uuid;
        v_alloc_amount := (v_alloc->>'amount')::numeric;
        
        -- F) Insert allocation with correct column name "amount"
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
        
        -- E-2) FOR UPDATE: Lock invoice row for atomic update
        SELECT 
          COALESCE(total_amount, 0),
          COALESCE(total_returned_amount, 0),
          COALESCE(paid_amount, 0)
        INTO v_invoice_total_amount, v_invoice_total_returned, v_invoice_paid_amount
        FROM public.invoices
        WHERE id = v_alloc_invoice_id
        FOR UPDATE;
        
        -- D) GAP-02: Compute new values using canonical formula
        v_new_paid := v_invoice_paid_amount + v_alloc_amount;
        v_new_remaining := v_invoice_total_amount 
                         - v_invoice_total_returned 
                         - v_new_paid;
        
        -- Hard fail if new_remaining < -0.01 (no clamping)
        IF v_new_remaining < -0.01 THEN
          RAISE EXCEPTION 'Payment would result in negative remaining (%.2f) for invoice %', 
                          v_new_remaining, v_alloc_invoice_id;
        END IF;
        
        -- Determine new status
        IF v_new_remaining <= 0.01 THEN
          v_new_status := 'paid';
        ELSE
          v_new_status := 'partial';
        END IF;
        
        -- Update invoice
        UPDATE public.invoices
        SET 
          paid_amount = v_new_paid,
          remaining_amount = v_new_remaining,
          status = v_new_status,
          updated_at = now()
        WHERE id = v_alloc_invoice_id;
        
        -- E-3) touchedInvoices: Array append via jsonb_build_array
        v_touched_invoices := v_touched_invoices || jsonb_build_array(
          jsonb_build_object(
            'invoiceId', v_alloc_invoice_id,
            'allocatedAmount', v_alloc_amount,
            'newPaid', v_new_paid,
            'newRemaining', v_new_remaining,
            'newStatus', v_new_status
          )
        );
      END LOOP;
    END IF;
    
    -- Build success result
    v_result := jsonb_build_object(
      'success', true,
      'paymentId', v_payment_id,
      'paymentNumber', v_payment_number,
      'journalEntryId', v_journal_entry_id,
      'journalNumber', v_journal_number,
      'touchedInvoices', v_touched_invoices,
      'meta', jsonb_build_object(
        'workflowType', 'payment_voucher_atomic',
        'clientRequestId', v_client_request_id,
        'payloadHash', v_payload_hash
      )
    );
    
    -- E-1) core_workflow_success with 3 args
    PERFORM public.core_workflow_success(v_client_request_id, v_payment_id, v_result);
    
    RETURN v_result;
    
  EXCEPTION WHEN OTHERS THEN
    -- Log failure and re-raise
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
END;
$$;

-- Grants: authenticated only
REVOKE ALL ON FUNCTION public.payment_voucher_atomic(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payment_voucher_atomic(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.payment_voucher_atomic(jsonb) TO authenticated;

COMMENT ON FUNCTION public.payment_voucher_atomic(jsonb) IS 
'RESTORED: Canonical payment voucher atomic RPC.
Contract: snake_case nested (payment{}, journal{}, allocations[{invoice_id, amount}])
Includes: SET-HB hard block, GAP-02 canonical formula, Fix-P1 pack (3-arg success, FOR UPDATE, jsonb_build_array)';