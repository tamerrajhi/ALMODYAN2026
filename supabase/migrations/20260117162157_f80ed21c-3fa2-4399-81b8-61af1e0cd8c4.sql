-- Fix begin_workflow_request to properly detect payload hash conflicts
-- and return appropriate statuses

CREATE OR REPLACE FUNCTION public.begin_workflow_request(p_client_request_id uuid, p_workflow_type text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_hash text;
  v_existing record;
BEGIN
  -- stable hash for idempotency using sha256
  v_hash := encode(extensions.digest(coalesce(p_payload::text,''), 'sha256'), 'hex');

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
        'cached_result', COALESCE(v_existing.result, jsonb_build_object('status','succeeded'))
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
      
      RETURN jsonb_build_object('status', 'retry');
    ELSE
      -- Status is 'processing' - another process is working on it
      RETURN jsonb_build_object(
        'status', 'in_progress',
        'error_message', 'request is already being processed'
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

  RETURN jsonb_build_object('status', 'ok');
END;
$$;

-- Update the text overload to pass through
CREATE OR REPLACE FUNCTION public.begin_workflow_request(p_client_request_id text, p_workflow_type text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
BEGIN
  IF p_client_request_id IS NULL OR btrim(p_client_request_id) = '' THEN
    RAISE EXCEPTION 'EMPTY_CLIENT_REQUEST_ID';
  END IF;

  RETURN public.begin_workflow_request(p_client_request_id::uuid, p_workflow_type, p_payload);
END;
$$;