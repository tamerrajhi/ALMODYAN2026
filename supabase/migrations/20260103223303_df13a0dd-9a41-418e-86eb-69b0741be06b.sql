-- 1. إنشاء حساب رئيسي جديد للقطع المستوردة (Parent Account)
INSERT INTO chart_of_accounts (account_code, account_name, account_name_en, account_type, is_system, parent_id, description)
VALUES (
  '110307', 
  'مخزون متاح للبيع - قطع مستوردة (رئيسي)', 
  'Imported Pieces Inventory (Parent)', 
  'asset', 
  true, 
  'e14d7184-a9b9-4307-a9b3-559de2ab3ed9',  -- parent_id = المخزون (1103)
  'حساب رئيسي لتجميع أرصدة مخزون القطع المستوردة لجميع الفروع - لا يستخدم في القيود المباشرة'
);

-- 2. تحديث الحساب القديم (1137) ليكون فرعياً وإعادة تسميته للفرع الأول (المقر الرئيسي)
UPDATE chart_of_accounts 
SET 
  parent_id = (SELECT id FROM chart_of_accounts WHERE account_code = '110307'),
  account_name = 'مخزون متاح للبيع - قطع مستوردة - المقر الرئيسي',
  account_name_en = 'Imported Pieces Inventory - HQ'
WHERE account_code = '1137';

-- 3. إنشاء حسابات فرعية للفروع الأخرى
-- فرع BR2
INSERT INTO chart_of_accounts (account_code, account_name, account_name_en, account_type, is_system, parent_id)
VALUES (
  '11370002', 
  'مخزون متاح للبيع - قطع مستوردة - BR2', 
  'Imported Pieces Inventory - BR2', 
  'asset', 
  true, 
  (SELECT id FROM chart_of_accounts WHERE account_code = '110307')
);

-- فرع BR3-Gold
INSERT INTO chart_of_accounts (account_code, account_name, account_name_en, account_type, is_system, parent_id)
VALUES (
  '11370003', 
  'مخزون متاح للبيع - قطع مستوردة - BR3-Gold', 
  'Imported Pieces Inventory - BR3-Gold', 
  'asset', 
  true, 
  (SELECT id FROM chart_of_accounts WHERE account_code = '110307')
);

-- 4. إنشاء جدول ربط الفروع بحسابات المخزون
CREATE TABLE IF NOT EXISTS branch_inventory_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  imported_pieces_account_id UUID REFERENCES chart_of_accounts(id),
  general_inventory_account_id UUID REFERENCES chart_of_accounts(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(branch_id)
);

-- 5. إضافة RLS Policies
ALTER TABLE branch_inventory_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view branch inventory accounts"
ON branch_inventory_accounts FOR SELECT
USING (true);

CREATE POLICY "Admins can manage branch inventory accounts"
ON branch_inventory_accounts FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- 6. إنشاء index للأداء
CREATE INDEX IF NOT EXISTS idx_branch_inventory_accounts_branch_id 
ON branch_inventory_accounts(branch_id);

-- 7. ملء جدول الربط بالبيانات الأولية
-- ربط المقر الرئيسي بالحساب 1137
INSERT INTO branch_inventory_accounts (branch_id, imported_pieces_account_id)
VALUES (
  '40588085-9d0c-4ab4-a682-662b937196df',  -- المقر الرئيسي
  (SELECT id FROM chart_of_accounts WHERE account_code = '1137')
);

-- ربط BR2 بحسابه
INSERT INTO branch_inventory_accounts (branch_id, imported_pieces_account_id)
VALUES (
  '0dfd6b76-2c40-451b-9a08-de3d073f1452',  -- BR2
  (SELECT id FROM chart_of_accounts WHERE account_code = '11370002')
);

-- ربط BR3-Gold بحسابه
INSERT INTO branch_inventory_accounts (branch_id, imported_pieces_account_id)
VALUES (
  'aba6bb15-34a9-4741-8a98-843bdf246227',  -- BR3-Gold
  (SELECT id FROM chart_of_accounts WHERE account_code = '11370003')
);