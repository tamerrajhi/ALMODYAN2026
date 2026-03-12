-- Fix Blocker B2: Secure invoices table (base table for purchase_invoices view)
-- The invoices table already has RLS enabled, but INSERT/UPDATE policies are too permissive

-- Drop overly permissive policies
DROP POLICY IF EXISTS "Authenticated users can insert invoices" ON public.invoices;
DROP POLICY IF EXISTS "Authenticated users can update invoices" ON public.invoices;

-- Create proper branch-based INSERT policy
CREATE POLICY "Users can insert invoices in their branches"
ON public.invoices
FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) 
  OR (branch_id = ANY (get_user_branches(auth.uid())))
);

-- Create proper branch-based UPDATE policy
CREATE POLICY "Users can update invoices in their branches"
ON public.invoices
FOR UPDATE
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR (branch_id = ANY (get_user_branches(auth.uid())))
);

-- Add DELETE policy for void operations
CREATE POLICY "Users can delete invoices in their branches"
ON public.invoices
FOR DELETE
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR (branch_id = ANY (get_user_branches(auth.uid())))
);