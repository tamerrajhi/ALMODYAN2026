-- ============================================================================
-- P3-11 D-005: supplier_payment_allocations RLS Hardening
-- ============================================================================
-- Execution Date: 2026-01-23 08:30 (UTC+3)
-- Finding: D-005 from P3-10 Audit-First Gate
-- Issue: Only 1 SELECT policy (permissive true), missing INSERT/UPDATE/DELETE
-- Solution: Replace with 4 branch-scoped policies using EXISTS join to payments
-- Risk: LOW — All allocation writes go through payment_voucher_atomic RPC
-- ============================================================================

-- Table structure: id, payment_id (FK), invoice_id (FK), amount, created_at
-- Branch scoping: via payment_id → payments.branch_id

-- Pre-check: Confirm current policy count = 1
-- SELECT COUNT(*) FROM pg_policies WHERE tablename = 'supplier_payment_allocations';

-- ============================================================================
-- STEP 1: DROP EXISTING PERMISSIVE POLICY
-- ============================================================================

DROP POLICY IF EXISTS "Authenticated users can read allocations" ON public.supplier_payment_allocations;

-- ============================================================================
-- STEP 2: CREATE BRANCH-SCOPED POLICIES
-- ============================================================================

-- SELECT: Users can view allocations from their branches (via payment)
CREATE POLICY "Users can view allocations in their branches"
ON public.supplier_payment_allocations
FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR EXISTS (
    SELECT 1 FROM payments p 
    WHERE p.id = supplier_payment_allocations.payment_id 
    AND p.branch_id = ANY (get_user_branches(auth.uid()))
  )
);

-- INSERT: Users can insert allocations for their branch payments
CREATE POLICY "Users can insert allocations in their branches"
ON public.supplier_payment_allocations
FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) 
  OR EXISTS (
    SELECT 1 FROM payments p 
    WHERE p.id = supplier_payment_allocations.payment_id 
    AND p.branch_id = ANY (get_user_branches(auth.uid()))
  )
);

-- UPDATE: Users can update allocations in their branches
CREATE POLICY "Users can update allocations in their branches"
ON public.supplier_payment_allocations
FOR UPDATE
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR EXISTS (
    SELECT 1 FROM payments p 
    WHERE p.id = supplier_payment_allocations.payment_id 
    AND p.branch_id = ANY (get_user_branches(auth.uid()))
  )
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) 
  OR EXISTS (
    SELECT 1 FROM payments p 
    WHERE p.id = supplier_payment_allocations.payment_id 
    AND p.branch_id = ANY (get_user_branches(auth.uid()))
  )
);

-- DELETE: Users can delete allocations from their branches
CREATE POLICY "Users can delete allocations in their branches"
ON public.supplier_payment_allocations
FOR DELETE
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR EXISTS (
    SELECT 1 FROM payments p 
    WHERE p.id = supplier_payment_allocations.payment_id 
    AND p.branch_id = ANY (get_user_branches(auth.uid()))
  )
);

-- ============================================================================
-- STEP 3: VERIFICATION QUERIES (Post-Apply)
-- ============================================================================

-- Verify policy count = 4
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'supplier_payment_allocations';
