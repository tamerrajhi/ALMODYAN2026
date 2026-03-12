-- 1) Add batch_id column to invoices table with FK
ALTER TABLE public.invoices 
ADD COLUMN batch_id uuid NULL 
REFERENCES public.purchase_batches(id) ON DELETE SET NULL;

-- 2) Index for fast lookup
CREATE INDEX idx_invoices_batch_id ON public.invoices(batch_id);

-- 3) Unique index to prevent duplicate invoices for same batch
CREATE UNIQUE INDEX uq_invoices_batch_id 
ON public.invoices(batch_id) 
WHERE invoice_type = 'purchase' AND batch_id IS NOT NULL;

-- 4) Backfill: Link existing invoices to their batches
UPDATE invoices i
SET batch_id = pb.id
FROM purchase_batches pb
WHERE pb.invoice_id = i.id
  AND i.invoice_type = 'purchase'
  AND i.batch_id IS NULL;

-- 5) Fix the current orphaned invoice-batch relationship
UPDATE purchase_batches 
SET invoice_id = '4a035d3c-129a-44db-b321-b7001f395134', 
    needs_invoice = false 
WHERE id = 'b3dfca92-e3cc-4fd6-95b2-87c9da3caba5'
  AND invoice_id IS NULL;

UPDATE invoices 
SET batch_id = 'b3dfca92-e3cc-4fd6-95b2-87c9da3caba5'
WHERE id = '4a035d3c-129a-44db-b321-b7001f395134'
  AND batch_id IS NULL;