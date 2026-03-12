-- SET-HB-G1b: Tighten RPC Grants for payment_voucher_atomic
-- Only authenticated users can execute this function

-- Revoke all from PUBLIC (removes default grant)
REVOKE ALL ON FUNCTION public.payment_voucher_atomic(jsonb) FROM PUBLIC;

-- Revoke from anon explicitly
REVOKE ALL ON FUNCTION public.payment_voucher_atomic(jsonb) FROM anon;

-- Grant only to authenticated
GRANT EXECUTE ON FUNCTION public.payment_voucher_atomic(jsonb) TO authenticated;