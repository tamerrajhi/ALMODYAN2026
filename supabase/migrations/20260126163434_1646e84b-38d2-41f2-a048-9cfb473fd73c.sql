-- Finalized v_returns_hub: Canonical-safe view preventing type flip and false drift
CREATE OR REPLACE VIEW public.v_returns_hub AS
WITH
pr_presence AS (
  SELECT pr.id, pr.return_number
  FROM purchase_returns pr
),
unique_returns AS (
  SELECT
    pr.id,
    pr.return_number,
    pr.status,
    pr.branch_id,
    pr.supplier_id,
    pr.return_date,
    pr.subtotal,
    pr.tax_amount,
    pr.total_amount,
    pr.journal_entry_id,
    pr.created_at
  FROM purchase_returns pr
),
invoice_line_counts AS (
  SELECT
    inv.id AS invoice_id,
    inv.invoice_number,
    COUNT(pil.id) AS line_count
  FROM invoices inv
  LEFT JOIN purchase_invoice_lines pil ON pil.invoice_id = inv.id
  WHERE inv.invoice_type = 'purchase_return'
  GROUP BY inv.id, inv.invoice_number
),
mirrors AS (
  SELECT
    ilc.invoice_number AS return_number,
    TRUE AS mirror_exists
  FROM invoice_line_counts ilc
  WHERE ilc.line_count = 0
    AND EXISTS (SELECT 1 FROM pr_presence p WHERE p.return_number = ilc.invoice_number)
),
general_returns AS (
  SELECT
    inv.id,
    inv.invoice_number AS return_number,
    inv.status,
    inv.branch_id,
    inv.supplier_id,
    inv.invoice_date::timestamptz AS return_date,
    inv.subtotal,
    inv.tax_amount,
    inv.total_amount,
    inv.journal_entry_id,
    inv.created_at
  FROM invoices inv
  JOIN invoice_line_counts ilc ON ilc.invoice_id = inv.id
  WHERE inv.invoice_type = 'purchase_return'
    AND ilc.line_count > 0
    AND NOT EXISTS (SELECT 1 FROM pr_presence p WHERE p.return_number = inv.invoice_number)
),
unique_return_items_count AS (
  SELECT
    pri.return_id,
    COUNT(DISTINCT pri.jewelry_item_id) AS expected_count
  FROM purchase_return_items pri
  GROUP BY pri.return_id
),
unique_movements_count AS (
  SELECT
    im.reference_id AS return_id,
    COUNT(*) AS actual_count
  FROM item_movements im
  WHERE im.movement_type = 'PURCHASE_RETURN'
    AND im.reference_type = 'purchase_return'
  GROUP BY im.reference_id
),
branch_not_cleared AS (
  SELECT
    pri.return_id,
    COUNT(*) AS items_with_branch
  FROM purchase_return_items pri
  JOIN jewelry_items ji ON ji.id = pri.jewelry_item_id
  JOIN purchase_returns pr ON pr.id = pri.return_id
  WHERE pr.status IN ('confirmed', 'posted', 'completed')
    AND ji.branch_id IS NOT NULL
  GROUP BY pri.return_id
)
SELECT
  ur.return_number,
  'unique'::text AS return_type,
  ur.id AS canonical_id,

  ur.status,
  ur.branch_id,
  ur.supplier_id,
  ur.return_date,
  ur.subtotal,
  ur.tax_amount,
  ur.total_amount,

  COALESCE(m.mirror_exists, FALSE) AS mirror_exists,
  (ur.journal_entry_id IS NOT NULL) AS has_je,
  ur.journal_entry_id,

  COALESCE(uric.expected_count, 0)::int AS expected_movement_count,
  COALESCE(umc.actual_count, 0)::int AS actual_movement_count,

  CASE
    WHEN COALESCE(bnc.items_with_branch, 0) > 0 THEN TRUE
    WHEN COALESCE(uric.expected_count, 0) IS DISTINCT FROM COALESCE(umc.actual_count, 0) THEN TRUE
    ELSE FALSE
  END AS has_drift,

  CASE
    WHEN COALESCE(bnc.items_with_branch, 0) > 0 THEN 'branch_not_cleared'
    WHEN COALESCE(uric.expected_count, 0) IS DISTINCT FROM COALESCE(umc.actual_count, 0) THEN 'movement_mismatch'
    ELSE 'none'
  END::text AS drift_type,

  ur.created_at
FROM unique_returns ur
LEFT JOIN mirrors m ON m.return_number = ur.return_number
LEFT JOIN unique_return_items_count uric ON uric.return_id = ur.id
LEFT JOIN unique_movements_count umc ON umc.return_id = ur.id
LEFT JOIN branch_not_cleared bnc ON bnc.return_id = ur.id

UNION ALL

SELECT
  gr.return_number,
  'general'::text AS return_type,
  gr.id AS canonical_id,

  gr.status,
  gr.branch_id,
  gr.supplier_id,
  gr.return_date,
  gr.subtotal,
  gr.tax_amount,
  gr.total_amount,

  FALSE AS mirror_exists,
  (gr.journal_entry_id IS NOT NULL) AS has_je,
  gr.journal_entry_id,

  NULL::int AS expected_movement_count,
  NULL::int AS actual_movement_count,
  NULL::boolean AS has_drift,
  NULL::text AS drift_type,

  gr.created_at
FROM general_returns gr;