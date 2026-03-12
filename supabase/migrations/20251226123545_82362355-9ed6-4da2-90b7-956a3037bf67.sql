-- =====================================================
-- 1. إضافة مرحلة الإنتاج التام
-- =====================================================
INSERT INTO public.production_stages (stage_code, stage_name, stage_name_en, stage_order, description)
VALUES ('FIN', 'إنتاج تام', 'Finished Production', 15, 'المرحلة النهائية - المنتج جاهز للتسليم');

-- =====================================================
-- 2. إنشاء الشاشات للنظام
-- =====================================================
INSERT INTO public.screens (screen_key, screen_name, screen_name_en, screen_path, icon, sort_order, parent_key) VALUES
-- الشاشات الرئيسية
('dashboard', 'لوحة التحكم', 'Dashboard', '/dashboard', 'LayoutDashboard', 1, NULL),
('branches', 'الفروع', 'Branches', '/branches', 'Building2', 2, NULL),
('users', 'المستخدمين', 'Users', '/users', 'Users', 3, NULL),
('roles', 'الأدوار والصلاحيات', 'Roles', '/roles', 'Shield', 4, NULL),
('customers', 'العملاء', 'Customers', '/customers', 'UserCircle', 5, NULL),
('suppliers', 'الموردين', 'Suppliers', '/suppliers', 'Truck', 6, NULL),
-- المخزون
('batches', 'الدفعات', 'Batches', '/batches', 'Package', 10, NULL),
('import', 'الاستيراد', 'Import', '/import', 'Upload', 11, NULL),
('transfers', 'التحويلات', 'Transfers', '/transfers', 'ArrowLeftRight', 12, NULL),
('transfer_requests', 'طلبات التحويل', 'Transfer Requests', '/transfer-requests', 'FileText', 13, NULL),
-- الذهب
('gold_prices', 'أسعار الذهب', 'Gold Prices', '/gold/prices', 'TrendingUp', 20, NULL),
('gold_karats', 'العيارات', 'Gold Karats', '/gold/karats', 'Scale', 21, NULL),
('gold_vault', 'خزنة الذهب', 'Gold Vault', '/gold/vault', 'Vault', 22, NULL),
('gold_scrap', 'الكسر', 'Gold Scrap', '/gold/scrap', 'Recycle', 23, NULL),
-- المخازن
('cash_vault', 'الصندوق النقدي', 'Cash Vault', '/cash-vault', 'Banknote', 30, NULL),
('raw_materials', 'مستودع الخامات', 'Raw Materials', '/raw-materials', 'Warehouse', 31, NULL),
('production_wip', 'الإنتاج تحت التشغيل', 'Production WIP', '/production/wip', 'Factory', 32, NULL),
('finished_goods_factory', 'خزنة الإنتاج التام - المصنع', 'Finished Goods Factory', '/finished-goods/factory', 'Package', 33, NULL),
('finished_goods_showroom', 'خزنة الإنتاج التام - المعرض', 'Finished Goods Showroom', '/finished-goods/showroom', 'Store', 34, NULL),
-- المبيعات
('pos', 'نقطة البيع', 'POS', '/pos', 'ShoppingCart', 40, NULL),
('sales_history', 'سجل المبيعات', 'Sales History', '/sales-history', 'History', 41, NULL),
('returns', 'المرتجعات', 'Returns', '/returns', 'RotateCcw', 42, NULL),
-- المحاسبة
('accounting', 'المحاسبة', 'Accounting', '/accounting', 'Calculator', 50, NULL),
('chart_of_accounts', 'دليل الحسابات', 'Chart of Accounts', '/accounting/chart-of-accounts', 'BookOpen', 51, 'accounting'),
('journal_entries', 'قيود اليومية', 'Journal Entries', '/accounting/journal-entries', 'BookMarked', 52, 'accounting'),
('invoices', 'الفواتير', 'Invoices', '/accounting/invoices', 'Receipt', 53, 'accounting'),
('payments', 'المدفوعات', 'Payments', '/accounting/payments', 'CreditCard', 54, 'accounting'),
('account_ledger', 'دفتر الحساب', 'Account Ledger', '/accounting/ledger', 'FileSpreadsheet', 55, 'accounting'),
('financial_reports', 'التقارير المالية', 'Financial Reports', '/accounting/reports', 'BarChart3', 56, 'accounting'),
-- التقارير
('reports', 'التقارير', 'Reports', '/reports', 'FileBarChart', 60, NULL),
-- الجرد
('inventory_counts', 'الجرد', 'Inventory Counts', '/inventory/counts', 'ClipboardCheck', 70, NULL),
-- النظام
('audit_logs', 'سجل التدقيق', 'Audit Logs', '/audit-logs', 'FileSearch', 80, NULL),
('backup', 'النسخ الاحتياطي', 'Backup', '/backup', 'Database', 81, NULL),
('system_settings', 'إعدادات النظام', 'System Settings', '/system-settings', 'Settings', 82, NULL),
('system_health', 'صحة النظام', 'System Health', '/system-health', 'HeartPulse', 83, NULL);

-- =====================================================
-- 3. إنشاء الأدوار المحاسبية السبعة
-- =====================================================
INSERT INTO public.custom_roles (role_name, role_name_en, description, is_active) VALUES
('محاسب مكتب طيبة', 'Taiba Office Accountant', 'مسؤول عن العمليات المحاسبية لمكتب طيبة', true),
('محاسب مبيعات جدة', 'Jeddah Sales Accountant', 'مسؤول عن محاسبة المبيعات في فرع جدة', true),
('المحاسب العام', 'General Accountant', 'المحاسب الرئيسي للنظام', true),
('محاسب التكاليف', 'Cost Accountant', 'مسؤول عن حسابات التكاليف والإنتاج', true),
('المدير المالي', 'Financial Manager', 'مسؤول عن الإدارة المالية الشاملة', true),
('نائب المدير العام', 'Deputy General Manager', 'نائب المدير العام مع صلاحيات واسعة', true),
('المدير العام', 'General Manager', 'صلاحيات كاملة على النظام', true);

