-- Migration: P3-4 B2 Invoices RLS Governance
-- Purpose: Fix UPDATE policy to include WITH CHECK (prevent branch_id escalation)
-- Scope: public.invoices table only

-- 1. Enable RLS (idempotent)
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

-- 2. Drop and recreate UPDATE policy with proper WITH CHECK
DROP POLICY IF EXISTS "Users can update invoices in their branches" ON public.invoices;

CREATE POLICY "Users can update invoices in their branches"
ON public.invoices
FOR UPDATE
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR (branch_id = ANY (get_user_branches(auth.uid())))
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) 
  OR (branch_id = ANY (get_user_branches(auth.uid())))
);

-- Note: SELECT, INSERT, DELETE policies remain unchanged as they passed gate checks