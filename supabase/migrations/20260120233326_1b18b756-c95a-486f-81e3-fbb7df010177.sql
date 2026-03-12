-- ============================================================
-- Alias Wrappers to satisfy RPC contract:
-- 1) public.fail_workflow_request(uuid, text, text)
-- 2) public.complete_workflow_request(uuid, jsonb)
-- They forward to existing workflow functions in your DB.
-- ============================================================

-- 1) FAIL alias
CREATE OR REPLACE FUNCTION public.fail_workflow_request(
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
  -- Prefer end_workflow_request_failed if exists
  IF to_regprocedure('public.end_workflow_request_failed(uuid,text,text)') IS NOT NULL THEN
    PERFORM public.end_workflow_request_failed(p_client_request_id, p_error_code, p_error_message);
    RETURN;
  END IF;

  -- Fallback: core_workflow_failed
  IF to_regprocedure('public.core_workflow_failed(uuid,text,text)') IS NOT NULL THEN
    PERFORM public.core_workflow_failed(p_client_request_id, p_error_code, p_error_message);
    RETURN;
  END IF;

  RAISE EXCEPTION 'No failure workflow function found (end_workflow_request_failed/core_workflow_failed)';
END;
$$;

GRANT EXECUTE ON FUNCTION public.fail_workflow_request(uuid, text, text) TO authenticated;

-- 2) SUCCESS alias
CREATE OR REPLACE FUNCTION public.complete_workflow_request(
  p_client_request_id uuid,
  p_result jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entity_id uuid := NULL;
BEGIN
  -- Prefer end_workflow_request_success if exists
  IF to_regprocedure('public.end_workflow_request_success(uuid,uuid,jsonb)') IS NOT NULL THEN
    PERFORM public.end_workflow_request_success(p_client_request_id, v_entity_id, p_result);
    RETURN;
  END IF;

  -- Fallback: core_workflow_success
  IF to_regprocedure('public.core_workflow_success(uuid,uuid,jsonb)') IS NOT NULL THEN
    PERFORM public.core_workflow_success(p_client_request_id, v_entity_id, p_result);
    RETURN;
  END IF;

  RAISE EXCEPTION 'No success workflow function found (end_workflow_request_success/core_workflow_success)';
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_workflow_request(uuid, jsonb) TO authenticated;