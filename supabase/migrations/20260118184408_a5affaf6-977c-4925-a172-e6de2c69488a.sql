-- PR-1 FINAL PATCH: Fix reversal keys in void_purchase_return_atomic

CREATE OR REPLACE FUNCTION public.void_purchase_return_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_client_request_id uuid;
  v_return_id uuid;
  v_void_reason text;
  v_void_date date;
  v_created_by text;
  v_workflow_result jsonb;
  v_status text;
  v_cached jsonb;
  v_return_record RECORD;
  v_reversal_result jsonb;
  v_result jsonb;
  v_original_notes text;
BEGIN
  -- Parse payload
  v_client_request_id := (p_payload->>'client_request_id')::uuid;
  v_return_id := (p_payload->>'return_id')::uuid;
  v_void_reason := COALESCE(p_payload->>'void_reason', 'Voided');
  v_void_date := COALESCE((p_payload->>'void_date')::date, CURRENT_DATE);
  v_created_by := COALESCE(p_payload->>'created_by', 'system');

  -- Validate required fields
  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'client_request_id is required'
    );
  END IF;

  IF v_return_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'return_id is required'
    );
  END IF;

  -- Begin workflow request with FULL payload
  v_workflow_result := public.begin_workflow_request(
    v_client_request_id::TEXT,
    'purchase_return_void_atomic',
    p_payload
  );
  v_status := v_workflow_result->>'status';

  -- Handle idempotency states
  IF v_status = 'succeeded' THEN
    SELECT result INTO v_cached
    FROM pos_workflow_requests
    WHERE client_request_id = v_client_request_id
    LIMIT 1;
    RETURN COALESCE(v_cached, jsonb_build_object('success', true, 'cached', true));
  END IF;

  IF v_status = 'conflict' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'IDEMPOTENCY_CONFLICT',
      'error', 'A different payload was already submitted with this request ID'
    );
  END IF;

  IF v_status = 'in_progress' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'IN_PROGRESS',
      'error', 'This request is already being processed'
    );
  END IF;

  -- Lock and fetch return record
  SELECT id, return_number, journal_entry_id, status, branch_id, notes
  INTO v_return_record
  FROM purchase_returns
  WHERE id = v_return_id
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.core_workflow_failed(v_client_request_id::TEXT, 'NOT_FOUND', 'Purchase return not found');
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'NOT_FOUND',
      'error', 'Purchase return not found'
    );
  END IF;

  -- If already voided, return idempotent success
  IF v_return_record.status IN ('voided', 'cancelled') THEN
    v_result := jsonb_build_object(
      'success', true,
      'returnId', v_return_id,
      'returnNumber', v_return_record.return_number,
      'voided', true,
      'alreadyVoided', true,
      'meta', jsonb_build_object(
        'workflowType', 'purchase_return_void_atomic',
        'clientRequestId', v_client_request_id
      )
    );
    PERFORM public.core_workflow_success(v_client_request_id::TEXT, v_return_id, v_result);
    RETURN v_result;
  END IF;

  -- Reverse journal entry if exists
  IF v_return_record.journal_entry_id IS NOT NULL THEN
    v_reversal_result := public.reverse_journal_entry_atomic(
      v_return_record.journal_entry_id,
      v_return_id,
      'purchase_return_void',
      v_created_by,
      v_return_record.branch_id,
      v_void_reason
    );
    
    IF NOT (v_reversal_result->>'success')::boolean THEN
      PERFORM public.core_workflow_failed(v_client_request_id::TEXT, 'JE_REVERSAL_FAILED', v_reversal_result->>'error');
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'JE_REVERSAL_FAILED',
        'error', v_reversal_result->>'error'
      );
    END IF;
  END IF;

  -- Reverse inventory for jewelry items in purchase_return_items
  UPDATE jewelry_items ji
  SET sale_status = 'available',
      sold_at = NULL
  FROM purchase_return_items pri
  WHERE pri.purchase_return_id = v_return_id
    AND pri.jewelry_item_id = ji.id
    AND pri.jewelry_item_id IS NOT NULL;

  -- Insert reversal item_movements
  INSERT INTO item_movements (
    jewelry_item_id,
    movement_type,
    reference_type,
    reference_id,
    from_branch_id,
    notes,
    performed_by,
    movement_date
  )
  SELECT 
    pri.jewelry_item_id,
    'adjustment',
    'purchase_return_void',
    v_return_id,
    v_return_record.branch_id,
    'Void: ' || v_void_reason,
    v_created_by,
    now()
  FROM purchase_return_items pri
  WHERE pri.purchase_return_id = v_return_id
    AND pri.jewelry_item_id IS NOT NULL;

  -- Update return status
  v_original_notes := COALESCE(v_return_record.notes, '');
  
  UPDATE purchase_returns
  SET status = 'voided',
      notes = v_original_notes || E'\n[Voided ' || v_void_date::text || '] ' || v_void_reason,
      updated_at = now()
  WHERE id = v_return_id;

  -- Build result with CORRECT reversal keys
  v_result := jsonb_build_object(
    'success', true,
    'returnId', v_return_id,
    'returnNumber', v_return_record.return_number,
    'voided', true,
    'reversalJournalEntryId', CASE 
      WHEN v_reversal_result IS NOT NULL THEN v_reversal_result->>'reversalJournalEntryId' 
      ELSE NULL 
    END,
    'reversalEntryNumber', CASE 
      WHEN v_reversal_result IS NOT NULL THEN v_reversal_result->>'reversalEntryNumber' 
      ELSE NULL 
    END,
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
  RETURN jsonb_build_object(
    'success', false,
    'error_code', 'DB_ERROR',
    'error', SQLERRM
  );
END;
$$;

-- Ensure grants
GRANT EXECUTE ON FUNCTION public.void_purchase_return_atomic(jsonb) TO authenticated;