-- ============================================================
-- UNIQUE PURCHASE MODULE V1 — Tables + Indexes + View
-- Idempotent: safe to re-run
-- ============================================================

-- 1. unique_purchase_batches
CREATE TABLE IF NOT EXISTS unique_purchase_batches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_no      text NOT NULL UNIQUE,
  supplier_id   uuid NOT NULL REFERENCES suppliers(id),
  branch_id     uuid NOT NULL REFERENCES branches(id),
  uploaded_file_name text,
  status        text NOT NULL DEFAULT 'pending',
  rows_total    int NOT NULL DEFAULT 0,
  rows_imported int NOT NULL DEFAULT 0,
  rows_failed   int NOT NULL DEFAULT 0,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid
);

-- 2. unique_purchase_invoices
CREATE TABLE IF NOT EXISTS unique_purchase_invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id        uuid NOT NULL REFERENCES unique_purchase_batches(id),
  supplier_id     uuid NOT NULL REFERENCES suppliers(id),
  branch_id       uuid NOT NULL REFERENCES branches(id),
  supp_inv        text,
  invoice_number  text NOT NULL,
  invoice_date    date NOT NULL DEFAULT CURRENT_DATE,
  status          text NOT NULL DEFAULT 'posted',
  vat_rate        numeric NOT NULL DEFAULT 0,
  subtotal        numeric NOT NULL DEFAULT 0,
  tax_amount      numeric NOT NULL DEFAULT 0,
  total_amount    numeric NOT NULL DEFAULT 0,
  journal_entry_id uuid REFERENCES journal_entries(id),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid
);

-- Partial unique index: per-supplier SUPP INV uniqueness (only non-voided, non-empty)
CREATE UNIQUE INDEX IF NOT EXISTS uix_unique_inv_supp_inv
  ON unique_purchase_invoices (supplier_id, upper(trim(supp_inv)))
  WHERE status <> 'voided'
    AND supp_inv IS NOT NULL
    AND trim(supp_inv) <> '';

-- 3. unique_items (the core unique jewelry pieces table)
CREATE TABLE IF NOT EXISTS unique_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_no       text NOT NULL UNIQUE,
  branch_id       uuid NOT NULL REFERENCES branches(id),
  supplier_id     uuid REFERENCES suppliers(id),
  batch_id        uuid REFERENCES unique_purchase_batches(id),
  unique_invoice_id uuid REFERENCES unique_purchase_invoices(id),
  -- structured fields from Excel
  stockcode       text,
  model           text,
  description     text,
  division        text,
  supp_ref        text,
  type            text,
  cost_code       text,
  tag1            text,
  tag2            text,
  tag3            text,
  tag4            text,
  tag5            text,
  cost            numeric NOT NULL DEFAULT 0,
  tag_price       numeric NOT NULL DEFAULT 0,
  minimum_price   numeric NOT NULL DEFAULT 0,
  g_weight        numeric NOT NULL DEFAULT 0,
  d_weight        numeric NOT NULL DEFAULT 0,
  b_weight        numeric NOT NULL DEFAULT 0,
  mq_weight       numeric NOT NULL DEFAULT 0,
  cs_weight       numeric NOT NULL DEFAULT 0,
  stone_weight    numeric NOT NULL DEFAULT 0,
  metal_weight    numeric NOT NULL DEFAULT 0,
  m_weight        numeric NOT NULL DEFAULT 0,
  rate_type       text,
  clarity         text,
  metal           text,
  stone           text,
  -- sellable tracking
  sale_id         uuid,
  sold_at         timestamptz,
  -- raw Excel data preservation
  raw_headers_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_values_json  jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_row_json     jsonb,
  -- metadata
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid
);

-- 4. unique_purchase_invoice_items (link table: invoice ↔ item)
CREATE TABLE IF NOT EXISTS unique_purchase_invoice_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unique_invoice_id uuid NOT NULL REFERENCES unique_purchase_invoices(id),
  unique_item_id    uuid NOT NULL REFERENCES unique_items(id),
  line_no           int NOT NULL DEFAULT 1,
  unit_cost         numeric NOT NULL DEFAULT 0,
  qty               int NOT NULL DEFAULT 1,
  line_total        numeric NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- 5. unique_purchase_returns
CREATE TABLE IF NOT EXISTS unique_purchase_returns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number   text NOT NULL UNIQUE,
  supplier_id     uuid NOT NULL REFERENCES suppliers(id),
  branch_id       uuid NOT NULL REFERENCES branches(id),
  unique_invoice_id uuid REFERENCES unique_purchase_invoices(id),
  return_date     date NOT NULL DEFAULT CURRENT_DATE,
  status          text NOT NULL DEFAULT 'draft',
  reason          text,
  subtotal        numeric NOT NULL DEFAULT 0,
  tax_amount      numeric NOT NULL DEFAULT 0,
  total_amount    numeric NOT NULL DEFAULT 0,
  journal_entry_id uuid REFERENCES journal_entries(id),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid
);

-- 6. unique_purchase_return_items
CREATE TABLE IF NOT EXISTS unique_purchase_return_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unique_return_id      uuid NOT NULL REFERENCES unique_purchase_returns(id),
  unique_item_id        uuid NOT NULL REFERENCES unique_items(id),
  unit_cost             numeric NOT NULL DEFAULT 0,
  qty                   int NOT NULL DEFAULT 1,
  line_total            numeric NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- 7. Sequence for serial_no generation
CREATE SEQUENCE IF NOT EXISTS unique_serial_seq START 1;

-- 8. View: v_sellable_unique_items
CREATE OR REPLACE VIEW v_sellable_unique_items AS
SELECT
  id,
  serial_no,
  stockcode,
  model,
  description,
  tag_price,
  cost,
  CASE
    WHEN sale_id IS NULL AND sold_at IS NULL THEN 'sellable'
    ELSE 'not_sellable'
  END AS sellable_status,
  sold_at,
  branch_id,
  supplier_id,
  batch_id,
  unique_invoice_id
FROM unique_items;

-- 9. Helpful indexes
CREATE INDEX IF NOT EXISTS idx_unique_items_branch ON unique_items(branch_id);
CREATE INDEX IF NOT EXISTS idx_unique_items_supplier ON unique_items(supplier_id);
CREATE INDEX IF NOT EXISTS idx_unique_items_batch ON unique_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_unique_items_invoice ON unique_items(unique_invoice_id);
CREATE INDEX IF NOT EXISTS idx_unique_items_serial ON unique_items(serial_no);
CREATE INDEX IF NOT EXISTS idx_unique_items_sellable ON unique_items(sale_id, sold_at) WHERE sale_id IS NULL AND sold_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_unique_inv_items_invoice ON unique_purchase_invoice_items(unique_invoice_id);
CREATE INDEX IF NOT EXISTS idx_unique_inv_items_item ON unique_purchase_invoice_items(unique_item_id);
CREATE INDEX IF NOT EXISTS idx_unique_ret_items_return ON unique_purchase_return_items(unique_return_id);
CREATE INDEX IF NOT EXISTS idx_unique_ret_items_item ON unique_purchase_return_items(unique_item_id);
