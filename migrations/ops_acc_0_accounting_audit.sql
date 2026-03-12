-- OPS-ACC-0: Accounting Audit - Create missing tables/views for health check pages
-- Idempotent: all statements use IF NOT EXISTS or CREATE OR REPLACE

-- 1. customer_receipts VIEW (maps to payments with payment_type='receipt')
-- Health check lib reads: id, receipt_number, receipt_date, amount, customer_id, branch_id, payment_method, journal_entry_id
CREATE OR REPLACE VIEW customer_receipts AS
SELECT
  id,
  payment_number AS receipt_number,
  payment_date AS receipt_date,
  amount,
  customer_id,
  branch_id,
  payment_method,
  journal_entry_id,
  reference_type,
  reference_id,
  notes,
  created_at,
  created_by,
  invoice_id,
  status,
  void_reason,
  voided_at
FROM payments
WHERE payment_type = 'receipt';

-- 2. finished_goods_showroom table
CREATE TABLE IF NOT EXISTS finished_goods_showroom (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_code TEXT,
  item_name TEXT,
  status TEXT DEFAULT 'available',
  sale_id UUID,
  branch_id UUID,
  weight NUMERIC(10,3),
  karat TEXT,
  cost_price NUMERIC(15,2),
  selling_price NUMERIC(15,2),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. accounting_audit_logs table
CREATE TABLE IF NOT EXISTS accounting_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details JSONB,
  performed_by UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);
