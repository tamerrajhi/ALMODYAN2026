-- ROOT FIX: Add stale processing TTL (120s) to pos_begin_request
-- If a request is stuck in 'processing' for > 120 seconds, auto-abort it and allow retry

CREATE OR REPLACE FUNCTION public.pos_begin_request(
  p_client_request_id uuid, 
  p_workflow_type text, 
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_payload_hash text;
  v_existing record;
  v_stale_ttl interval := interval '120 seconds';
BEGIN
  -- Compute payload hash for idempotency
  v_payload_hash := md5(p_payload::text);
  
  -- Check for existing request by client_request_id
  SELECT status, entity_id, result, created_at, payload_hash
  INTO v_existing
  FROM public.pos_workflow_requests 
  WHERE client_request_id = p_client_request_id;
  
  IF FOUND THEN
    -- Idempotency: if succeeded, return existing result
    IF v_existing.status = 'succeeded' THEN
      RETURN jsonb_build_object(
        'idempotent', true,
        'status', 'succeeded',
        'entity_id', v_existing.entity_id,
        'result', v_existing.result
      );
    END IF;
    
    -- If processing, check if stale (TTL expired)
    IF v_existing.status = 'processing' THEN
      IF (now() - v_existing.created_at) > v_stale_ttl THEN
        -- Auto-abort stale request using canonical pattern
        UPDATE public.pos_workflow_requests
        SET status = 'failed',
            error_code = 'ABORTED_STALE',
            error_message = 'Auto-aborted: processing exceeded TTL of 120 seconds',
            updated_at = now()
        WHERE client_request_id = p_client_request_id;
        
        -- Now create new processing row for this new request with same client_request_id
        UPDATE public.pos_workflow_requests
        SET status = 'processing',
            payload_hash = v_payload_hash,
            error_code = NULL,
            error_message = NULL,
            updated_at = now()
        WHERE client_request_id = p_client_request_id;
        
        RETURN jsonb_build_object('idempotent', false, 'status', 'processing', 'retry', true, 'stale_aborted', true);
      ELSE
        -- Still within TTL, raise conflict
        RAISE EXCEPTION 'CONFLICT_IN_PROGRESS: Request % is already processing', p_client_request_id;
      END IF;
    END IF;
    
    -- If failed, allow retry by updating to processing
    IF v_existing.status = 'failed' THEN
      UPDATE public.pos_workflow_requests
      SET status = 'processing',
          payload_hash = v_payload_hash,
          error_code = NULL,
          error_message = NULL,
          updated_at = now()
      WHERE client_request_id = p_client_request_id;
      
      RETURN jsonb_build_object('idempotent', false, 'status', 'processing', 'retry', true);
    END IF;
  END IF;
  
  -- Insert new request
  INSERT INTO public.pos_workflow_requests (
    client_request_id,
    workflow_type,
    status,
    payload_hash,
    created_at,
    updated_at
  ) VALUES (
    p_client_request_id,
    p_workflow_type,
    'processing',
    v_payload_hash,
    now(),
    now()
  );
  
  RETURN jsonb_build_object('idempotent', false, 'status', 'processing', 'retry', false);
END;
$function$;

-- Also ensure pos_fail_request exists and works correctly
-- (This is a canonical writer that marks requests as failed)
CREATE OR REPLACE FUNCTION public.pos_fail_request(
  p_client_request_id uuid,
  p_error_code text,
  p_error_message text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.pos_workflow_requests
  SET status = 'failed',
      error_code = p_error_code,
      error_message = p_error_message,
      updated_at = now()
  WHERE client_request_id = p_client_request_id
    AND status = 'processing';
END;
$function$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.pos_begin_request(uuid, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pos_fail_request(uuid, text, text) TO authenticated, service_role;