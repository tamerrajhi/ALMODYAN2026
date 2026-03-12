
-- Create gemstone types table
CREATE TABLE public.gemstone_types (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    type_code TEXT NOT NULL UNIQUE,
    type_name TEXT NOT NULL,
    type_name_en TEXT,
    category TEXT NOT NULL DEFAULT 'precious', -- precious, semi-precious, synthetic
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create gemstone inventory table
CREATE TABLE public.gemstone_inventory (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    gemstone_type_id UUID NOT NULL REFERENCES public.gemstone_types(id),
    stone_code TEXT NOT NULL UNIQUE,
    carat_weight NUMERIC NOT NULL,
    color TEXT,
    clarity TEXT,
    cut TEXT,
    shape TEXT,
    origin TEXT,
    certificate_number TEXT,
    certificate_lab TEXT,
    purchase_price NUMERIC NOT NULL DEFAULT 0,
    selling_price NUMERIC,
    branch_id UUID REFERENCES public.branches(id),
    supplier_id UUID REFERENCES public.suppliers(id),
    status TEXT NOT NULL DEFAULT 'available', -- available, reserved, sold, used_in_production
    jewelry_item_id UUID REFERENCES public.jewelry_items(id),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create gemstone transactions table
CREATE TABLE public.gemstone_transactions (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    gemstone_id UUID NOT NULL REFERENCES public.gemstone_inventory(id),
    transaction_type TEXT NOT NULL, -- purchase, sale, use_in_production, transfer, return
    transaction_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    quantity NUMERIC NOT NULL DEFAULT 1,
    unit_price NUMERIC,
    total_amount NUMERIC,
    from_branch_id UUID REFERENCES public.branches(id),
    to_branch_id UUID REFERENCES public.branches(id),
    reference_type TEXT, -- sale, jewelry_item, work_order
    reference_id UUID,
    journal_entry_id UUID REFERENCES public.journal_entries(id),
    performed_by TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create jewelry item gemstones linking table
CREATE TABLE public.jewelry_item_gemstones (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    jewelry_item_id UUID NOT NULL REFERENCES public.jewelry_items(id),
    gemstone_id UUID NOT NULL REFERENCES public.gemstone_inventory(id),
    setting_type TEXT, -- prong, bezel, channel, pave
    setting_cost NUMERIC DEFAULT 0,
    added_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    added_by TEXT,
    notes TEXT,
    UNIQUE(jewelry_item_id, gemstone_id)
);

-- Enable RLS
ALTER TABLE public.gemstone_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gemstone_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gemstone_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jewelry_item_gemstones ENABLE ROW LEVEL SECURITY;

-- RLS Policies for gemstone_types
CREATE POLICY "Authenticated users can view gemstone types"
ON public.gemstone_types FOR SELECT
USING (true);

CREATE POLICY "Admins can manage gemstone types"
ON public.gemstone_types FOR ALL
USING (has_role(auth.uid(), 'admin'));

-- RLS Policies for gemstone_inventory
CREATE POLICY "Users can view gemstones in their branches"
ON public.gemstone_inventory FOR SELECT
USING (has_role(auth.uid(), 'admin') OR branch_id = ANY(get_user_branches(auth.uid())));

CREATE POLICY "Users can insert gemstones in their branches"
ON public.gemstone_inventory FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin') OR branch_id = ANY(get_user_branches(auth.uid())));

CREATE POLICY "Users can update gemstones in their branches"
ON public.gemstone_inventory FOR UPDATE
USING (has_role(auth.uid(), 'admin') OR branch_id = ANY(get_user_branches(auth.uid())));

-- RLS Policies for gemstone_transactions
CREATE POLICY "Users can view gemstone transactions"
ON public.gemstone_transactions FOR SELECT
USING (has_role(auth.uid(), 'admin') OR 
       from_branch_id = ANY(get_user_branches(auth.uid())) OR 
       to_branch_id = ANY(get_user_branches(auth.uid())));

CREATE POLICY "Users can insert gemstone transactions"
ON public.gemstone_transactions FOR INSERT
WITH CHECK (true);

-- RLS Policies for jewelry_item_gemstones
CREATE POLICY "Authenticated users can view jewelry item gemstones"
ON public.jewelry_item_gemstones FOR SELECT
USING (true);

CREATE POLICY "Authenticated users can insert jewelry item gemstones"
ON public.jewelry_item_gemstones FOR INSERT
WITH CHECK (true);

CREATE POLICY "Authenticated users can update jewelry item gemstones"
ON public.jewelry_item_gemstones FOR UPDATE
USING (true);

CREATE POLICY "Authenticated users can delete jewelry item gemstones"
ON public.jewelry_item_gemstones FOR DELETE
USING (true);

-- Add gemstone cost column to jewelry_items
ALTER TABLE public.jewelry_items ADD COLUMN IF NOT EXISTS gemstone_cost NUMERIC DEFAULT 0;

-- Create function to generate stone code
CREATE OR REPLACE FUNCTION public.generate_stone_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    next_num BIGINT;
BEGIN
    UPDATE public.code_sequences
    SET last_number = last_number + 1
    WHERE id = 'STONE'
    RETURNING last_number INTO next_num;
    
    IF next_num IS NULL THEN
        INSERT INTO public.code_sequences (id, last_number) VALUES ('STONE', 1);
        next_num := 1;
    END IF;
    
    RETURN 'STN-' || LPAD(next_num::TEXT, 6, '0');
END;
$$;

-- Insert default gemstone types
INSERT INTO public.gemstone_types (type_code, type_name, type_name_en, category) VALUES
('DIA', 'ألماس', 'Diamond', 'precious'),
('RUB', 'ياقوت أحمر', 'Ruby', 'precious'),
('SAP', 'ياقوت أزرق', 'Sapphire', 'precious'),
('EME', 'زمرد', 'Emerald', 'precious'),
('PRL', 'لؤلؤ', 'Pearl', 'precious'),
('TOP', 'توباز', 'Topaz', 'semi-precious'),
('AME', 'جمشت', 'Amethyst', 'semi-precious'),
('AQU', 'أكوامارين', 'Aquamarine', 'semi-precious'),
('GAR', 'عقيق', 'Garnet', 'semi-precious'),
('OPL', 'أوبال', 'Opal', 'semi-precious'),
('TUR', 'فيروز', 'Turquoise', 'semi-precious'),
('CIT', 'سترين', 'Citrine', 'semi-precious'),
('PER', 'بيريدوت', 'Peridot', 'semi-precious'),
('ONX', 'أونيكس', 'Onyx', 'semi-precious'),
('CZR', 'زركون', 'Cubic Zirconia', 'synthetic')
ON CONFLICT (type_code) DO NOTHING;

-- Add STONE sequence
INSERT INTO public.code_sequences (id, last_number) VALUES ('STONE', 0)
ON CONFLICT (id) DO NOTHING;

-- Create trigger for updated_at
CREATE TRIGGER update_gemstone_types_updated_at
    BEFORE UPDATE ON public.gemstone_types
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_gemstone_inventory_updated_at
    BEFORE UPDATE ON public.gemstone_inventory
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();
