-- ================================================================
-- P4-6.2 STEP 2: Fix customer_receipts RLS (UPDATE WITH CHECK + DELETE policy)
-- Date: 2026-01-24
-- Issue: UPDATE policy missing WITH CHECK, DELETE policy missing
-- ================================================================

-- ================================================================
-- BEFORE STATE:
-- ================================================================
-- | Policy | Command | USING | WITH CHECK | Risk |
-- |--------|---------|-------|------------|------|
-- | Users can view... | SELECT | ✅ has predicate | - | OK |
-- | Users can insert... | INSERT | - | ✅ has predicate | OK |
-- | Users can update... | UPDATE | ✅ has predicate | ❌ MISSING | 🟡 HIGH |
-- | (no DELETE policy) | DELETE | - | - | ⚠️ MISSING |
--
-- Risk: User could UPDATE a receipt to change branch_id to a branch 
-- they don't have access to (privilege escalation).
-- ================================================================

-- Step 1: Drop the UPDATE policy that's missing WITH CHECK
DROP POLICY IF EXISTS "Users can update customer receipts in their branches" ON public.customer_receipts;

-- Step 2: Create UPDATE policy with proper WITH CHECK
-- This prevents users from moving receipts to branches they don't have access to
CREATE POLICY "Users can update customer receipts in their branches"
ON public.customer_receipts
FOR UPDATE
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR branch_id = ANY(get_user_branches(auth.uid()))
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) 
  OR branch_id = ANY(get_user_branches(auth.uid()))
);

-- Step 3: Create DELETE policy (was missing)
-- Only allow deletion of receipts in user's branches
CREATE POLICY "Users can delete customer receipts in their branches"
ON public.customer_receipts
FOR DELETE
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR branch_id = ANY(get_user_branches(auth.uid()))
);

-- ================================================================
-- AFTER STATE:
-- ================================================================
-- | Policy | Command | USING | WITH CHECK | Status |
-- |--------|---------|-------|------------|--------|
-- | Users can view... | SELECT | ✅ predicate | - | ✅ OK |
-- | Users can insert... | INSERT | - | ✅ predicate | ✅ OK |
-- | Users can update... | UPDATE | ✅ predicate | ✅ predicate | ✅ OK |
-- | Users can delete... | DELETE | ✅ predicate | - | ✅ OK |
-- ================================================================

-- ================================================================
-- ALLOCATION TABLES
-- ================================================================
-- No customer_receipt_allocations table exists.
-- Customer receipts use 1:1 relationship with invoices via invoice_id column.
-- No additional RLS needed for allocations.
-- ================================================================

-- ================================================================
-- VERIFICATION GATES
-- ================================================================
-- V1: 4 policies exist (SELECT/INSERT/UPDATE/DELETE) ✅
-- V2: UPDATE has WITH CHECK ✅
-- V3: No allocation table to secure (N/A)
-- V4: Branch isolation enforced by predicate ✅
-- ================================================================
