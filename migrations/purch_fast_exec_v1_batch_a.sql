-- PURCH-FAST-EXEC-V1 BATCH A — DDL for missing Purchasing tables + view
-- Idempotent: safe to re-run

-- 1) purchase_returns
CREATE TABLE IF NOT EXISTS purchase_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number TEXT NOT NULL,
  return_date DATE NOT NULL DEFAULT CURRENT_DATE,
  purchase_type TEXT NOT NULL DEFAULT 'general' CHECK (purchase_type IN ('general', 'import', 'unique')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'completed', 'posted', 'confirmed', 'voided', 'cancelled', 'partial')),
  supplier_id UUID REFERENCES suppliers(id),
  branch_id UUID REFERENCES branches(id),
  purchase_invoice_id UUID REFERENCES invoices(id),
  subtotal NUMERIC(18,4) DEFAULT 0,
  tax_amount NUMERIC(18,4) DEFAULT 0,
  total_amount NUMERIC(18,4) DEFAULT 0,
  reason TEXT,
  notes TEXT,
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  client_request_id TEXT UNIQUE
);

-- 2) purchase_return_items
CREATE TABLE IF NOT EXISTS purchase_return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
  jewelry_item_id UUID NOT NULL REFERENCES jewelry_items(id),
  unit_price NUMERIC(18,4) DEFAULT 0,
  tax_amount NUMERIC(18,4) DEFAULT 0,
  total_amount NUMERIC(18,4) DEFAULT 0,
  gold_weight NUMERIC(18,4) DEFAULT 0,
  karat_id UUID,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3) purchase_return_lines
CREATE TABLE IF NOT EXISTS purchase_return_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES invoices(id),
  invoice_line_id UUID,
  line_number INT DEFAULT 1,
  item_id UUID,
  item_type TEXT DEFAULT 'product' CHECK (item_type IN ('product', 'cost', 'service')),
  description TEXT,
  quantity NUMERIC(18,4) DEFAULT 0,
  unit_cost NUMERIC(18,4) DEFAULT 0,
  vat_rate NUMERIC(6,4) DEFAULT 0,
  tax_amount NUMERIC(18,4) DEFAULT 0,
  line_total NUMERIC(18,4) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4) purchase_order_receipts
CREATE TABLE IF NOT EXISTS purchase_order_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id UUID NOT NULL REFERENCES purchase_orders(id),
  received_by UUID,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  status TEXT DEFAULT 'received' CHECK (status IN ('received', 'partial', 'rejected', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5) pr_approval_thresholds
CREATE TABLE IF NOT EXISTS pr_approval_thresholds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  threshold_name TEXT NOT NULL,
  min_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  max_amount NUMERIC(18,2),
  approver_role TEXT NOT NULL DEFAULT 'manager',
  approval_order INT NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_purchase_returns_supplier ON purchase_returns(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_branch ON purchase_returns(branch_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_invoice ON purchase_returns(purchase_invoice_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_status ON purchase_returns(status);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_date ON purchase_returns(return_date);
CREATE INDEX IF NOT EXISTS idx_purchase_return_items_return ON purchase_return_items(return_id);
CREATE INDEX IF NOT EXISTS idx_purchase_return_items_jewelry ON purchase_return_items(jewelry_item_id);
CREATE INDEX IF NOT EXISTS idx_purchase_return_lines_return ON purchase_return_lines(return_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_receipts_po ON purchase_order_receipts(po_id);

-- v_returns_hub view
CREATE OR REPLACE VIEW v_returns_hub AS
SELECT
  pr.return_number,
  CASE WHEN pr.purchase_type = 'import' THEN 'unique' ELSE 'general' END AS return_type,
  pr.id AS canonical_id,
  pr.status,
  pr.branch_id,
  pr.supplier_id,
  pr.return_date::text AS return_date,
  pr.subtotal,
  pr.tax_amount,
  pr.total_amount,
  TRUE AS mirror_exists,
  (pr.journal_entry_id IS NOT NULL) AS has_je,
  pr.journal_entry_id,
  NULL::int AS expected_movement_count,
  NULL::int AS actual_movement_count,
  NULL::boolean AS has_drift,
  NULL::text AS drift_type,
  pr.created_at::text AS created_at
FROM purchase_returns pr;
