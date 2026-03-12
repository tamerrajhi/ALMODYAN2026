-- Add UPDATE policy for suppliers table
CREATE POLICY "Authenticated users can update suppliers" 
ON public.suppliers 
FOR UPDATE 
USING (true)
WITH CHECK (true);

-- Add DELETE policy for suppliers table (for admin only)
CREATE POLICY "Admins can delete suppliers" 
ON public.suppliers 
FOR DELETE 
USING (has_role(auth.uid(), 'admin'::app_role));