-- =====================================================
-- Phase 3-B Gate Tests
-- SQL verification queries for KPI drill-down consistency
-- =====================================================

-- E.1) Verify hb_legacy_count matches drill-down list count
WITH summary AS (
  SELECT (get_monitoring_summary()->'hb_legacy_count')::int AS count
),
drilldown AS (
  SELECT COUNT(*) AS count FROM get_hb_legacy_list(NULL, NULL, NULL, NULL)
)
SELECT 
  'hb_legacy_count' AS metric,
  s.count AS summary_count,
  d.count AS drilldown_count,
  CASE WHEN s.count = d.count THEN '✓ PASS' ELSE '✗ FAIL' END AS status
FROM summary s, drilldown d;

-- E.2) Verify hb_new_violations matches drill-down list count
WITH summary AS (
  SELECT (get_monitoring_summary()->'hb_new_violations')::int AS count
),
drilldown AS (
  SELECT COUNT(*) AS count FROM get_hb_new_violations_list(NULL, NULL, NULL, NULL)
)
SELECT 
  'hb_new_violations' AS metric,
  s.count AS summary_count,
  d.count AS drilldown_count,
  CASE WHEN s.count = d.count THEN '✓ PASS' ELSE '✗ FAIL' END AS status
FROM summary s, drilldown d;

-- E.3) Verify allow_unallocated_count matches drill-down list count
WITH summary AS (
  SELECT (get_monitoring_summary()->'allow_unallocated_count')::int AS count
),
drilldown AS (
  SELECT COUNT(*) AS count FROM get_allow_unallocated_list(NULL, NULL, NULL, NULL)
)
SELECT 
  'allow_unallocated_count' AS metric,
  s.count AS summary_count,
  d.count AS drilldown_count,
  CASE WHEN s.count = d.count THEN '✓ PASS' ELSE '✗ FAIL' END AS status
FROM summary s, drilldown d;

-- E.4) Verify formula_mismatch_count matches drill-down list count
WITH summary AS (
  SELECT (get_monitoring_summary()->'formula_mismatch_count')::int AS count
),
drilldown AS (
  SELECT COUNT(*) AS count FROM get_formula_mismatch_list(NULL, NULL, NULL, NULL)
)
SELECT 
  'formula_mismatch_count' AS metric,
  s.count AS summary_count,
  d.count AS drilldown_count,
  CASE WHEN s.count = d.count THEN '✓ PASS' ELSE '✗ FAIL' END AS status
FROM summary s, drilldown d;

-- E.5) Verify negative_remaining_count matches drill-down list count
WITH summary AS (
  SELECT (get_monitoring_summary()->'negative_remaining_count')::int AS count
),
drilldown AS (
  SELECT COUNT(*) AS count FROM get_negative_remaining_list(NULL, NULL, NULL, NULL)
)
SELECT 
  'negative_remaining_count' AS metric,
  s.count AS summary_count,
  d.count AS drilldown_count,
  CASE WHEN s.count = d.count THEN '✓ PASS' ELSE '✗ FAIL' END AS status
FROM summary s, drilldown d;

-- E.6) Verify overpaid_count matches drill-down list count
WITH summary AS (
  SELECT (get_monitoring_summary()->'overpaid_count')::int AS count
),
drilldown AS (
  SELECT COUNT(*) AS count FROM get_overpaid_list(NULL, NULL, NULL, NULL)
)
SELECT 
  'overpaid_count' AS metric,
  s.count AS summary_count,
  d.count AS drilldown_count,
  CASE WHEN s.count = d.count THEN '✓ PASS' ELSE '✗ FAIL' END AS status
FROM summary s, drilldown d;

-- E.7) Verify stuck_workflows_count matches drill-down list count
WITH summary AS (
  SELECT (get_monitoring_summary()->'stuck_workflows_count')::int AS count
),
drilldown AS (
  SELECT COUNT(*) AS count FROM get_stuck_workflows_list(NULL, NULL, NULL)
)
SELECT 
  'stuck_workflows_count' AS metric,
  s.count AS summary_count,
  d.count AS drilldown_count,
  CASE WHEN s.count = d.count THEN '✓ PASS' ELSE '✗ FAIL' END AS status
FROM summary s, drilldown d;

