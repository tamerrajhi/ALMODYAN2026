-- P3-11 D-001: goods_receipt_notes RLS Hardening
-- Drop existing permissive policy
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.goods_receipt_notes;

-- CREATE BRANCH-SCOPED POLICIES

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