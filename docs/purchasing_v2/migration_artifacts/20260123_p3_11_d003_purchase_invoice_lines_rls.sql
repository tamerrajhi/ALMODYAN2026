-- ============================================================================
-- P3-11 D-003: purchase_invoice_lines RLS Hardening
-- ============================================================================
-- Execution Date: 2026-01-23 08:00 (UTC+3)
-- Finding: D-003 from P3-10 Audit-First Gate
-- Issue: 8 duplicate permissive policies with USING/WITH CHECK = true
-- Solution: Replace with 4 branch-scoped policies using EXISTS join to invoices
-- Risk: LOW — All writes go through SECURITY DEFINER RPCs
-- ============================================================================

-- Pre-check: Confirm current policy count = 8
-- SELECT COUNT(*) FROM pg_policies WHERE tablename = 'purchase_invoice_lines';

-- ============================================================================
-- STEP 1: DROP ALL EXISTING PERMISSIVE POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "Users can view invoice lines" ON public.purchase_invoice_lines;
DROP POLICY IF EXISTS "Authenticated users can view purchase invoice lines" ON public.purchase_invoice_lines;
DROP POLICY IF EXISTS "Users can insert invoice lines" ON public.purchase_invoice_lines;
DROP POLICY IF EXISTS "Authenticated users can insert purchase invoice lines" ON public.purchase_invoice_lines;
DROP POLICY IF EXISTS "Users can update invoice lines" ON public.purchase_invoice_lines;
DROP POLICY IF EXISTS "Authenticated users can update purchase invoice lines" ON public.purchase_invoice_lines;
DROP POLICY IF EXISTS "Users can delete invoice lines" ON public.purchase_invoice_lines;
DROP POLICY IF EXISTS "Authenticated users can delete purchase invoice lines" ON public.purchase_invoice_lines;

-- ============================================================================
-- STEP 2: CREATE BRANCH-SCOPED POLICIES
-- ============================================================================

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

-- ============================================================================
-- STEP 3: VERIFICATION QUERIES (Post-Apply)
-- ============================================================================

-- Verify policy count = 4
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'purchase_invoice_lines';

-- Verify all policies have branch-scoped expressions (not 'true')
-- SELECT policyname, qual, with_check FROM pg_policies 
-- WHERE tablename = 'purchase_invoice_lines' AND (qual = 'true' OR with_check = 'true');
-- Expected: 0 rows

-- ============================================================================
-- ROLLBACK (If needed)
-- ============================================================================
-- To rollback, re-create the original 8 permissive policies.
-- This is NOT recommended — the permissive policies were a security gap.
