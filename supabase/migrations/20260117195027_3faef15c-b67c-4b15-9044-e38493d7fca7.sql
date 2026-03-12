-- ============================================
-- PV-4: Atomic UPDATE + VOID Workflows for Payment Vouchers
-- ============================================

-- A) Workflow Types Registration
INSERT INTO public.workflow_types (code, description, is_enabled)
VALUES 
  ('payment_voucher_update_atomic', 'Atomic update of payment voucher with journal re-creation', true),
  ('payment_voucher_void_atomic', 'Atomic void/reversal of payment voucher', true)
ON CONFLICT (code) DO UPDATE SET is_enabled = true, description = EXCLUDED.description;

-- ============================================
-- C) Helper Function: reverse_journal_entry_atomic
-- Creates a reversal JE with inverted lines, marks original as reversed
-- ============================================
CREATE OR REPLACE FUNCTION public.reverse_journal_entry_atomic(
  p_original_je_id uuid,
  p_reference_id uuid,
  p_reference_type text,
  p_created_by text,
  p_branch_id uuid DEFAULT NULL,
  p_description text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_original_je RECORD;
  v_reversal_je_id uuid;
  v_reversal_entry_number text;
  v_line RECORD;
BEGIN
  -- Lock and fetch original JE
  SELECT * INTO v_original_je
  FROM public.journal_entries
  WHERE id = p_original_je_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Original journal entry not found');
  END IF;

  IF v_original_je.is_reversed THEN
    RETURN jsonb_build_object('success', false, 'error', 'Journal entry already reversed');
  END IF;

  -- Generate reversal entry number
  SELECT public.generate_code('JE') INTO v_reversal_entry_number;
  v_reversal_je_id := gen_random_uuid();

  -- Create reversal JE
  INSERT INTO public.journal_entries (
    id,
    entry_number,
    entry_date,
    description,
    reference_type,
    reference_id,
    is_posted,
    posted_at,
    posted_by,
    total_debit,
    total_credit,
    created_by,
    branch_id
  ) VALUES (
    v_reversal_je_id,
    v_reversal_entry_number,
    CURRENT_DATE,
    COALESCE(p_description, 'عكس قيد: ' || v_original_je.entry_number),
    p_reference_type,
    p_reference_id,
    true,
    now(),
    p_created_by,
    v_original_je.total_credit,  -- Swap: original credit becomes debit
    v_original_je.total_debit,   -- Swap: original debit becomes credit
    p_created_by,
    COALESCE(p_branch_id, v_original_je.branch_id)
  );

  -- Create reversal lines with inverted amounts
  FOR v_line IN 
    SELECT * FROM public.journal_entry_lines WHERE journal_entry_id = p_original_je_id
  LOOP
    INSERT INTO public.journal_entry_lines (
      journal_entry_id,
      account_id,
      debit_amount,
      credit_amount,
      description,
      cost_center_id
    ) VALUES (
      v_reversal_je_id,
      v_line.account_id,
      v_line.credit_amount,  -- Swap
      v_line.debit_amount,   -- Swap
      'عكس: ' || COALESCE(v_line.description, ''),
      v_line.cost_center_id
    );
  END LOOP;

  -- Mark original JE as reversed
  UPDATE public.journal_entries
  SET is_reversed = true,
      reversed_by_entry_id = v_reversal_je_id,
      reversal_reason = COALESCE(p_description, 'Reversed by atomic operation')
  WHERE id = p_original_je_id;

  RETURN jsonb_build_object(
    'success', true,
    'reversalJournalEntryId', v_reversal_je_id,
    'reversalEntryNumber', v_reversal_entry_number,
    'originalJournalEntryId', p_original_je_id
  );
END;
$$;

-- ============================================
-- B.2) payment_voucher_void_atomic
-- Voids a payment with reversal JE (soft delete)
-- ============================================
CREATE OR REPLACE FUNCTION public.payment_voucher_void_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_client_request_id uuid;
  v_payment_id uuid;
  v_void_reason text;
  v_void_date date;
  v_created_by text;
  v_workflow_status text;
  v_payment RECORD;
  v_reversal_result jsonb;
  v_result jsonb;
