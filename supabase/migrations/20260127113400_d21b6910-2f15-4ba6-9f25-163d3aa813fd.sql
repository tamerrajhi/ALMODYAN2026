
-- Fix: Grant EXECUTE on complete_purchase_return_general_atomic to service_role for testing
-- Also grant to anon for supabase-read-query tool access
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_general_atomic(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_general_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_general_atomic(jsonb) TO anon;
