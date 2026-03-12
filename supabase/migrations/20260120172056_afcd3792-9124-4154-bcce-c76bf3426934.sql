-- Phase 2 Monitoring Dashboard (Option 1)
-- Creates screens, role_permissions, and get_monitoring_summary RPC

-- ============================================
-- B1) Add missing screens records (upsert style)
-- ============================================

-- accounting_monitoring
INSERT INTO public.screens (id, screen_key, screen_path, screen_name, screen_name_en, parent_key, sort_order)
VALUES (
  gen_random_uuid(),
  'accounting_monitoring',
  '/accounting/monitoring',
  'مراقبة المحاسبة',
  'Accounting Monitoring',
  'accounting',
  80
)
ON CONFLICT (screen_key) DO NOTHING;

-- accounting_health_check
INSERT INTO public.screens (id, screen_key, screen_path, screen_name, screen_name_en, parent_key, sort_order)
VALUES (
  gen_random_uuid(),
  'accounting_health_check',
  '/accounting/health-check',
  'فحص صحة المحاسبة',
  'Accounting Health Check',
  'accounting',
  90
)
ON CONFLICT (screen_key) DO NOTHING;

-- ============================================
-- B2) Grant role_permissions.can_view for accounting_monitoring
-- ============================================

-- Grant to: المحاسب العام, المدير المالي, المدير العام, مدير النظام
-- Using INSERT ... ON CONFLICT to avoid duplicates

INSERT INTO public.role_permissions (id, role_id, screen_id, can_view, can_create, can_edit, can_delete)
SELECT 
  gen_random_uuid(),
  r.id,
  s.id,
  true,
  false,
  false,
  false
FROM public.custom_roles r
CROSS JOIN public.screens s
WHERE r.role_name IN ('المحاسب العام', 'المدير المالي', 'المدير العام', 'مدير النظام')
  AND s.screen_key = 'accounting_monitoring'
ON CONFLICT (role_id, screen_id) DO NOTHING;

-- Also grant for accounting_health_check (same roles)
INSERT INTO public.role_permissions (id, role_id, screen_id, can_view, can_create, can_edit, can_delete)
SELECT 
  gen_random_uuid(),
  r.id,
  s.id,
  true,
  false,
  false,
  false
FROM public.custom_roles r
CROSS JOIN public.screens s
WHERE r.role_name IN ('المحاسب العام', 'المدير المالي', 'المدير العام', 'مدير النظام')
  AND s.screen_key = 'accounting_health_check'
ON CONFLICT (role_id, screen_id) DO NOTHING;

-- ============================================
-- B3) Create RPC: public.get_monitoring_summary()
-- ============================================

CREATE OR REPLACE FUNCTION public.get_monitoring_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_hb_enable_date DATE := '2026-01-19';
  v_workflow_timeout_minutes INT := 15;
  v_tolerance NUMERIC := 0.01;
  
  v_hb_new_violations INT := 0;
  v_hb_legacy_count INT := 0;
  v_formula_mismatch_count INT := 0;
  v_negative_remaining_count INT := 0;
  v_overpaid_count INT := 0;
  v_stuck_workflows_count INT := 0;
  v_unbalanced_je_count INT := 0;
  v_notes TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- =============================================
  -- HB New Violations: supplier payments >= 2026-01-19 with no allocations
  -- =============================================
  SELECT COUNT(*)
  INTO v_hb_new_violations
  FROM public.payments p
  LEFT JOIN public.supplier_payment_allocations a ON a.payment_id = p.id
  WHERE p.payment_type = 'payment'
    AND p.supplier_id IS NOT NULL
    AND p.created_at >= v_hb_enable_date::timestamp with time zone
  GROUP BY p.id
  HAVING COUNT(a.id) = 0;
  
  -- Handle case when no rows match (COUNT returns null from aggregate)
  SELECT COALESCE(
    (SELECT COUNT(*) FROM (
      SELECT p.id
      FROM public.payments p
      LEFT JOIN public.supplier_payment_allocations a ON a.payment_id = p.id
      WHERE p.payment_type = 'payment'
        AND p.supplier_id IS NOT NULL
        AND p.created_at >= v_hb_enable_date::timestamp with time zone
      GROUP BY p.id
      HAVING COUNT(a.id) = 0
    ) sub),
    0
  ) INTO v_hb_new_violations;

  -- =============================================
  -- HB Legacy Count: supplier payments < 2026-01-19 with no allocations
  -- =============================================
  SELECT COALESCE(
    (SELECT COUNT(*) FROM (
      SELECT p.id
      FROM public.payments p
      LEFT JOIN public.supplier_payment_allocations a ON a.payment_id = p.id
      WHERE p.payment_type = 'payment'
        AND p.supplier_id IS NOT NULL
        AND p.created_at < v_hb_enable_date::timestamp with time zone
      GROUP BY p.id
      HAVING COUNT(a.id) = 0
    ) sub),
    0
  ) INTO v_hb_legacy_count;

  -- =============================================
  -- Formula Mismatch: remaining != (total - returned - paid)
  -- =============================================
  SELECT COUNT(*)
  INTO v_formula_mismatch_count
  FROM public.invoices
  WHERE ABS(
    remaining_amount - (total_amount - COALESCE(total_returned_amount, 0) - COALESCE(paid_amount, 0))
  ) > v_tolerance;

  -- =============================================
  -- Negative Remaining: remaining < -0.01
  -- =============================================
  SELECT COUNT(*)
  INTO v_negative_remaining_count
  FROM public.invoices
  WHERE remaining_amount < -v_tolerance;

  -- =============================================
  -- Overpaid: paid > (total - returned) + tolerance
  -- =============================================
  SELECT COUNT(*)
  INTO v_overpaid_count
  FROM public.invoices
  WHERE paid_amount > (total_amount - COALESCE(total_returned_amount, 0)) + v_tolerance;

  -- =============================================
  -- Stuck Workflows: in_progress > 15 minutes
  -- =============================================
  SELECT COUNT(*)
  INTO v_stuck_workflows_count
  FROM public.pos_workflow_requests
  WHERE status = 'in_progress'
    AND created_at < NOW() - (v_workflow_timeout_minutes || ' minutes')::interval;

  -- =============================================
  -- Unbalanced Journal Entries: total_debit != total_credit
  -- =============================================
  SELECT COUNT(*)
  INTO v_unbalanced_je_count
  FROM public.journal_entries
  WHERE ABS(COALESCE(total_debit, 0) - COALESCE(total_credit, 0)) > v_tolerance;

  -- Add notes for limitations
  v_notes := v_notes || 'allow_unallocated flag not tracked in payments table; metric excluded';

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
    'generated_at', NOW(),
    'notes', to_jsonb(v_notes)
  );
END;
$$;

-- ============================================
-- B4) Grants: authenticated only
-- ============================================
REVOKE ALL ON FUNCTION public.get_monitoring_summary() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_monitoring_summary() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_monitoring_summary() TO authenticated;

COMMENT ON FUNCTION public.get_monitoring_summary() IS 'Phase 2 Monitoring Dashboard - Returns KPI summary for accounting monitoring';