BEGIN
  -- Extract parameters
  v_client_request_id := (p_payload->>'client_request_id')::uuid;
  v_payment_id := (p_payload->>'payment_id')::uuid;
  v_void_reason := COALESCE(p_payload->>'void_reason', 'Voided by user');
  v_void_date := COALESCE((p_payload->>'void_date')::date, CURRENT_DATE);
  v_created_by := COALESCE(p_payload->>'created_by', 'system');

  -- Validate required fields
  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'client_request_id is required');
  END IF;

  IF v_payment_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'payment_id is required');
  END IF;

  -- Canonical idempotency gate
  SELECT public.begin_workflow_request(
    v_client_request_id,
    'payment_voucher_void_atomic',
    p_payload
  ) INTO v_workflow_status;

  -- Handle idempotency states
  IF v_workflow_status = 'succeeded' THEN
    SELECT result_payload INTO v_result
    FROM public.pos_workflow_requests
    WHERE client_request_id = v_client_request_id;
    RETURN v_result;
  ELSIF v_workflow_status = 'conflict' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'IDEMPOTENCY_CONFLICT', 'error', 'Same request ID used with different payload');
  ELSIF v_workflow_status = 'in_progress' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'IN_PROGRESS', 'error', 'Request already in progress');
  END IF;

  -- Lock and fetch payment
  SELECT * INTO v_payment
  FROM public.payments
  WHERE id = v_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'Payment not found');
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'Payment not found');
  END IF;

  -- Check if already voided (idempotent success)
  IF v_payment.status = 'voided' THEN
    v_result := jsonb_build_object(
      'success', true,
      'paymentId', v_payment_id,
      'paymentNumber', v_payment.payment_number,
      'voided', true,
      'alreadyVoided', true,
      'meta', jsonb_build_object('workflowType', 'payment_voucher_void_atomic', 'clientRequestId', v_client_request_id)
    );
    PERFORM public.core_workflow_success(v_client_request_id, v_payment_id, v_result);
    RETURN v_result;
  END IF;

  -- Create reversal JE if original JE exists
  IF v_payment.journal_entry_id IS NOT NULL THEN
    v_reversal_result := public.reverse_journal_entry_atomic(
      v_payment.journal_entry_id,
      v_payment_id,
      'payment_void',
      v_created_by,
      v_payment.branch_id,
      v_void_reason
    );

    IF NOT (v_reversal_result->>'success')::boolean THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'JE_REVERSAL_FAILED', v_reversal_result->>'error');
      RETURN jsonb_build_object('success', false, 'error_code', 'JE_REVERSAL_FAILED', 'error', v_reversal_result->>'error');
    END IF;
  END IF;

  -- Update payment status to voided
  UPDATE public.payments
  SET status = 'voided',
      notes = COALESCE(notes || E'\n', '') || 'ملغي: ' || v_void_reason || ' (' || v_void_date::text || ')'
  WHERE id = v_payment_id;

  -- Build success result
  v_result := jsonb_build_object(
    'success', true,
    'paymentId', v_payment_id,
    'paymentNumber', v_payment.payment_number,
    'voided', true,
    'reversalJournalEntryId', v_reversal_result->>'reversalJournalEntryId',
    'reversalEntryNumber', v_reversal_result->>'reversalEntryNumber',
    'meta', jsonb_build_object(
      'workflowType', 'payment_voucher_void_atomic',
      'clientRequestId', v_client_request_id,
      'voidDate', v_void_date,
      'voidReason', v_void_reason
    )
  );

  PERFORM public.core_workflow_success(v_client_request_id, v_payment_id, v_result);
  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  PERFORM public.core_workflow_failed(v_client_request_id, 'DB_ERROR', SQLERRM);
  RETURN jsonb_build_object('success', false, 'error_code', 'DB_ERROR', 'error', SQLERRM);
END;
$$;

