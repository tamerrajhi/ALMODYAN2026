
-- P4-1A Part 2: Add idempotency support to returns table

-- 1. Add client_request_id column to returns table for idempotency
ALTER TABLE public.returns 
ADD COLUMN IF NOT EXISTS client_request_id TEXT;

-- 2. Create unique index on client_request_id (only for non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS idx_returns_client_request_id_unique 
ON public.returns (client_request_id) 
WHERE client_request_id IS NOT NULL;

-- 3. Create sales_remediation_log table for tracking data fixes (if not exists)
CREATE TABLE IF NOT EXISTS public.sales_remediation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  remediation_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  entity_code TEXT,
  old_values JSONB,
  new_values JSONB,
  remediation_reason TEXT,
  remediated_by TEXT,
  remediated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on remediation log
ALTER TABLE public.sales_remediation_log ENABLE ROW LEVEL SECURITY;

-- Drop policy if exists and recreate
DROP POLICY IF EXISTS "System can manage remediation logs" ON public.sales_remediation_log;
CREATE POLICY "System can manage remediation logs"
ON public.sales_remediation_log
FOR ALL
USING (true)
WITH CHECK (true);

-- 4. Add comment for documentation
COMMENT ON COLUMN public.returns.client_request_id IS 'Idempotency key for preventing duplicate returns on retry/double-click (P4-1A)';
