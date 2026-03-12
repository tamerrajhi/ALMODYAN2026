-- =====================================================
-- PV-3 Stage-1: Canonical Restore for payment_voucher_atomic
-- Uses canonical workflow writers (no direct writes to atomic_workflow_requests)
-- =====================================================

-- Drop and recreate the function with canonical pattern
CREATE OR REPLACE FUNCTION public.payment_voucher_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_client_request_id text;
  v_payment_type text;
  v_payment_date date;
  v_amount numeric;
  v_payment_method text;
  v_supplier_id uuid;
  v_customer_id uuid;
  v_branch_id uuid;
  v_notes text;
  v_reference_number text;
  v_allow_unallocated boolean;
  v_allocations jsonb;
  
  v_payment_id uuid;
  v_payment_number text;
  v_je_id uuid;
  v_entry_number text;
  
  v_party_account_id uuid;
  v_cash_account_id uuid;
  
  v_workflow_result jsonb;
  v_result jsonb;
  v_alloc jsonb;
  v_invoice_id uuid;
  v_alloc_amount numeric;
BEGIN
  -- =====================================================
  -- 1. Extract payload fields
  -- =====================================================
  v_client_request_id := COALESCE(
    p_payload->>'client_request_id',
    p_payload->'payment'->>'client_request_id'
  );
  
  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'MISSING_CLIENT_REQUEST_ID',
      'error', 'client_request_id is required'
    );
  END IF;
  
  -- Extract from nested payment object or root level
  v_payment_type := COALESCE(
    p_payload->'payment'->>'payment_type',
    p_payload->>'payment_type',
    'payment'
  );
  v_payment_date := COALESCE(
    (p_payload->'payment'->>'payment_date')::date,
    (p_payload->>'payment_date')::date,
    CURRENT_DATE
  );
  v_amount := COALESCE(
    (p_payload->'payment'->>'amount')::numeric,
    (p_payload->>'amount')::numeric,
    0
  );
  v_payment_method := COALESCE(
    p_payload->'payment'->>'payment_method',
    p_payload->>'payment_method',
    'cash'
  );
  v_supplier_id := NULLIF(COALESCE(
    p_payload->'payment'->>'supplier_id',
    p_payload->>'supplier_id'
  ), '')::uuid;
  v_customer_id := NULLIF(COALESCE(
    p_payload->'payment'->>'customer_id',
    p_payload->>'customer_id'
  ), '')::uuid;
  v_branch_id := NULLIF(COALESCE(
    p_payload->'payment'->>'branch_id',
    p_payload->>'branch_id'
  ), '')::uuid;
  v_notes := COALESCE(
    p_payload->'payment'->>'notes',
    p_payload->>'notes'
  );
  v_reference_number := COALESCE(
    p_payload->'payment'->>'reference_number',
    p_payload->>'reference_number'
  );
  v_allow_unallocated := COALESCE(
    (p_payload->>'allow_unallocated')::boolean,
    false
  );
  v_allocations := COALESCE(p_payload->'allocations', '[]'::jsonb);

  -- =====================================================
  -- 2. Begin workflow request (canonical writer #1)
  -- =====================================================
  v_workflow_result := public.begin_workflow_request(
    v_client_request_id,
    'payment_voucher',
    p_payload
  );
  
  -- Check if already processed (idempotency)
  IF (v_workflow_result->>'status') = 'already_exists' THEN
    RETURN v_workflow_result->'cached_result';
  END IF;
  
  IF (v_workflow_result->>'status') != 'started' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', v_workflow_result->>'error_code',
      'error', v_workflow_result->>'error'
    );
  END IF;

  BEGIN
    -- =====================================================
    -- 3. Hard Block (SET_HB): Supplier payment without allocations
    -- =====================================================
    IF v_payment_type = 'payment' 
       AND v_supplier_id IS NOT NULL 
       AND jsonb_array_length(v_allocations) = 0 
       AND v_allow_unallocated = false 
    THEN
      PERFORM public.core_workflow_failed(
        v_client_request_id,
        'payment_voucher',
        'SET_HB',
        'Supplier payments require invoice allocations unless allow_unallocated=true'
      );
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'SET_HB',
        'error', 'Supplier payments require invoice allocations unless allow_unallocated=true'
      );
    END IF;

    -- =====================================================
    -- 4. Resolve accounts
    -- =====================================================
    -- Get party account (supplier or customer)
    IF v_supplier_id IS NOT NULL THEN
      SELECT account_id INTO v_party_account_id
      FROM suppliers WHERE id = v_supplier_id;
    ELSIF v_customer_id IS NOT NULL THEN
      SELECT account_id INTO v_party_account_id
      FROM customers WHERE id = v_customer_id;
    END IF;
    
    IF v_party_account_id IS NULL THEN
      PERFORM public.core_workflow_failed(
        v_client_request_id,
        'payment_voucher',
        'MISSING_PARTY_ACCOUNT',
        'Party (supplier/customer) does not have a linked GL account'
      );
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'MISSING_PARTY_ACCOUNT',
        'error', 'Party (supplier/customer) does not have a linked GL account'
      );
    END IF;
    
    -- Get cash/bank account based on payment method
    IF v_payment_method IN ('cash', 'نقدي') THEN
      SELECT cv.account_id INTO v_cash_account_id
      FROM cash_vaults cv
      WHERE cv.branch_id = v_branch_id AND cv.is_active = true
      LIMIT 1;
    ELSE
      -- Bank account - use first active bank for the branch or default
      SELECT id INTO v_cash_account_id
      FROM chart_of_accounts
      WHERE account_type = 'asset' 
        AND account_code LIKE '1102%'
        AND is_active = true
      LIMIT 1;
    END IF;
    
    IF v_cash_account_id IS NULL THEN
      -- Fallback to any cash account
      SELECT id INTO v_cash_account_id
      FROM chart_of_accounts
      WHERE account_type = 'asset'
        AND (account_code LIKE '1101%' OR account_code LIKE '1102%')
        AND is_active = true
      LIMIT 1;
    END IF;
    
    IF v_cash_account_id IS NULL THEN
      PERFORM public.core_workflow_failed(
        v_client_request_id,
        'payment_voucher',
        'MISSING_CASH_ACCOUNT',
        'No cash/bank account found for branch'
      );
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'MISSING_CASH_ACCOUNT',
        'error', 'No cash/bank account found for branch'
      );
    END IF;

    -- =====================================================
    -- 5. Generate numbers
    -- =====================================================
    v_payment_number := public.generate_payment_number(v_payment_type);
    v_entry_number := public.generate_journal_entry_number();
    v_payment_id := gen_random_uuid();
    v_je_id := gen_random_uuid();

    -- =====================================================
    -- 6. Create Journal Entry (is_posted=true, reference_type='payment_voucher')
    -- =====================================================
    INSERT INTO journal_entries (
      id,
      entry_number,
      entry_date,
      reference_type,
      reference_id,
      description,
      total_debit,
      total_credit,
      is_posted,
      created_by,
      branch_id
    ) VALUES (
      v_je_id,
      v_entry_number,
      v_payment_date,
      'payment_voucher',
      v_payment_id,
      COALESCE(v_notes, v_payment_type || ' voucher ' || v_payment_number),
      v_amount,
      v_amount,
      true,
      auth.uid(),
      v_branch_id
    );

    -- =====================================================
    -- 7. Create Journal Entry Lines
    -- =====================================================
    IF v_payment_type = 'payment' THEN
      -- Payment: Dr Supplier Account (reduce liability) / Cr Cash Account
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
      VALUES 
        (v_je_id, v_party_account_id, v_amount, 0, 'Payment to supplier'),
        (v_je_id, v_cash_account_id, 0, v_amount, 'Cash/Bank payment');
    ELSE
      -- Receipt: Dr Cash Account / Cr Customer Account (reduce receivable)
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
      VALUES 
        (v_je_id, v_cash_account_id, v_amount, 0, 'Cash/Bank receipt'),
        (v_je_id, v_party_account_id, 0, v_amount, 'Receipt from customer');
    END IF;

    -- =====================================================
    -- 8. Create Payment record in 'payments' table
    -- =====================================================
    INSERT INTO payments (
      id,
      payment_number,
      payment_type,
      payment_date,
      amount,
      payment_method,
      supplier_id,
      customer_id,
      branch_id,
      journal_entry_id,
      notes,
      reference_number,
      status,
      allow_unallocated,
      created_by
    ) VALUES (
      v_payment_id,
      v_payment_number,
      v_payment_type,
      v_payment_date,
      v_amount,
      v_payment_method,
      v_supplier_id,
      v_customer_id,
      v_branch_id,
      v_je_id,
      v_notes,
      v_reference_number,
      'posted',
      v_allow_unallocated,
      auth.uid()
    );

    -- =====================================================
    -- 9. Create allocations in 'supplier_payment_allocations'
    -- =====================================================
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(v_allocations)
    LOOP
      v_invoice_id := (v_alloc->>'invoice_id')::uuid;
      v_alloc_amount := (v_alloc->>'amount')::numeric;
      
      IF v_invoice_id IS NOT NULL AND v_alloc_amount > 0 THEN
        INSERT INTO supplier_payment_allocations (
          payment_id,
          invoice_id,
          allocated_amount,
          created_at
        ) VALUES (
          v_payment_id,
          v_invoice_id,
          v_alloc_amount,
          now()
        );
        
        -- Update invoice remaining_amount with row locking
        UPDATE invoices
        SET 
          paid_amount = COALESCE(paid_amount, 0) + v_alloc_amount,
          remaining_amount = COALESCE(remaining_amount, total_amount) - v_alloc_amount,
          status = CASE 
            WHEN COALESCE(remaining_amount, total_amount) - v_alloc_amount <= 0 THEN 'paid'
            ELSE 'partially_paid'
          END,
          updated_at = now()
        WHERE id = v_invoice_id;
      END IF;
    END LOOP;

    -- =====================================================
    -- 10. Build result and mark workflow success
    -- =====================================================
    v_result := jsonb_build_object(
      'success', true,
      'payment_id', v_payment_id,
      'payment_number', v_payment_number,
      'journal_entry_id', v_je_id,
      'entry_number', v_entry_number,
      'amount', v_amount,
      'allocations_count', jsonb_array_length(v_allocations)
    );
    
    -- Record success (canonical writer #2)
    PERFORM public.core_workflow_success(
      v_client_request_id,
      'payment_voucher',
      v_result
    );
    
    RETURN v_result;

  EXCEPTION WHEN OTHERS THEN
    -- Record failure (canonical writer #3)
    PERFORM public.core_workflow_failed(
      v_client_request_id,
      'payment_voucher',
      'EXCEPTION',
      SQLERRM
    );
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'EXCEPTION',
      'error', SQLERRM
    );
  END;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.payment_voucher_atomic(jsonb) TO authenticated;

-- Add comment
COMMENT ON FUNCTION public.payment_voucher_atomic(jsonb) IS 
'PV-3 Stage-1 Canonical Restore: Payment voucher creation using canonical workflow writers (begin_workflow_request, core_workflow_success, core_workflow_failed). No direct writes to atomic_workflow_requests. Uses payments + supplier_payment_allocations tables. JE with reference_type=payment_voucher, is_posted=true.';