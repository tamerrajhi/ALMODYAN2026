-- ACC-BRANCH-COA-TREEFIX-VAT-1: Fix Branch COA orphans + VAT header
-- Idempotent: re-runnable safely, no deletions, no account_code changes
-- 1) Create global VAT header 2090 under 2000
-- 2) Re-parent global 2105, 2110 under 2090
-- 3) Fix all existing branch orphans (BR*-*, MAIN-*)
-- 4) Add global_parent_account_code to templates + update provision function

-- ============================================================
-- B1) Create global VAT header 2090 under 2000
-- ============================================================
INSERT INTO chart_of_accounts (id, account_code, account_name, account_name_en, account_type, parent_id, is_active, is_system)
SELECT
  gen_random_uuid(),
  '2090',
  'ضريبة القيمة المضافة',
  'Value Added Tax',
  'liability'::account_type,
  (SELECT id FROM chart_of_accounts WHERE account_code = '2000'),
  true,
  true
WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = '2090');

-- ============================================================
-- B2) Re-parent global VAT accounts under 2090
-- ============================================================
UPDATE chart_of_accounts
SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '2090')
WHERE account_code IN ('2105', '2110')
  AND parent_id IS DISTINCT FROM (SELECT id FROM chart_of_accounts WHERE account_code = '2090');

-- ============================================================
-- B3) Fix existing branch orphans by suffix mapping
-- ============================================================
-- 110101 -> 1100, 110104 -> 1100
UPDATE chart_of_accounts
SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '1100')
WHERE (account_code LIKE '%-110101' OR account_code LIKE '%-110104')
  AND parent_id IS NULL
  AND EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = '1100');

-- 1301 -> 1200
UPDATE chart_of_accounts
SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '1200')
WHERE account_code LIKE '%-1301'
  AND parent_id IS NULL
  AND EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = '1200');

-- 2101 -> 2100
UPDATE chart_of_accounts
SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '2100')
WHERE account_code LIKE '%-2101'
  AND parent_id IS NULL
  AND EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = '2100');

-- 2105, 2110 -> 2090 (VAT header)
UPDATE chart_of_accounts
SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '2090')
WHERE (account_code LIKE '%-2105' OR account_code LIKE '%-2110')
  AND parent_id IS NULL
  AND EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = '2090');

-- 4100 -> 4000
UPDATE chart_of_accounts
SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '4000')
WHERE account_code LIKE '%-4100'
  AND parent_id IS NULL
  AND EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = '4000');

-- 5100 -> 5000
UPDATE chart_of_accounts
SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '5000')
WHERE account_code LIKE '%-5100'
  AND parent_id IS NULL
  AND EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = '5000');

-- ============================================================
-- B4a) Add global_parent_account_code column to templates
-- ============================================================
ALTER TABLE coa_account_templates
  ADD COLUMN IF NOT EXISTS global_parent_account_code text;

-- Populate the mapping: which global parent each template's branch account nests under
UPDATE coa_account_templates SET global_parent_account_code = '1100' WHERE template_code IN ('CASH', 'BANK');
UPDATE coa_account_templates SET global_parent_account_code = '1200' WHERE template_code = 'INVENTORY';
UPDATE coa_account_templates SET global_parent_account_code = '2100' WHERE template_code = 'AP_SUPPLIERS';
UPDATE coa_account_templates SET global_parent_account_code = '2090' WHERE template_code IN ('VAT_INPUT_PUR', 'VAT_OUTPUT');
UPDATE coa_account_templates SET global_parent_account_code = '4000' WHERE template_code = 'SALES_REVENUE';
UPDATE coa_account_templates SET global_parent_account_code = '5000' WHERE template_code = 'COGS';

-- ============================================================
-- B4b) Updated provision_branch_coa_atomic — sets parent_id from
--      global_parent_account_code, repairs orphans on re-run
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
  v_repaired     int := 0;
BEGIN
  SELECT code INTO v_branch_code FROM branches WHERE id = v_branch_id;
  IF v_branch_code IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'الفرع غير موجود');
  END IF;

  IF EXISTS (SELECT 1 FROM branch_coa_accounts WHERE branch_id = v_branch_id LIMIT 1) THEN
    FOR v_tmpl IN
      SELECT t.template_code, t.global_parent_account_code, bca.account_id
      FROM branch_coa_accounts bca
      JOIN coa_account_templates t ON t.template_code = bca.template_code
      WHERE bca.branch_id = v_branch_id
        AND t.global_parent_account_code IS NOT NULL
    LOOP
      UPDATE chart_of_accounts
      SET parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = v_tmpl.global_parent_account_code)
      WHERE id = v_tmpl.account_id
        AND parent_id IS DISTINCT FROM (SELECT id FROM chart_of_accounts WHERE account_code = v_tmpl.global_parent_account_code);
      IF FOUND THEN v_repaired := v_repaired + 1; END IF;
    END LOOP;

    SELECT count(*) INTO v_count FROM branch_coa_accounts WHERE branch_id = v_branch_id;
    RETURN jsonb_build_object('success', true, 'already', true, 'existing_count', v_count, 'repaired_parents', v_repaired);
  END IF;

  FOR v_tmpl IN
    SELECT template_code, account_code, name_ar, name_en, account_type,
           global_parent_account_code
    FROM coa_account_templates
    ORDER BY sort_order
  LOOP
    v_acct_code := v_branch_code || '-' || v_tmpl.account_code;

    v_parent_acct := NULL;
    IF v_tmpl.global_parent_account_code IS NOT NULL THEN
      SELECT id INTO v_parent_acct
      FROM chart_of_accounts
      WHERE account_code = v_tmpl.global_parent_account_code;
    END IF;

    IF EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = v_acct_code) THEN
      SELECT id INTO v_acct_id FROM chart_of_accounts WHERE account_code = v_acct_code;
      UPDATE chart_of_accounts
      SET parent_id = v_parent_acct
      WHERE id = v_acct_id AND parent_id IS DISTINCT FROM v_parent_acct;
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
