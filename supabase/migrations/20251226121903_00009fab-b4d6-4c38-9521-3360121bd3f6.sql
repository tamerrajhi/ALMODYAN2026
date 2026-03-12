-- جدول مراحل الإنتاج (14 مرحلة)
CREATE TABLE public.production_stages (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    stage_code TEXT NOT NULL UNIQUE,
    stage_name TEXT NOT NULL,
    stage_name_en TEXT,
    stage_order INTEGER NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- جدول أوامر العمل
CREATE TABLE public.work_orders (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    order_number TEXT NOT NULL UNIQUE,
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    branch_id UUID REFERENCES public.branches(id),
    product_description TEXT,
    quantity INTEGER NOT NULL DEFAULT 1,
    gold_weight_required NUMERIC DEFAULT 0,
    karat_id UUID REFERENCES public.gold_karats(id),
    priority TEXT DEFAULT 'normal', -- low, normal, high, urgent
    status TEXT NOT NULL DEFAULT 'pending', -- pending, in_progress, completed, cancelled
    current_stage_id UUID REFERENCES public.production_stages(id),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- جدول مخزون WIP (الإنتاج تحت التشغيل)
CREATE TABLE public.wip_inventory (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
    stage_id UUID NOT NULL REFERENCES public.production_stages(id),
    gold_weight_in NUMERIC DEFAULT 0,
    gold_weight_out NUMERIC DEFAULT 0,
    gold_weight_loss NUMERIC DEFAULT 0,
    entered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    exited_at TIMESTAMP WITH TIME ZONE,
    processed_by TEXT,
    status TEXT NOT NULL DEFAULT 'in_stage', -- in_stage, completed, rejected
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- جدول حركات WIP بين المراحل
CREATE TABLE public.wip_movements (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
    from_stage_id UUID REFERENCES public.production_stages(id),
    to_stage_id UUID NOT NULL REFERENCES public.production_stages(id),
    gold_weight NUMERIC NOT NULL DEFAULT 0,
    movement_type TEXT NOT NULL, -- forward, backward, reject, complete
    performed_by TEXT,
    notes TEXT,
    movement_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.production_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wip_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wip_movements ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can view stages" ON public.production_stages FOR SELECT USING (true);
CREATE POLICY "Admins can manage stages" ON public.production_stages FOR ALL USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can view work orders in their branches" ON public.work_orders FOR SELECT
USING (has_role(auth.uid(), 'admin') OR branch_id = ANY(get_user_branches(auth.uid())));

CREATE POLICY "Users can insert work orders in their branches" ON public.work_orders FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin') OR branch_id = ANY(get_user_branches(auth.uid())));

CREATE POLICY "Users can update work orders in their branches" ON public.work_orders FOR UPDATE
USING (has_role(auth.uid(), 'admin') OR branch_id = ANY(get_user_branches(auth.uid())));

CREATE POLICY "Users can view WIP inventory" ON public.wip_inventory FOR SELECT USING (true);
CREATE POLICY "Users can insert WIP inventory" ON public.wip_inventory FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update WIP inventory" ON public.wip_inventory FOR UPDATE USING (true);

CREATE POLICY "Users can view WIP movements" ON public.wip_movements FOR SELECT USING (true);
CREATE POLICY "Users can insert WIP movements" ON public.wip_movements FOR INSERT WITH CHECK (true);

-- Triggers
CREATE TRIGGER update_work_orders_updated_at
    BEFORE UPDATE ON public.work_orders
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();