
-- B2-10T-FIX: Harden canonical layer with fallback hash + add hold_lock_atomic for IN_PROGRESS testing

-- 1) Create a robust hash function with fallback
CREATE OR REPLACE FUNCTION public.stable_payload_hash(p_payload jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
BEGIN
  -- Try sha256 first (if pgcrypto extension available)
  BEGIN
    RETURN encode(extensions.digest(coalesce(p_payload::text,''), 'sha256'), 'hex');
  EXCEPTION WHEN OTHERS THEN
    -- Fallback to md5 (always available)
    RETURN md5(coalesce(p_payload::text,''));
  END;
END;
$$;

COMMENT ON FUNCTION public.stable_payload_hash(jsonb) IS 'Stable hash for idempotency - uses sha256 if available, falls back to md5';

-- 2) Update begin_workflow_request to use the stable hash function
CREATE OR REPLACE FUNCTION public.begin_workflow_request(p_client_request_id uuid, p_workflow_type text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_hash text;
  v_existing record;
  v_is_new boolean := false;
BEGIN
  -- Use stable hash function with fallback
  v_hash := public.stable_payload_hash(p_payload);

  -- Lock and check existing request
  SELECT r.*
    INTO v_existing
  FROM public.pos_workflow_requests r
  WHERE r.client_request_id = p_client_request_id
  FOR UPDATE;

  IF FOUND THEN
    -- Request exists, check status
    IF v_existing.status = 'succeeded' THEN
      -- Check if payload hash matches
      IF v_existing.payload_hash IS NOT NULL AND v_existing.payload_hash <> v_hash THEN
        -- Different payload with same client_request_id = CONFLICT
        RETURN jsonb_build_object(
          'status', 'conflict',
          'error_code', 'IDEMPOTENCY_CONFLICT',
          'error_message', 'client_request_id reused with different payload'
        );
      END IF;
      -- Same payload, return cached result
      RETURN jsonb_build_object(
        'status', 'succeeded',
        'cached_result', COALESCE(v_existing.result, jsonb_build_object('status','succeeded')),
        'is_cached', true
      );
    ELSIF v_existing.status = 'failed' THEN
      -- Check if payload hash matches for retry
      IF v_existing.payload_hash IS NOT NULL AND v_existing.payload_hash <> v_hash THEN
        -- Different payload with same client_request_id = CONFLICT
        RETURN jsonb_build_object(
          'status', 'conflict',
          'error_code', 'IDEMPOTENCY_CONFLICT',
          'error_message', 'client_request_id reused with different payload'
        );
      END IF;
      -- Same payload, allow retry - update to processing
      UPDATE public.pos_workflow_requests
      SET status = 'processing',
          payload_hash = v_hash,
          error_code = NULL,
          error_message = NULL,
          updated_at = now()
      WHERE client_request_id = p_client_request_id;
      
      RETURN jsonb_build_object('status', 'retry', 'is_retry', true);
    ELSE
      -- Status is 'processing' - another process is working on it
      RETURN jsonb_build_object(
        'status', 'in_progress',
        'error_message', 'request is already being processed',
        'is_locked', true
      );
    END IF;
  END IF;

  -- New request - insert
  INSERT INTO public.pos_workflow_requests (
    client_request_id, workflow_type, status, payload_hash, created_at, updated_at
  )
  VALUES (
    p_client_request_id, p_workflow_type, 'processing', v_hash, now(), now()
  );

  RETURN jsonb_build_object('status', 'ok', 'is_new', true);
END;
$$;

-- 3) Create hold_lock_atomic for IN_PROGRESS testing without parallel sessions
CREATE OR REPLACE FUNCTION public.hold_lock_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_client_request_id text;
  v_hold_ms integer;
  v_begin_result jsonb;
  v_begin_status text;
  v_result jsonb;
BEGIN
  -- Extract parameters
  v_client_request_id := p_payload->>'client_request_id';
  v_hold_ms := COALESCE((p_payload->>'hold_ms')::integer, 5000);
  
  IF v_client_request_id IS NULL OR v_client_request_id = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'client_request_id is required'
    );
  END IF;

  -- Begin workflow (marks as 'processing')
  v_begin_result := public.begin_workflow_request(
    v_client_request_id::uuid,
    'hold_lock_test',
    p_payload
  );
  
  v_begin_status := v_begin_result->>'status';
  
  -- Handle various statuses
  IF v_begin_status = 'succeeded' THEN
    RETURN jsonb_build_object(
      'success', true,
      'cached', true,
      'cached_result', v_begin_result->'cached_result'
    );
  ELSIF v_begin_status = 'conflict' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'IDEMPOTENCY_CONFLICT',
      'error', v_begin_result->>'error_message'
    );
  ELSIF v_begin_status = 'in_progress' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'IN_PROGRESS',
      'error', 'request is already being processed'
    );
  ELSIF v_begin_status NOT IN ('ok', 'retry') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'WORKFLOW_ERROR',
      'error', 'Unexpected workflow status: ' || COALESCE(v_begin_status, 'null')
    );
  END IF;

  -- Hold the lock for specified duration (simulates long-running operation)
  PERFORM pg_sleep(v_hold_ms / 1000.0);
  
  -- Success
  v_result := jsonb_build_object(
    'success', true,
    'held_for_ms', v_hold_ms,
    'client_request_id', v_client_request_id
  );
  
  PERFORM public.core_workflow_success(v_client_request_id::uuid, NULL::uuid, v_result);
  
  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  BEGIN
    PERFORM public.core_workflow_failed(v_client_request_id::uuid, COALESCE(SQLSTATE, 'DB_ERROR'), SQLERRM);
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

COMMENT ON FUNCTION public.hold_lock_atomic(jsonb) IS 'Test function to simulate long-running operation for IN_PROGRESS testing';

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.stable_payload_hash(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hold_lock_atomic(jsonb) TO authenticated, service_role;
