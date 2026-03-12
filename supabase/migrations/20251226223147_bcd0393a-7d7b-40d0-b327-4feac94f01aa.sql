-- Create table for module setting definitions (schema for settings)
CREATE TABLE public.module_setting_definitions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  module_id varchar(50) NOT NULL,
  setting_key varchar(100) NOT NULL,
  setting_label jsonb NOT NULL DEFAULT '{"ar": "", "en": ""}',
  setting_type varchar(20) NOT NULL DEFAULT 'text' CHECK (setting_type IN ('text', 'number', 'boolean', 'select')),
  default_value text,
  options jsonb, -- For select type: [{value: "...", label: {ar: "...", en: "..."}}]
  description jsonb, -- {ar: "...", en: "..."}
  display_order integer DEFAULT 0,
  is_required boolean DEFAULT false,
  min_value numeric, -- For number type
  max_value numeric, -- For number type
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(module_id, setting_key)
);

-- Create table for module setting values
CREATE TABLE public.module_setting_values (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  module_id varchar(50) NOT NULL,
  setting_key varchar(100) NOT NULL,
  setting_value text,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(module_id, setting_key)
);

-- Enable RLS
ALTER TABLE public.module_setting_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.module_setting_values ENABLE ROW LEVEL SECURITY;

-- RLS Policies for definitions
CREATE POLICY "Authenticated users can view setting definitions"
ON public.module_setting_definitions FOR SELECT
USING (true);

CREATE POLICY "Admins can manage setting definitions"
ON public.module_setting_definitions FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS Policies for values
CREATE POLICY "Authenticated users can view setting values"
ON public.module_setting_values FOR SELECT
USING (true);

CREATE POLICY "Admins can manage setting values"
ON public.module_setting_values FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Insert default settings for Sales module
INSERT INTO public.module_setting_definitions (module_id, setting_key, setting_label, setting_type, default_value, description, display_order, min_value, max_value)
VALUES 
  ('sales', 'max_discount_percent', '{"ar": "الحد الأقصى للخصم (%)", "en": "Max Discount Percent"}', 'number', '15', '{"ar": "أقصى نسبة خصم يمكن للموظف تطبيقها", "en": "Maximum discount percentage an employee can apply"}', 1, 0, 100),
  ('sales', 'require_manager_approval_for_large_sales', '{"ar": "طلب موافقة المدير للمبيعات الكبيرة", "en": "Require Manager Approval for Large Sales"}', 'boolean', 'true', '{"ar": "تفعيل طلب موافقة المدير للمبيعات التي تتجاوز حد معين", "en": "Enable manager approval for sales exceeding a certain amount"}', 2, NULL, NULL),
  ('sales', 'large_sale_threshold', '{"ar": "حد المبيعات الكبيرة (ريال)", "en": "Large Sale Threshold (SAR)"}', 'number', '10000', '{"ar": "المبلغ الذي يتطلب موافقة المدير", "en": "Amount that requires manager approval"}', 3, 0, NULL),
  ('sales', 'default_invoice_template', '{"ar": "قالب الفاتورة الافتراضي", "en": "Default Invoice Template"}', 'select', 'standard', '{"ar": "القالب المستخدم لطباعة الفواتير", "en": "Template used for printing invoices"}', 4, NULL, NULL),
  ('sales', 'auto_print_invoice', '{"ar": "طباعة الفاتورة تلقائياً", "en": "Auto Print Invoice"}', 'boolean', 'true', '{"ar": "طباعة الفاتورة تلقائياً بعد إتمام البيع", "en": "Automatically print invoice after completing sale"}', 5, NULL, NULL);

-- Add options for select type setting
UPDATE public.module_setting_definitions
SET options = '[{"value": "standard", "label": {"ar": "قياسي", "en": "Standard"}}, {"value": "compact", "label": {"ar": "مختصر", "en": "Compact"}}, {"value": "detailed", "label": {"ar": "تفصيلي", "en": "Detailed"}}]'::jsonb
WHERE module_id = 'sales' AND setting_key = 'default_invoice_template';

