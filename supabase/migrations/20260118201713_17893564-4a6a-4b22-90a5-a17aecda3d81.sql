-- ============================================================
-- PR-1: Canonical void_purchase_return_atomic RPC
-- Uses confirmed signatures from Phase 0 Audit
-- ============================================================

-- 1) Ensure workflow type exists
INSERT INTO public.workflow_types (code, description, is_enabled)
VALUES ('purchase_return_void_atomic', 'Atomic void purchase return', true)
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, is_enabled = true;

-- 2) Create/Replace the canonical void function
CREATE OR REPLACE FUNCTION public.void_purchase_return_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_client_request_id uuid;
  v_return_id uuid;
  v_created_by text;
  v_void_reason text;
  v_void_date date;
  v_workflow_result jsonb;
  v_status text;
  v_cached jsonb;
  v_return_rec RECORD;
  v_reversal_result jsonb;
  v_result jsonb;
  v_item RECORD;
BEGIN
  -- a) Parse + validate
  v_client_request_id := (p_payload->>'client_request_id')::uuid;
  v_return_id := (p_payload->>'return_id')::uuid;
  v_created_by := COALESCE(p_payload->>'created_by', 'system');
  v_void_reason := COALESCE(p_payload->>'void_reason', 'Voided');
  v_void_date := COALESCE((p_payload->>'void_date')::date, CURRENT_DATE);

  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'MISSING_CLIENT_REQUEST_ID',
      'error', 'client_request_id is required'
    );
  END IF;

  IF v_return_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'MISSING_RETURN_ID',
      'error', 'return_id is required'
    );
  END IF;

  -- b) Canonical Idempotency Gate
  v_workflow_result := public.begin_workflow_request(v_client_request_id, 'purchase_return_void_atomic'::text, p_payload);
  v_status := v_workflow_result->>'status';

  IF v_status = 'succeeded' THEN
    -- Return cached result
    SELECT result INTO v_cached
    FROM public.pos_workflow_requests
    WHERE client_request_id = v_client_request_id
    LIMIT 1;
    RETURN COALESCE(v_cached, jsonb_build_object('success', true, 'cached', true));
  END IF;

  IF v_status = 'conflict' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'IDEMPOTENCY_CONFLICT',
      'error', 'Request with same client_request_id but different payload already exists'
    );
  END IF;

  IF v_status = 'in_progress' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'IN_PROGRESS',
      'error', 'Another request with the same client_request_id is currently processing'
    );
  END IF;

  -- c) Lock return row FOR UPDATE
  SELECT id, return_number, journal_entry_id, status, branch_id, notes
  INTO v_return_rec
  FROM public.purchase_returns
  WHERE id = v_return_id
  FOR UPDATE;

  IF v_return_rec.id IS NULL THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'NOT_FOUND', 'Purchase return not found: ' || v_return_id::text);
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'NOT_FOUND',
      'error', 'Purchase return not found: ' || v_return_id::text
    );
  END IF;

  -- Check if already voided/cancelled
  IF v_return_rec.status IN ('voided', 'cancelled') THEN
    v_result := jsonb_build_object(
      'success', true,
      'alreadyVoided', true,
      'returnId', v_return_rec.id,
      'returnNumber', v_return_rec.return_number,
      'voided', true,
      'reversalJournalEntryId', NULL,
      'reversalEntryNumber', NULL,
      'meta', jsonb_build_object(
        'workflowType', 'purchase_return_void_atomic',
        'clientRequestId', v_client_request_id
      )
    );
    PERFORM public.core_workflow_success(v_client_request_id, v_return_rec.id, v_result);
    RETURN v_result;
  END IF;

  -- d) Reverse JE using helper
  IF v_return_rec.journal_entry_id IS NOT NULL THEN
    v_reversal_result := public.reverse_journal_entry_atomic(
      v_return_rec.journal_entry_id,
      v_return_id,
      'purchase_return_void',
      v_created_by,
      v_return_rec.branch_id,
      v_void_reason
    );

    IF (v_reversal_result->>'success')::boolean IS NOT TRUE THEN
      -- Check if already reversed (idempotent)
      IF (v_reversal_result->>'alreadyReversed')::boolean = true THEN
        -- Already reversed, continue
        NULL;
      ELSE
        PERFORM public.core_workflow_failed(v_client_request_id, 'JE_REVERSAL_FAILED', COALESCE(v_reversal_result->>'error', 'Failed to reverse journal entry'));
        RETURN jsonb_build_object(
          'success', false,
          'error_code', 'JE_REVERSAL_FAILED',
          'error', COALESCE(v_reversal_result->>'error', 'Failed to reverse journal entry')
        );
      END IF;
    END IF;
  END IF;

  -- e) Reverse inventory effects (jewelry items only)
  FOR v_item IN
    SELECT pri.jewelry_item_id
    FROM public.purchase_return_items pri
    WHERE pri.return_id = v_return_id
      AND pri.jewelry_item_id IS NOT NULL
  LOOP
    -- Update jewelry item status to available
    UPDATE public.jewelry_items
    SET sale_status = 'available',
        sold_at = NULL,
        updated_at = NOW()
    WHERE id = v_item.jewelry_item_id;

    -- Record reversal movement (uses item_id, not jewelry_item_id)
    INSERT INTO public.item_movements (
      item_id,
      movement_type,
      to_branch_id,
      reference_type,
      reference_id,
      return_id,
      performed_by,
      movement_date,
      notes
    ) VALUES (
      v_item.jewelry_item_id,
      'RETURN_VOID',
      v_return_rec.branch_id,
      'purchase_return_void',
      v_return_id,
      v_return_id,
      v_created_by,
      NOW(),
      'Void return ' || v_return_rec.return_number || ': ' || v_void_reason
    );
  END LOOP;

  -- f) Update purchase_returns
  UPDATE public.purchase_returns
  SET status = 'voided',
      notes = COALESCE(notes, '') || E'\n[Voided ' || v_void_date::text || '] ' || v_void_reason,
      updated_at = NOW()
  WHERE id = v_return_id;

  -- g) Build result JSON
  v_result := jsonb_build_object(
    'success', true,
    'returnId', v_return_rec.id,
    'returnNumber', v_return_rec.return_number,
    'voided', true,
    'voidReason', v_void_reason,
    'reversalJournalEntryId', v_reversal_result->>'reversalJournalEntryId',
    'reversalEntryNumber', v_reversal_result->>'reversalEntryNumber',
    'meta', jsonb_build_object(
      'workflowType', 'purchase_return_void_atomic',
      'clientRequestId', v_client_request_id
    )
  );

  PERFORM public.core_workflow_success(v_client_request_id, v_return_rec.id, v_result);
  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  PERFORM public.core_workflow_failed(v_client_request_id, 'DB_ERROR', SQLERRM);
  RETURN jsonb_build_object(
    'success', false,
    'error_code', 'DB_ERROR',
    'error', SQLERRM
  );
END;
$$;

-- 3) Grant to authenticated only
REVOKE ALL ON FUNCTION public.void_purchase_return_atomic(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.void_purchase_return_atomic(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.void_purchase_return_atomic(jsonb) TO authenticated;