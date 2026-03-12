-- ============================================
-- D2-7B(A1-FIX): atomic_workflow_requests status vocabulary alignment
-- Replace 'completed' with 'succeeded' and add 'conflict'
-- Safe: table currently empty per audit
-- ============================================

-- 1) Drop the existing constraint (name from audit: valid_status)
ALTER TABLE public.atomic_workflow_requests
  DROP CONSTRAINT IF EXISTS valid_status;

-- 2) Recreate with canonical gate vocabulary
ALTER TABLE public.atomic_workflow_requests
  ADD CONSTRAINT atomic_workflow_requests_status_chk
  CHECK (status = ANY (ARRAY['in_progress','succeeded','failed','conflict']));

-- 3) Document
COMMENT ON COLUMN public.atomic_workflow_requests.status IS
  'D2-7B: Gate status vocabulary. Allowed: in_progress, succeeded, failed, conflict';