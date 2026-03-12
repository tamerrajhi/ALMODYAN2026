-- ==========================================
-- 1. Add missing screens to the screens table
-- ==========================================

INSERT INTO screens (screen_key, screen_name, screen_name_en, screen_path, sort_order) VALUES
  -- Dashboard
  ('dashboard_settings', 'إعدادات لوحة التحكم', 'Dashboard Settings', '/dashboard-settings', 2),
  
  -- Purchasing
  ('purchasing_orders', 'أوامر الشراء', 'Purchase Orders', '/purchasing/orders', 10),
  ('purchasing_reports', 'تقارير المشتريات', 'Purchase Reports', '/purchasing/reports', 11),
  ('item_history', 'تاريخ القطعة', 'Item History', '/item-history', 12),
  
  -- Production
  ('production_planning', 'تخطيط الإنتاج', 'Production Planning', '/production/planning', 26),
  ('production_loss_report', 'تقرير الفاقد', 'Loss Report', '/production/loss-report', 27),
  ('gemstones', 'الأحجار الكريمة', 'Gemstones', '/gemstones', 28),
  ('gemstones_link', 'ربط الأحجار', 'Link Gemstones', '/gemstones/link', 29),
  
  -- HR
  ('hr_employees', 'الموظفين', 'Employees', '/hr/employees', 40),
  ('hr_attendance', 'الحضور والانصراف', 'Attendance', '/hr/attendance', 41),
  ('hr_leaves', 'الإجازات', 'Leaves', '/hr/leaves', 42),
  ('hr_payroll', 'الرواتب', 'Payroll', '/hr/payroll', 43),
  
  -- Gold
  ('gold_scrap', 'الكسر', 'Gold Scrap', '/gold/scrap', 35),
  
  -- Settings & System
  ('settings', 'إعدادات النظام', 'System Settings', '/settings', 50),
  ('system_health', 'صحة النظام', 'System Health', '/system-health', 55)
ON CONFLICT (screen_key) DO NOTHING;

-- ==========================================
-- 2. Add new roles
-- ==========================================

INSERT INTO custom_roles (role_name, role_name_en, description, is_active) VALUES
  -- System Level (for developers/system admins)
  ('مطور النظام', 'System Developer', 'تحكم كامل في النظام - لفريق التطوير والدعم الفني', true),
  ('مدير النظام', 'System Admin', 'إدارة النظام والإعدادات والمستخدمين للعميل', true),
  
  -- Sales Department
  ('مدير المبيعات', 'Sales Manager', 'إدارة قسم المبيعات والتقارير والفريق', true),
  ('مشرف المبيعات', 'Sales Supervisor', 'إشراف على فريق المبيعات ومتابعة الأداء', true),
  ('موظف مبيعات', 'Sales Staff', 'نقطة البيع والعملاء والمرتجعات', true),
  ('أمين الصندوق', 'Cashier', 'العمليات النقدية فقط', true),
  
  -- Purchasing & Inventory
  ('مدير المشتريات', 'Purchasing Manager', 'إدارة المشتريات والموردين والدفعات', true),
  ('موظف مشتريات', 'Purchasing Staff', 'تسجيل الدفعات والاستيراد', true),
  ('أمين المخزون', 'Warehouse Keeper', 'إدارة المخزون والتحويلات والجرد', true),
  
  -- Production
  ('مدير الإنتاج', 'Production Manager', 'إدارة عمليات الإنتاج والتخطيط', true),
  ('مشرف الإنتاج', 'Production Supervisor', 'متابعة أوامر العمل والفاقد', true),
  ('فني إنتاج', 'Production Technician', 'تسجيل عمليات الإنتاج فقط', true),
  
  -- HR
  ('مدير الموارد البشرية', 'HR Manager', 'إدارة شؤون الموظفين والرواتب', true),
  ('موظف موارد بشرية', 'HR Staff', 'الحضور والإجازات', true)
ON CONFLICT DO NOTHING;

