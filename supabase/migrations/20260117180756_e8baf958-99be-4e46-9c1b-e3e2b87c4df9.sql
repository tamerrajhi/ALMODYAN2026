-- PV-1.2 HOTFIX: Fix payments schema mismatch (remove updated_at reference)
CREATE OR REPLACE FUNCTION public.payment_voucher_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
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
  v_payment_method := p_payload->'payment'->>'payment_method';
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
  -- VALIDATIONS
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
  
  IF v_lines IS NULL OR jsonb_array_length(v_lines) = 0 THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'lines array is required');
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'lines array is required and must not be empty'
    );
  END IF;
  
  -- Calculate and validate line totals
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
  -- INSERT PAYMENT (no updated_at column)
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
    COALESCE(v_journal_description, 'Payment Voucher ' || v_payment_number),
    v_reference_type,
    v_payment_id,
    v_branch_id,
    v_created_by,
    now(),
    true,
    now(),
    COALESCE(v_created_by, v_requested_by::text),
    v_total_debit,
    v_total_credit
  );
  
  -- ====================
  -- INSERT JOURNAL ENTRY LINES
  -- ====================
  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines)
  LOOP
    INSERT INTO public.journal_entry_lines (
      id,
      journal_entry_id,
      account_id,
      debit_amount,
      credit_amount,
      description,
      created_at
    ) VALUES (
      gen_random_uuid(),
      v_journal_entry_id,
      (v_line->>'account_id')::uuid,
      COALESCE((v_line->>'debit_amount')::numeric, 0),
      COALESCE((v_line->>'credit_amount')::numeric, 0),
      v_line->>'description',
      now()
    );
  END LOOP;
  
  -- ====================
  -- UPDATE PAYMENT WITH JOURNAL ENTRY ID
  -- ====================
  UPDATE public.payments
  SET journal_entry_id = v_journal_entry_id
  WHERE id = v_payment_id;
  
  -- ====================
  -- BUILD RESULT
  -- ====================
  v_result := jsonb_build_object(
    'success', true,
    'paymentId', v_payment_id,
    'paymentNumber', v_payment_number,
    'journalEntryId', v_journal_entry_id,
    'meta', jsonb_build_object(
      'workflowType', 'payment_voucher_atomic',
      'clientRequestId', v_client_request_id,
      'payloadHash', v_payload_hash
    )
  );
  
  -- ====================
  -- MARK SUCCESS
  -- ====================
  PERFORM public.core_workflow_success(v_client_request_id, v_payment_id, v_result);
  
  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  PERFORM public.core_workflow_failed(v_client_request_id, SQLSTATE, SQLERRM);
  RETURN jsonb_build_object(
    'success', false,
    'error_code', 'DB_ERROR',
    'error', SQLERRM
  );
END;
$function$;

-- Ensure grants
GRANT EXECUTE ON FUNCTION public.payment_voucher_atomic(jsonb) TO authenticated, service_role;