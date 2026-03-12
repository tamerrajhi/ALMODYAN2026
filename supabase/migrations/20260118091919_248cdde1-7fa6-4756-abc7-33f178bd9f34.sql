-- PR-1: Register void workflow type + Fix void_purchase_return_atomic (canonical)

-- A1) Register workflow type
INSERT INTO workflow_types (code, description, is_enabled)
VALUES ('purchase_return_void_atomic', 'Void Purchase Return Atomic Workflow', true)
ON CONFLICT (code) DO UPDATE SET is_enabled = true;

-- Also ensure purchase_return_void is registered (used by current RPC)
INSERT INTO workflow_types (code, description, is_enabled)
VALUES ('purchase_return_void', 'Void Purchase Return', true)
ON CONFLICT (code) DO UPDATE SET is_enabled = true;

-- A2) Drop and recreate void_purchase_return_atomic with canonical pattern
CREATE OR REPLACE FUNCTION public.void_purchase_return_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_client_request_id UUID;
  v_created_by TEXT;
  v_return_id UUID;
  v_void_reason TEXT;
  v_void_date DATE;
  v_payload_hash TEXT;
  v_return_record RECORD;
  v_original_je_id UUID;
  v_reversal_result JSONB;
  v_items RECORD;
  v_workflow_state TEXT;
  v_result JSONB;
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
  
  -- Compute stable payload hash
  v_payload_hash := md5(jsonb_build_object(
    'return_id', v_return_id,
    'void_reason', v_void_reason
  )::TEXT);

  -- Canonical idempotency gate
  SELECT public.begin_workflow_request(
    v_client_request_id::TEXT, 
    'purchase_return_void_atomic', 
    v_payload_hash
  ) INTO v_workflow_state;

  IF v_workflow_state = 'succeeded' THEN
    -- Return cached result
    SELECT result_payload INTO v_result 
    FROM public.pos_workflow_requests 
    WHERE client_request_id = v_client_request_id::TEXT 
    LIMIT 1;
    RETURN COALESCE(v_result, jsonb_build_object('success', true, 'cached', true));
  ELSIF v_workflow_state = 'in_progress' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'IN_PROGRESS', 'error', 'Request already in progress');
  ELSIF v_workflow_state = 'conflict' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'IDEMPOTENCY_CONFLICT', 'error', 'Payload conflict for same request ID');
  END IF;

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
  FOR v_items IN 
    SELECT jewelry_item_id 
    FROM public.purchase_return_items 
    WHERE return_id = v_return_id 
    AND jewelry_item_id IS NOT NULL 
  LOOP
    -- Restore item to available status
    UPDATE public.jewelry_items 
    SET sale_status = 'available', 
        sold_at = NULL,
        updated_at = NOW()
    WHERE id = v_items.jewelry_item_id;
    
    -- Record reversal movement
    INSERT INTO public.item_movements (
      item_id, 
      movement_type, 
      to_branch_id, 
      reference_type, 
      reference_id, 
      notes, 
      performed_by, 
      movement_date, 
      return_id
    )
    VALUES (
      v_items.jewelry_item_id, 
      'RETURN_VOID', 
      v_return_record.branch_id, 
      'purchase_return_void', 
      v_return_id, 
      'إلغاء مرتجع: ' || v_return_record.return_number || ' - ' || v_void_reason, 
      v_created_by, 
      NOW(), 
      v_return_id
    );
  END LOOP;

  -- Update purchase return status
  UPDATE public.purchase_returns 
  SET 
    status = 'voided', 
    notes = COALESCE(notes, '') || E'\n[Voided ' || v_void_date::TEXT || '] ' || v_void_reason,
    updated_at = NOW()
  WHERE id = v_return_id;

  -- Build result
  v_result := jsonb_build_object(
    'success', true,
    'returnId', v_return_id,
    'returnNumber', v_return_record.return_number,
    'voided', true,
    'reversalJournalEntryId', CASE WHEN v_reversal_result IS NOT NULL THEN v_reversal_result->>'reversalJournalEntryId' ELSE NULL END,
    'reversalEntryNumber', CASE WHEN v_reversal_result IS NOT NULL THEN v_reversal_result->>'reversalEntryNumber' ELSE NULL END,
    'meta', jsonb_build_object(
      'workflowType', 'purchase_return_void_atomic',
      'clientRequestId', v_client_request_id,
      'payloadHash', v_payload_hash
    )
  );

  -- Finalize workflow
  PERFORM public.core_workflow_success(v_client_request_id::TEXT, v_return_id, v_result);
  
  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  -- On any error, mark workflow failed and return error
  PERFORM public.core_workflow_failed(v_client_request_id::TEXT, 'DB_ERROR', SQLERRM);
  RETURN jsonb_build_object('success', false, 'error_code', 'DB_ERROR', 'error', SQLERRM);
END;
$$;

-- A3) Grant execute to authenticated only
REVOKE ALL ON FUNCTION public.void_purchase_return_atomic(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.void_purchase_return_atomic(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.void_purchase_return_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_purchase_return_atomic(jsonb) TO service_role;