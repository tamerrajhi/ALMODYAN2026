-- PV-4.2: Fix UPDATE RPC to handle unique JE constraint
-- The issue: idx_journal_entries_unique_ref prevents multiple JEs for same payment
-- Solution: Clear reference on reversed JE before creating new one, OR use different reference_type for updates

CREATE OR REPLACE FUNCTION public.payment_voucher_update_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_client_request_id uuid;
  v_begin jsonb;
  v_status text;
  v_payment_id uuid;
  v_created_by text;
  v_payment record;
  v_payment_date date;
  v_amount numeric;
  v_payment_method text;
  v_supplier_id uuid;
  v_customer_id uuid;
  v_branch_id uuid;
  v_notes text;
  v_currency text;
  v_exchange_rate numeric;
  v_lines jsonb;
  v_lines_derived boolean := false;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_reversal_result jsonb;
  v_new_je_id uuid;
  v_new_entry_number text;
  v_line jsonb;
  v_result jsonb;
BEGIN
  v_client_request_id := NULLIF(p_payload->>'client_request_id','')::uuid;
  v_payment_id := NULLIF(p_payload->>'payment_id','')::uuid;
  v_created_by := COALESCE(NULLIF(p_payload->>'created_by',''), 'system');

  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object('success', false,'error_code','VALIDATION','error','client_request_id is required');
  END IF;
  IF v_payment_id IS NULL THEN
    RETURN jsonb_build_object('success', false,'error_code','VALIDATION','error','payment_id is required');
  END IF;

  v_begin := public.begin_workflow_request(v_client_request_id,'payment_voucher_update_atomic',p_payload);
  v_status := v_begin->>'status';
  IF v_status='succeeded' THEN
    RETURN v_begin->'cached_result';
  ELSIF v_status='conflict' THEN
    RETURN jsonb_build_object('success', false,'error_code','IDEMPOTENCY_CONFLICT','error', COALESCE(v_begin->>'error_message','conflict'));
  ELSIF v_status='in_progress' THEN
    RETURN jsonb_build_object('success', false,'error_code','IN_PROGRESS','error', COALESCE(v_begin->>'error_message','in_progress'));
  END IF;

  SELECT * INTO v_payment
  FROM public.payments
  WHERE id = v_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.core_workflow_failed(v_client_request_id,'VALIDATION','Payment not found');
    RETURN jsonb_build_object('success', false,'error_code','VALIDATION','error','Payment not found');
  END IF;

  IF v_payment.status='voided' THEN
    PERFORM public.core_workflow_failed(v_client_request_id,'VALIDATION','Cannot update voided payment');
    RETURN jsonb_build_object('success', false,'error_code','VALIDATION','error','Cannot update voided payment');
  END IF;

  v_payment_date := COALESCE(NULLIF(p_payload->'payment'->>'payment_date','')::date, v_payment.payment_date);
  v_amount := COALESCE(NULLIF(p_payload->'payment'->>'amount','')::numeric, v_payment.amount);
  v_payment_method := COALESCE(NULLIF(p_payload->'payment'->>'payment_method',''), v_payment.payment_method);
  v_supplier_id := COALESCE(NULLIF(p_payload->'payment'->>'supplier_id','')::uuid, v_payment.supplier_id);
  v_customer_id := COALESCE(NULLIF(p_payload->'payment'->>'customer_id','')::uuid, v_payment.customer_id);
  v_branch_id := COALESCE(NULLIF(p_payload->'payment'->>'branch_id','')::uuid, v_payment.branch_id);
  v_notes := COALESCE(p_payload->'payment'->>'notes', v_payment.notes);
  v_currency := COALESCE(NULLIF(p_payload->'payment'->>'currency',''), v_payment.currency);
  v_exchange_rate := COALESCE(NULLIF(p_payload->'payment'->>'exchange_rate','')::numeric, v_payment.exchange_rate);

  IF v_amount IS NULL OR v_amount <= 0 THEN
    PERFORM public.core_workflow_failed(v_client_request_id,'VALIDATION','Amount must be > 0');
    RETURN jsonb_build_object('success', false,'error_code','VALIDATION','error','Amount must be > 0');
  END IF;

  v_lines := p_payload->'lines';
  IF v_lines IS NULL OR jsonb_array_length(v_lines)=0 THEN
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
      PERFORM public.core_workflow_failed(v_client_request_id,'VALIDATION',SQLERRM);
      RETURN jsonb_build_object('success', false,'error_code','VALIDATION','error',SQLERRM);
    END;
  END IF;

  SELECT
    COALESCE(SUM((l->>'debit_amount')::numeric),0),
    COALESCE(SUM((l->>'credit_amount')::numeric),0)
  INTO v_total_debit, v_total_credit
  FROM jsonb_array_elements(v_lines) l;

  IF v_total_debit<=0 OR v_total_credit<=0 OR v_total_debit<>v_total_credit THEN
    PERFORM public.core_workflow_failed(v_client_request_id,'VALIDATION','Journal lines must be balanced');
    RETURN jsonb_build_object('success', false,'error_code','VALIDATION','error','Journal lines must be balanced');
  END IF;

  -- Handle existing JE: reverse it AND clear its reference to avoid unique constraint
  IF v_payment.journal_entry_id IS NOT NULL THEN
    v_reversal_result := public.reverse_journal_entry_atomic(
      v_payment.journal_entry_id,
      v_payment_id,
      'payment_update',
      v_created_by,
      v_branch_id,
      'تحديث سند'
    );
    IF COALESCE((v_reversal_result->>'success')::boolean,false)=false 
       AND COALESCE((v_reversal_result->>'alreadyReversed')::boolean,false)=false THEN
      PERFORM public.core_workflow_failed(v_client_request_id,'JE_REVERSAL_FAILED',COALESCE(v_reversal_result->>'error','reversal failed'));
      RETURN jsonb_build_object('success', false,'error_code','JE_REVERSAL_FAILED','error',COALESCE(v_reversal_result->>'error','reversal failed'));
    END IF;

    -- CRITICAL: Clear reference on OLD JE to avoid unique constraint violation
    -- The old JE is now reversed, so it shouldn't block new JE with same reference
    UPDATE public.journal_entries
    SET reference_id = NULL
    WHERE id = v_payment.journal_entry_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='generate_journal_entry_number'
  ) THEN
    SELECT public.generate_journal_entry_number() INTO v_new_entry_number;
  ELSE
    v_new_entry_number := 'JE-' || to_char(now(),'YYYYMMDD-HH24MISS');
  END IF;

  v_new_je_id := gen_random_uuid();

  INSERT INTO public.journal_entries (
    id, entry_number, entry_date, description,
    reference_type, reference_id,
    branch_id,
    is_posted, posted_at, posted_by,
    total_debit, total_credit,
    created_by, created_at
  ) VALUES (
    v_new_je_id,
    v_new_entry_number,
    v_payment_date,
    CASE WHEN v_payment.payment_type='payment' THEN 'سند صرف محدث: ' ELSE 'سند قبض محدث: ' END || v_payment.payment_number,
    v_payment.payment_type,
    v_payment_id,
    v_branch_id,
    true, now(), v_created_by,
    v_total_debit, v_total_credit,
    v_created_by, now()
  );

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines)
  LOOP
    INSERT INTO public.journal_entry_lines (
      journal_entry_id, account_id, debit_amount, credit_amount, description, created_at
    ) VALUES (
      v_new_je_id,
      (v_line->>'account_id')::uuid,
      COALESCE((v_line->>'debit_amount')::numeric,0),
      COALESCE((v_line->>'credit_amount')::numeric,0),
      v_line->>'description',
      now()
    );
  END LOOP;

  UPDATE public.payments
  SET payment_date=v_payment_date,
      amount=v_amount,
      payment_method=v_payment_method,
      supplier_id=v_supplier_id,
      customer_id=v_customer_id,
      branch_id=v_branch_id,
      notes=v_notes,
      currency=v_currency,
      exchange_rate=v_exchange_rate,
      journal_entry_id=v_new_je_id
  WHERE id=v_payment_id;

  v_result := jsonb_build_object(
    'success', true,
    'paymentId', v_payment_id,
    'paymentNumber', v_payment.payment_number,
    'journalEntryId', v_new_je_id,
    'journalEntryNumber', v_new_entry_number,
    'linesDerived', v_lines_derived,
    'totals', jsonb_build_object('debit', v_total_debit, 'credit', v_total_credit),
    'reversalJournalEntryId', v_reversal_result->>'reversalJournalEntryId',
    'meta', jsonb_build_object('workflowType','payment_voucher_update_atomic','clientRequestId', v_client_request_id)
  );

  PERFORM public.core_workflow_success(v_client_request_id, v_payment_id, v_result);
  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  PERFORM public.core_workflow_failed(v_client_request_id,'DB_ERROR',SQLERRM);
  RETURN jsonb_build_object('success', false,'error_code','DB_ERROR','error',SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.payment_voucher_update_atomic(jsonb) TO authenticated, service_role;