-- E.8) Verify unbalanced_je_count matches drill-down list count
WITH summary AS (
  SELECT (get_monitoring_summary()->'unbalanced_je_count')::int AS count
),
drilldown AS (
  SELECT COUNT(*) AS count FROM get_unbalanced_je_list(NULL, NULL, NULL)
)
SELECT 
  'unbalanced_je_count' AS metric,
  s.count AS summary_count,
  d.count AS drilldown_count,
  CASE WHEN s.count = d.count THEN '✓ PASS' ELSE '✗ FAIL' END AS status
FROM summary s, drilldown d;

-- =====================================================
-- E.9) Verify allow_unallocated_count is non-NULL
-- =====================================================
SELECT 
  'allow_unallocated_count NOT NULL' AS test,
  CASE 
    WHEN (get_monitoring_summary()->'allow_unallocated_count') IS NOT NULL 
    THEN '✓ PASS' 
    ELSE '✗ FAIL' 
  END AS status,
  get_monitoring_summary()->'allow_unallocated_count' AS value;

-- =====================================================
-- E.10) Verify hb_legacy_count decreases after classification
-- (Manual test - run before and after classifying a record)
-- =====================================================
-- Before: SELECT (get_monitoring_summary()->'hb_legacy_count')::int AS before_count;
-- Action: Call classify_hb_legacy_payment(payment_id, 'advance_payment', 'Test note', NULL)
-- After:  SELECT (get_monitoring_summary()->'hb_legacy_count')::int AS after_count;
-- Verify: after_count < before_count OR payment now has hb_legacy_classification != 'pending'

-- =====================================================
-- E.11) RBAC Check - Verify functions are restricted to authenticated role
-- =====================================================
-- These should succeed for authenticated users only:
-- SELECT * FROM get_hb_legacy_list(NULL, NULL, NULL, NULL) LIMIT 1;
-- SELECT * FROM get_monitoring_summary();

-- =====================================================
-- Full Gate Test Summary
-- =====================================================
WITH tests AS (
  SELECT 'hb_legacy_count' AS metric,
    (get_monitoring_summary()->'hb_legacy_count')::int AS summary,
    (SELECT COUNT(*) FROM get_hb_legacy_list(NULL, NULL, NULL, NULL))::int AS drilldown
  UNION ALL
  SELECT 'hb_new_violations',
    (get_monitoring_summary()->'hb_new_violations')::int,
    (SELECT COUNT(*) FROM get_hb_new_violations_list(NULL, NULL, NULL, NULL))::int
  UNION ALL
  SELECT 'allow_unallocated_count',
    (get_monitoring_summary()->'allow_unallocated_count')::int,
    (SELECT COUNT(*) FROM get_allow_unallocated_list(NULL, NULL, NULL, NULL))::int
  UNION ALL
  SELECT 'formula_mismatch_count',
    (get_monitoring_summary()->'formula_mismatch_count')::int,
    (SELECT COUNT(*) FROM get_formula_mismatch_list(NULL, NULL, NULL, NULL))::int
  UNION ALL
  SELECT 'negative_remaining_count',
    (get_monitoring_summary()->'negative_remaining_count')::int,
    (SELECT COUNT(*) FROM get_negative_remaining_list(NULL, NULL, NULL, NULL))::int
  UNION ALL
  SELECT 'overpaid_count',
    (get_monitoring_summary()->'overpaid_count')::int,
    (SELECT COUNT(*) FROM get_overpaid_list(NULL, NULL, NULL, NULL))::int
  UNION ALL
  SELECT 'stuck_workflows_count',
    (get_monitoring_summary()->'stuck_workflows_count')::int,
    (SELECT COUNT(*) FROM get_stuck_workflows_list(NULL, NULL, NULL))::int
  UNION ALL
  SELECT 'unbalanced_je_count',
    (get_monitoring_summary()->'unbalanced_je_count')::int,
    (SELECT COUNT(*) FROM get_unbalanced_je_list(NULL, NULL, NULL))::int
)
SELECT 
  metric,
  summary AS summary_count,
  drilldown AS drilldown_count,
  CASE WHEN summary = drilldown THEN '✓ PASS' ELSE '✗ FAIL' END AS status
FROM tests
ORDER BY metric;
