-- Add needs_invoice and invoice_id columns to purchase_batches
ALTER TABLE public.purchase_batches
ADD COLUMN IF NOT EXISTS needs_invoice boolean NOT NULL DEFAULT true;

ALTER TABLE public.purchase_batches
ADD COLUMN IF NOT EXISTS invoice_id uuid;

-- Add FK constraint to invoices table
ALTER TABLE public.purchase_batches
ADD CONSTRAINT purchase_batches_invoice_id_fkey
FOREIGN KEY (invoice_id) REFERENCES public.invoices(id);