-- ============================================================
-- P-PURCH-D2-7A: GLOBAL STATUS NORMALIZATION
-- ============================================================
-- Phase: Evidence-based normalization + constraint enforcement
-- Safe: All existing values are already canonical (no data migration needed)
-- ============================================================

-- B2) Create normalization audit table (for future use and auditability)
CREATE TABLE IF NOT EXISTS public.status_normalization_map (
  id bigserial PRIMARY KEY,
  table_name text NOT NULL,
  column_name text NOT NULL,
  old_value text NOT NULL,
  new_value text NOT NULL,
  rule_note text,
  records_affected integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE public.status_normalization_map IS 'D2-7A: Audit trail for status vocabulary normalization. Tracks any value mappings applied.';

-- Log that no normalization was needed (all values already canonical)
INSERT INTO public.status_normalization_map (table_name, column_name, old_value, new_value, rule_note, records_affected)
VALUES 
  ('purchase_returns', 'status', '*', '*', 'D2-7A: All existing values already canonical. No migration needed.', 0),
  ('invoices', 'status', '*', '*', 'D2-7A: All existing values already canonical. No migration needed.', 0);

-- B4.1) Add CHECK constraint for purchase_returns.status
ALTER TABLE public.purchase_returns
ADD CONSTRAINT purchase_returns_status_chk
CHECK (status IN ('draft', 'confirmed', 'posted', 'cancelled', 'voided'));

COMMENT ON COLUMN public.purchase_returns.status IS 'D2-7A: Canonical status. Allowed: draft, confirmed, posted, cancelled, voided. Default: confirmed';

-- B4.2) Add CHECK constraint for invoices.status
ALTER TABLE public.invoices
ADD CONSTRAINT invoices_status_chk
CHECK (status IN ('draft', 'pending', 'confirmed', 'posted', 'paid', 'partial', 'cancelled', 'voided'));

COMMENT ON COLUMN public.invoices.status IS 'D2-7A: Canonical status. Allowed: draft, pending, confirmed, posted, paid, partial, cancelled, voided. Default: pending';

-- B5) Create derived status view for journal_entries (keeps booleans canonical)
CREATE OR REPLACE VIEW public.v_journal_entries_status AS
SELECT 
  je.*,
  CASE
    WHEN je.is_reversed = true THEN 'voided'
    WHEN je.is_posted = true THEN 'posted'
    ELSE 'draft'
  END AS derived_status
FROM public.journal_entries je;

COMMENT ON VIEW public.v_journal_entries_status IS 'D2-7A: Journal entries with derived status from boolean flags. is_reversed->voided, is_posted->posted, else->draft';

-- B6) atomic_workflow_requests: add constraint if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conrelid = 'public.atomic_workflow_requests'::regclass
      AND conname LIKE '%status%'
  ) THEN
    ALTER TABLE public.atomic_workflow_requests
    ADD CONSTRAINT atomic_workflow_requests_status_chk
    CHECK (status IN ('in_progress', 'completed', 'failed', 'conflict'));
  END IF;
END $$;

-- Add RLS policy for normalization_map (admin only via user_roles)
ALTER TABLE public.status_normalization_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin only access to normalization map"
ON public.status_normalization_map
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
  )
);

GRANT SELECT ON public.status_normalization_map TO authenticated;