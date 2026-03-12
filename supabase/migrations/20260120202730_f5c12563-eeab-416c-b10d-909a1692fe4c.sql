-- Recreate get_allow_unallocated_list with correct column name
CREATE OR REPLACE FUNCTION public.get_allow_unallocated_list(
  p_from_date date DEFAULT NULL::date, 
  p_to_date date DEFAULT NULL::date, 
  p_branch_id uuid DEFAULT NULL::uuid, 
  p_supplier_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  event_id uuid, 
  payment_id uuid, 
  payment_number text, 
  payment_date date, 
  amount numeric, 
  supplier_id uuid, 
  supplier_name text, 
  branch_id uuid, 
  branch_name text, 
  actor_id uuid, 
  reason text, 
  created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    e.id AS event_id,
    p.id AS payment_id,
    p.payment_number,
    p.payment_date,
    p.amount,
    p.supplier_id,
    s.supplier_name AS supplier_name,
    p.branch_id,
    b.branch_name,
    e.actor_id,
    e.reason,
    e.created_at
  FROM payment_unallocated_events e
  INNER JOIN payments p ON p.id = e.payment_id
  LEFT JOIN suppliers s ON s.id = p.supplier_id
  LEFT JOIN branches b ON b.id = p.branch_id
  WHERE (p_from_date IS NULL OR p.payment_date >= p_from_date)
    AND (p_to_date IS NULL OR p.payment_date <= p_to_date)
    AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
    AND (p_supplier_id IS NULL OR p.supplier_id = p_supplier_id)
  ORDER BY e.created_at DESC;
END;
$function$;

-- Recreate get_formula_mismatch_list with correct column name
CREATE OR REPLACE FUNCTION public.get_formula_mismatch_list(
  p_from_date date DEFAULT NULL::date, 
  p_to_date date DEFAULT NULL::date, 
  p_branch_id uuid DEFAULT NULL::uuid, 
  p_supplier_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  invoice_id uuid, 
  invoice_number text, 
  invoice_type text, 
  invoice_date date, 
  supplier_id uuid, 
  supplier_name text, 
  branch_id uuid, 
  branch_name text, 
  total_amount numeric, 
  total_returned_amount numeric, 
  paid_amount numeric, 
  remaining_amount numeric, 
  expected_remaining numeric, 
  mismatch_amount numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_tolerance numeric := 0.01;
BEGIN
  RETURN QUERY
  SELECT 
    i.id AS invoice_id,
    i.invoice_number,
    i.invoice_type,
    i.invoice_date,
    i.supplier_id,
    s.supplier_name AS supplier_name,
    i.branch_id,
    b.branch_name,
    i.total_amount,
    COALESCE(i.total_returned_amount, 0) AS total_returned_amount,
    COALESCE(i.paid_amount, 0) AS paid_amount,
    i.remaining_amount,
    (i.total_amount - COALESCE(i.total_returned_amount, 0) - COALESCE(i.paid_amount, 0)) AS expected_remaining,
    (i.remaining_amount - (i.total_amount - COALESCE(i.total_returned_amount, 0) - COALESCE(i.paid_amount, 0))) AS mismatch_amount
  FROM invoices i
  LEFT JOIN suppliers s ON s.id = i.supplier_id
  LEFT JOIN branches b ON b.id = i.branch_id
  WHERE ABS(i.remaining_amount - (i.total_amount - COALESCE(i.total_returned_amount, 0) - COALESCE(i.paid_amount, 0))) > v_tolerance
    AND (p_from_date IS NULL OR i.invoice_date >= p_from_date)
    AND (p_to_date IS NULL OR i.invoice_date <= p_to_date)
    AND (p_branch_id IS NULL OR i.branch_id = p_branch_id)
    AND (p_supplier_id IS NULL OR i.supplier_id = p_supplier_id)
  ORDER BY ABS(i.remaining_amount - (i.total_amount - COALESCE(i.total_returned_amount, 0) - COALESCE(i.paid_amount, 0))) DESC;
END;
$function$;

-- Recreate get_negative_remaining_list with correct column name
CREATE OR REPLACE FUNCTION public.get_negative_remaining_list(
  p_from_date date DEFAULT NULL::date, 
  p_to_date date DEFAULT NULL::date, 
  p_branch_id uuid DEFAULT NULL::uuid, 
  p_supplier_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  invoice_id uuid, 
  invoice_number text, 
  invoice_type text, 
  invoice_date date, 
  supplier_id uuid, 
  supplier_name text, 
  branch_id uuid, 
  branch_name text, 
  total_amount numeric, 
  total_returned_amount numeric, 
  paid_amount numeric, 
  remaining_amount numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_tolerance numeric := 0.01;
BEGIN
  RETURN QUERY
  SELECT 
    i.id AS invoice_id,
    i.invoice_number,
    i.invoice_type,
    i.invoice_date,
    i.supplier_id,
    s.supplier_name AS supplier_name,
    i.branch_id,
    b.branch_name,
    i.total_amount,
    COALESCE(i.total_returned_amount, 0) AS total_returned_amount,
    COALESCE(i.paid_amount, 0) AS paid_amount,
    i.remaining_amount
  FROM invoices i
  LEFT JOIN suppliers s ON s.id = i.supplier_id
  LEFT JOIN branches b ON b.id = i.branch_id
  WHERE i.remaining_amount < -v_tolerance
    AND (p_from_date IS NULL OR i.invoice_date >= p_from_date)
    AND (p_to_date IS NULL OR i.invoice_date <= p_to_date)
    AND (p_branch_id IS NULL OR i.branch_id = p_branch_id)
    AND (p_supplier_id IS NULL OR i.supplier_id = p_supplier_id)
  ORDER BY i.remaining_amount ASC;
END;
$function$;

-- Recreate get_overpaid_list with correct column name
CREATE OR REPLACE FUNCTION public.get_overpaid_list(
  p_from_date date DEFAULT NULL::date, 
  p_to_date date DEFAULT NULL::date, 
  p_branch_id uuid DEFAULT NULL::uuid, 
  p_supplier_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  invoice_id uuid, 
  invoice_number text, 
  invoice_type text, 
  invoice_date date, 
  supplier_id uuid, 
  supplier_name text, 
  branch_id uuid, 
  branch_name text, 
  total_amount numeric, 
  total_returned_amount numeric, 
  paid_amount numeric, 
  overpaid_amount numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_tolerance numeric := 0.01;
BEGIN
  RETURN QUERY
  SELECT 
    i.id AS invoice_id,
    i.invoice_number,
    i.invoice_type,
    i.invoice_date,
    i.supplier_id,
    s.supplier_name AS supplier_name,
    i.branch_id,
    b.branch_name,
    i.total_amount,
    COALESCE(i.total_returned_amount, 0) AS total_returned_amount,
    COALESCE(i.paid_amount, 0) AS paid_amount,
    (COALESCE(i.paid_amount, 0) - (i.total_amount - COALESCE(i.total_returned_amount, 0))) AS overpaid_amount
  FROM invoices i
  LEFT JOIN suppliers s ON s.id = i.supplier_id
  LEFT JOIN branches b ON b.id = i.branch_id
  WHERE COALESCE(i.paid_amount, 0) > (i.total_amount - COALESCE(i.total_returned_amount, 0)) + v_tolerance
    AND (p_from_date IS NULL OR i.invoice_date >= p_from_date)
    AND (p_to_date IS NULL OR i.invoice_date <= p_to_date)
    AND (p_branch_id IS NULL OR i.branch_id = p_branch_id)
    AND (p_supplier_id IS NULL OR i.supplier_id = p_supplier_id)
  ORDER BY (COALESCE(i.paid_amount, 0) - (i.total_amount - COALESCE(i.total_returned_amount, 0))) DESC;
END;
$function$;

-- Recreate get_hb_legacy_list with correct column name
CREATE OR REPLACE FUNCTION public.get_hb_legacy_list(
  p_from_date date DEFAULT NULL::date, 
  p_to_date date DEFAULT NULL::date, 
  p_branch_id uuid DEFAULT NULL::uuid, 
  p_supplier_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  payment_id uuid, 
  payment_number text, 
  payment_date date, 
  amount numeric, 
  supplier_id uuid, 
  supplier_name text, 
  branch_id uuid, 
  branch_name text, 
  created_at timestamp with time zone, 
  hb_legacy_classification hb_legacy_classification, 
  hb_legacy_notes text, 
  hb_legacy_approved_by uuid, 
  hb_legacy_approved_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_hb_enable_date timestamp := '2026-01-19'::timestamp;
BEGIN
  RETURN QUERY
  SELECT 
    p.id AS payment_id,
    p.payment_number,
    p.payment_date,
    p.amount,
    p.supplier_id,
    s.supplier_name AS supplier_name,
    p.branch_id,
    b.branch_name,
    p.created_at,
    p.hb_legacy_classification,
    p.hb_legacy_notes,
    p.hb_legacy_approved_by,
    p.hb_legacy_approved_at
  FROM payments p
  LEFT JOIN supplier_payment_allocations a ON a.payment_id = p.id
  LEFT JOIN suppliers s ON s.id = p.supplier_id
  LEFT JOIN branches b ON b.id = p.branch_id
  WHERE p.payment_type = 'payment'
    AND p.supplier_id IS NOT NULL
    AND p.created_at < v_hb_enable_date
    AND (p_from_date IS NULL OR p.payment_date >= p_from_date)
    AND (p_to_date IS NULL OR p.payment_date <= p_to_date)
    AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
    AND (p_supplier_id IS NULL OR p.supplier_id = p_supplier_id)
  GROUP BY p.id, s.supplier_name, b.branch_name
  HAVING COUNT(a.id) = 0
  ORDER BY p.created_at DESC;
END;
$function$;

-- Recreate get_hb_new_violations_list with correct column name
CREATE OR REPLACE FUNCTION public.get_hb_new_violations_list(
  p_from_date date DEFAULT NULL::date, 
  p_to_date date DEFAULT NULL::date, 
  p_branch_id uuid DEFAULT NULL::uuid, 
  p_supplier_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  payment_id uuid, 
  payment_number text, 
  payment_date date, 
  amount numeric, 
  supplier_id uuid, 
  supplier_name text, 
  branch_id uuid, 
  branch_name text, 
  created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_hb_enable_date timestamp := '2026-01-19'::timestamp;
BEGIN
  RETURN QUERY
  SELECT 
    p.id AS payment_id,
    p.payment_number,
    p.payment_date,
    p.amount,
    p.supplier_id,
    s.supplier_name AS supplier_name,
    p.branch_id,
    b.branch_name,
    p.created_at
  FROM payments p
  LEFT JOIN supplier_payment_allocations a ON a.payment_id = p.id
  LEFT JOIN suppliers s ON s.id = p.supplier_id
  LEFT JOIN branches b ON b.id = p.branch_id
  WHERE p.payment_type = 'payment'
    AND p.supplier_id IS NOT NULL
    AND p.created_at >= v_hb_enable_date
    AND (p_from_date IS NULL OR p.payment_date >= p_from_date)
    AND (p_to_date IS NULL OR p.payment_date <= p_to_date)
    AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
    AND (p_supplier_id IS NULL OR p.supplier_id = p_supplier_id)
  GROUP BY p.id, s.supplier_name, b.branch_name
  HAVING COUNT(a.id) = 0
  ORDER BY p.created_at DESC;
END;
$function$;

-- Grant execute to authenticated for all functions
GRANT EXECUTE ON FUNCTION public.get_allow_unallocated_list(date, date, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_formula_mismatch_list(date, date, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_negative_remaining_list(date, date, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_overpaid_list(date, date, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_hb_legacy_list(date, date, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_hb_new_violations_list(date, date, uuid, uuid) TO authenticated;