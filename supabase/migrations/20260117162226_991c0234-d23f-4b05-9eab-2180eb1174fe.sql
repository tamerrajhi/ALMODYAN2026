-- Update idempotency_smoke_atomic to handle updated begin_workflow_request statuses
-- New statuses: 'ok' (new), 'retry' (failed retry), 'succeeded' (cached), 'conflict', 'in_progress'

CREATE OR REPLACE FUNCTION public.idempotency_smoke_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_client_request_id text;
  v_sleep_ms integer;
  v_payload_hash text;
  v_begin_result jsonb;
  v_result jsonb;
  v_begin_status text;
BEGIN
  -- ===========================================
  -- 1) Extract and validate client_request_id
  -- ===========================================
  v_client_request_id := p_payload->>'client_request_id';
  
  IF v_client_request_id IS NULL OR v_client_request_id = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'client_request_id is required'
    );
  END IF;
  
  -- Extract optional sleep_ms (default 0)
  v_sleep_ms := COALESCE((p_payload->>'sleep_ms')::integer, 0);
  
  -- Calculate payload hash for meta
  v_payload_hash := md5(p_payload::text);
  
  -- ===========================================
  -- 2) Call canonical begin_workflow_request
  -- ===========================================
  v_begin_result := public.begin_workflow_request(
    v_client_request_id,
    'idempotency_smoke',
    p_payload
  );
  
  v_begin_status := v_begin_result->>'status';
  
  -- ===========================================
  -- 3) Interpret begin_workflow_request status
  -- Statuses: 'ok' (new), 'retry', 'succeeded' (cached), 'conflict', 'in_progress'
  -- ===========================================
  
  -- SUCCEEDED: Previously succeeded, return cached result
  IF v_begin_status = 'succeeded' THEN
    RETURN v_begin_result->'cached_result';
  END IF;
  
  -- CONFLICT: Same ID but different payload
  IF v_begin_status = 'conflict' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'IDEMPOTENCY_CONFLICT',
      'error', COALESCE(v_begin_result->>'error_message', 'client_request_id reused with different payload')
    );
  END IF;
  
  -- IN_PROGRESS: Another process is working on this
  IF v_begin_status = 'in_progress' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'IN_PROGRESS',
      'error', COALESCE(v_begin_result->>'error_message', 'request is already processing')
    );
  END IF;
  
  -- OK or RETRY: Proceed with processing
  IF v_begin_status NOT IN ('ok', 'retry') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'WORKFLOW_ERROR',
      'error', 'Unexpected workflow status: ' || COALESCE(v_begin_status, 'null')
    );
  END IF;
  
  -- ===========================================
  -- 4) Execute "business logic" (optional sleep for testing)
  -- ===========================================
  IF v_sleep_ms > 0 THEN
    PERFORM pg_sleep(v_sleep_ms / 1000.0);
  END IF;
  
  -- ===========================================
  -- 5) Build success result
  -- ===========================================
  v_result := jsonb_build_object(
    'success', true,
    'echo', jsonb_build_object(
      'client_request_id', v_client_request_id,
      'sleep_ms', v_sleep_ms
    ),
    'meta', jsonb_build_object(
      'workflowType', 'idempotency_smoke',
      'clientRequestId', v_client_request_id,
      'payloadHash', v_payload_hash
    )
  );
  
  -- ===========================================
  -- 6) Mark workflow as successful using canonical function
  -- ===========================================
  PERFORM public.core_workflow_success(v_client_request_id, NULL::uuid, v_result);
  
  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  BEGIN
    PERFORM public.core_workflow_failed(
      v_client_request_id,
      COALESCE(SQLSTATE, 'DB_ERROR'),
      SQLERRM
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  
  RETURN jsonb_build_object(
    'success', false,
    'error_code', 'DB_ERROR',
    'error', 'DB_ERROR: ' || SQLERRM
  );
END;
$$;