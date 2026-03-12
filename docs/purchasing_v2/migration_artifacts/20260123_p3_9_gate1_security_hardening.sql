-- ============================================================
-- P3-9 Gate 1: Security Hardening Migration
-- Executed: 2026-01-23 (UTC+3)
-- Fixes MED findings F-001 and F-002 from P3-8
-- ============================================================

-- F-001: Add missing DELETE policy for purchase_returns
-- Ensures users can only delete (void) returns in their branches
CREATE POLICY "Users can delete purchase returns in their branches"
ON public.purchase_returns
FOR DELETE
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR branch_id = ANY (get_user_branches(auth.uid()))
);

-- F-001 continued: Add WITH CHECK to UPDATE policy for purchase_returns
-- Prevents branch escalation on updates
DROP POLICY IF EXISTS "Users can update purchase returns in their branches" ON public.purchase_returns;

CREATE POLICY "Users can update purchase returns in their branches"
ON public.purchase_returns
FOR UPDATE
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR branch_id = ANY (get_user_branches(auth.uid()))
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) 
  OR branch_id = ANY (get_user_branches(auth.uid()))
);

-- F-002: Replace permissive purchase_return_lines policies with branch-scoped policies
-- These policies check via the parent invoices table's branch_id

-- Drop existing permissive policies
DROP POLICY IF EXISTS "Authenticated users can view purchase_return_lines" ON public.purchase_return_lines;
DROP POLICY IF EXISTS "Authenticated users can insert purchase_return_lines" ON public.purchase_return_lines;
DROP POLICY IF EXISTS "Authenticated users can update purchase_return_lines" ON public.purchase_return_lines;
DROP POLICY IF EXISTS "Authenticated users can delete purchase_return_lines" ON public.purchase_return_lines;

-- Create new branch-scoped SELECT policy
CREATE POLICY "Users can view purchase_return_lines via invoice branch"
ON public.purchase_return_lines
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM invoices i
    WHERE i.id = purchase_return_lines.invoice_id
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR i.branch_id = ANY (get_user_branches(auth.uid()))
    )
  )
);

-- Create new branch-scoped INSERT policy
CREATE POLICY "Users can insert purchase_return_lines via invoice branch"
ON public.purchase_return_lines
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM invoices i
    WHERE i.id = purchase_return_lines.invoice_id
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR i.branch_id = ANY (get_user_branches(auth.uid()))
    )
  )
);

-- Create new branch-scoped UPDATE policy
CREATE POLICY "Users can update purchase_return_lines via invoice branch"
ON public.purchase_return_lines
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM invoices i
    WHERE i.id = purchase_return_lines.invoice_id
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR i.branch_id = ANY (get_user_branches(auth.uid()))
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM invoices i
    WHERE i.id = purchase_return_lines.invoice_id
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR i.branch_id = ANY (get_user_branches(auth.uid()))
    )
  )
);

-- Create new branch-scoped DELETE policy
CREATE POLICY "Users can delete purchase_return_lines via invoice branch"
ON public.purchase_return_lines
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM invoices i
    WHERE i.id = purchase_return_lines.invoice_id
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR i.branch_id = ANY (get_user_branches(auth.uid()))
    )
  )
);

-- ============================================================
-- VERIFICATION QUERIES (run after migration)
-- ============================================================

-- Verify purchase_returns policies (expect 4 policies)
-- SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'public.purchase_returns'::regclass;

-- Verify purchase_return_lines policies (expect 4 policies with EXISTS checks)
-- SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'public.purchase_return_lines'::regclass;
