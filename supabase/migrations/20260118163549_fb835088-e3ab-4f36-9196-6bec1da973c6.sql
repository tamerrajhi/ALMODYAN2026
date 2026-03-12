-- PR-1 PATCH: Fix void_purchase_return_atomic to be truly canonical
-- Pass full p_payload to begin_workflow_request as required

CREATE OR REPLACE FUNCTION public.void_purchase_return_atomic(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_client_request_id UUID;
  v_created_by TEXT;
  v_return_id UUID;
  v_void_reason TEXT;
  v_void_date DATE;
  v_return_record RECORD;
  v_original_je_id UUID;
  v_reversal_result JSONB;
  v_items RECORD;
  v_workflow_result JSONB;
  v_workflow_status TEXT;
  v_result JSONB;
  v_cached JSONB;
BEGIN
  -- Parse input
  v_client_request_id := (p_payload->>'client_request_id')::UUID;
  v_created_by := COALESCE(p_payload->>'created_by', 'system');
  v_return_id := (p_payload->>'return_id')::UUID;
  v_void_reason := COALESCE(p_payload->>'void_reason', 'Voided by user');
  v_void_date := COALESCE((p_payload->>'void_date')::DATE, CURRENT_DATE);
  
  -- Validate required fields
  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'client_request_id is required');
  END IF;
  
  IF v_return_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'return_id is required');
  END IF;
  
  -- Canonical idempotency gate - PASS FULL p_payload as required
  v_workflow_result := public.begin_workflow_request(
    v_client_request_id::TEXT, 
    'purchase_return_void_atomic', 
    p_payload  -- Full payload as-is
  );
  
  v_workflow_status := v_workflow_result->>'status';

  IF v_workflow_status = 'succeeded' THEN
    -- Return cached result from pos_workflow_requests.result
    SELECT result INTO v_cached 
    FROM public.pos_workflow_requests 
    WHERE client_request_id = v_client_request_id
    LIMIT 1;
    RETURN COALESCE(v_cached, jsonb_build_object('success', true, 'cached', true));
  ELSIF v_workflow_status = 'in_progress' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'IN_PROGRESS', 'error', 'Request already in progress');
  ELSIF v_workflow_status = 'conflict' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'IDEMPOTENCY_CONFLICT', 'error', 'Payload conflict for same request ID');
  END IF;
  -- v_workflow_status = 'ok' or 'retry' -> continue

  -- Lock and fetch return
  SELECT * INTO v_return_record 
  FROM public.purchase_returns 
  WHERE id = v_return_id 
  FOR UPDATE;
  
  IF NOT FOUND THEN
    PERFORM public.core_workflow_failed(v_client_request_id::TEXT, 'RETURN_NOT_FOUND', 'Return not found: ' || v_return_id::TEXT);
    RETURN jsonb_build_object('success', false, 'error_code', 'RETURN_NOT_FOUND', 'error', 'Return not found');
  END IF;
  
  -- If already voided/cancelled, return idempotent success
  IF v_return_record.status IN ('voided', 'cancelled') THEN
    v_result := jsonb_build_object(
      'success', true,
      'alreadyVoided', true,
      'returnId', v_return_id,
      'returnNumber', v_return_record.return_number,
      'meta', jsonb_build_object(
        'workflowType', 'purchase_return_void_atomic',
        'clientRequestId', v_client_request_id
      )
    );
    PERFORM public.core_workflow_success(v_client_request_id::TEXT, v_return_id, v_result);
    RETURN v_result;
  END IF;
  
  v_original_je_id := v_return_record.journal_entry_id;

  -- Reverse JE using canonical helper if journal entry exists
  IF v_original_je_id IS NOT NULL THEN
    v_reversal_result := public.reverse_journal_entry_atomic(
      v_original_je_id,
      v_return_id,
      'purchase_return_void',
      v_created_by,
      v_return_record.branch_id,
      'إلغاء مرتجع: ' || v_return_record.return_number
    );
    
    -- Check reversal success
    IF NOT COALESCE((v_reversal_result->>'success')::BOOLEAN, false) THEN
      -- If already reversed, that's fine - continue
      IF NOT COALESCE((v_reversal_result->>'alreadyReversed')::BOOLEAN, false) THEN
        PERFORM public.core_workflow_failed(v_client_request_id::TEXT, 'JE_REVERSAL_FAILED', COALESCE(v_reversal_result->>'error', 'JE reversal failed'));
        RETURN jsonb_build_object('success', false, 'error_code', 'JE_REVERSAL_FAILED', 'error', v_reversal_result->>'error');
      END IF;
    END IF;
  END IF;

  -- Restore jewelry items (unique returns only)
  -- jewelry_items has: sale_status, sold_at, updated_at columns (verified)
  FOR v_items IN 
    SELECT jewelry_item_id 
    FROM public.purchase_return_items 
    WHERE return_id = v_return_id AND jewelry_item_id IS NOT NULL
  LOOP
    -- Restore item to available
    UPDATE public.jewelry_items
    SET sale_status = 'available',
        sold_at = NULL,
        updated_at = now()
    WHERE id = v_items.jewelry_item_id;
    
    -- Insert reversal movement
    -- item_movements columns: id, item_id, movement_type, from_branch_id, to_branch_id, 
    -- reference_id, reference_type, notes, performed_by, movement_date, created_at, 
    -- return_id, cost, journal_entry_id, reference_code
    INSERT INTO public.item_movements (
      id,
      item_id,
      movement_type,
      to_branch_id,
      reference_id,
      reference_type,
      notes,
      performed_by,
      movement_date,
      return_id
    ) VALUES (
      gen_random_uuid(),
      v_items.jewelry_item_id,
      'RETURN_VOID',
      v_return_record.branch_id,
      v_return_id,
      'purchase_return_void',
      'إلغاء مرتجع مشتريات - ' || v_return_record.return_number,
      v_created_by,
      now(),
      v_return_id
    );
  END LOOP;

  -- Update purchase_returns
  UPDATE public.purchase_returns
  SET status = 'voided',
      notes = COALESCE(notes, '') || E'\n[Voided ' || v_void_date::TEXT || '] ' || v_void_reason,
      updated_at = now()
  WHERE id = v_return_id;

  -- Build result
  v_result := jsonb_build_object(
    'success', true,
    'returnId', v_return_id,
    'returnNumber', v_return_record.return_number,
    'voided', true,
    'reversalJournalEntryId', CASE WHEN v_reversal_result IS NOT NULL THEN v_reversal_result->>'reversalEntryId' ELSE NULL END,
    'reversalEntryNumber', CASE WHEN v_reversal_result IS NOT NULL THEN v_reversal_result->>'reversalEntryNumber' ELSE NULL END,
    'meta', jsonb_build_object(
      'workflowType', 'purchase_return_void_atomic',
      'clientRequestId', v_client_request_id
    )
  );

  -- Finalize workflow
  PERFORM public.core_workflow_success(v_client_request_id::TEXT, v_return_id, v_result);
  
  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  PERFORM public.core_workflow_failed(v_client_request_id::TEXT, 'DB_ERROR', SQLERRM);
  RETURN jsonb_build_object('success', false, 'error_code', 'DB_ERROR', 'error', SQLERRM);
END;
$function$;

-- Ensure workflow type exists
INSERT INTO workflow_types(code, description, is_enabled)
VALUES ('purchase_return_void_atomic', 'Atomic void purchase return', true)
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, is_enabled = true;

-- Grant to authenticated only
GRANT EXECUTE ON FUNCTION public.void_purchase_return_atomic(jsonb) TO authenticated;