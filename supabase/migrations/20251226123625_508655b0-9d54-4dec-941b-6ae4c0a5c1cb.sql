-- =====================================================
-- ربط صلاحيات الأدوار المحاسبية بالشاشات
-- =====================================================

-- محاسب مكتب طيبة - صلاحيات محدودة على المحاسبة والمبيعات
INSERT INTO public.role_permissions (role_id, screen_id, can_view, can_create, can_edit, can_delete)
SELECT 
    (SELECT id FROM custom_roles WHERE role_name = 'محاسب مكتب طيبة'),
    id, true, true, true, false
FROM screens 
WHERE screen_key IN ('dashboard', 'pos', 'sales_history', 'returns', 'customers', 'invoices', 'payments', 'journal_entries');

-- محاسب مبيعات جدة - صلاحيات على المبيعات والعملاء
INSERT INTO public.role_permissions (role_id, screen_id, can_view, can_create, can_edit, can_delete)
SELECT 
    (SELECT id FROM custom_roles WHERE role_name = 'محاسب مبيعات جدة'),
    id, true, true, true, false
FROM screens 
WHERE screen_key IN ('dashboard', 'pos', 'sales_history', 'returns', 'customers', 'invoices', 'payments', 'journal_entries', 'finished_goods_showroom');

-- المحاسب العام - صلاحيات واسعة على المحاسبة
INSERT INTO public.role_permissions (role_id, screen_id, can_view, can_create, can_edit, can_delete)
SELECT 
    (SELECT id FROM custom_roles WHERE role_name = 'المحاسب العام'),
    id, true, true, true, true
FROM screens 
WHERE screen_key IN ('dashboard', 'accounting', 'chart_of_accounts', 'journal_entries', 'invoices', 'payments', 'account_ledger', 'financial_reports', 'customers', 'suppliers', 'cash_vault');

-- محاسب التكاليف - صلاحيات على الإنتاج والتكاليف
INSERT INTO public.role_permissions (role_id, screen_id, can_view, can_create, can_edit, can_delete)
SELECT 
    (SELECT id FROM custom_roles WHERE role_name = 'محاسب التكاليف'),
    id, true, true, true, false
FROM screens 
WHERE screen_key IN ('dashboard', 'production_wip', 'raw_materials', 'finished_goods_factory', 'gold_vault', 'journal_entries', 'batches', 'inventory_counts', 'reports');

-- المدير المالي - صلاحيات كاملة على المحاسبة والتقارير
INSERT INTO public.role_permissions (role_id, screen_id, can_view, can_create, can_edit, can_delete)
SELECT 
    (SELECT id FROM custom_roles WHERE role_name = 'المدير المالي'),
    id, true, true, true, true
FROM screens 
WHERE screen_key IN ('dashboard', 'accounting', 'chart_of_accounts', 'journal_entries', 'invoices', 'payments', 'account_ledger', 'financial_reports', 'reports', 'customers', 'suppliers', 'cash_vault', 'gold_vault', 'inventory_counts', 'audit_logs');

-- نائب المدير العام - صلاحيات شاملة ماعدا الإعدادات
INSERT INTO public.role_permissions (role_id, screen_id, can_view, can_create, can_edit, can_delete)
SELECT 
    (SELECT id FROM custom_roles WHERE role_name = 'نائب المدير العام'),
    id, true, true, true, true
FROM screens 
WHERE screen_key NOT IN ('system_settings', 'system_health', 'backup');

-- المدير العام - صلاحيات كاملة على كل الشاشات
INSERT INTO public.role_permissions (role_id, screen_id, can_view, can_create, can_edit, can_delete)
SELECT 
    (SELECT id FROM custom_roles WHERE role_name = 'المدير العام'),
    id, true, true, true, true
FROM screens;