-- ==========================================
-- 3. Create role permissions template function
-- ==========================================

CREATE OR REPLACE FUNCTION setup_role_permissions(
  p_role_name text,
  p_screen_keys text[],
  p_can_view boolean DEFAULT true,
  p_can_create boolean DEFAULT false,
  p_can_edit boolean DEFAULT false,
  p_can_delete boolean DEFAULT false
) RETURNS void AS $$
DECLARE
  v_role_id uuid;
  v_screen_key text;
  v_screen_id uuid;
BEGIN
  -- Get role ID
  SELECT id INTO v_role_id FROM custom_roles WHERE role_name = p_role_name;
  
  IF v_role_id IS NULL THEN
    RETURN; -- Skip if role not found
  END IF;
  
  -- Add permissions for each screen
  FOREACH v_screen_key IN ARRAY p_screen_keys LOOP
    SELECT id INTO v_screen_id FROM screens WHERE screen_key = v_screen_key;
    
    IF v_screen_id IS NOT NULL THEN
      INSERT INTO role_permissions (role_id, screen_id, can_view, can_create, can_edit, can_delete)
      VALUES (v_role_id, v_screen_id, p_can_view, p_can_create, p_can_edit, p_can_delete)
      ON CONFLICT (role_id, screen_id) DO UPDATE SET
        can_view = EXCLUDED.can_view,
        can_create = EXCLUDED.can_create,
        can_edit = EXCLUDED.can_edit,
        can_delete = EXCLUDED.can_delete;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ==========================================
-- 4. Setup default permissions for each role
-- ==========================================

-- مطور النظام (Full Access)
SELECT setup_role_permissions('مطور النظام', 
  ARRAY['dashboard', 'dashboard_settings', 'batches', 'import', 'suppliers', 'purchasing_orders', 'purchasing_reports', 'item_history',
        'pos', 'sales_history', 'returns', 'customers', 'transfers', 'transfer_requests', 'inventory_counts', 'raw_materials',
        'wip', 'production_planning', 'production_loss_report', 'finished_goods_factory', 'finished_goods_showroom', 'gemstones', 'gemstones_link',
        'accounting_dashboard', 'chart_of_accounts', 'journal_entries', 'invoices', 'payments', 'account_ledger', 'financial_reports',
        'gold_vault', 'cash_vault', 'gold_scrap', 'hr_employees', 'hr_attendance', 'hr_leaves', 'hr_payroll', 'reports',
        'branches', 'users', 'roles', 'gold_karats', 'gold_prices', 'settings', 'audit_logs', 'backup', 'system_health'],
  true, true, true, true);

-- مدير النظام (Full Access except system_health)
SELECT setup_role_permissions('مدير النظام', 
  ARRAY['dashboard', 'dashboard_settings', 'batches', 'import', 'suppliers', 'purchasing_orders', 'purchasing_reports', 'item_history',
        'pos', 'sales_history', 'returns', 'customers', 'transfers', 'transfer_requests', 'inventory_counts', 'raw_materials',
        'wip', 'production_planning', 'production_loss_report', 'finished_goods_factory', 'finished_goods_showroom', 'gemstones', 'gemstones_link',
        'accounting_dashboard', 'chart_of_accounts', 'journal_entries', 'invoices', 'payments', 'account_ledger', 'financial_reports',
        'gold_vault', 'cash_vault', 'gold_scrap', 'hr_employees', 'hr_attendance', 'hr_leaves', 'hr_payroll', 'reports',
        'branches', 'users', 'roles', 'gold_karats', 'gold_prices', 'settings', 'audit_logs', 'backup'],
  true, true, true, true);

-- مدير المبيعات
SELECT setup_role_permissions('مدير المبيعات', 
  ARRAY['dashboard', 'pos', 'sales_history', 'returns', 'customers', 'transfers', 'transfer_requests', 'reports', 'gold_prices'],
  true, true, true, true);
