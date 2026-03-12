-- PV3 Stage-1: Fix journal_entry_lines column names
-- Changes: debit → debit_amount, credit → credit_amount

CREATE OR REPLACE FUNCTION public.payment_voucher_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_request_id text;
  v_workflow_type text := 'payment_voucher';
  v_existing_result jsonb;
  v_payment_id uuid;
  v_payment_number text;
  v_payment_type text;
  v_payment_date date;
  v_supplier_id uuid;
  v_customer_id uuid;
  v_branch_id uuid;
  v_amount numeric;
  v_payment_method text;
  v_notes text;
  v_performed_by uuid;
  v_performed_by_name text;
  v_allow_unallocated boolean;
  v_allocations jsonb;
  v_journal_entry_id uuid;
  v_journal_entry_number text;
  v_dr_account_id uuid;
  v_cr_account_id uuid;
  v_alloc jsonb;
  v_invoice_id uuid;
  v_alloc_amount numeric;
  v_total_allocated numeric := 0;
  v_result jsonb;
  v_payment_obj jsonb;
BEGIN
  -- ===========================================
  -- 1. Extract payload (support both flat and nested formats)
  -- ===========================================
  v_client_request_id := COALESCE(p_payload->>'client_request_id', gen_random_uuid()::text);
  
  -- Support nested 'payment' object or flat payload
  v_payment_obj := COALESCE(p_payload->'payment', p_payload);
  
  v_payment_type := COALESCE(v_payment_obj->>'payment_type', 'payment');
  v_payment_date := COALESCE((v_payment_obj->>'payment_date')::date, CURRENT_DATE);
  v_supplier_id := NULLIF(v_payment_obj->>'supplier_id', '')::uuid;
  v_customer_id := NULLIF(v_payment_obj->>'customer_id', '')::uuid;
  v_branch_id := NULLIF(v_payment_obj->>'branch_id', '')::uuid;
  v_amount := COALESCE((v_payment_obj->>'amount')::numeric, 0);
  v_payment_method := COALESCE(v_payment_obj->>'payment_method', 'cash');
  v_notes := v_payment_obj->>'notes';
  v_performed_by := NULLIF(v_payment_obj->>'performed_by', '')::uuid;
  v_performed_by_name := v_payment_obj->>'performed_by_name';
  v_allow_unallocated := COALESCE((p_payload->>'allow_unallocated')::boolean, false);
  v_allocations := COALESCE(p_payload->'allocations', '[]'::jsonb);

  -- ===========================================
  -- 2. Begin workflow (idempotency check via canonical writer)
  -- ===========================================
  v_existing_result := public.begin_workflow_request(
    v_client_request_id,
    v_workflow_type,
    p_payload
  );

  -- If cached result exists, return it
  IF v_existing_result IS NOT NULL AND v_existing_result ? 'cached_result' THEN
    RETURN v_existing_result->'cached_result';
  END IF;

  -- ===========================================
  -- 3. Hard Block: SET_HB for supplier payments without allocations
  -- ===========================================
  IF v_payment_type = 'payment' 
     AND v_supplier_id IS NOT NULL 
     AND jsonb_array_length(v_allocations) = 0 
     AND v_allow_unallocated = false THEN
    
    PERFORM public.core_workflow_failed(
      v_client_request_id,
      'SET_HB',
      'Supplier payment requires allocations or allow_unallocated=true | workflow=' || v_workflow_type
    );
    
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'SET_HB',
      'error', 'Supplier payment requires allocations or allow_unallocated=true'
    );
  END IF;

  -- ===========================================
  -- 4. Generate payment number
  -- ===========================================
  v_payment_number := public.generate_payment_number(v_payment_type);
  v_payment_id := gen_random_uuid();

  -- ===========================================
  -- 5. Generate journal entry number
  -- ===========================================
  v_journal_entry_number := public.generate_journal_entry_number();
  v_journal_entry_id := gen_random_uuid();

  -- ===========================================
  -- 6. Resolve accounts for journal entry
  -- ===========================================
  IF v_payment_type = 'payment' THEN
    -- Payment to supplier: Dr Supplier Account, Cr Cash/Bank
    SELECT account_id INTO v_dr_account_id FROM suppliers WHERE id = v_supplier_id;
    SELECT account_id INTO v_cr_account_id FROM cash_vaults WHERE branch_id = v_branch_id AND is_active = true LIMIT 1;
  ELSE
    -- Receipt from customer: Dr Cash/Bank, Cr Customer Account
    SELECT account_id INTO v_dr_account_id FROM cash_vaults WHERE branch_id = v_branch_id AND is_active = true LIMIT 1;
    SELECT account_id INTO v_cr_account_id FROM customers WHERE id = v_customer_id;
  END IF;

  -- Fallback if accounts not found
  IF v_dr_account_id IS NULL THEN
    SELECT id INTO v_dr_account_id FROM chart_of_accounts WHERE account_code = '2100' LIMIT 1;
  END IF;
  IF v_cr_account_id IS NULL THEN
    SELECT id INTO v_cr_account_id FROM chart_of_accounts WHERE account_code = '1100' LIMIT 1;
  END IF;

  -- ===========================================
  -- 7. Create Journal Entry (is_posted=true, reference_type='payment_voucher')
  -- ===========================================
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
    posted_at,
    created_by,
    branch_id
  ) VALUES (
    v_journal_entry_id,
    v_journal_entry_number,
    v_payment_date,
    'payment_voucher',
    v_payment_id,
    COALESCE(v_notes, v_payment_type || ' - ' || v_payment_number),
    v_amount,
    v_amount,
    true,
    now(),
    v_performed_by,
    v_branch_id
  );

  -- ===========================================
  -- 8. Create Journal Entry Lines (2 lines: debit + credit)
  -- ===========================================
  -- Debit line (FIX: debit_amount, credit_amount)
  INSERT INTO journal_entry_lines (
    id,
    journal_entry_id,
    account_id,
    debit_amount,
    credit_amount,
    description
  ) VALUES (
    gen_random_uuid(),
    v_journal_entry_id,
    v_dr_account_id,
    v_amount,
    0,
    v_payment_type || ' - ' || v_payment_number
  );

  -- Credit line (FIX: debit_amount, credit_amount)
  INSERT INTO journal_entry_lines (
    id,
    journal_entry_id,
    account_id,
    debit_amount,
    credit_amount,
    description
  ) VALUES (
    gen_random_uuid(),
    v_journal_entry_id,
    v_cr_account_id,
    0,
    v_amount,
    v_payment_type || ' - ' || v_payment_number
  );

  -- ===========================================
  -- 9. Create Payment record in 'payments' table
  -- ===========================================
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
    v_branch_id,
    v_journal_entry_id,
    v_notes,
    'completed',
    v_performed_by,
    now()
  );

  -- ===========================================
  -- 10. Create allocations in 'supplier_payment_allocations' and update invoice balances
  -- ===========================================
  FOR v_alloc IN SELECT * FROM jsonb_array_elements(v_allocations)
  LOOP
    v_invoice_id := (v_alloc->>'invoice_id')::uuid;
    v_alloc_amount := COALESCE((v_alloc->>'amount')::numeric, 0);
    
    IF v_invoice_id IS NOT NULL AND v_alloc_amount > 0 THEN
      -- Insert allocation into supplier_payment_allocations
      INSERT INTO supplier_payment_allocations (
        id,
        payment_id,
        invoice_id,
        amount,
        created_at
      ) VALUES (
        gen_random_uuid(),
        v_payment_id,
        v_invoice_id,
        v_alloc_amount,
        now()
      );

      -- Update invoice balances (with row lock for concurrency)
      UPDATE invoices
      SET 
        paid_amount = COALESCE(paid_amount, 0) + v_alloc_amount,
        remaining_amount = COALESCE(remaining_amount, total_amount) - v_alloc_amount,
        updated_at = now()
      WHERE id = v_invoice_id;

      v_total_allocated := v_total_allocated + v_alloc_amount;
    END IF;
  END LOOP;

  -- ===========================================
  -- 11. Build result and mark workflow success via canonical writer
  -- ===========================================
  v_result := jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'payment_number', v_payment_number,
    'journal_entry_id', v_journal_entry_id,
    'entry_number', v_journal_entry_number,
    'amount', v_amount,
    'allocations_count', jsonb_array_length(v_allocations),
    'total_allocated', v_total_allocated
  );

  PERFORM public.core_workflow_success(
    v_client_request_id,
    v_payment_id,
    v_result
  );

  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  PERFORM public.core_workflow_failed(
    v_client_request_id,
    'EXCEPTION',
    SQLERRM || ' | workflow=' || v_workflow_type
  );
  RAISE;
END;
$$;

-- Maintain existing permission
GRANT EXECUTE ON FUNCTION public.payment_voucher_atomic(jsonb) TO authenticated;