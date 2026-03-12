-- ============================================================
-- C-MIG-02: Fix orphan edge-case returns
-- Purpose: Correct misclassified returns and add missing lines
-- ============================================================

-- Temporarily disable the type-change trigger
ALTER TABLE public.purchase_returns DISABLE TRIGGER trg_prevent_purchase_return_type_change;

-- Fix purchase_type for the 4 edge case returns
UPDATE public.purchase_returns pr
SET purchase_type = 'general'
WHERE pr.id IN (
  SELECT pr2.id
  FROM public.purchase_returns pr2
  JOIN public.invoices i ON i.journal_entry_id = pr2.journal_entry_id
  WHERE i.invoice_type = 'purchase_return'
    AND i.purchase_type = 'general'
    AND pr2.purchase_type = 'import'
);

-- Re-enable the type-change trigger
ALTER TABLE public.purchase_returns ENABLE TRIGGER trg_prevent_purchase_return_type_change;

-- Now insert lines for these fixed returns
INSERT INTO public.purchase_return_lines (
  id, return_id, invoice_id, invoice_line_id,
  line_number, item_id, quantity,
  unit_cost, vat_rate, tax_amount, line_total,
  item_type, description, created_at
)
SELECT
  gen_random_uuid(),
  pr.id,
  pil.invoice_id,
  pil.id,
  pil.line_number,
  pil.product_id,
  pil.quantity,
  pil.unit_price,
  CASE WHEN COALESCE(pil.tax_rate, 0) > 1 
       THEN pil.tax_rate / 100.0 
       ELSE COALESCE(pil.tax_rate, 0) 
  END,
  COALESCE(pil.tax_amount, 0),
  pil.total_amount,
  pil.item_type,
  pil.description,
  COALESCE(pil.created_at, now())
FROM public.purchase_returns pr
JOIN public.invoices i ON i.journal_entry_id = pr.journal_entry_id
JOIN public.purchase_invoice_lines pil ON pil.invoice_id = i.id
WHERE pr.purchase_type = 'general'
  AND i.invoice_type = 'purchase_return'
  AND i.purchase_type = 'general'
  AND NOT EXISTS (
    SELECT 1 FROM public.purchase_return_lines prl
    WHERE prl.return_id = pr.id
  );