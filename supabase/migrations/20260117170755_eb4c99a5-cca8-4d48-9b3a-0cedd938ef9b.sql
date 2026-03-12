-- Bridge function مؤقتة لاختبار begin_workflow_request
CREATE OR REPLACE FUNCTION public.begin_workflow_request_test(
  p_client_request_id uuid, 
  p_workflow_type text, 
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
BEGIN
  RETURN public.begin_workflow_request(p_client_request_id, p_workflow_type, p_payload);
END;
$$;

-- منح الصلاحيات
GRANT EXECUTE ON FUNCTION public.begin_workflow_request_test(uuid, text, jsonb) TO authenticated, service_role, anon;