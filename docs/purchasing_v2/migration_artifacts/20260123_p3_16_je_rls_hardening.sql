-- ============================================================================
-- P3-16: Journal Entries RLS Hardening
-- ============================================================================
-- Execution Date: 2026-01-23
-- Scope: journal_entries, journal_entry_lines
-- Model: Permission-Gated (Model-1) - Not RPC-Only due to Manual JE UI
-- Fixes: F-001, F-002, F-003, F-004 from P3-15 R6
-- ============================================================================

-- ============================================================================
-- PART 1: journal_entries Policy Hardening
-- ============================================================================

-- 1A) DROP permissive INSERT policy (with_check = true)
DROP POLICY IF EXISTS "Authenticated users can insert journal entries" ON public.journal_entries;

-- 1B) DROP permissive DELETE policy (using = true)
DROP POLICY IF EXISTS "Users with permissions can delete journal entries" ON public.journal_entries;

-- 1C) DROP UPDATE policy without WITH CHECK
DROP POLICY IF EXISTS "Users with permissions can update journal entries" ON public.journal_entries;

-- 1D) CREATE new INSERT policy (permission-gated)
CREATE POLICY "Users with accounting permission can insert journal entries"
ON public.journal_entries
FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_screen_permission(auth.uid(), 'journal_entries'::text, 'create'::text)
  OR has_screen_permission(auth.uid(), 'accounting'::text, 'create'::text)
);

-- 1E) CREATE new UPDATE policy with matching WITH CHECK
CREATE POLICY "Users with accounting permission can update journal entries"
ON public.journal_entries
FOR UPDATE
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_screen_permission(auth.uid(), 'journal_entries'::text, 'edit'::text)
  OR has_screen_permission(auth.uid(), 'accounting'::text, 'edit'::text)
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_screen_permission(auth.uid(), 'journal_entries'::text, 'edit'::text)
  OR has_screen_permission(auth.uid(), 'accounting'::text, 'edit'::text)
);

-- 1F) CREATE new DELETE policy (admin-only, not permissive true)
CREATE POLICY "Admins can delete journal entries"
ON public.journal_entries
FOR DELETE
USING (
  has_role(auth.uid(), 'admin'::app_role)
);

-- ============================================================================
-- PART 2: journal_entry_lines Policy Hardening
-- ============================================================================

-- 2A) DROP permissive INSERT policy (with_check = true)
DROP POLICY IF EXISTS "Authenticated users can insert journal entry lines" ON public.journal_entry_lines;

-- 2B) DROP permissive SELECT policy (using = true)
DROP POLICY IF EXISTS "Authenticated users can view journal entry lines" ON public.journal_entry_lines;

-- 2C) DROP UPDATE policy without WITH CHECK
DROP POLICY IF EXISTS "Admins can update journal entry lines" ON public.journal_entry_lines;

-- 2D) CREATE new SELECT policy (permission-gated via parent JE)
CREATE POLICY "Users with accounting access can view journal entry lines"
ON public.journal_entry_lines
FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_screen_permission(auth.uid(), 'journal_entries'::text, 'view'::text)
  OR has_screen_permission(auth.uid(), 'accounting'::text, 'view'::text)
);

-- 2E) CREATE new INSERT policy (permission-gated)
CREATE POLICY "Users with accounting permission can insert journal entry lines"
ON public.journal_entry_lines
FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_screen_permission(auth.uid(), 'journal_entries'::text, 'create'::text)
  OR has_screen_permission(auth.uid(), 'accounting'::text, 'create'::text)
);

-- 2F) CREATE new UPDATE policy with matching WITH CHECK
CREATE POLICY "Users with accounting permission can update journal entry lines"
ON public.journal_entry_lines
FOR UPDATE
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_screen_permission(auth.uid(), 'journal_entries'::text, 'edit'::text)
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_screen_permission(auth.uid(), 'journal_entries'::text, 'edit'::text)
);

-- Note: DELETE policy for journal_entry_lines already admin-only - no change needed

-- ============================================================================
-- PART 3: Verification Queries (Post-Apply)
-- ============================================================================

-- V1: No permissive=true policies remaining
-- SELECT policyname, cmd, qual, with_check 
-- FROM pg_policies 
-- WHERE tablename IN ('journal_entries', 'journal_entry_lines')
--   AND (qual = 'true' OR with_check = 'true');
-- Expected: 0 rows

-- V2: All UPDATE policies have WITH CHECK
-- SELECT policyname, with_check IS NOT NULL as has_with_check
-- FROM pg_policies 
-- WHERE tablename IN ('journal_entries', 'journal_entry_lines')
--   AND cmd = 'UPDATE';
-- Expected: All rows have has_with_check = true

-- V3: Policy counts
-- SELECT tablename, COUNT(*) 
-- FROM pg_policies 
-- WHERE tablename IN ('journal_entries', 'journal_entry_lines')
-- GROUP BY tablename;
-- Expected: journal_entries = 4, journal_entry_lines = 4
