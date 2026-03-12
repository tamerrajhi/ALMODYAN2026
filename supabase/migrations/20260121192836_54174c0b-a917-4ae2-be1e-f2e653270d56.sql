-- =====================================================
-- PV-3 Stage-1: Canonical Restore of payment_voucher_atomic
-- Eliminates DIRECT_WRITE_BLOCKED by using canonical writers
-- Uses correct tables: payments, supplier_payment_allocations
-- =====================================================

CREATE OR REPLACE FUNCTION public.payment_voucher_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  -- Workflow variables
  v_client_request_id uuid;
  v_begin jsonb;
  v_begin_status text;
  v_result jsonb;
  
  -- Payment fields (from nested payload)
  v_payment_type text;
  v_payment_date date;
  v_amount numeric;
  v_payment_method text;
  v_supplier_id uuid;
  v_customer_id uuid;
  v_invoice_id uuid;
  v_branch_id uuid;
  v_notes text;
  v_allow_unallocated boolean;
  v_description text;
  
  -- Generated/resolved
  v_payment_number text;
  v_entry_number text;
  v_payment_method_account_id uuid;
  v_party_account_id uuid;
  v_party_name text;
  
  -- IDs
  v_payment_id uuid;
  v_journal_entry_id uuid;
  
  -- Allocations
  v_allocations jsonb;
  v_alloc jsonb;
  v_alloc_total numeric := 0;
  v_alloc_count int := 0;
  v_unallocated_amount numeric;
  
  -- Balance tracking
  v_invoice_total numeric;
  v_invoice_paid numeric;
  v_invoice_returned numeric;
  v_new_paid numeric;
  v_new_remaining numeric;
  v_new_status text;
  
