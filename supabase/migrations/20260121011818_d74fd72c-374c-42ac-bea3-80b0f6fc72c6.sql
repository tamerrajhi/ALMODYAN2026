-- Fix workflow_type to use existing 'purchase_return_void_atomic'
CREATE OR REPLACE FUNCTION public.void_purchase_return_atomic(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_client_request_id uuid;
  v_return_id uuid;
  v_voided_by text;
  v_void_reason text;
  v_void_date date;
  v_workflow_result jsonb;
  v_gate_status text;
  v_return_rec RECORD;
  v_reversal_result jsonb;
  v_result jsonb;
  v_item RECORD;
  v_reversal_je_id uuid;
  v_void_data jsonb;
BEGIN
  -- ============================
  -- 1. Parse & Validate Input
  -- ============================
  v_client_request_id := (p_payload->>'client_request_id')::uuid;
  
  v_void_data := p_payload->'void';
  IF v_void_data IS NOT NULL THEN
    v_return_id := (v_void_data->>'purchase_return_id')::uuid;
    v_voided_by := COALESCE(v_void_data->>'voided_by', p_payload->>'created_by', 'system');
    v_void_reason := COALESCE(v_void_data->>'reason', 'Voided');
  ELSE
    v_return_id := (p_payload->>'return_id')::uuid;
    v_voided_by := COALESCE(p_payload->>'created_by', 'system');
    v_void_reason := COALESCE(p_payload->>'void_reason', 'Voided');
  END IF;
  
  v_void_date := CURRENT_DATE;

  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'client_request_id is required');
  END IF;

  IF v_return_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'purchase_return_id is required');
  END IF;

  -- ============================
  -- 2. Advisory Lock
  -- ============================
  PERFORM pg_advisory_xact_lock(abs(hashtext(v_client_request_id::text)));

  -- ============================
  -- 3. Idempotency Gate (using registered workflow_type)
  -- ============================
  v_workflow_result := public.begin_workflow_request(v_client_request_id, 'purchase_return_void_atomic', p_payload);
  v_gate_status := v_workflow_result->>'status';

  IF v_gate_status = 'succeeded' THEN
    RETURN (v_workflow_result->'cached_result') || jsonb_build_object('idempotent', true);
  ELSIF v_gate_status = 'conflict' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'IDEMPOTENCY_CONFLICT', 'error', 'client_request_id reused with different payload');
  ELSIF v_gate_status = 'in_progress' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'IN_PROGRESS', 'error', 'Request is already being processed');
  END IF;

  -- ============================
  -- 4. Lock & Read Return Record
  -- ============================
  SELECT id, return_number, journal_entry_id, status, branch_id, supplier_id, total_amount
  INTO v_return_rec
  FROM public.purchase_returns
  WHERE id = v_return_id
  FOR UPDATE;

  IF v_return_rec.id IS NULL THEN
    PERFORM public.fail_workflow_request(v_client_request_id, 'NOT_FOUND', 'Purchase return not found: ' || v_return_id::text);
    RETURN jsonb_build_object('success', false, 'error_code', 'NOT_FOUND', 'error', 'Purchase return not found');
  END IF;

  -- ============================
  -- 5. Status Validation
  -- ============================
  IF v_return_rec.status IN ('voided', 'cancelled') THEN
    v_result := jsonb_build_object(
      'success', true,
      'purchase_return_id', v_return_rec.id,
      'return_number', v_return_rec.return_number,
      'status', 'voided',
      'already_voided', true,
      'idempotent', true
    );
    PERFORM public.complete_workflow_request(v_client_request_id, v_result);
    RETURN v_result;
  END IF;

  IF v_return_rec.status NOT IN ('confirmed', 'posted') THEN
    PERFORM public.fail_workflow_request(v_client_request_id, 'INVALID_STATUS', 'Cannot void return with status: ' || v_return_rec.status);
    RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_STATUS', 'error', 'Cannot void return with status: ' || v_return_rec.status);
  END IF;

  -- ============================
  -- 6. Reverse Journal Entry
  -- ============================
  v_reversal_je_id := NULL;
  
  IF v_return_rec.journal_entry_id IS NOT NULL THEN
    v_reversal_result := public.reverse_journal_entry_atomic(
      v_return_rec.journal_entry_id,
      v_return_id,
      'purchase_return_void',
      v_voided_by,
      v_return_rec.branch_id,
      'عكس مرتجع مشتريات: ' || v_return_rec.return_number || ' - ' || v_void_reason
    );

    IF (v_reversal_result->>'success')::boolean IS NOT TRUE THEN
      IF (v_reversal_result->>'alreadyReversed')::boolean = true THEN
        v_reversal_je_id := (v_reversal_result->>'originalJournalEntryId')::uuid;
      ELSE
        PERFORM public.fail_workflow_request(v_client_request_id, 'JE_REVERSAL_FAILED', COALESCE(v_reversal_result->>'error', 'Failed to reverse journal entry'));
        RETURN jsonb_build_object('success', false, 'error_code', 'JE_REVERSAL_FAILED', 'error', COALESCE(v_reversal_result->>'error', 'Failed to reverse journal entry'));
      END IF;
    ELSE
      v_reversal_je_id := (v_reversal_result->>'reversalJournalEntryId')::uuid;
    END IF;
  END IF;

  -- ============================
  -- 7. Restore Jewelry Items + Reversal Movements
  -- ============================
  FOR v_item IN
    SELECT pri.jewelry_item_id, pri.unit_price
    FROM public.purchase_return_items pri
    WHERE pri.return_id = v_return_id AND pri.jewelry_item_id IS NOT NULL
  LOOP
    UPDATE public.jewelry_items
    SET sale_status = 'available',
        branch_id = v_return_rec.branch_id,
        sold_at = NULL,
        updated_at = NOW()
    WHERE id = v_item.jewelry_item_id;

    INSERT INTO public.item_movements (id, item_id, movement_type, to_branch_id, reference_type, reference_id, performed_by, movement_date, notes, cost, journal_entry_id)
    VALUES (gen_random_uuid(), v_item.jewelry_item_id, 'purchase_return_void', v_return_rec.branch_id, 'purchase_return_void', v_return_id, v_voided_by, NOW(), 'إلغاء مرتجع: ' || v_return_rec.return_number, v_item.unit_price, v_reversal_je_id);
  END LOOP;

  -- ============================
  -- 8. Update Purchase Return
  -- ============================
  UPDATE public.purchase_returns
  SET status = 'voided',
      notes = COALESCE(notes, '') || E'\n[ملغي ' || v_void_date::text || ' بواسطة ' || v_voided_by || '] ' || v_void_reason,
      updated_at = NOW()
  WHERE id = v_return_id;

  -- ============================
  -- 9. Build Result & Complete
  -- ============================
  v_result := jsonb_build_object(
    'success', true,
    'purchase_return_id', v_return_rec.id,
    'return_number', v_return_rec.return_number,
    'status', 'voided',
    'reversing_journal_entry_id', v_reversal_je_id,
    'reversing_journal_entry_number', v_reversal_result->>'reversalEntryNumber',
    'void_reason', v_void_reason,
    'voided_by', v_voided_by,
    'idempotent', false
  );

  PERFORM public.complete_workflow_request(v_client_request_id, v_result);
  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  BEGIN
    PERFORM public.fail_workflow_request(v_client_request_id, SQLSTATE, SQLERRM);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  
  RETURN jsonb_build_object('success', false, 'error_code', SQLSTATE, 'error', SQLERRM);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.void_purchase_return_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_purchase_return_atomic(jsonb) TO service_role;