
-- 1. إنشاء جدول حدود الموافقات
CREATE TABLE public.pr_approval_thresholds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    threshold_name TEXT NOT NULL,
    min_amount NUMERIC NOT NULL DEFAULT 0,
    max_amount NUMERIC,
    approver_role TEXT NOT NULL CHECK (approver_role IN ('department_manager', 'procurement', 'top_management')),
    approval_order INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. إنشاء جدول سجل الموافقات
CREATE TABLE public.pr_approval_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requisition_id UUID NOT NULL REFERENCES public.purchase_requisitions(id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'submitted', 'approved', 'rejected', 'cancelled', 'converted')),
    action_by UUID NOT NULL,
    action_by_name TEXT,
    action_by_role TEXT,
    approval_level INTEGER,
    comments TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. تحديث جدول طلبات الشراء
ALTER TABLE public.purchase_requisitions 
ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES public.departments(id),
ADD COLUMN IF NOT EXISTS current_approval_level INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS required_approval_level INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS cancelled_by UUID,
ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
ADD COLUMN IF NOT EXISTS converted_to_po_id UUID REFERENCES public.purchase_orders(id),
ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS justification TEXT;

-- 4. تحديث جدول بنود الطلب
ALTER TABLE public.purchase_requisition_items
ADD COLUMN IF NOT EXISTS item_code TEXT,
ADD COLUMN IF NOT EXISTS jewelry_item_id UUID REFERENCES public.jewelry_items(id);

-- 5. إدخال حدود الموافقات الافتراضية
INSERT INTO public.pr_approval_thresholds (threshold_name, min_amount, max_amount, approver_role, approval_order) VALUES
('موافقة مدير القسم', 0, 5000, 'department_manager', 1),
('موافقة المشتريات', 5000.01, 25000, 'procurement', 2),
('موافقة الإدارة العليا', 25000.01, NULL, 'top_management', 3);

-- 6. تمكين RLS
ALTER TABLE public.pr_approval_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pr_approval_history ENABLE ROW LEVEL SECURITY;

-- 7. سياسات RLS لجدول الحدود
CREATE POLICY "Authenticated users can view thresholds"
ON public.pr_approval_thresholds FOR SELECT
USING (true);

CREATE POLICY "Admins can manage thresholds"
ON public.pr_approval_thresholds FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- 8. سياسات RLS لجدول سجل الموافقات
CREATE POLICY "Users can view approval history"
ON public.pr_approval_history FOR SELECT
USING (true);

CREATE POLICY "Users can insert approval history"
ON public.pr_approval_history FOR INSERT
WITH CHECK (true);

-- 9. دالة لتحديد مستوى الموافقة المطلوب حسب القيمة
CREATE OR REPLACE FUNCTION public.get_required_approval_level(total_amount NUMERIC)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
    IF total_amount <= 5000 THEN
        RETURN 1; -- مدير القسم فقط
    ELSIF total_amount <= 25000 THEN
        RETURN 2; -- مدير القسم + المشتريات
    ELSE
        RETURN 3; -- الكل
    END IF;
END;
$$;

-- 10. دالة للتحقق من صلاحية الموافقة
CREATE OR REPLACE FUNCTION public.can_approve_requisition(p_user_id UUID, p_requisition_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
    v_requisition RECORD;
    v_user_dept_id UUID;
    v_is_dept_manager BOOLEAN;
    v_is_procurement BOOLEAN;
    v_is_top_management BOOLEAN;
BEGIN
    -- Get requisition details
    SELECT * INTO v_requisition FROM purchase_requisitions WHERE id = p_requisition_id;
    
    IF v_requisition IS NULL THEN
        RETURN false;
    END IF;
    
    -- Check if admin
    IF has_role(p_user_id, 'admin'::app_role) THEN
        RETURN true;
    END IF;
    
    -- Get user's department from employees
    SELECT department_id INTO v_user_dept_id 
    FROM employees 
    WHERE user_id = p_user_id;
    
    -- Check roles through custom roles
    SELECT EXISTS (
        SELECT 1 FROM user_custom_roles ucr
        JOIN custom_roles cr ON ucr.role_id = cr.id
        WHERE ucr.user_id = p_user_id 
        AND cr.role_name IN ('مدير قسم', 'Department Manager')
    ) INTO v_is_dept_manager;
    
    SELECT EXISTS (
        SELECT 1 FROM user_custom_roles ucr
        JOIN custom_roles cr ON ucr.role_id = cr.id
        WHERE ucr.user_id = p_user_id 
        AND cr.role_name IN ('المشتريات', 'Procurement', 'مسؤول المشتريات')
    ) INTO v_is_procurement;
    
    SELECT EXISTS (
        SELECT 1 FROM user_custom_roles ucr
        JOIN custom_roles cr ON ucr.role_id = cr.id
        WHERE ucr.user_id = p_user_id 
        AND cr.role_name IN ('الإدارة العليا', 'Top Management', 'المدير العام', 'General Manager')
    ) INTO v_is_top_management;
    
    -- Check based on current approval level needed
    CASE v_requisition.current_approval_level
        WHEN 0 THEN -- Needs dept manager
            RETURN v_is_dept_manager AND v_user_dept_id = v_requisition.department_id;
        WHEN 1 THEN -- Needs procurement
            RETURN v_is_procurement;
        WHEN 2 THEN -- Needs top management
            RETURN v_is_top_management;
        ELSE
            RETURN false;
    END CASE;
END;
$$;

-- 11. Trigger لتحديث updated_at
CREATE TRIGGER update_pr_approval_thresholds_updated_at
BEFORE UPDATE ON public.pr_approval_thresholds
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