BEGIN
  -- ═══════════════════════════════════════════════════════════════
  -- A) PARSE & VALIDATE PAYLOAD
  -- ═══════════════════════════════════════════════════════════════
  
  -- A-1) client_request_id (required at root)
  v_client_request_id := NULLIF(p_payload->>'client_request_id', '')::uuid;
  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'client_request_id is required'
    );
  END IF;
  
  -- A-2) Extract nested payment object
  v_payment_type := COALESCE(p_payload->'payment'->>'payment_type', 'payment');
  v_payment_date := COALESCE((p_payload->'payment'->>'payment_date')::date, CURRENT_DATE);
  v_amount := (p_payload->'payment'->>'amount')::numeric;
  v_payment_method := COALESCE(p_payload->'payment'->>'payment_method', 'cash');
  v_supplier_id := NULLIF(p_payload->'payment'->>'supplier_id', '')::uuid;
  v_customer_id := NULLIF(p_payload->'payment'->>'customer_id', '')::uuid;
  v_invoice_id := NULLIF(p_payload->'payment'->>'invoice_id', '')::uuid;
  v_branch_id := NULLIF(p_payload->'payment'->>'branch_id', '')::uuid;
  v_notes := p_payload->'payment'->>'notes';
  
  -- A-3) allow_unallocated (check both root and payment object)
  v_allow_unallocated := COALESCE(
    (p_payload->>'allow_unallocated')::boolean,
    (p_payload->'payment'->>'allow_unallocated')::boolean,
    false
  );
  
  -- A-4) Journal description
  v_description := p_payload->'journal'->>'description';
  
  -- A-5) Allocations array
  v_allocations := COALESCE(p_payload->'allocations', '[]'::jsonb);
  
  -- A-6) Validate amount
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'amount must be greater than 0'
    );
  END IF;
  
  -- A-7) Validate payment_type
  IF v_payment_type NOT IN ('payment', 'receipt') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'payment_type must be payment or receipt'
    );
  END IF;
  
  -- A-8) Validate payment_method
  IF v_payment_method NOT IN ('cash', 'bank_transfer', 'check', 'card') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'payment_method must be one of: cash, bank_transfer, check, card'
    );
  END IF;
  
  -- A-9) Derive branch_id if not provided
  IF v_branch_id IS NULL AND v_invoice_id IS NOT NULL THEN
    SELECT branch_id INTO v_branch_id FROM invoices WHERE id = v_invoice_id;
  END IF;
  IF v_branch_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'branch_id is required (could not derive from invoice)'
    );
  END IF;
  
  -- ═══════════════════════════════════════════════════════════════
  -- B) HARD BLOCK: Supplier payments require allocations
  -- ═══════════════════════════════════════════════════════════════
  IF v_payment_type = 'payment' 
     AND v_supplier_id IS NOT NULL 
     AND jsonb_array_length(v_allocations) = 0 
     AND v_allow_unallocated = false 
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'SET_HB',
      'error', 'Supplier payments require invoice allocations. Set allow_unallocated=true to override.'
    );
  END IF;
  
  -- ═══════════════════════════════════════════════════════════════
  -- C) CANONICAL IDEMPOTENCY (using begin_workflow_request)
  -- ═══════════════════════════════════════════════════════════════
  v_begin := public.begin_workflow_request(v_client_request_id, 'payment_voucher_atomic', p_payload);
  v_begin_status := v_begin->>'status';
  
  -- C-1) Already succeeded → return cached result
  IF v_begin_status = 'succeeded' THEN
    RETURN v_begin->'cached_result';
  END IF;
  
  -- C-2) In progress or conflict → return error
  IF v_begin_status NOT IN ('ok', 'retry') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', v_begin_status,
      'error', 'Workflow already in progress or conflicted'
    );
  END IF;
  
  -- ═══════════════════════════════════════════════════════════════
  -- D) RESOLVE ACCOUNTS
  -- ═══════════════════════════════════════════════════════════════
  
  -- D-1) Payment method account from payment_account_settings
  SELECT 
    CASE v_payment_method
      WHEN 'cash' THEN pas.cash_account_id
      WHEN 'bank_transfer' THEN pas.bank_transfer_account_id
      WHEN 'check' THEN pas.check_account_id
      WHEN 'card' THEN pas.card_account_id
    END
  INTO v_payment_method_account_id
  FROM payment_account_settings pas
  WHERE pas.branch_id = v_branch_id
     OR pas.branch_id IS NULL
  ORDER BY pas.branch_id NULLS LAST
  LIMIT 1;
  
  IF v_payment_method_account_id IS NULL THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'CONFIG_MISSING', 
      'No payment_account_settings found for payment_method=' || v_payment_method);
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'CONFIG_MISSING',
      'error', 'Payment account settings not configured for branch'
    );
  END IF;
  
  -- D-2) Party account (supplier or customer)
  IF v_payment_type = 'payment' THEN
    IF v_supplier_id IS NULL THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 
        'supplier_id is required for payment_type=payment');
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'VALIDATION',
        'error', 'supplier_id is required for payment type'
      );
    END IF;
    
    SELECT s.account_id, s.supplier_name 
    INTO v_party_account_id, v_party_name
    FROM suppliers s
    WHERE s.id = v_supplier_id;
    
    IF v_party_account_id IS NULL THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'CONFIG_MISSING', 
        'Supplier has no linked account_id');
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'CONFIG_MISSING',
        'error', 'Supplier has no linked account'
      );
    END IF;
    
  ELSIF v_payment_type = 'receipt' THEN
    IF v_customer_id IS NULL THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 
        'customer_id is required for payment_type=receipt');
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'VALIDATION',
        'error', 'customer_id is required for receipt type'
      );
    END IF;
    
    SELECT c.account_id, c.full_name 
    INTO v_party_account_id, v_party_name
    FROM customers c
    WHERE c.id = v_customer_id;
    
    IF v_party_account_id IS NULL THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 
        'Customer has no linked account_id');
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'CONFIG_MISSING',
        'error', 'Customer has no linked account'
      );
    END IF;
  END IF;
  
  -- ═══════════════════════════════════════════════════════════════
  -- E) GENERATE NUMBERS
  -- ═══════════════════════════════════════════════════════════════
  v_payment_number := public.generate_payment_number(v_payment_type);
  v_entry_number := public.generate_journal_entry_number();
  
  -- ═══════════════════════════════════════════════════════════════
  -- F) CREATE PAYMENT (correct table: payments)
  -- ═══════════════════════════════════════════════════════════════
  
  -- F-1) Determine invoice_id for payment record
  -- If allocations provided with multiple invoices, set NULL
  -- If single allocation or direct invoice_id, use it
  IF jsonb_array_length(v_allocations) = 1 THEN
    v_invoice_id := (v_allocations->0->>'invoice_id')::uuid;
  ELSIF jsonb_array_length(v_allocations) > 1 THEN
    v_invoice_id := NULL; -- Multiple allocations, don't set single invoice
  END IF;
  -- Otherwise keep original v_invoice_id from payload
  
  INSERT INTO payments (
    id,
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
    allow_unallocated,
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
    v_invoice_id,
    v_branch_id,
    v_notes,
    'posted',
    v_allow_unallocated,
    now()
  )
  RETURNING id INTO v_payment_id;
  
  -- ═══════════════════════════════════════════════════════════════
  -- G) CREATE JOURNAL ENTRY (is_posted=true, reference_type='payment_voucher')
  -- ═══════════════════════════════════════════════════════════════
  
  -- G-1) Build description if not provided
  IF v_description IS NULL OR v_description = '' THEN
    IF v_payment_type = 'payment' THEN
      v_description := 'سند صرف - ' || COALESCE(v_party_name, 'مورد');
    ELSE
      v_description := 'سند قبض - ' || COALESCE(v_party_name, 'عميل');
    END IF;
  END IF;
  
  INSERT INTO journal_entries (
    id,
    entry_number,
    entry_date,
    description,
    reference_type,
    reference_id,
    branch_id,
    is_posted,
    posted_at,
    total_debit,
    total_credit,
    created_at
  ) VALUES (
    gen_random_uuid(),
    v_entry_number,
    v_payment_date,
    v_description,
    'payment_voucher',
    v_payment_id,
    v_branch_id,
    true,
    now(),
    v_amount,
    v_amount,
    now()
  )
  RETURNING id INTO v_journal_entry_id;
  
  -- G-2) Create journal entry lines
  IF v_payment_type = 'payment' THEN
    -- Supplier Payment: Dr Supplier AP, Cr Cash/Bank
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES 
      (v_journal_entry_id, v_party_account_id, v_amount, 0, 'سداد مورد - ' || COALESCE(v_party_name, '')),
      (v_journal_entry_id, v_payment_method_account_id, 0, v_amount, 'سداد نقدي/بنكي');
  ELSE
    -- Customer Receipt: Dr Cash/Bank, Cr Customer AR
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES 
      (v_journal_entry_id, v_payment_method_account_id, v_amount, 0, 'تحصيل من عميل'),
      (v_journal_entry_id, v_party_account_id, 0, v_amount, 'سداد ذمة عميل - ' || COALESCE(v_party_name, ''));
  END IF;
  
  -- G-3) Update payment with journal_entry_id
  UPDATE payments SET journal_entry_id = v_journal_entry_id WHERE id = v_payment_id;
  
  -- ═══════════════════════════════════════════════════════════════
  -- H) PROCESS ALLOCATIONS (correct table: supplier_payment_allocations)
  -- ═══════════════════════════════════════════════════════════════
  
  FOR v_alloc IN SELECT * FROM jsonb_array_elements(v_allocations)
  LOOP
    DECLARE
      v_alloc_invoice_id uuid := (v_alloc->>'invoice_id')::uuid;
      v_alloc_amount numeric := (v_alloc->>'amount')::numeric;
    BEGIN
      -- Validate allocation
      IF v_alloc_invoice_id IS NULL THEN
        PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 
          'Allocation invoice_id cannot be null');
        RAISE EXCEPTION 'Allocation invoice_id cannot be null';
      END IF;
      
      IF v_alloc_amount IS NULL OR v_alloc_amount <= 0 THEN
        PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 
          'Allocation amount must be greater than 0');
        RAISE EXCEPTION 'Allocation amount must be greater than 0';
      END IF;
      
      -- Insert allocation
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
      SELECT total_amount, COALESCE(paid_amount, 0), COALESCE(total_returned_amount, 0)
      INTO v_invoice_total, v_invoice_paid, v_invoice_returned
      FROM invoices
      WHERE id = v_alloc_invoice_id
      FOR UPDATE;
      
      v_new_paid := v_invoice_paid + v_alloc_amount;
      v_new_remaining := v_invoice_total - v_new_paid - v_invoice_returned;
      
      IF v_new_remaining <= 0 THEN
        v_new_status := 'paid';
      ELSIF v_new_paid > 0 THEN
        v_new_status := 'partially_paid';
      ELSE
        v_new_status := 'pending';
      END IF;
      
      UPDATE invoices
      SET 
        paid_amount = v_new_paid,
        remaining_amount = v_new_remaining,
        status = v_new_status
      WHERE id = v_alloc_invoice_id;
      
      v_alloc_total := v_alloc_total + v_alloc_amount;
      v_alloc_count := v_alloc_count + 1;
    END;
  END LOOP;
  
  -- H-2) Validate allocation total (must equal payment amount unless allow_unallocated)
  v_unallocated_amount := v_amount - v_alloc_total;
  
  IF v_alloc_count > 0 AND v_allow_unallocated = false AND ABS(v_unallocated_amount) > 0.01 THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 
      'Allocation total does not match payment amount');
    RAISE EXCEPTION 'Allocation total (%) does not match payment amount (%)', v_alloc_total, v_amount;
  END IF;
  
  -- ═══════════════════════════════════════════════════════════════
  -- I) SUCCESS
  -- ═══════════════════════════════════════════════════════════════
  v_result := jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'payment_number', v_payment_number,
    'journal_entry_id', v_journal_entry_id,
    'entry_number', v_entry_number,
    'allocations_applied_total', v_alloc_total,
    'unallocated_amount', v_unallocated_amount
  );
  
  PERFORM public.core_workflow_success(v_client_request_id, v_payment_id, v_result);
  
  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  -- Log failure
  PERFORM public.core_workflow_failed(v_client_request_id, SQLSTATE, SQLERRM);
  
  RETURN jsonb_build_object(
    'success', false,
    'error_code', 'EXCEPTION',
    'error', SQLERRM
  );
END;
$function$;

-- Grant execute to authenticated role
GRANT EXECUTE ON FUNCTION public.payment_voucher_atomic(jsonb) TO authenticated;

-- Add comment
COMMENT ON FUNCTION public.payment_voucher_atomic(jsonb) IS 
'PV-3 Canonical Payment Voucher atomic RPC. Uses canonical workflow writers (begin_workflow_request, core_workflow_success, core_workflow_failed). Writes to payments + supplier_payment_allocations. reference_type=payment_voucher, is_posted=true.';