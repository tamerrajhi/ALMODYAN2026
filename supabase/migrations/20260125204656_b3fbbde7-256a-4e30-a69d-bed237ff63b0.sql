-- ================================================
-- POS-P1B: Standardize POS request logging functions
-- Implements: pos_begin_request, pos_succeed_request, pos_fail_request
-- ================================================

-- 1. Ensure pos_workflow_requests table has all needed columns
DO $$
BEGIN
  -- Add payload_hash if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'pos_workflow_requests' AND column_name = 'payload_hash'
  ) THEN
    ALTER TABLE public.pos_workflow_requests ADD COLUMN payload_hash text;
  END IF;
  
  -- Add result if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'pos_workflow_requests' AND column_name = 'result'
  ) THEN
    ALTER TABLE public.pos_workflow_requests ADD COLUMN result jsonb;
  END IF;
END $$;

-- 2. Create pos_begin_request function (SECURITY DEFINER to bypass RLS)
CREATE OR REPLACE FUNCTION public.pos_begin_request(
  p_client_request_id uuid,
  p_workflow_type text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload_hash text;
  v_existing_status text;
  v_existing_entity_id uuid;
  v_existing_result jsonb;
BEGIN
  -- Compute payload hash for idempotency
  v_payload_hash := md5(p_payload::text);
  
  -- Check for existing request
  SELECT status, entity_id, result 
  INTO v_existing_status, v_existing_entity_id, v_existing_result
  FROM public.pos_workflow_requests 
  WHERE client_request_id = p_client_request_id;
  
  IF FOUND THEN
    -- Idempotency: if succeeded, return existing result
    IF v_existing_status = 'succeeded' THEN
      RETURN jsonb_build_object(
        'idempotent', true,
        'status', 'succeeded',
        'entity_id', v_existing_entity_id,
        'result', v_existing_result
      );
    END IF;
    
    -- If processing, raise conflict
    IF v_existing_status = 'processing' THEN
      RAISE EXCEPTION 'CONFLICT_IN_PROGRESS: Request % is already processing', p_client_request_id;
    END IF;
    
    -- If failed, allow retry by updating to processing
    IF v_existing_status = 'failed' THEN
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
$$;

-- 3. Create pos_succeed_request function
CREATE OR REPLACE FUNCTION public.pos_succeed_request(
  p_client_request_id uuid,
  p_entity_id uuid,
  p_result jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.pos_workflow_requests
  SET status = 'succeeded',
      entity_id = p_entity_id,
      result = p_result,
      updated_at = now()
  WHERE client_request_id = p_client_request_id;
END;
$$;

-- 4. Create pos_fail_request function
CREATE OR REPLACE FUNCTION public.pos_fail_request(
  p_client_request_id uuid,
  p_error_code text,
  p_error_message text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Upsert: if row exists update it, otherwise insert as failed
  INSERT INTO public.pos_workflow_requests (
    client_request_id,
    workflow_type,
    status,
    error_code,
    error_message,
    created_at,
    updated_at
  ) VALUES (
    p_client_request_id,
    'unknown',
    'failed',
    p_error_code,
    p_error_message,
    now(),
    now()
  )
  ON CONFLICT (client_request_id) DO UPDATE
  SET status = 'failed',
      error_code = p_error_code,
      error_message = p_error_message,
      updated_at = now();
END;
$$;

-- 5. Create index for monitoring queries
CREATE INDEX IF NOT EXISTS idx_pos_workflow_requests_type_status_created 
ON public.pos_workflow_requests (workflow_type, status, created_at);

-- 6. Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.pos_begin_request(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pos_succeed_request(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pos_fail_request(uuid, text, text) TO authenticated;

-- 7. Create helper function to check if user is admin
CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role = 'admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_current_user_admin() TO authenticated;