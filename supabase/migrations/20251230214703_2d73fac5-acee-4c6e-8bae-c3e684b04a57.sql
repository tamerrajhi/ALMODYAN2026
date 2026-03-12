
-- Drop the existing unique constraint on invoice_number
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_invoice_number_key;

-- Create a new composite unique constraint
-- This allows same invoice_number for different suppliers or branches
ALTER TABLE public.invoices ADD CONSTRAINT invoices_unique_per_supplier_branch 
  UNIQUE (invoice_number, supplier_id, branch_id);

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_invoices_lookup 
  ON public.invoices (invoice_number, supplier_id, branch_id);
