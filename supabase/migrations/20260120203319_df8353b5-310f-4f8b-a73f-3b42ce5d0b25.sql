-- Drop and recreate get_allow_unallocated_list with correct columns
DROP FUNCTION IF EXISTS public.get_allow_unallocated_list(date, date, uuid, uuid);

CREATE FUNCTION public.get_allow_unallocated_list(
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL
)
RETURNS TABLE (
  payment_id uuid,
  payment_code text,
  supplier_id uuid,
  supplier_name text,
  branch_id uuid,
  branch_name text,
  actor_id uuid,
  reason text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.payment_id,
    p.payment_number AS payment_code,
    p.supplier_id,
    s.supplier_name,
    p.branch_id,
    b.branch_name,
    e.created_by AS actor_id,
    COALESCE(e.reason, NULL) AS reason,
    e.created_at
  FROM payment_unallocated_events e
  JOIN payments p ON p.id = e.payment_id
  LEFT JOIN suppliers s ON s.id = p.supplier_id
  LEFT JOIN branches b ON b.id = p.branch_id
  WHERE (p_from_date IS NULL OR e.created_at::date >= p_from_date)
    AND (p_to_date IS NULL OR e.created_at::date <= p_to_date)
    AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
    AND (p_supplier_id IS NULL OR p.supplier_id = p_supplier_id)
  ORDER BY e.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_allow_unallocated_list(date, date, uuid, uuid) TO authenticated;