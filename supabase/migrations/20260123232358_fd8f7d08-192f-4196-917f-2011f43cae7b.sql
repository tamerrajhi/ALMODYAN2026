-- P4-6.2 STEP 1: Fix CRITICAL RLS on atomic_workflow_requests
-- Remove permissive TRUE policy that allows any authenticated user full access

-- Step 1: Drop the dangerous permissive policy
DROP POLICY IF EXISTS "Authenticated users can manage workflow requests" ON public.atomic_workflow_requests;

-- Step 2: Keep existing safe policies (already exist):
-- - "Users can view their own workflow requests" (SELECT with created_by = auth.uid())
-- - "Users can insert their own workflow requests" (INSERT with created_by check)

-- Step 3: Add UPDATE policy - users can only update their own pending requests
-- This is needed for RPC status updates but scoped to owner
CREATE POLICY "Users can update their own workflow requests"
ON public.atomic_workflow_requests
FOR UPDATE
USING (created_by = auth.uid())
WITH CHECK (created_by = auth.uid());

-- Step 4: Add DELETE policy - users can only delete their own requests (if needed for cleanup)
CREATE POLICY "Users can delete their own workflow requests"
ON public.atomic_workflow_requests
FOR DELETE
USING (created_by = auth.uid());

-- Note: RPCs with SECURITY DEFINER will bypass RLS anyway,
-- but this prevents direct table access exploitation