-- POS-P2E-FIX: Add overload generate_sale_code(uuid) to match RPC signature
-- Fixes error 42883: function public.generate_sale_code(uuid) does not exist

CREATE OR REPLACE FUNCTION public.generate_sale_code(p_branch_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  today_str TEXT;
  sale_count INTEGER;
BEGIN
  -- Currently: branch-agnostic pattern matching existing function
  -- p_branch_id exists for RPC signature compatibility; can be used later for per-branch sequences
  today_str := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
  
  SELECT COUNT(*) + 1 INTO sale_count
  FROM public.sales
  WHERE sale_code LIKE 'SL-' || today_str || '%';
  
  RETURN 'SL-' || today_str || '-' || LPAD(sale_count::TEXT, 4, '0');
END;
$$;

-- Security hardening: restrict execution to authenticated users only
REVOKE EXECUTE ON FUNCTION public.generate_sale_code(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_sale_code(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.generate_sale_code(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_sale_code(uuid) TO service_role;

COMMENT ON FUNCTION public.generate_sale_code(uuid) IS 
'POS-P2E: Overload to satisfy complete_pos_sale_atomic(v_branch_id) signature. Currently keeps SL-YYYYMMDD-#### pattern (branch-agnostic).';