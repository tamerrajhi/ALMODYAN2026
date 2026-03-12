-- Phase-3B.1: Create missing Neon tables for vault & settings endpoints
-- Tables: cash_vaults, gold_vaults, branch_inventory_accounts,
--         payment_account_settings, production_account_settings
-- All columns derived from Supabase type definitions + server route SQL.

-- 1) cash_vaults
CREATE TABLE IF NOT EXISTS cash_vaults (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_name    TEXT NOT NULL,
  name          TEXT GENERATED ALWAYS AS (vault_name) STORED,
  branch_id     UUID REFERENCES branches(id),
  account_id    UUID REFERENCES chart_of_accounts(id),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cash_vaults_branch_id ON cash_vaults(branch_id);
CREATE INDEX IF NOT EXISTS idx_cash_vaults_is_active ON cash_vaults(is_active);

-- 2) gold_vaults
CREATE TABLE IF NOT EXISTS gold_vaults (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_name    TEXT NOT NULL,
  name          TEXT GENERATED ALWAYS AS (vault_name) STORED,
  vault_type    TEXT NOT NULL DEFAULT 'standard',
  branch_id     UUID REFERENCES branches(id),
  account_id    UUID REFERENCES chart_of_accounts(id),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gold_vaults_branch_id ON gold_vaults(branch_id);
CREATE INDEX IF NOT EXISTS idx_gold_vaults_is_active ON gold_vaults(is_active);

-- 3) branch_inventory_accounts
CREATE TABLE IF NOT EXISTS branch_inventory_accounts (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id                     UUID NOT NULL UNIQUE REFERENCES branches(id),
  general_inventory_account_id  UUID REFERENCES chart_of_accounts(id),
  imported_pieces_account_id    UUID REFERENCES chart_of_accounts(id),
  created_at                    TIMESTAMPTZ DEFAULT now(),
  updated_at                    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_branch_inv_accts_branch_id ON branch_inventory_accounts(branch_id);

-- 4) payment_account_settings
CREATE TABLE IF NOT EXISTS payment_account_settings (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id                 UUID UNIQUE REFERENCES branches(id),
  cash_account_id           UUID REFERENCES chart_of_accounts(id),
  bank_transfer_account_id  UUID REFERENCES chart_of_accounts(id),
  check_account_id          UUID REFERENCES chart_of_accounts(id),
  card_account_id           UUID REFERENCES chart_of_accounts(id),
  created_by                UUID,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pay_acct_settings_branch_id ON payment_account_settings(branch_id);

-- 5) production_account_settings
CREATE TABLE IF NOT EXISTS production_account_settings (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id                 UUID UNIQUE REFERENCES branches(id),
  wip_account_id            UUID REFERENCES chart_of_accounts(id),
  raw_material_account_id   UUID REFERENCES chart_of_accounts(id),
  finished_goods_account_id UUID REFERENCES chart_of_accounts(id),
  scrap_loss_account_id     UUID REFERENCES chart_of_accounts(id),
  is_journal_auto_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prod_acct_settings_branch_id ON production_account_settings(branch_id);
