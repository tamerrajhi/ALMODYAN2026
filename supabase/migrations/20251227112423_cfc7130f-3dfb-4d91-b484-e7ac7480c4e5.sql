-- Enable RLS on purchase_invoice_lines table
ALTER TABLE public.purchase_invoice_lines ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view invoice lines
CREATE POLICY "Users can view invoice lines" 
ON public.purchase_invoice_lines 
FOR SELECT 
TO authenticated 
USING (true);

-- Policy: Users can insert invoice lines
CREATE POLICY "Users can insert invoice lines" 
ON public.purchase_invoice_lines 
FOR INSERT 
TO authenticated 
WITH CHECK (true);

-- Policy: Users can update invoice lines
CREATE POLICY "Users can update invoice lines" 
ON public.purchase_invoice_lines 
FOR UPDATE 
TO authenticated 
USING (true);

-- Policy: Users can delete invoice lines
CREATE POLICY "Users can delete invoice lines" 
ON public.purchase_invoice_lines 
FOR DELETE 
TO authenticated 
USING (true);