
-- Add costing columns to work_orders
ALTER TABLE public.work_orders 
ADD COLUMN IF NOT EXISTS target_quantity INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS completed_quantity INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS product_type TEXT,
ADD COLUMN IF NOT EXISTS planned_start_date DATE,
ADD COLUMN IF NOT EXISTS planned_end_date DATE,
ADD COLUMN IF NOT EXISTS actual_start_date DATE,
ADD COLUMN IF NOT EXISTS actual_end_date DATE,
ADD COLUMN IF NOT EXISTS assigned_to TEXT,
ADD COLUMN IF NOT EXISTS estimated_gold_weight NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS actual_gold_weight NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS estimated_gold_cost NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS actual_gold_cost NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS estimated_labor_cost NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS actual_labor_cost NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS estimated_gemstone_cost NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS actual_gemstone_cost NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS estimated_other_cost NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS actual_other_cost NUMERIC DEFAULT 0;

-- Create production_plans table
CREATE TABLE IF NOT EXISTS public.production_plans (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    plan_number TEXT NOT NULL UNIQUE,
    plan_name TEXT NOT NULL,
    branch_id UUID NOT NULL REFERENCES public.branches(id),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed', 'cancelled')),
    total_orders INTEGER DEFAULT 0,
    completed_orders INTEGER DEFAULT 0,
    notes TEXT,
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create production_plan_items table
CREATE TABLE IF NOT EXISTS public.production_plan_items (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    plan_id UUID NOT NULL REFERENCES public.production_plans(id) ON DELETE CASCADE,
    work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
    sequence_order INTEGER DEFAULT 0,
    planned_date DATE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create production_losses table
CREATE TABLE IF NOT EXISTS public.production_losses (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    loss_code TEXT NOT NULL,
    work_order_id UUID REFERENCES public.work_orders(id),
    branch_id UUID NOT NULL REFERENCES public.branches(id),
    loss_type TEXT NOT NULL CHECK (loss_type IN ('gold', 'gemstone', 'material', 'labor', 'defect')),
    loss_date DATE NOT NULL DEFAULT CURRENT_DATE,
    gold_weight_grams NUMERIC DEFAULT 0,
    gold_karat_id UUID REFERENCES public.gold_karats(id),
    gold_value NUMERIC DEFAULT 0,
    gemstone_id UUID REFERENCES public.gemstone_inventory(id),
    gemstone_carat NUMERIC DEFAULT 0,
    gemstone_value NUMERIC DEFAULT 0,
    material_description TEXT,
    material_value NUMERIC DEFAULT 0,
    labor_hours NUMERIC DEFAULT 0,
    labor_value NUMERIC DEFAULT 0,
    total_loss_value NUMERIC DEFAULT 0,
    reason TEXT NOT NULL,
    preventive_action TEXT,
    recorded_by TEXT,
    approved_by TEXT,
    approved_at TIMESTAMP WITH TIME ZONE,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create work_order_materials table
CREATE TABLE IF NOT EXISTS public.work_order_materials (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
    material_type TEXT NOT NULL CHECK (material_type IN ('gold', 'gemstone', 'raw_material', 'other')),
    gold_weight_grams NUMERIC DEFAULT 0,
    gold_karat_id UUID REFERENCES public.gold_karats(id),
    gold_cost NUMERIC DEFAULT 0,
    gemstone_id UUID REFERENCES public.gemstone_inventory(id),
    gemstone_cost NUMERIC DEFAULT 0,
    raw_material_id UUID REFERENCES public.raw_materials(id),
    quantity NUMERIC DEFAULT 0,
    unit TEXT,
    unit_cost NUMERIC DEFAULT 0,
    description TEXT,
    total_cost NUMERIC DEFAULT 0,
    is_estimated BOOLEAN DEFAULT true,
    added_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create work_order_labor table
CREATE TABLE IF NOT EXISTS public.work_order_labor (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
    stage_id UUID REFERENCES public.production_stages(id),
    worker_name TEXT,
    labor_type TEXT,
    hours_worked NUMERIC DEFAULT 0,
    hourly_rate NUMERIC DEFAULT 0,
    total_cost NUMERIC DEFAULT 0,
    work_date DATE DEFAULT CURRENT_DATE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create production_efficiency_log table
CREATE TABLE IF NOT EXISTS public.production_efficiency_log (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    work_order_id UUID REFERENCES public.work_orders(id),
    branch_id UUID NOT NULL REFERENCES public.branches(id),
    log_date DATE NOT NULL DEFAULT CURRENT_DATE,
    stage_id UUID REFERENCES public.production_stages(id),
    planned_hours NUMERIC DEFAULT 0,
    actual_hours NUMERIC DEFAULT 0,
    efficiency_percentage NUMERIC DEFAULT 0,
    units_planned INTEGER DEFAULT 0,
    units_completed INTEGER DEFAULT 0,
    units_defective INTEGER DEFAULT 0,
    quality_rate NUMERIC DEFAULT 0,
    notes TEXT,
    recorded_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Function to generate production plan number
CREATE OR REPLACE FUNCTION public.generate_production_plan_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    today_str TEXT;
    plan_count INTEGER;
BEGIN
    today_str := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
    
    SELECT COUNT(*) + 1 INTO plan_count
    FROM public.production_plans
    WHERE plan_number LIKE 'PP-' || today_str || '%';
    
    RETURN 'PP-' || today_str || '-' || LPAD(plan_count::TEXT, 4, '0');
END;
$$;

-- Function to generate loss code
CREATE OR REPLACE FUNCTION public.generate_loss_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    today_str TEXT;
    loss_count INTEGER;
BEGIN
    today_str := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
    
    SELECT COUNT(*) + 1 INTO loss_count
    FROM public.production_losses
    WHERE loss_code LIKE 'PL-' || today_str || '%';
    
    RETURN 'PL-' || today_str || '-' || LPAD(loss_count::TEXT, 4, '0');
END;
$$;

-- Enable RLS on new tables
ALTER TABLE public.production_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_plan_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_losses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_labor ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_efficiency_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies for production_plans
CREATE POLICY "Users can view production plans in their branches"
ON public.production_plans FOR SELECT
USING (has_role(auth.uid(), 'admin') OR branch_id = ANY(get_user_branches(auth.uid())));

CREATE POLICY "Users can insert production plans in their branches"
ON public.production_plans FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin') OR branch_id = ANY(get_user_branches(auth.uid())));

CREATE POLICY "Users can update production plans in their branches"
ON public.production_plans FOR UPDATE
USING (has_role(auth.uid(), 'admin') OR branch_id = ANY(get_user_branches(auth.uid())));

-- RLS Policies for production_plan_items
CREATE POLICY "Users can view production plan items"
ON public.production_plan_items FOR SELECT USING (true);

CREATE POLICY "Users can insert production plan items"
ON public.production_plan_items FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update production plan items"
ON public.production_plan_items FOR UPDATE USING (true);

CREATE POLICY "Users can delete production plan items"
ON public.production_plan_items FOR DELETE USING (true);

-- RLS Policies for production_losses
CREATE POLICY "Users can view production losses in their branches"
ON public.production_losses FOR SELECT
USING (has_role(auth.uid(), 'admin') OR branch_id = ANY(get_user_branches(auth.uid())));

CREATE POLICY "Users can insert production losses in their branches"
ON public.production_losses FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin') OR branch_id = ANY(get_user_branches(auth.uid())));

CREATE POLICY "Users can update production losses in their branches"
ON public.production_losses FOR UPDATE
USING (has_role(auth.uid(), 'admin') OR branch_id = ANY(get_user_branches(auth.uid())));

-- RLS Policies for work_order_materials
CREATE POLICY "Users can view work order materials"
ON public.work_order_materials FOR SELECT USING (true);

CREATE POLICY "Users can insert work order materials"
ON public.work_order_materials FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update work order materials"
ON public.work_order_materials FOR UPDATE USING (true);

CREATE POLICY "Users can delete work order materials"
ON public.work_order_materials FOR DELETE USING (true);

-- RLS Policies for work_order_labor
CREATE POLICY "Users can view work order labor"
ON public.work_order_labor FOR SELECT USING (true);

CREATE POLICY "Users can insert work order labor"
ON public.work_order_labor FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update work order labor"
ON public.work_order_labor FOR UPDATE USING (true);

CREATE POLICY "Users can delete work order labor"
ON public.work_order_labor FOR DELETE USING (true);

-- RLS Policies for production_efficiency_log
CREATE POLICY "Users can view efficiency logs in their branches"
ON public.production_efficiency_log FOR SELECT
USING (has_role(auth.uid(), 'admin') OR branch_id = ANY(get_user_branches(auth.uid())));

CREATE POLICY "Users can insert efficiency logs in their branches"
ON public.production_efficiency_log FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin') OR branch_id = ANY(get_user_branches(auth.uid())));
