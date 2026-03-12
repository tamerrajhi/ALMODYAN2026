-- ============================================================
-- C-MIG-01: Canonical Returns Migration (Fixed v4)
-- Purpose: Migrate general returns from invoices to purchase_returns
-- ============================================================

-- C1-A) Fix item_type constraint to allow product, cost, raw_material
ALTER TABLE public.purchase_return_lines DROP CONSTRAINT IF EXISTS chk_item_type;
ALTER TABLE public.purchase_return_lines 
  ADD CONSTRAINT chk_item_type 
  CHECK (item_type IN ('jewelry', 'service', 'product', 'cost', 'raw_material'));

-- C1-B) Widen vat_rate column to accept percentage values (0-100 range)
ALTER TABLE public.purchase_return_lines 
  ALTER COLUMN vat_rate TYPE numeric(10,4);

-- C1-C) Drop the jewelry-only FK constraint on item_id 
-- General returns use product_id which references products/raw_materials, not jewelry_items
ALTER TABLE public.purchase_return_lines 
  DROP CONSTRAINT IF EXISTS purchase_return_lines_item_id_fkey;

-- C1-D) Add return_id column to purchase_return_lines if missing
ALTER TABLE public.purchase_return_lines 
  ADD COLUMN IF NOT EXISTS return_id uuid;

-- C1-E) Add FK return_id -> purchase_returns (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_purchase_return_lines_return') THEN
    ALTER TABLE public.purchase_return_lines
      ADD CONSTRAINT fk_purchase_return_lines_return
      FOREIGN KEY (return_id) REFERENCES public.purchase_returns(id) ON DELETE CASCADE;
  END IF;
END $$;

-- C1-F) Create index on return_id
CREATE INDEX IF NOT EXISTS idx_purchase_return_lines_return_id 
ON public.purchase_return_lines(return_id);

-- C1-G) Insert canonical purchase_returns for general mirror invoices
-- Only insert if no existing purchase_returns row with same journal_entry_id
INSERT INTO public.purchase_returns (
  id, return_number, purchase_type, purchase_invoice_id,
  supplier_id, branch_id, return_date,
  subtotal, tax_amount, total_amount,
  notes, status, journal_entry_id, created_at
)
SELECT
  gen_random_uuid(),
  i.invoice_number,
  'general',
  i.linked_invoice_id,
  i.supplier_id,
  i.branch_id,
  i.invoice_date::timestamp with time zone,
  i.subtotal,
  i.tax_amount,
  i.total_amount,
  i.notes,
  CASE 
    WHEN i.status ILIKE '%void%' THEN 'voided'
    WHEN i.status ILIKE '%cancel%' THEN 'cancelled'
    ELSE 'confirmed' 
  END,
  i.journal_entry_id,
  COALESCE(i.created_at, now())
FROM public.invoices i
WHERE i.invoice_type = 'purchase_return'
  AND i.purchase_type = 'general'
  AND NOT EXISTS (
    SELECT 1 FROM public.purchase_returns pr 
    WHERE pr.journal_entry_id = i.journal_entry_id
  );

-- C1-H) Copy void metadata for voided returns
UPDATE public.purchase_returns pr
SET 
  voided_at = i.voided_at,
  voided_by = i.voided_by,
  void_reason = i.void_reason
FROM public.invoices i
WHERE pr.journal_entry_id = i.journal_entry_id
  AND i.invoice_type = 'purchase_return'
  AND i.purchase_type = 'general'
  AND i.voided_at IS NOT NULL
  AND pr.voided_at IS NULL;

-- C1-I) Add index on purchase_invoice_lines for efficient joining
CREATE INDEX IF NOT EXISTS idx_purchase_invoice_lines_invoice_id
ON public.purchase_invoice_lines(invoice_id);

-- C1-J) Insert return lines into purchase_return_lines
-- Normalize tax_rate to decimal (15 -> 0.15) for storage consistency
INSERT INTO public.purchase_return_lines (
  id, return_id, invoice_id, invoice_line_id,
  line_number, item_id, quantity,
  unit_cost, vat_rate, tax_amount, line_total,
  item_type, description, created_at
)
SELECT
  gen_random_uuid(),
  pr.id,                              -- canonical return_id
  pil.invoice_id,                     -- keep legacy invoice reference
  pil.id,                             -- the mirror line id
  pil.line_number,
  pil.product_id,
  pil.quantity,
  pil.unit_price,
  -- Normalize: if tax_rate > 1 assume percentage, convert to decimal
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

-- C1-K) Update track validation trigger for purchase_return_lines
CREATE OR REPLACE FUNCTION public.validate_return_lines_track()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_purchase_type text;
BEGIN
  -- return_id is now canonical and required
  IF NEW.return_id IS NULL THEN
    RAISE EXCEPTION 'TRACK_VALIDATION: return_id is required on purchase_return_lines';
  END IF;

  SELECT purchase_type INTO v_purchase_type
  FROM public.purchase_returns
  WHERE id = NEW.return_id;

  IF v_purchase_type IS NULL THEN
    RAISE EXCEPTION 'TRACK_VALIDATION: Parent purchase_return not found for return_id=%', NEW.return_id;
  END IF;

  IF v_purchase_type <> 'general' THEN
    RAISE EXCEPTION 'TRACK_VALIDATION: purchase_return_lines can only be used with general returns (got: %)', v_purchase_type;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_return_lines_track ON public.purchase_return_lines;
CREATE TRIGGER trg_validate_return_lines_track
BEFORE INSERT OR UPDATE ON public.purchase_return_lines
FOR EACH ROW
EXECUTE FUNCTION public.validate_return_lines_track();

-- C1-L) Backward compatibility VIEW for legacy queries
DROP VIEW IF EXISTS public.v_purchase_return_invoices_mirror;
CREATE OR REPLACE VIEW public.v_purchase_return_invoices_mirror AS
SELECT
  pr.id as purchase_return_id,
  pr.return_number as invoice_number,
  pr.return_date as invoice_date,
  'purchase_return' as invoice_type,
  pr.purchase_type,
  pr.purchase_invoice_id as linked_invoice_id,
  pr.supplier_id,
  pr.branch_id,
  pr.subtotal,
  pr.tax_amount,
  pr.total_amount,
  pr.status,
  pr.journal_entry_id,
  pr.notes,
  pr.voided_at,
  pr.voided_by,
  pr.void_reason,
  pr.created_at
FROM public.purchase_returns pr;