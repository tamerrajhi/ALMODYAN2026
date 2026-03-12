-- Fix payment_voucher_atomic to read from nested payment object structure
-- The UI sends: { payment: { amount, supplier_id, ... }, allocations: [...] }
-- But the RPC was reading: { amount, supplier_id, ... } (flat structure)

CREATE OR REPLACE FUNCTION public.payment_voucher_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_request_id text;
  v_payment_type text;
  v_amount numeric;
  v_payment_date date;
  v_payment_method text;
  v_supplier_id uuid;
  v_customer_id uuid;
  v_invoice_id uuid;
  v_notes text;
  v_branch_id uuid;
  v_allow_unallocated boolean;
  v_allocations jsonb;
  v_supplier_name text;
  v_customer_name text;
  v_payment_number text;
  v_journal_number text;
  v_payment_id uuid;
  v_journal_entry_id uuid;
  v_existing_request record;
  v_total_allocated numeric := 0;
  v_allocation jsonb;
  v_debit_account_id uuid;
  v_credit_account_id uuid;
  v_party_account_id uuid;
  v_cash_account_id uuid;
  v_description text;
BEGIN
  -- Extract client_request_id (stays at root level)
  v_client_request_id := p_payload->>'client_request_id';
  
  -- Extract fields from nested 'payment' object
  v_payment_type := COALESCE(p_payload->'payment'->>'payment_type', 'payment');
  v_amount := (p_payload->'payment'->>'amount')::numeric;
  v_payment_date := COALESCE((p_payload->'payment'->>'payment_date')::date, CURRENT_DATE);
  v_payment_method := COALESCE(p_payload->'payment'->>'payment_method', 'cash');
  v_supplier_id := (p_payload->'payment'->>'supplier_id')::uuid;
  v_customer_id := (p_payload->'payment'->>'customer_id')::uuid;
  v_invoice_id := (p_payload->'payment'->>'invoice_id')::uuid;
  v_notes := p_payload->'payment'->>'notes';
  v_branch_id := (p_payload->'payment'->>'branch_id')::uuid;
  v_allow_unallocated := COALESCE((p_payload->'payment'->>'allow_unallocated')::boolean, false);
  
  -- Extract allocations (stays at root level)
  v_allocations := COALESCE(p_payload->'allocations', '[]'::jsonb);
  
  -- Extract names from payment object with fallback
  v_supplier_name := COALESCE(p_payload->'payment'->>'supplier_name', p_payload->>'supplier_name');
  v_customer_name := COALESCE(p_payload->'payment'->>'customer_name', p_payload->>'customer_name');

  -- Validate required fields
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Valid amount is required';
  END IF;

  IF v_payment_type = 'payment' AND v_supplier_id IS NULL THEN
    RAISE EXCEPTION 'Supplier is required for payment vouchers';
  END IF;

  IF v_payment_type = 'receipt' AND v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Customer is required for receipt vouchers';
  END IF;

  -- Check allocations requirement (Hard Block rule)
  IF v_payment_type = 'payment' AND jsonb_array_length(v_allocations) = 0 AND NOT v_allow_unallocated THEN
    RAISE EXCEPTION 'Payment vouchers require at least one allocation. Set allow_unallocated=true to bypass.';
  END IF;

  -- Idempotency check
  IF v_client_request_id IS NOT NULL THEN
    SELECT * INTO v_existing_request
    FROM atomic_workflow_requests
    WHERE client_request_id = v_client_request_id
      AND workflow_type = 'payment_voucher';
    
    IF FOUND THEN
      IF v_existing_request.status = 'completed' THEN
        RETURN v_existing_request.result_payload;
      ELSIF v_existing_request.status = 'failed' THEN
        -- Allow retry for failed requests
        DELETE FROM atomic_workflow_requests WHERE client_request_id = v_client_request_id;
      ELSE
        RAISE EXCEPTION 'Request already in progress';
      END IF;
    END IF;

    -- Register new request
    INSERT INTO atomic_workflow_requests (client_request_id, workflow_type, status, request_payload)
    VALUES (v_client_request_id, 'payment_voucher', 'processing', p_payload);
  END IF;

  -- Generate payment number using correct function
  v_payment_number := public.generate_payment_number(v_payment_type);
  
  -- Generate journal entry number using correct function
  v_journal_number := public.generate_journal_entry_number();

  -- Determine accounts based on payment type
  IF v_payment_type = 'payment' THEN
    -- Payment to supplier: Debit supplier account, Credit cash
    SELECT account_id INTO v_party_account_id FROM suppliers WHERE id = v_supplier_id;
    v_description := 'سند صرف - ' || COALESCE(v_supplier_name, 'مورد');
  ELSE
    -- Receipt from customer: Debit cash, Credit customer account
    SELECT account_id INTO v_party_account_id FROM customers WHERE id = v_customer_id;
    v_description := 'سند قبض - ' || COALESCE(v_customer_name, 'عميل');
  END IF;

  -- Get cash account from settings
  SELECT (value_json->>'account_id')::uuid INTO v_cash_account_id
  FROM app_settings_values
  WHERE key = 'default_cash_account'
  LIMIT 1;

  IF v_cash_account_id IS NULL THEN
    -- Fallback to first active cash vault account
    SELECT cv.account_id INTO v_cash_account_id
    FROM cash_vaults cv
    WHERE cv.is_active = true
    LIMIT 1;
  END IF;

  IF v_cash_account_id IS NULL THEN
    RAISE EXCEPTION 'No cash account configured';
  END IF;

  -- Set debit/credit based on payment type
  IF v_payment_type = 'payment' THEN
    v_debit_account_id := v_party_account_id;
    v_credit_account_id := v_cash_account_id;
  ELSE
    v_debit_account_id := v_cash_account_id;
    v_credit_account_id := v_party_account_id;
  END IF;

  -- Create journal entry
  INSERT INTO journal_entries (
    entry_number,
    entry_date,
    description,
    entry_type,
    status,
    total_debit,
    total_credit,
    created_by,
    branch_id
  ) VALUES (
    v_journal_number,
    v_payment_date,
    v_description,
    CASE WHEN v_payment_type = 'payment' THEN 'payment' ELSE 'receipt' END,
    'posted',
    v_amount,
    v_amount,
    auth.uid(),
    v_branch_id
  ) RETURNING id INTO v_journal_entry_id;

  -- Create journal entry lines
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES 
    (v_journal_entry_id, v_debit_account_id, v_amount, 0, v_description),
    (v_journal_entry_id, v_credit_account_id, 0, v_amount, v_description);

  -- Create payment voucher
  INSERT INTO payment_vouchers (
    voucher_number,
    voucher_type,
    payment_date,
    amount,
    payment_method,
    supplier_id,
    customer_id,
    invoice_id,
    journal_entry_id,
    notes,
    status,
    created_by,
    branch_id
  ) VALUES (
    v_payment_number,
    v_payment_type,
    v_payment_date,
    v_amount,
    v_payment_method,
    v_supplier_id,
    v_customer_id,
    v_invoice_id,
    v_journal_entry_id,
    v_notes,
    'posted',
    auth.uid(),
    v_branch_id
  ) RETURNING id INTO v_payment_id;

  -- Process allocations and update invoice balances
  FOR v_allocation IN SELECT * FROM jsonb_array_elements(v_allocations)
  LOOP
    DECLARE
      v_alloc_invoice_id uuid := (v_allocation->>'invoice_id')::uuid;
      v_alloc_amount numeric := (v_allocation->>'amount')::numeric;
    BEGIN
      -- Create allocation record
      INSERT INTO payment_allocations (
        payment_voucher_id,
        invoice_id,
        amount,
        created_at
      ) VALUES (
        v_payment_id,
        v_alloc_invoice_id,
        v_alloc_amount,
        now()
      );

      -- Update invoice paid amount and remaining
      UPDATE invoices
      SET 
        paid_amount = COALESCE(paid_amount, 0) + v_alloc_amount,
        remaining_amount = total_amount - COALESCE(returned_amount, 0) - (COALESCE(paid_amount, 0) + v_alloc_amount),
        payment_status = CASE 
          WHEN total_amount - COALESCE(returned_amount, 0) - (COALESCE(paid_amount, 0) + v_alloc_amount) <= 0 THEN 'paid'
          WHEN COALESCE(paid_amount, 0) + v_alloc_amount > 0 THEN 'partial'
          ELSE 'unpaid'
        END,
        updated_at = now()
      WHERE id = v_alloc_invoice_id;

      v_total_allocated := v_total_allocated + v_alloc_amount;
    END;
  END LOOP;

  -- Update request status
  IF v_client_request_id IS NOT NULL THEN
    UPDATE atomic_workflow_requests
    SET 
      status = 'completed',
      completed_at = now(),
      result_payload = jsonb_build_object(
        'success', true,
        'payment_id', v_payment_id,
        'payment_number', v_payment_number,
        'journal_entry_id', v_journal_entry_id,
        'journal_number', v_journal_number,
        'amount', v_amount,
        'total_allocated', v_total_allocated
      )
    WHERE client_request_id = v_client_request_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'payment_number', v_payment_number,
    'journal_entry_id', v_journal_entry_id,
    'journal_number', v_journal_number,
    'amount', v_amount,
    'total_allocated', v_total_allocated
  );

EXCEPTION WHEN OTHERS THEN
  -- Update request status on failure
  IF v_client_request_id IS NOT NULL THEN
    UPDATE atomic_workflow_requests
    SET 
      status = 'failed',
      completed_at = now(),
      error_message = SQLERRM
    WHERE client_request_id = v_client_request_id;
  END IF;
  
  RAISE;
END;
$$;