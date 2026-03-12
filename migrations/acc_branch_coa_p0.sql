-- ACC-BRANCH-COA-FAST-0: Branch COA Auto-Provisioning
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION
-- Tables: coa_account_templates, branch_coa_accounts
-- Function: provision_branch_coa_atomic(p_payload jsonb)
-- Seed: 8 essential templates for purchasing/sales

-- ============================================================
-- 1) coa_account_templates — master template for branch COA
-- ============================================================
CREATE TABLE IF NOT EXISTS coa_account_templates (
  template_code        text PRIMARY KEY,
  account_code         text NOT NULL,
  name_ar              text NOT NULL,
  name_en              text,
  account_type         account_type NOT NULL,
  parent_template_code text REFERENCES coa_account_templates(template_code),
  is_postable          boolean NOT NULL DEFAULT true,
  sort_order           int NOT NULL DEFAULT 0
);

-- ============================================================
-- 2) branch_coa_accounts — mapping per branch
-- ============================================================
CREATE TABLE IF NOT EXISTS branch_coa_accounts (
  branch_id     uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  template_code text NOT NULL REFERENCES coa_account_templates(template_code),
  account_id    uuid NOT NULL REFERENCES chart_of_accounts(id) ON DELETE CASCADE,
  UNIQUE(branch_id, template_code)
);

-- ============================================================
-- 3) Seed template rows (idempotent via ON CONFLICT)
-- ============================================================
INSERT INTO coa_account_templates (template_code, account_code, name_ar, name_en, account_type, parent_template_code, is_postable, sort_order)
VALUES
  ('CASH',              '110101', 'الصندوق - نقدي',                          'Cash',                'asset',     NULL,         true,  10),
  ('BANK',              '110104', 'البنك - تحويل بنكي',                      'Bank Transfer',       'asset',     NULL,         true,  20),
  ('INVENTORY',         '1301',   'مخزون البضائع',                           'Inventory',           'asset',     NULL,         true,  30),
  ('AP_SUPPLIERS',      '2101',   'الذمم الدائنة - الموردين',                'Accounts Payable',    'liability', NULL,         true,  40),
  ('VAT_INPUT_PUR',     '2105',   'ضريبة القيمة المضافة المدخلة - مشتريات', 'VAT Input Purchases', 'liability', NULL,         true,  50),
  ('VAT_OUTPUT',        '2110',   'ضريبة القيمة المضافة المخرجة',           'VAT Output',         'liability', NULL,         true,  60),
  ('SALES_REVENUE',     '4100',   'إيرادات المبيعات',                        'Sales Revenue',       'revenue',   NULL,         true,  70),
  ('COGS',              '5100',   'تكلفة البضائع المباعة',                   'COGS',                'expense',   NULL,         true,  80)
ON CONFLICT (template_code) DO UPDATE SET
  account_code = EXCLUDED.account_code,
  name_ar      = EXCLUDED.name_ar,
  name_en      = EXCLUDED.name_en,
  account_type = EXCLUDED.account_type,
  sort_order   = EXCLUDED.sort_order;

-- ============================================================
-- 4) provision_branch_coa_atomic(p_payload jsonb) — creates
--    per-branch COA from templates
-- ============================================================
CREATE OR REPLACE FUNCTION public.provision_branch_coa_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_branch_id    uuid := (p_payload->>'branch_id')::uuid;
  v_branch_code  text;
  v_tmpl         RECORD;
  v_acct_id      uuid;
  v_parent_acct  uuid;
  v_acct_code    text;
  v_count        int := 0;
BEGIN
  -- Validate branch exists
  SELECT code INTO v_branch_code FROM branches WHERE id = v_branch_id;
  IF v_branch_code IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'الفرع غير موجود');
  END IF;

  -- Idempotency: if already provisioned, return early
  IF EXISTS (SELECT 1 FROM branch_coa_accounts WHERE branch_id = v_branch_id LIMIT 1) THEN
    SELECT count(*) INTO v_count FROM branch_coa_accounts WHERE branch_id = v_branch_id;
    RETURN jsonb_build_object('success', true, 'already', true, 'existing_count', v_count);
  END IF;

  -- Loop through templates ordered by sort_order (parents first)
  FOR v_tmpl IN
    SELECT template_code, account_code, name_ar, name_en, account_type,
           parent_template_code, is_postable
    FROM coa_account_templates
    ORDER BY sort_order
  LOOP
    -- Build branch-specific account code: <branch_code>-<base_code>
    v_acct_code := v_branch_code || '-' || v_tmpl.account_code;

    -- Resolve parent if template has a parent
    v_parent_acct := NULL;
    IF v_tmpl.parent_template_code IS NOT NULL THEN
      SELECT account_id INTO v_parent_acct
      FROM branch_coa_accounts
      WHERE branch_id = v_branch_id
        AND template_code = v_tmpl.parent_template_code;
    END IF;

    -- Skip if account_code already exists (defensive)
    IF EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = v_acct_code) THEN
      SELECT id INTO v_acct_id FROM chart_of_accounts WHERE account_code = v_acct_code;
    ELSE
      INSERT INTO chart_of_accounts (
        id, account_code, account_name, account_name_en, account_type,
        parent_id, is_active, is_system
      ) VALUES (
        gen_random_uuid(), v_acct_code, v_tmpl.name_ar || ' - ' || v_branch_code,
        COALESCE(v_tmpl.name_en, '') || ' - ' || v_branch_code,
        v_tmpl.account_type,
        v_parent_acct, true, true
      )
      RETURNING id INTO v_acct_id;
    END IF;

    -- Insert mapping
    INSERT INTO branch_coa_accounts (branch_id, template_code, account_id)
    VALUES (v_branch_id, v_tmpl.template_code, v_acct_id)
    ON CONFLICT (branch_id, template_code) DO NOTHING;

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'already', false, 'created_count', v_count);

EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
