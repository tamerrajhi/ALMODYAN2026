-- ============================================================================
-- P3-11 D-002: payments RLS Hardening
-- ============================================================================
-- Execution Date: 2026-01-23 08:15 (UTC+3)
-- Finding: D-002 from P3-10 Audit-First Gate
-- Issue: 4 permissive policies with USING/WITH CHECK = true
-- Solution: Replace with 4 branch-scoped policies using direct branch_id
-- Risk: LOW — All payment writes go through payment_voucher_atomic RPC
-- ============================================================================

-- Pre-check: Confirm current policy count = 4
-- SELECT COUNT(*) FROM pg_policies WHERE tablename = 'payments';

-- ============================================================================
-- STEP 1: DROP ALL EXISTING PERMISSIVE POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "Authenticated users can view payments" ON public.payments;
DROP POLICY IF EXISTS "Authenticated users can insert payments" ON public.payments;
DROP POLICY IF EXISTS "Users with permissions can update payments" ON public.payments;
DROP POLICY IF EXISTS "Users with permissions can delete payments" ON public.payments;

-- ============================================================================
-- STEP 2: CREATE BRANCH-SCOPED POLICIES
-- ============================================================================

-- SELECT: Users can view payments from their branches
CREATE POLICY "Users can view payments in their branches"
ON public.payments
FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR branch_id = ANY (get_user_branches(auth.uid()))
);

-- INSERT: Users can insert payments for their branches
CREATE POLICY "Users can insert payments in their branches"
ON public.payments
FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) 
  OR branch_id = ANY (get_user_branches(auth.uid()))
);

-- UPDATE: Users can update payments in their branches (WITH CHECK prevents escalation)
CREATE POLICY "Users can update payments in their branches"
ON public.payments
FOR UPDATE
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR branch_id = ANY (get_user_branches(auth.uid()))
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) 
  OR branch_id = ANY (get_user_branches(auth.uid()))
);

-- DELETE: Users can delete payments from their branches
CREATE POLICY "Users can delete payments in their branches"
ON public.payments
FOR DELETE
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR branch_id = ANY (get_user_branches(auth.uid()))
);

-- ============================================================================
-- STEP 3: VERIFICATION QUERIES (Post-Apply)
-- ============================================================================

-- Verify policy count = 4
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'payments';

-- Verify all policies have branch-scoped expressions (not 'true')
-- SELECT policyname, qual, with_check FROM pg_policies 
-- WHERE tablename = 'payments' AND (qual = 'true' OR with_check = 'true');
-- Expected: 0 rows
