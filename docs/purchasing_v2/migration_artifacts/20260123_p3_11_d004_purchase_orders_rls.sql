-- ============================================================================
-- P3-11 D-004: purchase_orders RLS Hardening
-- ============================================================================
-- Execution Date: 2026-01-23 08:25 (UTC+3)
-- Finding: D-004 from P3-10 Audit-First Gate
-- Issue: UPDATE policy missing WITH CHECK, DELETE policy missing
-- Solution: Add WITH CHECK to UPDATE, add DELETE policy
-- Risk: LOW — All PO writes go through atomic RPCs
-- ============================================================================

-- Pre-check: Current policies
-- SELECT policyname, cmd, with_check FROM pg_policies WHERE tablename = 'purchase_orders';

-- ============================================================================
-- STEP 1: DROP EXISTING UPDATE POLICY (to recreate with WITH CHECK)
-- ============================================================================

DROP POLICY IF EXISTS "Users can update POs in their branches" ON public.purchase_orders;

-- ============================================================================
-- STEP 2: CREATE/REPLACE POLICIES WITH PROPER WITH CHECK
-- ============================================================================

-- UPDATE: Users can update POs in their branches (WITH CHECK prevents escalation)
CREATE POLICY "Users can update POs in their branches"
ON public.purchase_orders
FOR UPDATE
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR branch_id = ANY (get_user_branches(auth.uid()))
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) 
  OR branch_id = ANY (get_user_branches(auth.uid()))
);

-- DELETE: Users can delete POs from their branches (was missing)
CREATE POLICY "Users can delete POs in their branches"
ON public.purchase_orders
FOR DELETE
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR branch_id = ANY (get_user_branches(auth.uid()))
);

-- ============================================================================
-- STEP 3: VERIFICATION QUERIES (Post-Apply)
-- ============================================================================

-- Verify policy count = 4
-- SELECT policyname, cmd, with_check FROM pg_policies WHERE tablename = 'purchase_orders';

-- Verify UPDATE has WITH CHECK
-- SELECT policyname FROM pg_policies 
-- WHERE tablename = 'purchase_orders' AND cmd = 'UPDATE' AND with_check IS NOT NULL;
-- Expected: 1 row