-- ============================================
-- B.1) payment_voucher_update_atomic
-- Updates payment with new JE (marks old JE as reversed)
-- ============================================
CREATE OR REPLACE FUNCTION public.payment_voucher_update_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_client_request_id uuid;
  v_payment_id uuid;
  v_created_by text;
  v_workflow_status text;
  v_payment RECORD;
  
  -- Patch fields
  v_payment_date date;
  v_amount numeric;
  v_payment_method text;
  v_supplier_id uuid;
  v_customer_id uuid;
  v_branch_id uuid;
  v_notes text;
  v_currency text;
  v_exchange_rate numeric;
  
  -- JE handling
  v_lines jsonb;
  v_lines_derived boolean := false;
  v_reversal_result jsonb;
  v_new_je_id uuid;
  v_new_entry_number text;
  v_line jsonb;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  
  v_result jsonb;
BEGIN
  -- Extract parameters
  v_client_request_id := (p_payload->>'client_request_id')::uuid;
  v_payment_id := (p_payload->>'payment_id')::uuid;
  v_created_by := COALESCE(p_payload->>'created_by', 'system');

  -- Validate required fields
  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'client_request_id is required');
  END IF;

  IF v_payment_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'payment_id is required');
  END IF;

  -- Canonical idempotency gate
  SELECT public.begin_workflow_request(
    v_client_request_id,
    'payment_voucher_update_atomic',
    p_payload
  ) INTO v_workflow_status;

  -- Handle idempotency states
  IF v_workflow_status = 'succeeded' THEN
    SELECT result_payload INTO v_result
    FROM public.pos_workflow_requests
    WHERE client_request_id = v_client_request_id;
    RETURN v_result;
  ELSIF v_workflow_status = 'conflict' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'IDEMPOTENCY_CONFLICT', 'error', 'Same request ID used with different payload');
  ELSIF v_workflow_status = 'in_progress' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'IN_PROGRESS', 'error', 'Request already in progress');
  END IF;

  -- Lock and fetch payment
  SELECT * INTO v_payment
  FROM public.payments
  WHERE id = v_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'Payment not found');
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'Payment not found');
  END IF;

  -- Cannot update voided payment
  IF v_payment.status = 'voided' THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'Cannot update voided payment');
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'Cannot update voided payment');
  END IF;

  -- Extract patch fields with fallbacks to current values
  v_payment_date := COALESCE((p_payload->'payment'->>'payment_date')::date, v_payment.payment_date);
  v_amount := COALESCE((p_payload->'payment'->>'amount')::numeric, v_payment.amount);
  v_payment_method := COALESCE(p_payload->'payment'->>'payment_method', v_payment.payment_method);
  v_supplier_id := COALESCE((p_payload->'payment'->>'supplier_id')::uuid, v_payment.supplier_id);
  v_customer_id := COALESCE((p_payload->'payment'->>'customer_id')::uuid, v_payment.customer_id);
  v_branch_id := COALESCE((p_payload->'payment'->>'branch_id')::uuid, v_payment.branch_id);
  v_notes := COALESCE(p_payload->'payment'->>'notes', v_payment.notes);
  v_currency := COALESCE(p_payload->'payment'->>'currency', v_payment.currency);
  v_exchange_rate := COALESCE((p_payload->'payment'->>'exchange_rate')::numeric, v_payment.exchange_rate);

  -- Validate amount
  IF v_amount <= 0 THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'Amount must be greater than zero');
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'Amount must be greater than zero');
  END IF;

  -- Get lines (optional - derive if not provided)
  v_lines := p_payload->'lines';
  
  IF v_lines IS NULL OR jsonb_array_length(v_lines) = 0 THEN
    -- Build payment object for derivation
    BEGIN
      v_lines := public.derive_payment_voucher_lines(
        jsonb_build_object(
          'payment_type', v_payment.payment_type,
          'amount', v_amount,
          'payment_method', v_payment_method,
          'supplier_id', v_supplier_id,
          'customer_id', v_customer_id,
          'branch_id', v_branch_id
        )
      );
      v_lines_derived := true;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', SQLERRM);
      RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', SQLERRM);
    END;
    
    IF v_lines IS NULL OR jsonb_array_length(v_lines) = 0 THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'Failed to derive journal lines');
      RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'Failed to derive journal lines - check account mappings');
    END IF;
  END IF;

  -- Validate lines balance
  SELECT 
    COALESCE(SUM((l->>'debit_amount')::numeric), 0),
    COALESCE(SUM((l->>'credit_amount')::numeric), 0)
  INTO v_total_debit, v_total_credit
  FROM jsonb_array_elements(v_lines) AS l;

  IF ABS(v_total_debit - v_total_credit) > 0.01 OR v_total_debit <= 0 THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'Journal lines must be balanced');
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'Journal lines must be balanced');
  END IF;

  -- Reverse old JE if exists
  IF v_payment.journal_entry_id IS NOT NULL THEN
    v_reversal_result := public.reverse_journal_entry_atomic(
      v_payment.journal_entry_id,
      v_payment_id,
      'payment_update',
      v_created_by,
      v_branch_id,
      'تحديث سند الدفع'
    );

    IF NOT (v_reversal_result->>'success')::boolean THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'JE_REVERSAL_FAILED', v_reversal_result->>'error');
      RETURN jsonb_build_object('success', false, 'error_code', 'JE_REVERSAL_FAILED', 'error', v_reversal_result->>'error');
    END IF;
  END IF;

  -- Create new JE
  SELECT public.generate_code('JE') INTO v_new_entry_number;
  v_new_je_id := gen_random_uuid();

  INSERT INTO public.journal_entries (
    id,
    entry_number,
    entry_date,
    description,
    reference_type,
    reference_id,
    is_posted,
    posted_at,
    posted_by,
    total_debit,
    total_credit,
    created_by,
    branch_id
  ) VALUES (
    v_new_je_id,
    v_new_entry_number,
    v_payment_date,
    CASE 
      WHEN v_payment.payment_type = 'payment' THEN 'سند صرف محدث: ' || v_payment.payment_number
      ELSE 'سند قبض محدث: ' || v_payment.payment_number
    END,
    v_payment.payment_type,
    v_payment_id,
    true,
    now(),
    v_created_by,
    v_total_debit,
    v_total_credit,
    v_created_by,
    v_branch_id
  );

  -- Insert JE lines
  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines)
  LOOP
    INSERT INTO public.journal_entry_lines (
      journal_entry_id,
      account_id,
      debit_amount,
      credit_amount,
      description
    ) VALUES (
      v_new_je_id,
      (v_line->>'account_id')::uuid,
      COALESCE((v_line->>'debit_amount')::numeric, 0),
      COALESCE((v_line->>'credit_amount')::numeric, 0),
      v_line->>'description'
    );
  END LOOP;

  -- Update payment record
  UPDATE public.payments
  SET 
    payment_date = v_payment_date,
    amount = v_amount,
    payment_method = v_payment_method,
    supplier_id = v_supplier_id,
    customer_id = v_customer_id,
    branch_id = v_branch_id,
    notes = v_notes,
    currency = v_currency,
    exchange_rate = v_exchange_rate,
    journal_entry_id = v_new_je_id,
    local_amount = v_amount * v_exchange_rate
  WHERE id = v_payment_id;

  -- Build success result
  v_result := jsonb_build_object(
    'success', true,
    'paymentId', v_payment_id,
    'paymentNumber', v_payment.payment_number,
    'journalEntryId', v_new_je_id,
    'journalEntryNumber', v_new_entry_number,
    'linesDerived', v_lines_derived,
    'totals', jsonb_build_object('debit', v_total_debit, 'credit', v_total_credit),
    'reversedJournalEntryId', v_reversal_result->>'reversalJournalEntryId',
    'meta', jsonb_build_object(
      'workflowType', 'payment_voucher_update_atomic',
      'clientRequestId', v_client_request_id
    )
  );

  PERFORM public.core_workflow_success(v_client_request_id, v_payment_id, v_result);
  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  PERFORM public.core_workflow_failed(v_client_request_id, 'DB_ERROR', SQLERRM);
  RETURN jsonb_build_object('success', false, 'error_code', 'DB_ERROR', 'error', SQLERRM);
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.reverse_journal_entry_atomic(uuid, uuid, text, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payment_voucher_void_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payment_voucher_update_atomic(jsonb) TO authenticated;