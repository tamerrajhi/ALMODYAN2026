-- P3-11 D-003: purchase_invoice_lines RLS Hardening
-- Drop all existing permissive policies
DROP POLICY IF EXISTS "Users can view invoice lines" ON public.purchase_invoice_lines;
DROP POLICY IF EXISTS "Authenticated users can view purchase invoice lines" ON public.purchase_invoice_lines;
DROP POLICY IF EXISTS "Users can insert invoice lines" ON public.purchase_invoice_lines;
DROP POLICY IF EXISTS "Authenticated users can insert purchase invoice lines" ON public.purchase_invoice_lines;
DROP POLICY IF EXISTS "Users can update invoice lines" ON public.purchase_invoice_lines;
DROP POLICY IF EXISTS "Authenticated users can update purchase invoice lines" ON public.purchase_invoice_lines;
DROP POLICY IF EXISTS "Users can delete invoice lines" ON public.purchase_invoice_lines;
DROP POLICY IF EXISTS "Authenticated users can delete purchase invoice lines" ON public.purchase_invoice_lines;

-- CREATE BRANCH-SCOPED POLICIES

-- SELECT: Users can view invoice lines from their branches
CREATE POLICY "Users can view invoice lines in their branches"
ON public.purchase_invoice_lines
FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR EXISTS (
    SELECT 1 FROM invoices i 
    WHERE i.id = purchase_invoice_lines.invoice_id 
    AND i.branch_id = ANY (get_user_branches(auth.uid()))
  )
);

-- INSERT: Users can insert invoice lines for invoices in their branches
CREATE POLICY "Users can insert invoice lines in their branches"
ON public.purchase_invoice_lines
FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) 
  OR EXISTS (
    SELECT 1 FROM invoices i 
    WHERE i.id = purchase_invoice_lines.invoice_id 
    AND i.branch_id = ANY (get_user_branches(auth.uid()))
  )
);

-- UPDATE: Users can update invoice lines in their branches (WITH CHECK prevents escalation)
CREATE POLICY "Users can update invoice lines in their branches"
ON public.purchase_invoice_lines
FOR UPDATE
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR EXISTS (
    SELECT 1 FROM invoices i 
    WHERE i.id = purchase_invoice_lines.invoice_id 
    AND i.branch_id = ANY (get_user_branches(auth.uid()))
  )
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) 
  OR EXISTS (
    SELECT 1 FROM invoices i 
    WHERE i.id = purchase_invoice_lines.invoice_id 
    AND i.branch_id = ANY (get_user_branches(auth.uid()))
  )
);

-- DELETE: Users can delete invoice lines from their branches
CREATE POLICY "Users can delete invoice lines in their branches"
ON public.purchase_invoice_lines
FOR DELETE
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR EXISTS (
    SELECT 1 FROM invoices i 
    WHERE i.id = purchase_invoice_lines.invoice_id 
    AND i.branch_id = ANY (get_user_branches(auth.uid()))
  )
);