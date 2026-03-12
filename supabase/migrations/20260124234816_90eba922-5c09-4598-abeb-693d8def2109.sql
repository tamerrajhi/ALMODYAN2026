-- OPS-P3: Security Hotfix - Remove anon access from complete_pos_sale_atomic
-- Revoke from PUBLIC and anon
REVOKE ALL ON FUNCTION public.complete_pos_sale_atomic(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_pos_sale_atomic(jsonb) FROM anon;

-- Grant only to authenticated and service_role
GRANT EXECUTE ON FUNCTION public.complete_pos_sale_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_pos_sale_atomic(jsonb) TO service_role;