-- ============================================================
-- PV-3B: DB-side Line Derivation for payment_voucher_atomic
-- ============================================================

-- ============================================================
-- STEP 1: Create derive_payment_voucher_lines function
-- ============================================================
CREATE OR REPLACE FUNCTION public.derive_payment_voucher_lines(p_payment jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_payment_type text;
  v_payment_method text;
  v_amount numeric;
  v_supplier_id uuid;
  v_customer_id uuid;
  v_branch_id uuid;
  
  v_payment_method_account_id uuid;
  v_party_account_id uuid;
  v_party_name text;
  
  v_lines jsonb := '[]'::jsonb;
BEGIN
  -- Extract fields from p_payment
  v_payment_type := p_payment->>'payment_type';
  v_payment_method := COALESCE(p_payment->>'payment_method', 'cash');
  v_amount := (p_payment->>'amount')::numeric;
  v_supplier_id := NULLIF(p_payment->>'supplier_id', '')::uuid;
  v_customer_id := NULLIF(p_payment->>'customer_id', '')::uuid;
  v_branch_id := NULLIF(p_payment->>'branch_id', '')::uuid;
  
  -- ======================================
  -- Get payment method account from payment_account_settings
  -- Priority: branch-specific > global (branch_id IS NULL)
  -- ======================================
  SELECT 
    CASE v_payment_method
      WHEN 'cash' THEN pas.cash_account_id
      WHEN 'bank_transfer' THEN pas.bank_transfer_account_id
      WHEN 'check' THEN pas.check_account_id
      WHEN 'card' THEN pas.card_account_id
      ELSE pas.cash_account_id
    END
  INTO v_payment_method_account_id
  FROM payment_account_settings pas
  WHERE pas.branch_id = v_branch_id
     OR pas.branch_id IS NULL
  ORDER BY pas.branch_id NULLS LAST
  LIMIT 1;
  
  IF v_payment_method_account_id IS NULL THEN
    RAISE EXCEPTION 'MISSING_ACCOUNT_MAPPING: No payment_account_settings found for payment_method=% branch_id=%', 
      v_payment_method, v_branch_id
      USING ERRCODE = 'P0001';
  END IF;
  
  -- ======================================
  -- Get party account (supplier or customer)
  -- ======================================
  IF v_payment_type = 'payment' THEN
    -- Supplier payment
    IF v_supplier_id IS NULL THEN
      RAISE EXCEPTION 'MISSING_PARTY: supplier_id is required for payment_type=payment'
        USING ERRCODE = 'P0001';
    END IF;
    
    SELECT s.account_id, s.supplier_name 
    INTO v_party_account_id, v_party_name
    FROM suppliers s
    WHERE s.id = v_supplier_id;
    
    IF v_party_account_id IS NULL THEN
      RAISE EXCEPTION 'MISSING_PARTY_ACCOUNT: Supplier % has no linked account_id', v_supplier_id
        USING ERRCODE = 'P0001';
    END IF;
    
    -- Build lines for SUPPLIER PAYMENT:
    -- Debit: Supplier account (reduce payable)
    -- Credit: Cash/Bank account (reduce cash)
    v_lines := jsonb_build_array(
      jsonb_build_object(
        'account_id', v_party_account_id,
        'debit_amount', v_amount,
        'credit_amount', 0,
        'description', 'سداد مورد - ' || COALESCE(v_party_name, '')
      ),
      jsonb_build_object(
        'account_id', v_payment_method_account_id,
        'debit_amount', 0,
        'credit_amount', v_amount,
        'description', 'سداد نقدي/بنكي - ' || COALESCE(v_party_name, '')
      )
    );
    
  ELSIF v_payment_type = 'receipt' THEN
    -- Customer receipt
    IF v_customer_id IS NULL THEN
      RAISE EXCEPTION 'MISSING_PARTY: customer_id is required for payment_type=receipt'
        USING ERRCODE = 'P0001';
    END IF;
    
    SELECT c.account_id, c.full_name 
    INTO v_party_account_id, v_party_name
    FROM customers c
    WHERE c.id = v_customer_id;
    
    IF v_party_account_id IS NULL THEN
      RAISE EXCEPTION 'MISSING_PARTY_ACCOUNT: Customer % has no linked account_id', v_customer_id
        USING ERRCODE = 'P0001';
    END IF;
    
    -- Build lines for CUSTOMER RECEIPT:
    -- Debit: Cash/Bank account (increase cash)
    -- Credit: Customer account (reduce receivable)
    v_lines := jsonb_build_array(
      jsonb_build_object(
        'account_id', v_payment_method_account_id,
        'debit_amount', v_amount,
        'credit_amount', 0,
        'description', 'تحصيل من عميل - ' || COALESCE(v_party_name, '')
      ),
      jsonb_build_object(
        'account_id', v_party_account_id,
        'debit_amount', 0,
        'credit_amount', v_amount,
        'description', 'سداد ذمة عميل - ' || COALESCE(v_party_name, '')
      )
    );
    
  ELSE
    RAISE EXCEPTION 'INVALID_PAYMENT_TYPE: payment_type must be payment or receipt, got: %', v_payment_type
      USING ERRCODE = 'P0001';
  END IF;
  
  RETURN v_lines;
END;
$function$;

-- ============================================================
-- STEP 2: Update payment_voucher_atomic to make lines optional
-- ============================================================
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
  -- INSERT PAYMENT
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
    v_invoice_id,
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
  -- SUCCESS RESULT
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
    'meta', jsonb_build_object(
      'workflowType', 'payment_voucher_atomic',
      'clientRequestId', v_client_request_id,
      'payloadHash', v_payload_hash
    )
  );
  
  -- Mark workflow as succeeded
  PERFORM public.core_workflow_success(v_client_request_id, v_result);
  
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