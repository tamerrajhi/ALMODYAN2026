-- Fix payment_voucher_atomic: Replace non-existent generate_next_code calls
-- with correct generator functions

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
  v_supplier_name text;
  v_customer_id uuid;
  v_customer_name text;
  v_invoice_id uuid;
  v_notes text;
  v_branch_id uuid;
  v_created_by uuid;
  v_allow_unallocated boolean;
  
  v_payment_id uuid;
  v_payment_number text;
  v_journal_entry_id uuid;
  v_journal_number text;
  
  v_allocations jsonb;
  v_allocation jsonb;
  v_alloc_invoice_id uuid;
  v_alloc_amount numeric;
  
  v_debit_account_id uuid;
  v_credit_account_id uuid;
  v_party_account_id uuid;
  
  v_existing_request jsonb;
  v_result jsonb;
BEGIN
  -- Extract payload fields
  v_client_request_id := p_payload->>'client_request_id';
  v_payment_type := COALESCE(p_payload->>'payment_type', 'payment');
  v_payment_date := COALESCE((p_payload->>'payment_date')::date, CURRENT_DATE);
  v_amount := (p_payload->>'amount')::numeric;
  v_payment_method := COALESCE(p_payload->>'payment_method', 'cash');
  v_supplier_id := (p_payload->>'supplier_id')::uuid;
  v_supplier_name := p_payload->>'supplier_name';
  v_customer_id := (p_payload->>'customer_id')::uuid;
  v_customer_name := p_payload->>'customer_name';
  v_invoice_id := (p_payload->>'invoice_id')::uuid;
  v_notes := p_payload->>'notes';
  v_branch_id := (p_payload->>'branch_id')::uuid;
  v_created_by := COALESCE((p_payload->>'created_by')::uuid, auth.uid());
  v_allow_unallocated := COALESCE((p_payload->>'allow_unallocated')::boolean, false);
  v_allocations := COALESCE(p_payload->'allocations', '[]'::jsonb);

  -- Validate required fields
  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'client_request_id is required');
  END IF;

  IF v_amount IS NULL OR v_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Valid amount is required');
  END IF;

  -- Check idempotency
  SELECT result_payload INTO v_existing_request
  FROM atomic_workflow_requests
  WHERE client_request_id = v_client_request_id
    AND workflow_type = 'payment_voucher'
    AND status = 'completed';

  IF v_existing_request IS NOT NULL THEN
    RETURN v_existing_request;
  END IF;

  -- Register workflow request
  INSERT INTO atomic_workflow_requests (
    client_request_id,
    workflow_type,
    status,
    request_payload,
    created_by
  ) VALUES (
    v_client_request_id,
    'payment_voucher',
    'processing',
    p_payload,
    v_created_by
  )
  ON CONFLICT (client_request_id, workflow_type) DO UPDATE
  SET status = 'processing', created_at = now()
  WHERE atomic_workflow_requests.status = 'failed';

  -- Hard block: supplier payments require allocations (unless explicitly allowed)
  IF v_payment_type = 'payment' AND v_supplier_id IS NOT NULL THEN
    IF jsonb_array_length(v_allocations) = 0 AND NOT v_allow_unallocated THEN
      UPDATE atomic_workflow_requests
      SET status = 'failed', error_message = 'Supplier payments require allocations'
      WHERE client_request_id = v_client_request_id AND workflow_type = 'payment_voucher';
      
      RETURN jsonb_build_object('success', false, 'error', 'Supplier payments require allocations. Use allow_unallocated=true to override.');
    END IF;
  END IF;

  -- Generate payment number using correct function
  v_payment_number := public.generate_payment_number(v_payment_type);

  -- Resolve accounts based on payment method and party
  SELECT 
    CASE 
      WHEN v_payment_method = 'cash' THEN (SELECT account_id FROM payment_account_settings WHERE setting_key = 'cash_account' LIMIT 1)
      WHEN v_payment_method = 'bank_transfer' THEN (SELECT account_id FROM payment_account_settings WHERE setting_key = 'bank_account' LIMIT 1)
      WHEN v_payment_method = 'card' THEN (SELECT account_id FROM payment_account_settings WHERE setting_key = 'card_account' LIMIT 1)
      ELSE (SELECT account_id FROM payment_account_settings WHERE setting_key = 'cash_account' LIMIT 1)
    END INTO v_debit_account_id;

  -- Get party account
  IF v_supplier_id IS NOT NULL THEN
    SELECT account_id INTO v_party_account_id FROM suppliers WHERE id = v_supplier_id;
  ELSIF v_customer_id IS NOT NULL THEN
    SELECT account_id INTO v_party_account_id FROM customers WHERE id = v_customer_id;
  END IF;

  -- Fallback to default AP/AR if no party account
  IF v_party_account_id IS NULL THEN
    IF v_payment_type = 'payment' THEN
      SELECT id INTO v_party_account_id FROM chart_of_accounts WHERE account_code = '2100' LIMIT 1;
    ELSE
      SELECT id INTO v_party_account_id FROM chart_of_accounts WHERE account_code = '1200' LIMIT 1;
    END IF;
  END IF;

  v_credit_account_id := v_party_account_id;

  -- Generate journal entry number using correct governance-compliant function
  v_journal_number := public.generate_journal_entry_number();

  -- Create journal entry
  INSERT INTO journal_entries (
    entry_number,
    entry_date,
    description,
    reference_type,
    is_posted,
    created_by,
    branch_id
  ) VALUES (
    v_journal_number,
    v_payment_date,
    CASE 
      WHEN v_payment_type = 'payment' THEN 'سند صرف - ' || COALESCE(v_supplier_name, 'مورد')
      ELSE 'سند قبض - ' || COALESCE(v_customer_name, 'عميل')
    END,
    'payment_voucher',
    true,
    v_created_by,
    v_branch_id
  )
  RETURNING id INTO v_journal_entry_id;

  -- Create journal entry lines
  IF v_payment_type = 'payment' THEN
    -- Payment: Debit AP (reduce liability), Credit Cash/Bank
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES 
      (v_journal_entry_id, v_party_account_id, v_amount, 0, 'سداد للمورد'),
      (v_journal_entry_id, v_debit_account_id, 0, v_amount, v_payment_method);
  ELSE
    -- Receipt: Debit Cash/Bank, Credit AR (reduce receivable)
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES 
      (v_journal_entry_id, v_debit_account_id, v_amount, 0, v_payment_method),
      (v_journal_entry_id, v_party_account_id, 0, v_amount, 'تحصيل من العميل');
  END IF;

  -- Create payment voucher record
  INSERT INTO supplier_payments (
    id,
    payment_number,
    payment_date,
    amount,
    payment_method,
    supplier_id,
    invoice_id,
    notes,
    status,
    journal_entry_id,
    created_by,
    branch_id,
    payment_type
  ) VALUES (
    gen_random_uuid(),
    v_payment_number,
    v_payment_date,
    v_amount,
    v_payment_method,
    v_supplier_id,
    v_invoice_id,
    v_notes,
    'posted',
    v_journal_entry_id,
    v_created_by,
    v_branch_id,
    v_payment_type
  )
  RETURNING id INTO v_payment_id;

  -- Update reference_id on journal entry
  UPDATE journal_entries
  SET reference_id = v_payment_id
  WHERE id = v_journal_entry_id;

  -- Process allocations
  FOR v_allocation IN SELECT * FROM jsonb_array_elements(v_allocations)
  LOOP
    v_alloc_invoice_id := (v_allocation->>'invoiceId')::uuid;
    IF v_alloc_invoice_id IS NULL THEN
      v_alloc_invoice_id := (v_allocation->>'invoice_id')::uuid;
    END IF;
    
    v_alloc_amount := (v_allocation->>'amount')::numeric;

    IF v_alloc_invoice_id IS NOT NULL AND v_alloc_amount > 0 THEN
      -- Create allocation record
      INSERT INTO supplier_payment_allocations (
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

      -- Update invoice balance
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
    END IF;
  END LOOP;

  -- Build result
  v_result := jsonb_build_object(
    'success', true,
    'paymentId', v_payment_id,
    'paymentNumber', v_payment_number,
    'journalEntryId', v_journal_entry_id,
    'journalNumber', v_journal_number
  );

  -- Mark workflow as completed
  UPDATE atomic_workflow_requests
  SET 
    status = 'completed',
    completed_at = now(),
    result_payload = v_result
  WHERE client_request_id = v_client_request_id AND workflow_type = 'payment_voucher';

  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  -- Mark workflow as failed
  UPDATE atomic_workflow_requests
  SET 
    status = 'failed',
    error_message = SQLERRM,
    error_code = SQLSTATE
  WHERE client_request_id = v_client_request_id AND workflow_type = 'payment_voucher';

  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;