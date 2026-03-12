-- =====================================================
-- مراكز التكلفة (Cost Centers)
-- =====================================================
CREATE TABLE public.cost_centers (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    center_code TEXT NOT NULL UNIQUE,
    center_name TEXT NOT NULL,
    center_name_en TEXT,
    center_type TEXT NOT NULL DEFAULT 'production', -- production, sales, admin
    parent_id UUID REFERENCES public.cost_centers(id),
    branch_id UUID REFERENCES public.branches(id),
    is_active BOOLEAN NOT NULL DEFAULT true,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.cost_centers ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can view cost centers"
ON public.cost_centers FOR SELECT
USING (true);

CREATE POLICY "Admins can manage cost centers"
ON public.cost_centers FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Trigger for updated_at
CREATE TRIGGER update_cost_centers_updated_at
BEFORE UPDATE ON public.cost_centers
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- إعدادات حسابات الإنتاج
-- =====================================================
CREATE TABLE public.production_account_settings (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    branch_id UUID REFERENCES public.branches(id), -- NULL = إعداد عام
    wip_account_id UUID REFERENCES public.chart_of_accounts(id),
    raw_material_account_id UUID REFERENCES public.chart_of_accounts(id),
    finished_goods_account_id UUID REFERENCES public.chart_of_accounts(id),
    scrap_loss_account_id UUID REFERENCES public.chart_of_accounts(id),
    is_journal_auto_enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(branch_id)
);

-- Enable RLS
ALTER TABLE public.production_account_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can view production settings"
ON public.production_account_settings FOR SELECT
USING (true);

CREATE POLICY "Admins can manage production settings"
ON public.production_account_settings FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Trigger for updated_at
CREATE TRIGGER update_production_account_settings_updated_at
BEFORE UPDATE ON public.production_account_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- التكاليف الإضافية المباشرة على أوامر الإنتاج
-- =====================================================
CREATE TABLE public.work_order_direct_costs (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
    cost_type TEXT NOT NULL, -- labor, services, overhead, other
    cost_type_name TEXT NOT NULL, -- اسم نوع التكلفة بالعربي
    description TEXT NOT NULL,
    amount NUMERIC NOT NULL DEFAULT 0,
    cost_date DATE NOT NULL DEFAULT CURRENT_DATE,
    added_by TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.work_order_direct_costs ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view work order direct costs in their branches"
ON public.work_order_direct_costs FOR SELECT
USING (
    has_role(auth.uid(), 'admin'::app_role) OR
    EXISTS (
        SELECT 1 FROM work_orders wo
        WHERE wo.id = work_order_direct_costs.work_order_id
        AND wo.branch_id = ANY(get_user_branches(auth.uid()))
    )
);

CREATE POLICY "Users can insert work order direct costs in their branches"
ON public.work_order_direct_costs FOR INSERT
WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role) OR
    EXISTS (
        SELECT 1 FROM work_orders wo
        WHERE wo.id = work_order_direct_costs.work_order_id
        AND wo.branch_id = ANY(get_user_branches(auth.uid()))
    )
);

CREATE POLICY "Users can update work order direct costs in their branches"
ON public.work_order_direct_costs FOR UPDATE
USING (
    has_role(auth.uid(), 'admin'::app_role) OR
    EXISTS (
        SELECT 1 FROM work_orders wo
        WHERE wo.id = work_order_direct_costs.work_order_id
        AND wo.branch_id = ANY(get_user_branches(auth.uid()))
    )
);

CREATE POLICY "Users can delete work order direct costs in their branches"
ON public.work_order_direct_costs FOR DELETE
USING (
    has_role(auth.uid(), 'admin'::app_role) OR
    EXISTS (
        SELECT 1 FROM work_orders wo
        WHERE wo.id = work_order_direct_costs.work_order_id
        AND wo.branch_id = ANY(get_user_branches(auth.uid()))
    )
);

