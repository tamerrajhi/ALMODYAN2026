-- =========================================================
-- P4-9 (D-FIX): Properly revoke anon and grant only authenticated/service_role
-- =========================================================

-- First, revoke from PUBLIC (which includes anon)
REVOKE ALL ON FUNCTION public.complete_erp_sales_return_atomic(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.void_erp_sales_return_atomic(jsonb) FROM PUBLIC;

-- Explicitly revoke from anon just in case
REVOKE EXECUTE ON FUNCTION public.complete_erp_sales_return_atomic(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.void_erp_sales_return_atomic(jsonb) FROM anon;

-- Grant only to authenticated and service_role
GRANT EXECUTE ON FUNCTION public.complete_erp_sales_return_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_erp_sales_return_atomic(jsonb) TO service_role;

GRANT EXECUTE ON FUNCTION public.void_erp_sales_return_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_erp_sales_return_atomic(jsonb) TO service_role;