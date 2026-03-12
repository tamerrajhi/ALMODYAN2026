-- PV-3 prerequisite: register workflow type (idempotent)
DO $$
BEGIN
  -- only if the workflow_types table exists
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema='public' AND table_name='workflow_types'
  ) THEN
    -- only if expected columns exist (defensive)
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='workflow_types' AND column_name='code'
    ) THEN
      INSERT INTO public.workflow_types (code, description, is_enabled)
      VALUES ('payment_voucher', 'Payment voucher atomic workflow', true)
      ON CONFLICT (code) DO NOTHING;
    END IF;
  END IF;
END $$;