-- =====================================================
-- الإنتاج الجزئي (Partial Completions)
-- =====================================================
CREATE TABLE public.work_order_partial_completions (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
    completion_number TEXT NOT NULL,
    completion_date TIMESTAMPTZ NOT NULL DEFAULT now(),
    quantity_completed INTEGER NOT NULL DEFAULT 0,
    weight_completed NUMERIC NOT NULL DEFAULT 0,
    cost_allocated NUMERIC NOT NULL DEFAULT 0,
    journal_entry_id UUID REFERENCES public.journal_entries(id),
    completed_by TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.work_order_partial_completions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view partial completions in their branches"
ON public.work_order_partial_completions FOR SELECT
USING (
    has_role(auth.uid(), 'admin'::app_role) OR
    EXISTS (
        SELECT 1 FROM work_orders wo
        WHERE wo.id = work_order_partial_completions.work_order_id
        AND wo.branch_id = ANY(get_user_branches(auth.uid()))
    )
);

CREATE POLICY "Users can insert partial completions in their branches"
ON public.work_order_partial_completions FOR INSERT
WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role) OR
    EXISTS (
        SELECT 1 FROM work_orders wo
        WHERE wo.id = work_order_partial_completions.work_order_id
        AND wo.branch_id = ANY(get_user_branches(auth.uid()))
    )
);

-- =====================================================
-- تحديث جدول work_orders
-- =====================================================
ALTER TABLE public.work_orders 
ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES public.cost_centers(id),
ADD COLUMN IF NOT EXISTS journal_entry_start_id UUID REFERENCES public.journal_entries(id),
ADD COLUMN IF NOT EXISTS journal_entry_complete_id UUID REFERENCES public.journal_entries(id),
ADD COLUMN IF NOT EXISTS total_raw_material_cost NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_additional_cost NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_production_cost NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS is_partial_completion BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS completed_quantity INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS completed_weight NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS approved_by TEXT,
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS cancelled_by TEXT,
ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- =====================================================
-- تحديث جدول journal_entries
-- =====================================================
ALTER TABLE public.journal_entries
ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES public.cost_centers(id),
ADD COLUMN IF NOT EXISTS is_reversed BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS reversed_by_entry_id UUID,
ADD COLUMN IF NOT EXISTS reversal_reason TEXT,
ADD COLUMN IF NOT EXISTS work_order_id UUID REFERENCES public.work_orders(id);

-- =====================================================
-- دالة توليد رقم الإنتاج الجزئي
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_partial_completion_number(p_work_order_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    wo_number TEXT;
    completion_count INTEGER;
BEGIN
    SELECT order_number INTO wo_number FROM work_orders WHERE id = p_work_order_id;
    
    SELECT COUNT(*) + 1 INTO completion_count
    FROM work_order_partial_completions
    WHERE work_order_id = p_work_order_id;
    
    RETURN wo_number || '-PC' || LPAD(completion_count::TEXT, 2, '0');
END;
$$;

-- =====================================================
-- دالة التحقق من توفر المخزون
-- =====================================================
CREATE OR REPLACE FUNCTION public.check_raw_material_availability(p_branch_id UUID, p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    item JSONB;
    result JSONB := '[]'::JSONB;
    available_qty NUMERIC;
    item_code TEXT;
    required_qty NUMERIC;
BEGIN
    FOR item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        item_code := item->>'item_code';
        required_qty := (item->>'quantity')::NUMERIC;
        
        SELECT COALESCE(SUM(weight_grams), 0) INTO available_qty
        FROM raw_materials
        WHERE branch_id = p_branch_id 
        AND status = 'available';
        
        IF available_qty < required_qty THEN
            result := result || jsonb_build_object(
                'item_code', item_code,
                'required', required_qty,
                'available', available_qty,
                'shortage', required_qty - available_qty
            );
        END IF;
    END LOOP;
    
    RETURN result;
END;
$$;