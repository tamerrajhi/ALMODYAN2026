
-- Grant service_role EXECUTE on purchase return RPCs (needed for testing via SQL)
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_unique_items_atomic(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_general_atomic(jsonb) TO service_role;
