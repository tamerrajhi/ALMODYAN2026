-- Compatibility Wrapper for pos_begin_request
-- Accepts (text, text, text) signature and routes to the original (uuid, text, jsonb)
-- This fixes the unique purchase returns RPC without affecting existing POS workflows

CREATE OR REPLACE FUNCTION public.pos_begin_request(
  p_client_request_id text,
  p_workflow_type text,
  p_payload text  -- payload_hash as text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Convert text to UUID and wrap payload in jsonb
  -- Route to the original function with correct types
  RETURN public.pos_begin_request(
    p_client_request_id::uuid,
    p_workflow_type,
    jsonb_build_object('payload_hash', p_payload)
  );
END;
$$;

-- Grant execute to authenticated users (matching original function permissions)
GRANT EXECUTE ON FUNCTION public.pos_begin_request(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pos_begin_request(text, text, text) TO service_role;

COMMENT ON FUNCTION public.pos_begin_request(text, text, text) IS 
'Compatibility wrapper: converts (text, text, text) calls to (uuid, text, jsonb) for legacy RPCs like complete_purchase_return_unique_items_atomic';