SELECT setup_role_permissions('مدير المبيعات', 
  ARRAY['inventory_counts', 'batches', 'gold_vault', 'cash_vault'],
  true, false, false, false);

-- مشرف المبيعات
SELECT setup_role_permissions('مشرف المبيعات', 
  ARRAY['dashboard', 'pos', 'sales_history', 'returns', 'customers', 'transfers', 'gold_prices'],
  true, true, true, false);
SELECT setup_role_permissions('مشرف المبيعات', 
  ARRAY['transfer_requests', 'reports'],
  true, false, false, false);

-- موظف مبيعات
SELECT setup_role_permissions('موظف مبيعات', 
  ARRAY['pos', 'customers', 'returns', 'gold_prices'],
  true, true, true, false);
SELECT setup_role_permissions('موظف مبيعات', 
  ARRAY['dashboard', 'sales_history'],
  true, false, false, false);

-- أمين الصندوق
SELECT setup_role_permissions('أمين الصندوق', 
  ARRAY['pos', 'cash_vault', 'gold_prices'],
  true, true, false, false);
SELECT setup_role_permissions('أمين الصندوق', 
  ARRAY['dashboard', 'sales_history'],
  true, false, false, false);

-- مدير المشتريات
SELECT setup_role_permissions('مدير المشتريات', 
  ARRAY['dashboard', 'batches', 'import', 'suppliers', 'purchasing_orders', 'purchasing_reports', 'item_history', 'raw_materials', 'reports'],
  true, true, true, true);
SELECT setup_role_permissions('مدير المشتريات', 
  ARRAY['inventory_counts', 'gold_vault', 'finished_goods_factory'],
  true, false, false, false);

-- موظف مشتريات
SELECT setup_role_permissions('موظف مشتريات', 
  ARRAY['batches', 'import', 'suppliers', 'purchasing_orders', 'item_history'],
  true, true, true, false);
SELECT setup_role_permissions('موظف مشتريات', 
  ARRAY['dashboard', 'purchasing_reports'],
  true, false, false, false);

-- أمين المخزون
SELECT setup_role_permissions('أمين المخزون', 
  ARRAY['transfers', 'transfer_requests', 'inventory_counts', 'raw_materials', 'finished_goods_factory', 'finished_goods_showroom'],
  true, true, true, false);
SELECT setup_role_permissions('أمين المخزون', 
  ARRAY['dashboard', 'batches', 'item_history', 'gold_vault'],
  true, false, false, false);

-- مدير الإنتاج
SELECT setup_role_permissions('مدير الإنتاج', 
  ARRAY['dashboard', 'wip', 'production_planning', 'production_loss_report', 'finished_goods_factory', 'finished_goods_showroom', 
        'gemstones', 'gemstones_link', 'raw_materials', 'reports'],
  true, true, true, true);
SELECT setup_role_permissions('مدير الإنتاج', 
  ARRAY['inventory_counts', 'gold_vault', 'batches'],
  true, false, false, false);

-- مشرف الإنتاج
SELECT setup_role_permissions('مشرف الإنتاج', 
  ARRAY['wip', 'production_planning', 'finished_goods_factory', 'finished_goods_showroom', 'gemstones', 'raw_materials'],
  true, true, true, false);
SELECT setup_role_permissions('مشرف الإنتاج', 
  ARRAY['dashboard', 'production_loss_report', 'inventory_counts'],
  true, false, false, false);

-- فني إنتاج
SELECT setup_role_permissions('فني إنتاج', 
  ARRAY['wip', 'finished_goods_factory'],
  true, true, true, false);
SELECT setup_role_permissions('فني إنتاج', 
  ARRAY['dashboard', 'raw_materials', 'gemstones'],
  true, false, false, false);

-- مدير الموارد البشرية
SELECT setup_role_permissions('مدير الموارد البشرية', 
  ARRAY['dashboard', 'hr_employees', 'hr_attendance', 'hr_leaves', 'hr_payroll', 'reports'],
  true, true, true, true);

