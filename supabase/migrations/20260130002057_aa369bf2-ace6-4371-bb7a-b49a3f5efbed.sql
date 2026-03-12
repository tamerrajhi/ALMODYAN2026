-- =============================================
-- Compatibility Wrapper: generate_purchase_return_number(uuid)
-- Bridges uuid-based calls to the existing text-based function
-- =============================================

CREATE OR REPLACE FUNCTION public.generate_purchase_return_number(p_branch_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_code text;
BEGIN
  -- Lookup branch_code from branches table
  SELECT b.branch_code INTO v_branch_code
  FROM public.branches b
  WHERE b.id = p_branch_id;

  -- If branch not found or code is empty, fallback to general generation
  IF v_branch_code IS NULL OR v_branch_code = '' THEN
    RETURN public.generate_purchase_return_number(NULL::text);
  END IF;

  -- Call the original text-based function
  RETURN public.generate_purchase_return_number(v_branch_code);
END;
$$;

-- Grant execute permissions (matching existing security pattern)
GRANT EXECUTE ON FUNCTION public.generate_purchase_return_number(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_purchase_return_number(uuid) TO service_role;