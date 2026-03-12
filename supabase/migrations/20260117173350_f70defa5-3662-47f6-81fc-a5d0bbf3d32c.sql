-- =============================================================================
-- PV-1: Payment Voucher Atomic RPC (CREATE ONLY)
-- Canonical idempotency + balanced JE lines + single transaction
-- =============================================================================

CREATE OR REPLACE FUNCTION public.payment_voucher_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_client_request_id uuid;
  v_workflow_status text;
  v_cached_result jsonb;
  v_payload_hash text;
  
  v_payment_id uuid;
  v_payment_number text;
  v_journal_entry_id uuid;
  v_journal_entry_number text;
  
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
  v_created_by text;
  v_requested_by uuid;
  
  v_je_description text;
  v_je_date date;
  v_je_reference_type text;
  
  v_lines jsonb;
  v_line jsonb;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_line_count int := 0;
  
  v_result jsonb;
BEGIN
  -- ==========================================================================
  -- P2: Canonical Idempotency Gate
  -- ==========================================================================
  
  -- Validate client_request_id
  IF p_payload->>'client_request_id' IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'client_request_id is required'
    );
  END IF;
  
  BEGIN
    v_client_request_id := (p_payload->>'client_request_id')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'client_request_id must be a valid UUID'
    );
  END;
  
  -- Call begin_workflow_request
  SELECT status, cached_result, payload_hash
  INTO v_workflow_status, v_cached_result, v_payload_hash
  FROM public.begin_workflow_request(
    v_client_request_id,
    'payment_voucher_atomic',
    p_payload
  );
  
  -- Handle workflow statuses
  IF v_workflow_status = 'succeeded' THEN
    RETURN v_cached_result;
  ELSIF v_workflow_status = 'conflict' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'IDEMPOTENCY_CONFLICT',
      'error', 'Same request ID used with different payload'
    );
  ELSIF v_workflow_status = 'in_progress' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'IN_PROGRESS',
      'error', 'Request is already being processed'
    );
  END IF;
  -- 'ok' or 'retry' => continue
  
  -- ==========================================================================
  -- P3: Validate Payload
  -- ==========================================================================
  
  -- Extract payment fields
  v_payment_type := p_payload->'payment'->>'payment_type';
  v_amount := COALESCE((p_payload->'payment'->>'amount')::numeric, 0);
  v_payment_date := COALESCE((p_payload->'payment'->>'payment_date')::date, CURRENT_DATE);
  v_payment_method := p_payload->'payment'->>'payment_method';
  v_supplier_id := (p_payload->'payment'->>'supplier_id')::uuid;
  v_customer_id := (p_payload->'payment'->>'customer_id')::uuid;
  v_invoice_id := (p_payload->'payment'->>'invoice_id')::uuid;
  v_bank_account := p_payload->'payment'->>'bank_account';
  v_check_number := p_payload->'payment'->>'check_number';
  v_currency := COALESCE(p_payload->'payment'->>'currency', 'SAR');
  v_exchange_rate := COALESCE((p_payload->'payment'->>'exchange_rate')::numeric, 1);
  v_branch_id := (p_payload->'payment'->>'branch_id')::uuid;
  v_notes := p_payload->'payment'->>'notes';
  v_status := COALESCE(p_payload->'payment'->>'status', 'posted');
  v_created_by := p_payload->>'created_by';
  v_requested_by := (p_payload->>'requested_by')::uuid;
  
  -- Extract journal fields
  v_je_date := COALESCE((p_payload->'journal'->>'entry_date')::date, v_payment_date);
  v_je_description := p_payload->'journal'->>'description';
  v_je_reference_type := COALESCE(p_payload->'journal'->>'reference_type', 'payment');
  
  -- Extract lines
  v_lines := p_payload->'lines';
  
  -- Validation: payment_type required
  IF v_payment_type IS NULL OR v_payment_type = '' THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'payment_type is required');
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'payment_type is required'
    );
  END IF;
  
  -- Validation: amount > 0
  IF v_amount <= 0 THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'amount must be greater than 0');
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'amount must be greater than 0'
    );
  END IF;
  
  -- Validation: lines array non-empty
  IF v_lines IS NULL OR jsonb_array_length(v_lines) = 0 THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'lines array is required and must not be empty');
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'lines array is required and must not be empty'
    );
  END IF;
  
  -- Validate lines and calculate totals
  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines)
  LOOP
    v_line_count := v_line_count + 1;
    
    -- Validate account_id
    IF v_line->>'account_id' IS NULL THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'line ' || v_line_count || ': account_id is required');
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'VALIDATION',
        'error', 'line ' || v_line_count || ': account_id is required'
      );
    END IF;
    
    -- Validate amounts are non-negative
    IF COALESCE((v_line->>'debit_amount')::numeric, 0) < 0 THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'line ' || v_line_count || ': debit_amount must be >= 0');
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'VALIDATION',
        'error', 'line ' || v_line_count || ': debit_amount must be >= 0'
      );
    END IF;
    
    IF COALESCE((v_line->>'credit_amount')::numeric, 0) < 0 THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'line ' || v_line_count || ': credit_amount must be >= 0');
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'VALIDATION',
        'error', 'line ' || v_line_count || ': credit_amount must be >= 0'
      );
    END IF;
    
    v_total_debit := v_total_debit + COALESCE((v_line->>'debit_amount')::numeric, 0);
    v_total_credit := v_total_credit + COALESCE((v_line->>'credit_amount')::numeric, 0);
  END LOOP;
  
  -- Validation: lines must be balanced
  IF v_total_debit != v_total_credit THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 
      'Journal entry lines must be balanced. Debit: ' || v_total_debit || ', Credit: ' || v_total_credit);
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'Journal entry lines must be balanced. Debit: ' || v_total_debit || ', Credit: ' || v_total_credit
    );
  END IF;
  
  -- Validation: both sums > 0
  IF v_total_debit <= 0 OR v_total_credit <= 0 THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'Total debit and credit must be greater than 0');
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'Total debit and credit must be greater than 0'
    );
  END IF;
  
  -- ==========================================================================
  -- P3: Atomic Business Logic
  -- ==========================================================================
  BEGIN
    -- Advisory lock for number generation (prevents race conditions)
    PERFORM pg_advisory_xact_lock(hashtext(v_payment_type || '-' || to_char(CURRENT_DATE, 'YYYYMMDD')));
    
    -- Generate payment number
    SELECT public.generate_payment_number(v_payment_type) INTO v_payment_number;
    
    -- Generate a new UUID for payment
    v_payment_id := gen_random_uuid();
    
    -- 1) Insert into payments
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
      v_invoice_id,
      v_bank_account,
      v_check_number,
      v_currency,
      v_exchange_rate,
      v_branch_id,
      v_notes,
      v_status,
      v_created_by
    );
    
    -- Generate journal entry number
    SELECT public.generate_journal_entry_number() INTO v_journal_entry_number;
    
    -- Generate UUID for journal entry
    v_journal_entry_id := gen_random_uuid();
    
    -- 2) Insert into journal_entries
    INSERT INTO public.journal_entries (
      id,
      entry_number,
      entry_date,
      description,
      reference_type,
      reference_id,
      branch_id,
      created_by,
      status,
      total_debit,
      total_credit
    ) VALUES (
      v_journal_entry_id,
      v_journal_entry_number,
      v_je_date,
      COALESCE(v_je_description, 'Payment Voucher ' || v_payment_number),
      v_je_reference_type,
      v_payment_id,
      v_branch_id,
      v_created_by,
      'posted',
      v_total_debit,
      v_total_credit
    );
    
    -- 3) Insert journal_entry_lines
    FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines)
    LOOP
      INSERT INTO public.journal_entry_lines (
        id,
        journal_entry_id,
        account_id,
        debit_amount,
        credit_amount,
        description
      ) VALUES (
        gen_random_uuid(),
        v_journal_entry_id,
        (v_line->>'account_id')::uuid,
        COALESCE((v_line->>'debit_amount')::numeric, 0),
        COALESCE((v_line->>'credit_amount')::numeric, 0),
        v_line->>'description'
      );
    END LOOP;
    
    -- 4) Update payment with journal_entry_id
    UPDATE public.payments
    SET journal_entry_id = v_journal_entry_id
    WHERE id = v_payment_id;
    
    -- Build success result
    v_result := jsonb_build_object(
      'success', true,
      'paymentId', v_payment_id,
      'paymentNumber', v_payment_number,
      'journalEntryId', v_journal_entry_id,
      'journalEntryNumber', v_journal_entry_number,
      'meta', jsonb_build_object(
        'workflowType', 'payment_voucher_atomic',
        'clientRequestId', v_client_request_id,
        'payloadHash', v_payload_hash
      )
    );
    
    -- Mark workflow as succeeded
    PERFORM public.core_workflow_success(v_client_request_id, v_payment_id, v_result);
    
    RETURN v_result;
    
  EXCEPTION WHEN OTHERS THEN
    -- Mark workflow as failed
    PERFORM public.core_workflow_failed(v_client_request_id, SQLSTATE, SQLERRM);
    
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'DB_ERROR',
      'error', SQLERRM
    );
  END;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.payment_voucher_atomic(jsonb) TO authenticated, service_role;

-- Add helpful comment
COMMENT ON FUNCTION public.payment_voucher_atomic(jsonb) IS 
'Atomic Payment Voucher creation with canonical idempotency (PV-1).
Creates payment, journal entry, and lines in single transaction.
Uses begin_workflow_request for idempotency gating.';