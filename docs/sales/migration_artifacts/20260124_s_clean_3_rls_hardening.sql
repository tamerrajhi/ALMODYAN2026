-- =============================================================================
-- S-Clean-3: RLS Hardening for jewelry_items and item_movements
-- =============================================================================
-- Date: 2026-01-24
-- Purpose: Remove risky broad RLS policies that enable legacy direct writes
-- Scope: public.jewelry_items (UPDATE), public.item_movements (INSERT)
-- 
-- SECURITY MODEL:
-- - Atomic RPCs run as SECURITY DEFINER, bypassing RLS
-- - service_role bypasses RLS for backoffice operations
-- - Direct writes from authenticated users are BLOCKED unless admin role
-- =============================================================================

-- =============================================================================
-- BASELINE EVIDENCE (captured before migration):
-- =============================================================================
-- jewelry_items policies:
--   - "Authenticated users can update items for transfers" (UPDATE) - USING(true) WITH CHECK(true) ← RISKY
--   - "Authenticated users can view items" (SELECT) - qual: true
--   - "Authenticated users can insert items" (INSERT) - WITH CHECK(true)
--
-- item_movements policies:
--   - "Authenticated users can insert item_movements" (INSERT) - WITH CHECK(true) ← RISKY
--   - "Users can view movements for their branches" (SELECT) - branch-based filter
--
-- RLS enabled: true for both tables
-- RBAC: has_role(user_id, app_role) function exists, app_role enum has 'admin'
-- =============================================================================

-- =============================================================================
-- PART 1: HARDEN jewelry_items UPDATE policy
-- =============================================================================

-- Drop the overly permissive UPDATE policy
DROP POLICY IF EXISTS "Authenticated users can update items for transfers" ON public.jewelry_items;

-- Create hardened UPDATE policy: only admin role can update directly
-- (SECURITY DEFINER RPCs and service_role bypass RLS automatically)
CREATE POLICY "jewelry_items_update_hardened"
ON public.jewelry_items
FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
);

-- =============================================================================
-- PART 2: HARDEN item_movements INSERT policy
-- =============================================================================

-- Drop the overly permissive INSERT policy
DROP POLICY IF EXISTS "Authenticated users can insert item_movements" ON public.item_movements;

-- Create hardened INSERT policy: only admin role can insert directly
-- (SECURITY DEFINER RPCs and service_role bypass RLS automatically)
CREATE POLICY "item_movements_insert_hardened"
ON public.item_movements
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
);

-- =============================================================================
-- VERIFICATION QUERIES (run after migration)
-- =============================================================================
-- 
-- 1) Check policies are in place:
-- SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
-- FROM pg_policies
-- WHERE schemaname='public' AND tablename IN ('jewelry_items','item_movements')
-- ORDER BY tablename, policyname;
--
-- 2) Confirm RLS still enabled:
-- SELECT relname, relrowsecurity, relforcerowsecurity
-- FROM pg_class
-- WHERE oid IN ('public.jewelry_items'::regclass,'public.item_movements'::regclass);
--
-- 3) Confirm RPC grants intact:
-- SELECT
--   has_function_privilege('anon','public.complete_pos_piece_return_atomic(jsonb)','EXECUTE') AS anon_exec,
--   has_function_privilege('authenticated','public.complete_pos_piece_return_atomic(jsonb)','EXECUTE') AS auth_exec,
--   has_function_privilege('service_role','public.complete_pos_piece_return_atomic(jsonb)','EXECUTE') AS service_exec;
--
-- Expected: anon=false, authenticated=true, service_role=true
-- =============================================================================

-- =============================================================================
-- ROLLBACK SECTION (if needed to restore previous behavior)
-- =============================================================================
-- To rollback, run the following:
--
-- -- Restore jewelry_items UPDATE policy
-- DROP POLICY IF EXISTS "jewelry_items_update_hardened" ON public.jewelry_items;
-- CREATE POLICY "Authenticated users can update items for transfers"
-- ON public.jewelry_items
-- FOR UPDATE
-- TO public
-- USING (true)
-- WITH CHECK (true);
--
-- -- Restore item_movements INSERT policy
-- DROP POLICY IF EXISTS "item_movements_insert_hardened" ON public.item_movements;
-- CREATE POLICY "Authenticated users can insert item_movements"
-- ON public.item_movements
-- FOR INSERT
-- TO public
-- WITH CHECK (true);
-- =============================================================================