-- Insert settings for Inventory module
INSERT INTO public.module_setting_definitions (module_id, setting_key, setting_label, setting_type, default_value, description, display_order, min_value, max_value)
VALUES 
  ('inventory', 'low_stock_threshold', '{"ar": "حد المخزون المنخفض", "en": "Low Stock Threshold"}', 'number', '10', '{"ar": "عدد القطع الذي يعتبر مخزون منخفض", "en": "Number of items considered low stock"}', 1, 0, NULL),
  ('inventory', 'enable_barcode_scanning', '{"ar": "تفعيل مسح الباركود", "en": "Enable Barcode Scanning"}', 'boolean', 'true', '{"ar": "السماح بمسح الباركود للبحث عن المنتجات", "en": "Allow barcode scanning for product search"}', 2, NULL, NULL),
  ('inventory', 'default_count_type', '{"ar": "نوع الجرد الافتراضي", "en": "Default Count Type"}', 'select', 'full', '{"ar": "نوع الجرد المستخدم افتراضياً", "en": "Default inventory count type"}', 3, NULL, NULL);

UPDATE public.module_setting_definitions
SET options = '[{"value": "full", "label": {"ar": "جرد كامل", "en": "Full Count"}}, {"value": "partial", "label": {"ar": "جرد جزئي", "en": "Partial Count"}}, {"value": "cycle", "label": {"ar": "جرد دوري", "en": "Cycle Count"}}]'::jsonb
WHERE module_id = 'inventory' AND setting_key = 'default_count_type';

-- Insert settings for Accounting module
INSERT INTO public.module_setting_definitions (module_id, setting_key, setting_label, setting_type, default_value, description, display_order)
VALUES 
  ('accounting', 'default_vat_rate', '{"ar": "نسبة الضريبة الافتراضية (%)", "en": "Default VAT Rate (%)"}', 'number', '15', '{"ar": "نسبة ضريبة القيمة المضافة الافتراضية", "en": "Default VAT percentage rate"}', 1),
  ('accounting', 'auto_post_journal_entries', '{"ar": "ترحيل القيود تلقائياً", "en": "Auto Post Journal Entries"}', 'boolean', 'false', '{"ar": "ترحيل القيود المحاسبية تلقائياً عند الحفظ", "en": "Automatically post journal entries when saved"}', 2),
  ('accounting', 'fiscal_year_start_month', '{"ar": "شهر بداية السنة المالية", "en": "Fiscal Year Start Month"}', 'select', '1', '{"ar": "الشهر الذي تبدأ فيه السنة المالية", "en": "Month when fiscal year starts"}', 3);

UPDATE public.module_setting_definitions
SET options = '[{"value": "1", "label": {"ar": "يناير", "en": "January"}}, {"value": "4", "label": {"ar": "أبريل", "en": "April"}}, {"value": "7", "label": {"ar": "يوليو", "en": "July"}}, {"value": "10", "label": {"ar": "أكتوبر", "en": "October"}}]'::jsonb
WHERE module_id = 'accounting' AND setting_key = 'fiscal_year_start_month';

-- Insert settings for Purchases module
INSERT INTO public.module_setting_definitions (module_id, setting_key, setting_label, setting_type, default_value, description, display_order)
VALUES 
  ('purchases', 'require_po_approval', '{"ar": "طلب موافقة على أوامر الشراء", "en": "Require PO Approval"}', 'boolean', 'true', '{"ar": "طلب موافقة قبل تنفيذ أوامر الشراء", "en": "Require approval before executing purchase orders"}', 1),
  ('purchases', 'po_approval_threshold', '{"ar": "حد الموافقة على أمر الشراء", "en": "PO Approval Threshold"}', 'number', '5000', '{"ar": "المبلغ الذي يتطلب موافقة", "en": "Amount that requires approval"}', 2),
  ('purchases', 'default_payment_terms', '{"ar": "شروط الدفع الافتراضية", "en": "Default Payment Terms"}', 'select', 'net30', '{"ar": "شروط الدفع الافتراضية للموردين", "en": "Default payment terms for suppliers"}', 3);

UPDATE public.module_setting_definitions
SET options = '[{"value": "immediate", "label": {"ar": "فوري", "en": "Immediate"}}, {"value": "net15", "label": {"ar": "15 يوم", "en": "Net 15"}}, {"value": "net30", "label": {"ar": "30 يوم", "en": "Net 30"}}, {"value": "net60", "label": {"ar": "60 يوم", "en": "Net 60"}}]'::jsonb
WHERE module_id = 'purchases' AND setting_key = 'default_payment_terms';

