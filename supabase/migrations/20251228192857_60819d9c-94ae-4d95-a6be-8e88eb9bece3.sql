-- Add item_type and gl_account_id columns to purchase_invoice_lines
ALTER TABLE public.purchase_invoice_lines 
ADD COLUMN IF NOT EXISTS item_type text DEFAULT 'jewelry',
ADD COLUMN IF NOT EXISTS gl_account_id uuid REFERENCES public.chart_of_accounts(id);

-- Add comment
COMMENT ON COLUMN public.purchase_invoice_lines.item_type IS 'Type of item: jewelry, cost, or product';
COMMENT ON COLUMN public.purchase_invoice_lines.gl_account_id IS 'GL account for direct posting (used for costs and products)';