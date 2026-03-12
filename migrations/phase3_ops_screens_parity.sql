-- Phase 3C: Operational screens DB parity migration
-- Run date: 2026-02-07

-- Branches: add branch_type and manager_name columns
ALTER TABLE branches ADD COLUMN IF NOT EXISTS branch_type TEXT NOT NULL DEFAULT 'jewelry';
ALTER TABLE branches ADD COLUMN IF NOT EXISTS manager_name TEXT;

-- Customers: add missing columns expected by UI
ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS vat_number TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_type TEXT NOT NULL DEFAULT 'individual';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS loyalty_points INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS total_purchases NUMERIC(15,2) NOT NULL DEFAULT 0;
