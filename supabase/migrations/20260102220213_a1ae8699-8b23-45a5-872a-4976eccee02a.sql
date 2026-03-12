-- إضافة حسابات محاسبية جديدة للرسوم والخصومات
-- 1. حساب إيرادات الخدمات (رسوم الشحن والتوصيل)
INSERT INTO chart_of_accounts (account_code, account_name, account_name_en, account_type, is_active, is_system, description)
VALUES ('4102', 'إيرادات خدمات', 'Service Revenue', 'revenue', true, true, 'إيرادات الخدمات المقدمة للعملاء مثل رسوم الشحن والتوصيل')
ON CONFLICT (account_code) DO NOTHING;

-- 2. حساب خصم مسموح به (مصروف بيعي)
INSERT INTO chart_of_accounts (account_code, account_name, account_name_en, account_type, is_active, is_system, description)
VALUES ('5201', 'خصم مسموح به', 'Discount Allowed', 'expense', true, true, 'الخصومات الممنوحة للعملاء بعد إصدار الفاتورة')
ON CONFLICT (account_code) DO NOTHING;

-- 3. حساب مصروف شحن (عندما تتحمله الشركة)
INSERT INTO chart_of_accounts (account_code, account_name, account_name_en, account_type, is_active, is_system, description)
VALUES ('5202', 'مصروف شحن', 'Shipping Expense', 'expense', true, true, 'مصاريف الشحن والتوصيل التي تتحملها الشركة')
ON CONFLICT (account_code) DO NOTHING;