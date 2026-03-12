-- Phase 3-B: KPI Drill-Down RPCs + Legacy Cleanup Atomic Operations
-- =====================================================
-- A) Schema changes for allow_unallocated tracking
-- =====================================================

-- Add allow_unallocated flag to payments table to track escape-hatch usage
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS allow_unallocated boolean DEFAULT false;

-- Add legacy_classification column for HB legacy cases tracking
CREATE TYPE public.hb_legacy_classification AS ENUM ('pending', 'backfilled', 'advance_payment', 'approved_exception');

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS hb_legacy_classification public.hb_legacy_classification DEFAULT 'pending';
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS hb_legacy_notes text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS hb_legacy_approved_by uuid;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS hb_legacy_approved_at timestamptz;

COMMENT ON COLUMN public.payments.allow_unallocated IS 'True if payment was created using allow_unallocated escape hatch';
COMMENT ON COLUMN public.payments.hb_legacy_classification IS 'Classification for legacy payments without allocations';

-- =====================================================
-- B) Drill-Down RPCs (READ-ONLY)
-- =====================================================

-- B1: get_hb_legacy_list - Supplier payments before HB enable date without allocations
CREATE OR REPLACE FUNCTION public.get_hb_legacy_list(
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL
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
  created_at timestamptz,
  hb_legacy_classification public.hb_legacy_classification,
  hb_legacy_notes text,
  hb_legacy_approved_by uuid,
  hb_legacy_approved_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
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
    s.name AS supplier_name,
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
  GROUP BY p.id, s.name, b.branch_name
  HAVING COUNT(a.id) = 0
  ORDER BY p.created_at DESC;
END;
$$;

-- B2: get_hb_new_violations_list - Supplier payments after HB enable date without allocations
CREATE OR REPLACE FUNCTION public.get_hb_new_violations_list(
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL
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
  created_at timestamptz,
  allow_unallocated boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
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
    s.name AS supplier_name,
    p.branch_id,
    b.branch_name,
    p.created_at,
    p.allow_unallocated
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
  GROUP BY p.id, s.name, b.branch_name
  HAVING COUNT(a.id) = 0
  ORDER BY p.created_at DESC;
END;
$$;

-- B3: get_allow_unallocated_list - Payments created with escape hatch
CREATE OR REPLACE FUNCTION public.get_allow_unallocated_list(
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL
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
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id AS payment_id,
    p.payment_number,
    p.payment_date,
    p.amount,
    p.supplier_id,
    s.name AS supplier_name,
    p.branch_id,
    b.branch_name,
    p.created_at
  FROM payments p
  LEFT JOIN suppliers s ON s.id = p.supplier_id
  LEFT JOIN branches b ON b.id = p.branch_id
  WHERE p.allow_unallocated = true
    AND (p_from_date IS NULL OR p.payment_date >= p_from_date)
    AND (p_to_date IS NULL OR p.payment_date <= p_to_date)
    AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
    AND (p_supplier_id IS NULL OR p.supplier_id = p_supplier_id)
  ORDER BY p.created_at DESC;
END;
$$;

-- B4: get_formula_mismatch_list - Invoices where remaining != total - returned - paid
CREATE OR REPLACE FUNCTION public.get_formula_mismatch_list(
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL
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
SET search_path = pg_catalog, public, extensions
AS $$
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
    s.name AS supplier_name,
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
$$;

-- B5: get_negative_remaining_list - Invoices with negative remaining
CREATE OR REPLACE FUNCTION public.get_negative_remaining_list(
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL
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
  paid_amount numeric,
  remaining_amount numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
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
    s.name AS supplier_name,
    i.branch_id,
    b.branch_name,
    i.total_amount,
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
$$;

-- B6: get_overpaid_list - Invoices where paid > total - returned
CREATE OR REPLACE FUNCTION public.get_overpaid_list(
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL
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
SET search_path = pg_catalog, public, extensions
AS $$
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
    s.name AS supplier_name,
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
$$;

-- B7: get_stuck_workflows_list - Workflows stuck in_progress > 15 minutes
CREATE OR REPLACE FUNCTION public.get_stuck_workflows_list(
  p_workflow_type text DEFAULT NULL,
  p_from_date timestamptz DEFAULT NULL,
  p_to_date timestamptz DEFAULT NULL
)
RETURNS TABLE(
  client_request_id uuid,
  workflow_type text,
  entity_id uuid,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  minutes_stuck numeric,
  error_code text,
  error_message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_timeout_minutes int := 15;
BEGIN
  RETURN QUERY
  SELECT 
    w.client_request_id,
    w.workflow_type,
    w.entity_id,
    w.status,
    w.created_at,
    w.updated_at,
    EXTRACT(EPOCH FROM (NOW() - w.created_at)) / 60 AS minutes_stuck,
    w.error_code,
    w.error_message
  FROM pos_workflow_requests w
  WHERE w.status = 'in_progress'
    AND w.created_at < NOW() - (v_timeout_minutes || ' minutes')::interval
    AND (p_workflow_type IS NULL OR w.workflow_type = p_workflow_type)
    AND (p_from_date IS NULL OR w.created_at >= p_from_date)
    AND (p_to_date IS NULL OR w.created_at <= p_to_date)
  ORDER BY w.created_at ASC;
END;
$$;

-- B8: get_unbalanced_je_list - Journal entries with debit != credit
CREATE OR REPLACE FUNCTION public.get_unbalanced_je_list(
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL,
  p_reference_type text DEFAULT NULL
)
RETURNS TABLE(
  journal_entry_id uuid,
  entry_number text,
  entry_date date,
  reference_type text,
  reference_id uuid,
  description text,
  total_debit numeric,
  total_credit numeric,
  imbalance_amount numeric,
  is_posted boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_tolerance numeric := 0.01;
BEGIN
  RETURN QUERY
  SELECT 
    j.id AS journal_entry_id,
    j.entry_number,
    j.entry_date,
    j.reference_type,
    j.reference_id,
    j.description,
    COALESCE(j.total_debit, 0) AS total_debit,
    COALESCE(j.total_credit, 0) AS total_credit,
    ABS(COALESCE(j.total_debit, 0) - COALESCE(j.total_credit, 0)) AS imbalance_amount,
    j.is_posted
  FROM journal_entries j
  WHERE ABS(COALESCE(j.total_debit, 0) - COALESCE(j.total_credit, 0)) > v_tolerance
    AND (p_from_date IS NULL OR j.entry_date >= p_from_date)
    AND (p_to_date IS NULL OR j.entry_date <= p_to_date)
    AND (p_reference_type IS NULL OR j.reference_type = p_reference_type)
  ORDER BY ABS(COALESCE(j.total_debit, 0) - COALESCE(j.total_credit, 0)) DESC;
END;
$$;

-- =====================================================
-- C) Update get_monitoring_summary to include allow_unallocated_count
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_monitoring_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_hb_enable_date text := '2026-01-19';
  v_workflow_timeout_minutes int := 15;
  v_tolerance numeric := 0.01;
  v_hb_new_violations int;
  v_hb_legacy_count int;
  v_hb_legacy_unresolved int;
  v_allow_unallocated_count int;
  v_formula_mismatch_count int;
  v_negative_remaining_count int;
  v_overpaid_count int;
  v_stuck_workflows_count int;
  v_unbalanced_je_count int;
  v_notes text[] := ARRAY[]::text[];
BEGIN
  -- HB New Violations: Supplier payments after enable date with no allocations
  SELECT COALESCE((
    SELECT COUNT(*) FROM (
      SELECT p.id
      FROM payments p
      LEFT JOIN supplier_payment_allocations a ON a.payment_id = p.id
      WHERE p.payment_type = 'payment'
        AND p.supplier_id IS NOT NULL
        AND p.created_at >= v_hb_enable_date::timestamp
      GROUP BY p.id
      HAVING COUNT(a.id) = 0
    ) sub
  ), 0) INTO v_hb_new_violations;

  -- HB Legacy Count: Supplier payments before enable date with no allocations (total)
  SELECT COALESCE((
    SELECT COUNT(*) FROM (
      SELECT p.id
      FROM payments p
      LEFT JOIN supplier_payment_allocations a ON a.payment_id = p.id
      WHERE p.payment_type = 'payment'
        AND p.supplier_id IS NOT NULL
        AND p.created_at < v_hb_enable_date::timestamp
      GROUP BY p.id
      HAVING COUNT(a.id) = 0
    ) sub
  ), 0) INTO v_hb_legacy_count;

  -- HB Legacy Unresolved: Only those still pending classification
  SELECT COALESCE((
    SELECT COUNT(*) FROM (
      SELECT p.id
      FROM payments p
      LEFT JOIN supplier_payment_allocations a ON a.payment_id = p.id
      WHERE p.payment_type = 'payment'
        AND p.supplier_id IS NOT NULL
        AND p.created_at < v_hb_enable_date::timestamp
        AND (p.hb_legacy_classification IS NULL OR p.hb_legacy_classification = 'pending')
      GROUP BY p.id
      HAVING COUNT(a.id) = 0
    ) sub
  ), 0) INTO v_hb_legacy_unresolved;

  -- Allow Unallocated Count
  SELECT COUNT(*) INTO v_allow_unallocated_count
  FROM payments
  WHERE allow_unallocated = true;

  -- Formula Mismatch Count
  SELECT COUNT(*) INTO v_formula_mismatch_count
  FROM invoices
  WHERE ABS(remaining_amount - (total_amount - COALESCE(total_returned_amount, 0) - COALESCE(paid_amount, 0))) > v_tolerance;

  -- Negative Remaining Count
  SELECT COUNT(*) INTO v_negative_remaining_count
  FROM invoices
  WHERE remaining_amount < -v_tolerance;

  -- Overpaid Count
  SELECT COUNT(*) INTO v_overpaid_count
  FROM invoices
  WHERE paid_amount > (total_amount - COALESCE(total_returned_amount, 0)) + v_tolerance;

  -- Stuck Workflows Count (in_progress for more than 15 minutes)
  SELECT COUNT(*) INTO v_stuck_workflows_count
  FROM pos_workflow_requests
  WHERE status = 'in_progress'
    AND created_at < NOW() - (v_workflow_timeout_minutes || ' minutes')::interval;

  -- Unbalanced Journal Entries Count
  SELECT COUNT(*) INTO v_unbalanced_je_count
  FROM journal_entries
  WHERE ABS(COALESCE(total_debit, 0) - COALESCE(total_credit, 0)) > v_tolerance;

  RETURN jsonb_build_object(
    'hb_enable_date', v_hb_enable_date,
    'workflow_timeout_minutes', v_workflow_timeout_minutes,
    'tolerance', v_tolerance,
    'hb_new_violations', v_hb_new_violations,
    'hb_legacy_count', v_hb_legacy_count,
    'hb_legacy_unresolved', v_hb_legacy_unresolved,
    'allow_unallocated_count', v_allow_unallocated_count,
    'formula_mismatch_count', v_formula_mismatch_count,
    'negative_remaining_count', v_negative_remaining_count,
    'overpaid_count', v_overpaid_count,
    'stuck_workflows_count', v_stuck_workflows_count,
    'unbalanced_je_count', v_unbalanced_je_count,
    'generated_at', NOW()::text,
    'notes', to_jsonb(v_notes)
  );
END;
$$;

-- =====================================================
-- D) Atomic RPCs for Legacy Cleanup
-- =====================================================

-- D1: classify_hb_legacy_payment - Classify a legacy payment
CREATE OR REPLACE FUNCTION public.classify_hb_legacy_payment(
  p_payment_id uuid,
  p_classification public.hb_legacy_classification,
  p_notes text DEFAULT NULL,
  p_approved_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_payment payments%ROWTYPE;
  v_hb_enable_date timestamp := '2026-01-19'::timestamp;
BEGIN
  -- Validate payment exists and is legacy
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id;
  
  IF v_payment IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment not found');
  END IF;
  
  IF v_payment.payment_type != 'payment' OR v_payment.supplier_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not a supplier payment');
  END IF;
  
  IF v_payment.created_at >= v_hb_enable_date THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment is after HB enable date - not a legacy case');
  END IF;
  
  -- Verify it has no allocations
  IF EXISTS (SELECT 1 FROM supplier_payment_allocations WHERE payment_id = p_payment_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment already has allocations');
  END IF;
  
  -- Update classification
  UPDATE payments SET
    hb_legacy_classification = p_classification,
    hb_legacy_notes = p_notes,
    hb_legacy_approved_by = CASE WHEN p_classification = 'approved_exception' THEN p_approved_by ELSE NULL END,
    hb_legacy_approved_at = CASE WHEN p_classification = 'approved_exception' THEN NOW() ELSE NULL END
  WHERE id = p_payment_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'payment_id', p_payment_id,
    'classification', p_classification::text
  );
END;
$$;

-- D2: backfill_payment_allocation - Create allocation for legacy payment
CREATE OR REPLACE FUNCTION public.backfill_payment_allocation(
  p_payment_id uuid,
  p_invoice_id uuid,
  p_amount numeric,
  p_notes text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_payment payments%ROWTYPE;
  v_invoice invoices%ROWTYPE;
  v_allocation_id uuid;
  v_hb_enable_date timestamp := '2026-01-19'::timestamp;
BEGIN
  -- Validate payment exists and is legacy
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id;
  
  IF v_payment IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment not found');
  END IF;
  
  IF v_payment.created_at >= v_hb_enable_date THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment is after HB enable date - use regular allocation flow');
  END IF;
  
  -- Validate invoice exists
  SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id;
  
  IF v_invoice IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invoice not found');
  END IF;
  
  -- Validate same supplier
  IF v_payment.supplier_id != v_invoice.supplier_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Supplier mismatch between payment and invoice');
  END IF;
  
  -- Validate amount
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
  END IF;
  
  IF p_amount > v_payment.amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount exceeds payment amount');
  END IF;
  
  IF p_amount > v_invoice.remaining_amount + 0.01 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount exceeds invoice remaining amount');
  END IF;
  
  -- Create allocation
  INSERT INTO supplier_payment_allocations (
    payment_id,
    invoice_id,
    amount,
    notes,
    created_at
  ) VALUES (
    p_payment_id,
    p_invoice_id,
    p_amount,
    COALESCE(p_notes, 'Backfilled legacy allocation'),
    NOW()
  )
  RETURNING id INTO v_allocation_id;
  
  -- Update invoice paid_amount and remaining_amount
  UPDATE invoices SET
    paid_amount = COALESCE(paid_amount, 0) + p_amount,
    remaining_amount = remaining_amount - p_amount,
    updated_at = NOW()
  WHERE id = p_invoice_id;
  
  -- Update payment classification
  UPDATE payments SET
    hb_legacy_classification = 'backfilled',
    hb_legacy_notes = COALESCE(p_notes, 'Backfilled legacy allocation')
  WHERE id = p_payment_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'allocation_id', v_allocation_id,
    'payment_id', p_payment_id,
    'invoice_id', p_invoice_id,
    'amount', p_amount
  );
END;
$$;

-- =====================================================
-- E) Security Grants
-- =====================================================

-- Revoke from public/anon, grant to authenticated
REVOKE ALL ON FUNCTION public.get_hb_legacy_list(date, date, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_hb_legacy_list(date, date, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_hb_new_violations_list(date, date, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_hb_new_violations_list(date, date, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_allow_unallocated_list(date, date, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_allow_unallocated_list(date, date, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_formula_mismatch_list(date, date, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_formula_mismatch_list(date, date, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_negative_remaining_list(date, date, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_negative_remaining_list(date, date, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_overpaid_list(date, date, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_overpaid_list(date, date, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_stuck_workflows_list(text, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_stuck_workflows_list(text, timestamptz, timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.get_unbalanced_je_list(date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_unbalanced_je_list(date, date, text) TO authenticated;

REVOKE ALL ON FUNCTION public.classify_hb_legacy_payment(uuid, public.hb_legacy_classification, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.classify_hb_legacy_payment(uuid, public.hb_legacy_classification, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.backfill_payment_allocation(uuid, uuid, numeric, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.backfill_payment_allocation(uuid, uuid, numeric, text, uuid) TO authenticated;

-- Re-apply monitoring summary grants
REVOKE ALL ON FUNCTION public.get_monitoring_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_monitoring_summary() TO authenticated;

COMMENT ON FUNCTION public.get_hb_legacy_list(date, date, uuid, uuid) IS 'Phase 3-B: Drill-down for HB legacy payments without allocations';
COMMENT ON FUNCTION public.get_hb_new_violations_list(date, date, uuid, uuid) IS 'Phase 3-B: Drill-down for HB new violations';
COMMENT ON FUNCTION public.get_allow_unallocated_list(date, date, uuid, uuid) IS 'Phase 3-B: Drill-down for allow_unallocated escape hatch usage';
COMMENT ON FUNCTION public.get_formula_mismatch_list(date, date, uuid, uuid) IS 'Phase 3-B: Drill-down for formula mismatch invoices';
COMMENT ON FUNCTION public.get_negative_remaining_list(date, date, uuid, uuid) IS 'Phase 3-B: Drill-down for negative remaining invoices';
COMMENT ON FUNCTION public.get_overpaid_list(date, date, uuid, uuid) IS 'Phase 3-B: Drill-down for overpaid invoices';
COMMENT ON FUNCTION public.get_stuck_workflows_list(text, timestamptz, timestamptz) IS 'Phase 3-B: Drill-down for stuck workflows';
COMMENT ON FUNCTION public.get_unbalanced_je_list(date, date, text) IS 'Phase 3-B: Drill-down for unbalanced journal entries';
COMMENT ON FUNCTION public.classify_hb_legacy_payment(uuid, public.hb_legacy_classification, text, uuid) IS 'Phase 3-B: Classify legacy payment for HB cleanup';
COMMENT ON FUNCTION public.backfill_payment_allocation(uuid, uuid, numeric, text, uuid) IS 'Phase 3-B: Backfill allocation for legacy payment';