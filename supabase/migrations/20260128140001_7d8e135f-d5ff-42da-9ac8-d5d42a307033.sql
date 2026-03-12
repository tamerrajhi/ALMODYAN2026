-- ============================================================
-- D2-5.2 C2-FIX: Backfill returned_qty for historical general returns
-- One-time recalc for all invoice lines with active general returns
-- ============================================================

-- Set-based update: recalc returned_qty for all invoice lines
-- that have non-voided/non-cancelled general returns
WITH active_return_sums AS (
  SELECT
    prl.invoice_line_id,
    COALESCE(SUM(prl.quantity), 0) AS total_returned
  FROM public.purchase_return_lines prl
  JOIN public.purchase_returns pr ON pr.id = prl.return_id
  WHERE pr.purchase_type = 'general'
    AND pr.status NOT IN ('voided', 'cancelled')
    AND prl.invoice_line_id IS NOT NULL
  GROUP BY prl.invoice_line_id
)
UPDATE public.purchase_invoice_lines pil
SET returned_qty = ars.total_returned
FROM active_return_sums ars
WHERE pil.id = ars.invoice_line_id
  AND pil.returned_qty IS DISTINCT FROM ars.total_returned;

-- Log backfill
INSERT INTO public.audit_events (
  entity_type, action, entity_id, payload
) VALUES (
  'system', 'backfill_returned_qty', NULL,
  jsonb_build_object(
    'migration', 'D2-5.2 C2-FIX',
    'timestamp', now()::text,
    'description', 'Backfilled returned_qty on purchase_invoice_lines for historical general returns'
  )
);