-- ============================================================================
-- Migration Artifact: P3-4 B2 Invoices RLS UPDATE Policy Fix
-- ============================================================================
-- Artifact ID:    20260123010500_p3_4_b2_invoices_rls_update_with_check
-- Date:           2026-01-23
-- Author:         Lovable AI
-- Scope:          public.invoices table only
-- Purpose:        Add WITH CHECK to UPDATE policy to prevent branch_id escalation
-- Related Doc:    docs/purchasing_v2/P3-4_big_bang_readiness_audit.md (Blocker B2)
-- ============================================================================
-- NOTE: This artifact documents the SQL applied via Lovable Cloud migration
-- system. It serves as the governed source of truth for audit purposes.
-- ============================================================================

-- A) Idempotent RLS enable
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

-- B) Idempotent UPDATE policy replacement with USING + WITH CHECK
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

-- ============================================================================
-- Verification Query (run after apply to confirm):
-- ============================================================================
-- SELECT polname, polcmd,
--        pg_get_expr(polqual, polrelid) AS using_expr,
--        pg_get_expr(polwithcheck, polrelid) AS check_expr
-- FROM pg_policy
-- WHERE polrelid='public.invoices'::regclass
--   AND polname='Users can update invoices in their branches';
--
-- Expected: check_expr IS NOT NULL
-- ============================================================================