-- =====================================================
-- 4. إنشاء جدول خزنة الإنتاج التام - المصنع
-- =====================================================
CREATE TABLE public.finished_goods_factory (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    item_id UUID REFERENCES public.jewelry_items(id),
    item_code TEXT NOT NULL,
    branch_id UUID REFERENCES public.branches(id) NOT NULL,
    received_from_wip_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    received_by TEXT,
    work_order_id UUID REFERENCES public.work_orders(id),
    status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'transferred', 'sold', 'returned')),
    transferred_to_showroom_at TIMESTAMP WITH TIME ZONE,
    transferred_to_branch_id UUID REFERENCES public.branches(id),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- =====================================================
-- 5. إنشاء جدول خزنة الإنتاج التام - المعرض
-- =====================================================
CREATE TABLE public.finished_goods_showroom (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    item_id UUID REFERENCES public.jewelry_items(id),
    item_code TEXT NOT NULL,
    branch_id UUID REFERENCES public.branches(id) NOT NULL,
    received_from_factory_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    received_by TEXT,
    factory_record_id UUID REFERENCES public.finished_goods_factory(id),
    status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'sold', 'returned', 'transferred')),
    sold_at TIMESTAMP WITH TIME ZONE,
    sale_id UUID REFERENCES public.sales(id),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- =====================================================
-- 6. إنشاء جدول حركات الإنتاج التام
-- =====================================================
CREATE TABLE public.finished_goods_movements (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    movement_type TEXT NOT NULL CHECK (movement_type IN ('wip_to_factory', 'factory_to_showroom', 'showroom_sale', 'showroom_return', 'showroom_transfer', 'factory_return')),
    item_id UUID REFERENCES public.jewelry_items(id),
    item_code TEXT NOT NULL,
    from_branch_id UUID REFERENCES public.branches(id),
    to_branch_id UUID REFERENCES public.branches(id),
    from_location TEXT, -- 'wip', 'factory', 'showroom'
    to_location TEXT,   -- 'factory', 'showroom', 'sold'
    work_order_id UUID REFERENCES public.work_orders(id),
    sale_id UUID REFERENCES public.sales(id),
    journal_entry_id UUID REFERENCES public.journal_entries(id),
    weight_grams NUMERIC,
    value_amount NUMERIC,
    performed_by TEXT,
    notes TEXT,
    movement_date TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- =====================================================
-- 7. تفعيل RLS على الجداول الجديدة
-- =====================================================
ALTER TABLE public.finished_goods_factory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finished_goods_showroom ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finished_goods_movements ENABLE ROW LEVEL SECURITY;

-- سياسات خزنة المصنع
CREATE POLICY "Users can view factory goods in their branches"
ON public.finished_goods_factory FOR SELECT
USING (has_role(auth.uid(), 'admin') OR branch_id = ANY(get_user_branches(auth.uid())));

CREATE POLICY "Users can insert factory goods in their branches"
ON public.finished_goods_factory FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin') OR branch_id = ANY(get_user_branches(auth.uid())));

CREATE POLICY "Users can update factory goods in their branches"
ON public.finished_goods_factory FOR UPDATE
USING (has_role(auth.uid(), 'admin') OR branch_id = ANY(get_user_branches(auth.uid())));

-- سياسات خزنة المعرض
CREATE POLICY "Users can view showroom goods in their branches"
ON public.finished_goods_showroom FOR SELECT
USING (has_role(auth.uid(), 'admin') OR branch_id = ANY(get_user_branches(auth.uid())));

CREATE POLICY "Users can insert showroom goods in their branches"
ON public.finished_goods_showroom FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin') OR branch_id = ANY(get_user_branches(auth.uid())));

CREATE POLICY "Users can update showroom goods in their branches"
ON public.finished_goods_showroom FOR UPDATE
USING (has_role(auth.uid(), 'admin') OR branch_id = ANY(get_user_branches(auth.uid())));

-- سياسات حركات الإنتاج التام
CREATE POLICY "Users can view finished goods movements"
ON public.finished_goods_movements FOR SELECT
USING (has_role(auth.uid(), 'admin') OR from_branch_id = ANY(get_user_branches(auth.uid())) OR to_branch_id = ANY(get_user_branches(auth.uid())));

CREATE POLICY "Users can insert finished goods movements"
ON public.finished_goods_movements FOR INSERT
WITH CHECK (true);

-- =====================================================
-- 8. Triggers للتحديث التلقائي
-- =====================================================
CREATE TRIGGER update_finished_goods_factory_updated_at
    BEFORE UPDATE ON public.finished_goods_factory
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_finished_goods_showroom_updated_at
    BEFORE UPDATE ON public.finished_goods_showroom
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- 9. دالة لتوليد كود القطعة النهائية
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_finished_goods_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    today_str TEXT;
    goods_count INTEGER;
BEGIN
    today_str := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
    
    SELECT COUNT(*) + 1 INTO goods_count
    FROM public.finished_goods_factory
    WHERE item_code LIKE 'FG-' || today_str || '%';
    
    RETURN 'FG-' || today_str || '-' || LPAD(goods_count::TEXT, 4, '0');
END;
$$;