-- Grant execute permission to authenticated users for payment_voucher_atomic
GRANT EXECUTE ON FUNCTION public.payment_voucher_atomic(jsonb) TO authenticated;

-- Future-proof: auto-grant execute on new functions in public schema
ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT EXECUTE ON FUNCTIONS TO authenticated;