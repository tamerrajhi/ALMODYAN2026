-- جدول المواد الخام
CREATE TABLE public.raw_materials (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    material_code TEXT NOT NULL UNIQUE,
    material_name TEXT NOT NULL,
    material_name_en TEXT,
    category TEXT NOT NULL DEFAULT 'general', -- gemstones, metals, packaging, tools, chemicals
    unit TEXT NOT NULL DEFAULT 'piece', -- piece, gram, kg, meter, liter
    minimum_stock NUMERIC DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- جدول مخزون المواد الخام
CREATE TABLE public.raw_materials_stock (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    material_id UUID NOT NULL REFERENCES public.raw_materials(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES public.branches(id),
    quantity NUMERIC NOT NULL DEFAULT 0,
    average_cost NUMERIC DEFAULT 0,
    last_purchase_price NUMERIC DEFAULT 0,
    last_purchase_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(material_id, branch_id)
);

-- جدول حركات المواد الخام
CREATE TABLE public.raw_materials_transactions (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    material_id UUID NOT NULL REFERENCES public.raw_materials(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES public.branches(id),
    transaction_type TEXT NOT NULL, -- purchase, issue_to_production, return, adjustment, transfer_in, transfer_out
    quantity NUMERIC NOT NULL,
    unit_price NUMERIC DEFAULT 0,
    total_amount NUMERIC DEFAULT 0,
    reference_type TEXT, -- work_order, purchase_order, adjustment
    reference_id UUID,
    supplier_id UUID REFERENCES public.suppliers(id),
    performed_by TEXT,
    notes TEXT,
    transaction_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.raw_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_materials_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_materials_transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for raw_materials
CREATE POLICY "Authenticated users can view materials"
ON public.raw_materials FOR SELECT
USING (true);

CREATE POLICY "Admins can manage materials"
ON public.raw_materials FOR ALL
USING (has_role(auth.uid(), 'admin'));

-- RLS Policies for raw_materials_stock
CREATE POLICY "Users can view stock in their branches"
ON public.raw_materials_stock FOR SELECT
USING (has_role(auth.uid(), 'admin') OR branch_id = ANY(get_user_branches(auth.uid())));

CREATE POLICY "Users can update stock in their branches"
ON public.raw_materials_stock FOR UPDATE
USING (has_role(auth.uid(), 'admin') OR branch_id = ANY(get_user_branches(auth.uid())));

CREATE POLICY "Users can insert stock"
ON public.raw_materials_stock FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin') OR branch_id = ANY(get_user_branches(auth.uid())));

-- RLS Policies for raw_materials_transactions
CREATE POLICY "Users can view transactions in their branches"
ON public.raw_materials_transactions FOR SELECT
USING (has_role(auth.uid(), 'admin') OR branch_id = ANY(get_user_branches(auth.uid())));

CREATE POLICY "Users can insert transactions in their branches"
ON public.raw_materials_transactions FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin') OR branch_id = ANY(get_user_branches(auth.uid())));

-- Triggers for updated_at
CREATE TRIGGER update_raw_materials_updated_at
    BEFORE UPDATE ON public.raw_materials
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_raw_materials_stock_updated_at
    BEFORE UPDATE ON public.raw_materials_stock
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();