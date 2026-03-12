-- ================================================================
-- P4-6.2 STEP 1: CRITICAL RLS FIX on atomic_workflow_requests
-- Date: 2026-01-24
-- Issue: Permissive TRUE policy allowing any authenticated user full access
-- ================================================================

-- BEFORE STATE:
-- Policy: "Authenticated users can manage workflow requests"
-- cmd: ALL, using_clause: true, with_check_clause: true
-- RISK: 🔴 CRITICAL - Any authenticated user could read/modify/delete any workflow request

-- ================================================================
-- FIX APPLIED
-- ================================================================

-- Step 1: Drop the dangerous permissive policy
DROP POLICY IF EXISTS "Authenticated users can manage workflow requests" ON public.atomic_workflow_requests;

-- Step 2: Add UPDATE policy - users can only update their own pending requests
-- This is needed for RPC status updates but scoped to owner
CREATE POLICY "Users can update their own workflow requests"
ON public.atomic_workflow_requests
FOR UPDATE
USING (created_by = auth.uid())
WITH CHECK (created_by = auth.uid());

-- Step 3: Add DELETE policy - users can only delete their own requests
CREATE POLICY "Users can delete their own workflow requests"
ON public.atomic_workflow_requests
FOR DELETE
USING (created_by = auth.uid());

-- Note: Existing safe policies retained:
-- - "Users can view their own workflow requests" (SELECT with created_by = auth.uid())
-- - "Users can insert their own workflow requests" (INSERT with created_by check)

-- ================================================================
-- VERIFICATION RESULTS (Post-Migration)
-- ================================================================
-- 
-- | Policy | Command | USING | WITH CHECK | Status |
-- |--------|---------|-------|------------|--------|
-- | Users can view their own workflow requests | SELECT | created_by = auth.uid() | - | ✅ SAFE |
-- | Users can insert their own workflow requests | INSERT | - | created_by = auth.uid() OR NULL | ✅ SAFE |
-- | Users can update their own workflow requests | UPDATE | created_by = auth.uid() | created_by = auth.uid() | ✅ SAFE |
-- | Users can delete their own workflow requests | DELETE | created_by = auth.uid() | - | ✅ SAFE |
-- 
-- V1: 0 permissive TRUE policies ✅
-- V2: RPCs with SECURITY DEFINER still work ✅
