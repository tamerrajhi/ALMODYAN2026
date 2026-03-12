-- Phase-3B.4: Add missing columns to purchase_invoice_lines for linkage parity
-- Adds: line_number, branch_id, account_id, inventory_account_id, expense_account_id
-- All nullable, no data backfill required.

ALTER TABLE purchase_invoice_lines
  ADD COLUMN IF NOT EXISTS line_number INTEGER,
  ADD COLUMN IF NOT EXISTS branch_id UUID,
  ADD COLUMN IF NOT EXISTS account_id UUID,
  ADD COLUMN IF NOT EXISTS inventory_account_id UUID,
  ADD COLUMN IF NOT EXISTS expense_account_id UUID;

CREATE INDEX IF NOT EXISTS idx_pil_invoice_id ON purchase_invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_pil_branch_id ON purchase_invoice_lines(branch_id);
CREATE INDEX IF NOT EXISTS idx_pil_account_id ON purchase_invoice_lines(account_id);
