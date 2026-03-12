-- (A) Data Fix: Update purchase_invoice_lines.batch_id for existing records
UPDATE public.purchase_invoice_lines pil
SET batch_id = i.batch_id
FROM public.invoices i
WHERE pil.invoice_id = i.id
  AND pil.batch_id IS NULL
  AND i.batch_id IS NOT NULL
  AND i.invoice_type = 'purchase';

-- (B) Enforcement Trigger: Prevent NULL batch_id when invoice has batch_id
CREATE OR REPLACE FUNCTION public.enforce_invoice_line_batch_id()
RETURNS TRIGGER AS $$
DECLARE v_invoice record;
BEGIN
  SELECT invoice_type, batch_id INTO v_invoice
  FROM public.invoices
  WHERE id = NEW.invoice_id;

  IF v_invoice.invoice_type = 'purchase' AND v_invoice.batch_id IS NOT NULL AND NEW.batch_id IS NULL THEN
    RAISE EXCEPTION 'purchase_invoice_lines.batch_id cannot be NULL when invoices.batch_id is set';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_invoice_line_batch_id ON public.purchase_invoice_lines;
CREATE TRIGGER trg_enforce_invoice_line_batch_id
BEFORE INSERT OR UPDATE ON public.purchase_invoice_lines
FOR EACH ROW
EXECUTE FUNCTION public.enforce_invoice_line_batch_id();