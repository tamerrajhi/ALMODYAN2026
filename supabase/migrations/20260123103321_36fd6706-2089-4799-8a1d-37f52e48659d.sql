-- P3-11 D-002: payments RLS Hardening
-- Drop all existing permissive policies
DROP POLICY IF EXISTS "Authenticated users can view payments" ON public.payments;
DROP POLICY IF EXISTS "Authenticated users can insert payments" ON public.payments;
DROP POLICY IF EXISTS "Users with permissions can update payments" ON public.payments;
DROP POLICY IF EXISTS "Users with permissions can delete payments" ON public.payments;

-- CREATE BRANCH-SCOPED POLICIES

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