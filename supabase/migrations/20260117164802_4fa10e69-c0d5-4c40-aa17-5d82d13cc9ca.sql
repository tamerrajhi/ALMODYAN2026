-- ============================================================
-- A) Replace CHECK valid_workflow_type with reference table + FK
-- ============================================================

-- 1) Create reference table
CREATE TABLE IF NOT EXISTS public.workflow_types (
  code text PRIMARY KEY,
  description text NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2) Seed existing + known types (safe idempotent)
INSERT INTO public.workflow_types (code, description)
VALUES
  ('pos_sale','POS Sale'),
  ('pos_return','POS Return'),
  ('sales_invoice','Sales Invoice'),
  ('sales_return','Sales Return'),
  ('purchase_invoice','Purchase Invoice'),
  ('purchase_return','Purchase Return'),
  ('purchase_return_unique','Purchase Return Unique'),
  ('purchase_return_general','Purchase Return General'),
  ('purchase_receipt','Purchase Receipt'),
  ('customer_receipt','Customer Receipt'),
  ('supplier_payment','Supplier Payment'),
  ('transfer','Inventory Transfer'),
  ('imported_serial_transfer','Imported Serial Transfer'),
  ('inventory_adjustment','Inventory Adjustment'),
  ('work_order','Work Order'),
  ('daily_settlement','Daily Settlement'),
  ('convert_prs_to_pos','Convert PRs to POs'),
  ('idempotency_smoke','Idempotency Smoke Test'),
  ('hold_lock_test','Hold Lock Test')
ON CONFLICT (code) DO NOTHING;

-- 3) Ensure any workflow_type already in requests exists in reference table
INSERT INTO public.workflow_types (code, description)
SELECT DISTINCT r.workflow_type, 'Auto-seeded from existing requests'
FROM public.pos_workflow_requests r
LEFT JOIN public.workflow_types t ON t.code = r.workflow_type
WHERE t.code IS NULL;

-- 4) Drop old CHECK constraint (if exists)
ALTER TABLE public.pos_workflow_requests
DROP CONSTRAINT IF EXISTS valid_workflow_type;

-- 5) Add FK (use NOT VALID then VALIDATE to avoid long locks on big tables)
ALTER TABLE public.pos_workflow_requests
ADD CONSTRAINT fk_pos_workflow_requests_workflow_type
FOREIGN KEY (workflow_type) REFERENCES public.workflow_types(code)
ON UPDATE CASCADE
ON DELETE RESTRICT
NOT VALID;

ALTER TABLE public.pos_workflow_requests
VALIDATE CONSTRAINT fk_pos_workflow_requests_workflow_type;

-- 6) Optional: index for joins/perf
CREATE INDEX IF NOT EXISTS idx_pos_workflow_requests_workflow_type
ON public.pos_workflow_requests(workflow_type);