-- Insert settings for HR module
INSERT INTO public.module_setting_definitions (module_id, setting_key, setting_label, setting_type, default_value, description, display_order)
VALUES 
  ('hr', 'working_hours_per_day', '{"ar": "ساعات العمل اليومية", "en": "Working Hours Per Day"}', 'number', '8', '{"ar": "عدد ساعات العمل اليومية المعتمدة", "en": "Official working hours per day"}', 1),
  ('hr', 'annual_leave_days', '{"ar": "أيام الإجازة السنوية", "en": "Annual Leave Days"}', 'number', '21', '{"ar": "عدد أيام الإجازة السنوية للموظف", "en": "Number of annual leave days per employee"}', 2),
  ('hr', 'enable_overtime', '{"ar": "تفعيل العمل الإضافي", "en": "Enable Overtime"}', 'boolean', 'true', '{"ar": "السماح بتسجيل ساعات العمل الإضافي", "en": "Allow recording overtime hours"}', 3),
  ('hr', 'overtime_rate_multiplier', '{"ar": "معامل أجر العمل الإضافي", "en": "Overtime Rate Multiplier"}', 'number', '1.5', '{"ar": "نسبة زيادة أجر ساعة العمل الإضافي", "en": "Multiplier for overtime hourly rate"}', 4);

-- Insert settings for Vaults module
INSERT INTO public.module_setting_definitions (module_id, setting_key, setting_label, setting_type, default_value, description, display_order)
VALUES 
  ('vaults', 'require_daily_settlement', '{"ar": "إلزام التسوية اليومية", "en": "Require Daily Settlement"}', 'boolean', 'true', '{"ar": "إلزام الكاشير بإجراء تسوية يومية", "en": "Require cashier to perform daily settlement"}', 1),
  ('vaults', 'settlement_tolerance_amount', '{"ar": "هامش التسامح في التسوية", "en": "Settlement Tolerance Amount"}', 'number', '10', '{"ar": "الفرق المسموح به في التسوية", "en": "Allowed difference in settlement"}', 2),
  ('vaults', 'gold_weight_tolerance', '{"ar": "هامش تسامح وزن الذهب (جرام)", "en": "Gold Weight Tolerance (grams)"}', 'number', '0.1', '{"ar": "الفرق المسموح به في وزن الذهب", "en": "Allowed difference in gold weight"}', 3);

-- Insert settings for Production module
INSERT INTO public.module_setting_definitions (module_id, setting_key, setting_label, setting_type, default_value, description, display_order)
VALUES 
  ('production', 'auto_create_work_order', '{"ar": "إنشاء أمر عمل تلقائي", "en": "Auto Create Work Order"}', 'boolean', 'false', '{"ar": "إنشاء أمر عمل تلقائياً عند طلب إنتاج", "en": "Automatically create work order on production request"}', 1),
  ('production', 'max_loss_percent', '{"ar": "الحد الأقصى للفاقد (%)", "en": "Max Loss Percent"}', 'number', '2', '{"ar": "أقصى نسبة فاقد مسموح بها", "en": "Maximum allowed loss percentage"}', 2),
  ('production', 'require_qc_approval', '{"ar": "طلب موافقة الجودة", "en": "Require QC Approval"}', 'boolean', 'true', '{"ar": "طلب موافقة مراقبة الجودة قبل التسليم", "en": "Require quality control approval before delivery"}', 3);

-- Create function to get module settings with values
CREATE OR REPLACE FUNCTION public.get_module_settings(p_module_id varchar)
RETURNS TABLE (
  setting_key varchar,
  setting_label jsonb,
  setting_type varchar,
  default_value text,
  current_value text,
  options jsonb,
  description jsonb,
  display_order integer,
  is_required boolean,
  min_value numeric,
  max_value numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    d.setting_key,
    d.setting_label,
    d.setting_type,
    d.default_value,
    COALESCE(v.setting_value, d.default_value) as current_value,
    d.options,
    d.description,
    d.display_order,
    d.is_required,
    d.min_value,
    d.max_value
  FROM module_setting_definitions d
  LEFT JOIN module_setting_values v ON d.module_id = v.module_id AND d.setting_key = v.setting_key
  WHERE d.module_id = p_module_id
  ORDER BY d.display_order;
END;
$$;

-- Create function to save module setting
CREATE OR REPLACE FUNCTION public.save_module_setting(p_module_id varchar, p_setting_key varchar, p_value text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO module_setting_values (module_id, setting_key, setting_value, updated_by)
  VALUES (p_module_id, p_setting_key, p_value, auth.uid())
  ON CONFLICT (module_id, setting_key)
  DO UPDATE SET 
    setting_value = EXCLUDED.setting_value,
    updated_by = EXCLUDED.updated_by,
    updated_at = now();
  
  RETURN true;
END;
$$;