-- Add linked_invoice_id column to invoices table for linking returns to original invoices
ALTER TABLE public.invoices 
ADD COLUMN linked_invoice_id uuid REFERENCES public.invoices(id);

-- Add index for better query performance
CREATE INDEX idx_invoices_linked_invoice_id ON public.invoices(linked_invoice_id);

-- Add comment for documentation
COMMENT ON COLUMN public.invoices.linked_invoice_id IS 'References the original invoice for return documents (purchase_return or sales_return)';