-- ============================================================================
-- P3-11 D-001: goods_receipt_notes RLS Hardening
-- ============================================================================
-- Execution Date: 2026-01-23 08:20 (UTC+3)
-- Finding: D-001 from P3-10 Audit-First Gate
-- Issue: 1 permissive ALL policy with USING/WITH CHECK = true
-- Solution: Replace with 4 branch-scoped policies using direct branch_id
-- Risk: LOW — All GRN writes go through purchase_order_receive_v2_atomic RPC
-- ============================================================================

-- Pre-check: Confirm current policy count = 1
-- SELECT COUNT(*) FROM pg_policies WHERE tablename = 'goods_receipt_notes';

-- ============================================================================
-- STEP 1: DROP EXISTING PERMISSIVE POLICY
-- ============================================================================

DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.goods_receipt_notes;

-- ============================================================================
-- STEP 2: CREATE BRANCH-SCOPED POLICIES
-- ============================================================================

-- SELECT: Users can view GRNs from their branches
CREATE POLICY "Users can view GRNs in their branches"
ON public.goods_receipt_notes
FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR branch_id = ANY (get_user_branches(auth.uid()))
);

-- INSERT: Users can insert GRNs for their branches
CREATE POLICY "Users can insert GRNs in their branches"
ON public.goods_receipt_notes
FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) 
  OR branch_id = ANY (get_user_branches(auth.uid()))
);

-- UPDATE: Users can update GRNs in their branches (WITH CHECK prevents escalation)
CREATE POLICY "Users can update GRNs in their branches"
ON public.goods_receipt_notes
FOR UPDATE
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR branch_id = ANY (get_user_branches(auth.uid()))
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) 
  OR branch_id = ANY (get_user_branches(auth.uid()))
);

-- DELETE: Users can delete GRNs from their branches
CREATE POLICY "Users can delete GRNs in their branches"
ON public.goods_receipt_notes
FOR DELETE
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR branch_id = ANY (get_user_branches(auth.uid()))
);

-- ============================================================================
-- STEP 3: VERIFICATION QUERIES (Post-Apply)
-- ============================================================================

-- Verify policy count = 4
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'goods_receipt_notes';

-- Verify all policies have branch-scoped expressions (not 'true')
-- SELECT policyname, qual, with_check FROM pg_policies 
-- WHERE tablename = 'goods_receipt_notes' AND (qual = 'true' OR with_check = 'true');
-- Expected: 0 rows
