-- POS-P1C-FIX: Add POS logging RPCs to canonical writer whitelist
-- Only adds pos_begin_request, pos_fail_request, pos_succeed_request
-- Keeps all existing allowed callers intact

CREATE OR REPLACE FUNCTION public._pos_context_allows_pos_canonical()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_ctx text;
BEGIN
  GET DIAGNOSTICS v_ctx = PG_CONTEXT;
  
  -- Allow canonical workflow writers (both direct and core wrappers)
  IF v_ctx ILIKE '%begin_workflow_request%' OR
     v_ctx ILIKE '%end_workflow_request_success%' OR
     v_ctx ILIKE '%end_workflow_request_failed%' OR
     v_ctx ILIKE '%core_workflow_success%' OR
     v_ctx ILIKE '%core_workflow_failed%' THEN
    RETURN true;
  END IF;
  
  -- Allow POS-specific logging RPCs (No-Silent-Fail observability)
  IF v_ctx ILIKE '%pos_begin_request%' OR
     v_ctx ILIKE '%pos_fail_request%' OR
     v_ctx ILIKE '%pos_succeed_request%' THEN
    RETURN true;
  END IF;
  
  RETURN false;
END;
$function$;