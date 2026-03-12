-- Create audit_runs table for storing test run results
CREATE TABLE IF NOT EXISTS public.audit_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  module TEXT NOT NULL,
  run_type TEXT NOT NULL,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_audit_runs_module ON public.audit_runs(module);
CREATE INDEX IF NOT EXISTS idx_audit_runs_run_type ON public.audit_runs(run_type);
CREATE INDEX IF NOT EXISTS idx_audit_runs_run_at ON public.audit_runs(run_at DESC);

-- Enable RLS
ALTER TABLE public.audit_runs ENABLE ROW LEVEL SECURITY;

-- Policy: Admins can read all audit runs
CREATE POLICY "admin_can_read_audit_runs"
  ON public.audit_runs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'admin'
    )
  );

-- Policy: Authenticated users can insert audit runs
CREATE POLICY "authenticated_can_insert_audit_runs"
  ON public.audit_runs
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Add comment
COMMENT ON TABLE public.audit_runs IS 'Stores audit/health check run results for various modules';