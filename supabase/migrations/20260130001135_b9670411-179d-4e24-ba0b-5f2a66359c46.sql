-- Compatibility wrapper: succeed_workflow_request(uuid, jsonb)
-- Some atomic RPCs still call succeed_workflow_request, while the current workflow table uses pos_* functions.

CREATE OR REPLACE FUNCTION public.succeed_workflow_request(
  p_client_request_id uuid,
  p_result jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entity_id uuid;
BEGIN
  -- Best-effort entity_id extraction (non-fatal if absent)
  v_entity_id := NULL;
  BEGIN
    IF p_result ? 'return_id' THEN
      v_entity_id := NULLIF(p_result->>'return_id','')::uuid;
    ELSIF p_result ? 'entity_id' THEN
      v_entity_id := NULLIF(p_result->>'entity_id','')::uuid;
    ELSIF p_result ? 'id' THEN
      v_entity_id := NULLIF(p_result->>'id','')::uuid;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_entity_id := NULL;
  END;

  -- Preferred path
  IF to_regprocedure('public.pos_succeed_request(uuid,uuid,jsonb)') IS NOT NULL THEN
    PERFORM public.pos_succeed_request(p_client_request_id, v_entity_id, p_result);
    RETURN;
  END IF;

  -- Fallback: update workflow table directly if present
  IF to_regclass('public.pos_workflow_requests') IS NOT NULL THEN
    UPDATE public.pos_workflow_requests
    SET status = 'succeeded',
        entity_id = v_entity_id,
        result = p_result,
        updated_at = now()
    WHERE client_request_id = p_client_request_id;
    RETURN;
  END IF;

  -- Last resort: no-op (avoid breaking business transaction if workflow infra is missing)
  RETURN;
END;
$$;