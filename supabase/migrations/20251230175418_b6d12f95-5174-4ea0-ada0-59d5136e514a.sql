-- إضافة شاشة مرتجع POS للصلاحيات
INSERT INTO screens (screen_key, screen_name, screen_name_en, screen_path, parent_key, icon, sort_order)
VALUES ('pos_return', 'مرتجع مبيعات POS', 'POS Sales Return', '/pos/return', 'sales', 'RotateCcw', 35)
ON CONFLICT (screen_key) DO UPDATE SET 
  screen_name = EXCLUDED.screen_name,
  screen_name_en = EXCLUDED.screen_name_en,
  screen_path = EXCLUDED.screen_path;

-- إضافة حساب مردودات المبيعات إذا لم يكن موجوداً
INSERT INTO chart_of_accounts (account_code, account_name, account_name_en, account_type, parent_id, is_active, is_system, description)
SELECT '4201', 'مردودات المبيعات', 'Sales Returns', 'revenue',
  (SELECT id FROM chart_of_accounts WHERE account_code = '42' LIMIT 1),
  true, true, 'حساب مردودات المبيعات والتخفيضات'
WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = '4201');

-- إضافة حساب أرصدة العملاء الدائنة (Store Credit) إذا لم يكن موجوداً
INSERT INTO chart_of_accounts (account_code, account_name, account_name_en, account_type, parent_id, is_active, is_system, description)
SELECT '2310', 'أرصدة العملاء الدائنة', 'Customer Store Credits', 'liability',
  (SELECT id FROM chart_of_accounts WHERE account_code = '23' OR account_code = '2' LIMIT 1),
  true, true, 'حساب أرصدة العملاء الدائنة (Store Credit)'
WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = '2310');

-- إضافة حساب ضريبة القيمة المضافة المستحقة إذا لم يكن موجوداً
INSERT INTO chart_of_accounts (account_code, account_name, account_name_en, account_type, parent_id, is_active, is_system, description)
SELECT '2201', 'ضريبة القيمة المضافة المستحقة', 'VAT Payable', 'liability',
  (SELECT id FROM chart_of_accounts WHERE account_code = '22' OR account_code = '2' LIMIT 1),
  true, true, 'حساب ضريبة القيمة المضافة المستحقة'
WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = '2201');