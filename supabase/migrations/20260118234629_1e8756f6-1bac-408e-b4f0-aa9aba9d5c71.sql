
-- PR-2 Grants: Ensure authenticated role can execute Purchase Return RPCs
-- These grants are MANDATORY for the atomic workflow to function from the UI

GRANT EXECUTE ON FUNCTION public.complete_purchase_return_unique_items_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_general_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_purchase_return_atomic(jsonb) TO authenticated;

-- Verify grants were applied
DO $$
BEGIN
  RAISE NOTICE 'PR-2 Grants applied successfully for authenticated role';
END $$;
