-- P3-11 D-004: purchase_orders RLS Hardening
-- Drop existing UPDATE policy (to recreate with WITH CHECK)
DROP POLICY IF EXISTS "Users can update POs in their branches" ON public.purchase_orders;

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