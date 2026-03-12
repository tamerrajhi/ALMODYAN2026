-- Create branch-specific code sequences table
CREATE TABLE IF NOT EXISTS public.branch_code_sequences (
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  code_type text NOT NULL,
  prefix text NOT NULL,
  padding int NOT NULL DEFAULT 6,
  next_value bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, code_type)
);

-- Index for faster lookups by code_type
CREATE INDEX IF NOT EXISTS idx_branch_code_sequences_code_type
ON public.branch_code_sequences(code_type);

-- Enable RLS
ALTER TABLE public.branch_code_sequences ENABLE ROW LEVEL SECURITY;

-- RLS policy for authenticated users
CREATE POLICY "Authenticated users can manage branch code sequences"
ON public.branch_code_sequences
FOR ALL
USING (true)
WITH CHECK (true);

-- Seed TRF sequences for all existing branches
INSERT INTO public.branch_code_sequences (branch_id, code_type, prefix, padding, next_value, updated_at)
SELECT
  b.id,
  'TRF',
  'TRF-' || b.branch_code || '-',
  6,
  1,
  now()
FROM public.branches b
WHERE b.branch_code IS NOT NULL
ON CONFLICT (branch_id, code_type) DO NOTHING;