-- P3-11 D-005: supplier_payment_allocations RLS Hardening
-- Drop existing permissive policy
DROP POLICY IF EXISTS "Authenticated users can read allocations" ON public.supplier_payment_allocations;

-- CREATE BRANCH-SCOPED POLICIES

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