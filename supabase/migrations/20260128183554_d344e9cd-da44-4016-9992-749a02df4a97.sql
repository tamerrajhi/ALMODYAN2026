-- HOTFIX: Add 2-arg compatibility wrapper for begin_workflow_request
-- Fixes error 42883: function begin_workflow_request(uuid, unknown) does not exist

CREATE OR REPLACE FUNCTION public.begin_workflow_request(
  p_client_request_id uuid, 
  p_workflow_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN public.begin_workflow_request(p_client_request_id, p_workflow_type, '{}'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.begin_workflow_request(uuid, text) IS 
  'HOTFIX: 2-arg compatibility wrapper routing to 3-arg version with empty payload';