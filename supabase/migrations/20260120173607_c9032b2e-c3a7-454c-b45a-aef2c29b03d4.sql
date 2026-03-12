-- Phase 2 Hotfix: Fix get_monitoring_summary() to avoid multi-row SELECT INTO bug
-- This replaces the faulty GROUP BY...HAVING...INTO with safe subquery pattern

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

  -- HB Legacy Count: Supplier payments before enable date with no allocations
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

  -- Add note about allow_unallocated not being tracked
  v_notes := array_append(v_notes, 'allow_unallocated_count is NULL because allow_unallocated flag is not persisted in payments table');

  RETURN jsonb_build_object(
    'hb_enable_date', v_hb_enable_date,
    'workflow_timeout_minutes', v_workflow_timeout_minutes,
    'tolerance', v_tolerance,
    'hb_new_violations', v_hb_new_violations,
    'hb_legacy_count', v_hb_legacy_count,
    'allow_unallocated_count', NULL,
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

-- Re-apply security grants
REVOKE ALL ON FUNCTION public.get_monitoring_summary() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_monitoring_summary() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_monitoring_summary() TO authenticated;

COMMENT ON FUNCTION public.get_monitoring_summary() IS 'Phase 2 Monitoring Dashboard RPC - Returns accounting health KPIs';