-- موظف موارد بشرية
SELECT setup_role_permissions('موظف موارد بشرية', 
  ARRAY['hr_employees', 'hr_attendance', 'hr_leaves'],
  true, true, true, false);
SELECT setup_role_permissions('موظف موارد بشرية', 
  ARRAY['dashboard', 'hr_payroll'],
  true, false, false, false);

-- ==========================================
-- 5. Update existing roles with permissions
-- ==========================================

-- المدير العام (existing)
SELECT setup_role_permissions('المدير العام', 
  ARRAY['dashboard', 'dashboard_settings', 'batches', 'import', 'suppliers', 'purchasing_orders', 'purchasing_reports', 'item_history',
        'pos', 'sales_history', 'returns', 'customers', 'transfers', 'transfer_requests', 'inventory_counts', 'raw_materials',
        'wip', 'production_planning', 'production_loss_report', 'finished_goods_factory', 'finished_goods_showroom', 'gemstones', 'gemstones_link',
        'accounting_dashboard', 'chart_of_accounts', 'journal_entries', 'invoices', 'payments', 'account_ledger', 'financial_reports',
        'gold_vault', 'cash_vault', 'gold_scrap', 'hr_employees', 'hr_attendance', 'hr_leaves', 'hr_payroll', 'reports',
        'branches', 'users', 'roles', 'gold_karats', 'gold_prices', 'audit_logs'],
  true, true, true, true);

-- نائب المدير العام (existing)
SELECT setup_role_permissions('نائب المدير العام', 
  ARRAY['dashboard', 'batches', 'import', 'suppliers', 'purchasing_orders', 'purchasing_reports', 'item_history',
        'pos', 'sales_history', 'returns', 'customers', 'transfers', 'transfer_requests', 'inventory_counts', 'raw_materials',
        'wip', 'production_planning', 'production_loss_report', 'finished_goods_factory', 'finished_goods_showroom', 'gemstones', 'gemstones_link',
        'accounting_dashboard', 'chart_of_accounts', 'journal_entries', 'invoices', 'payments', 'account_ledger', 'financial_reports',
        'gold_vault', 'cash_vault', 'gold_scrap', 'hr_employees', 'hr_attendance', 'hr_leaves', 'hr_payroll', 'reports',
        'gold_karats', 'gold_prices', 'audit_logs'],
  true, true, true, false);

-- المدير المالي (existing)
SELECT setup_role_permissions('المدير المالي', 
  ARRAY['dashboard', 'accounting_dashboard', 'chart_of_accounts', 'journal_entries', 'invoices', 'payments', 
        'account_ledger', 'financial_reports', 'gold_vault', 'cash_vault', 'reports', 'gold_prices'],
  true, true, true, true);
SELECT setup_role_permissions('المدير المالي', 
  ARRAY['sales_history', 'batches', 'purchasing_reports', 'hr_payroll', 'audit_logs'],
  true, false, false, false);

-- المحاسب العام (existing)
SELECT setup_role_permissions('المحاسب العام', 
  ARRAY['dashboard', 'accounting_dashboard', 'chart_of_accounts', 'journal_entries', 'invoices', 'payments', 
        'account_ledger', 'financial_reports', 'gold_vault', 'cash_vault', 'gold_prices'],
  true, true, true, false);
SELECT setup_role_permissions('المحاسب العام', 
  ARRAY['sales_history', 'batches', 'reports'],
  true, false, false, false);

-- محاسب التكاليف (existing)
SELECT setup_role_permissions('محاسب التكاليف', 
  ARRAY['dashboard', 'wip', 'production_planning', 'production_loss_report', 'finished_goods_factory', 
        'raw_materials', 'journal_entries', 'gold_vault'],
  true, true, true, false);
SELECT setup_role_permissions('محاسب التكاليف', 
  ARRAY['batches', 'accounting_dashboard', 'reports', 'gold_prices'],
  true, false, false, false);