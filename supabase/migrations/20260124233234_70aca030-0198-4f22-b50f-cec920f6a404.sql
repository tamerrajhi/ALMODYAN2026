-- OPS-P0: Security Hotfix - void_customer_receipt_atomic grants
-- Revoke PUBLIC and anon access, grant only to authenticated + service_role

REVOKE ALL ON FUNCTION public.void_customer_receipt_atomic(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.void_customer_receipt_atomic(jsonb) FROM anon;

GRANT EXECUTE ON FUNCTION public.void_customer_receipt_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_customer_receipt_atomic(jsonb) TO service_role;