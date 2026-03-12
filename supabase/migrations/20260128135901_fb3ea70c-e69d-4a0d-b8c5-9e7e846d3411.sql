-- ============================================================
-- D2-5.2 C1-FIX: REVOKE anon on complete_purchase_return_general_atomic
-- The original REVOKE failed silently - enforce it now
-- ============================================================

-- Force revoke from PUBLIC first (in case it inherited)
REVOKE ALL ON FUNCTION public.complete_purchase_return_general_atomic(jsonb) FROM PUBLIC;

-- Explicit revoke from anon
REVOKE EXECUTE ON FUNCTION public.complete_purchase_return_general_atomic(jsonb) FROM anon;

-- Re-grant to authenticated and service_role only
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_general_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_general_atomic(jsonb) TO service_role;

-- Add governance comment
COMMENT ON FUNCTION public.complete_purchase_return_general_atomic(jsonb) IS
  'D2-5.2 C1-FIX: anon EXECUTE revoked. Canonical atomic RPC for general returns.';