-- P4-6.2 STEP 2: Fix customer_receipts RLS (UPDATE WITH CHECK + DELETE policy)
-- Date: 2026-01-24
-- Issue: UPDATE policy missing WITH CHECK, DELETE policy missing

-- ================================================================
-- BEFORE STATE:
-- - SELECT: ✅ OK (has_role(admin) OR branch_id = ANY(get_user_branches()))
-- - INSERT: ✅ OK (WITH CHECK same predicate)
-- - UPDATE: 🟡 HIGH RISK - USING exists but NO WITH CHECK
-- - DELETE: ❌ MISSING
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
-- - SELECT: ✅ OK
-- - INSERT: ✅ OK  
-- - UPDATE: ✅ OK (USING + WITH CHECK)
-- - DELETE: ✅ OK (USING)
-- ================================================================