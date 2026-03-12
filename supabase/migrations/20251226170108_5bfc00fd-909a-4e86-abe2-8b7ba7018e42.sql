-- Create purchase_orders table
CREATE TABLE public.purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_number TEXT NOT NULL UNIQUE,
    supplier_id UUID REFERENCES public.suppliers(id),
    branch_id UUID REFERENCES public.branches(id),
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expected_delivery_date DATE,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'approved', 'partially_received', 'received', 'cancelled')),
    order_type TEXT NOT NULL DEFAULT 'gold' CHECK (order_type IN ('gold', 'raw_material', 'gemstone', 'mixed')),
    total_gold_weight NUMERIC DEFAULT 0,
    total_amount NUMERIC DEFAULT 0,
    notes TEXT,
    created_by TEXT,
    approved_by UUID,
    approved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create purchase_order_items table
CREATE TABLE public.purchase_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL CHECK (item_type IN ('gold', 'raw_material', 'gemstone')),
    description TEXT,
    karat_id UUID REFERENCES public.gold_karats(id),
    gemstone_type_id UUID REFERENCES public.gemstone_types(id),
    raw_material_id UUID REFERENCES public.raw_materials(id),
    quantity NUMERIC DEFAULT 1,
    weight_grams NUMERIC,
    unit_price NUMERIC,
    total_price NUMERIC,
    received_quantity NUMERIC DEFAULT 0,
    received_weight NUMERIC DEFAULT 0,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'partially_received', 'received', 'cancelled')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create purchase_order_receipts table for tracking receipts
CREATE TABLE public.purchase_order_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_id UUID NOT NULL REFERENCES public.purchase_orders(id),
    po_item_id UUID REFERENCES public.purchase_order_items(id),
    receipt_date DATE NOT NULL DEFAULT CURRENT_DATE,
    receipt_number TEXT NOT NULL,
    item_type TEXT NOT NULL,
    quantity_received NUMERIC,
    weight_received NUMERIC,
    unit_price NUMERIC,
    total_amount NUMERIC,
    gold_vault_transaction_id UUID REFERENCES public.gold_vault_transactions(id),
    raw_material_transaction_id UUID,
    gemstone_transaction_id UUID REFERENCES public.gemstone_transactions(id),
    journal_entry_id UUID REFERENCES public.journal_entries(id),
    received_by TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Generate PO number function
CREATE OR REPLACE FUNCTION public.generate_po_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    today_str TEXT;
    po_count INTEGER;
BEGIN
    today_str := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
    
    SELECT COUNT(*) + 1 INTO po_count
    FROM public.purchase_orders
    WHERE po_number LIKE 'PO-' || today_str || '%';
    
    RETURN 'PO-' || today_str || '-' || LPAD(po_count::TEXT, 4, '0');
END;
$$;

-- Generate receipt number function
CREATE OR REPLACE FUNCTION public.generate_receipt_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    today_str TEXT;
    receipt_count INTEGER;
BEGIN
    today_str := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
    
    SELECT COUNT(*) + 1 INTO receipt_count
    FROM public.purchase_order_receipts
    WHERE receipt_number LIKE 'RCV-' || today_str || '%';
    
    RETURN 'RCV-' || today_str || '-' || LPAD(receipt_count::TEXT, 4, '0');
END;
$$;

-- Enable RLS
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_receipts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for purchase_orders
CREATE POLICY "Users can view POs in their branches"
ON public.purchase_orders FOR SELECT
USING (has_role(auth.uid(), 'admin') OR branch_id = ANY(get_user_branches(auth.uid())));

CREATE POLICY "Users can insert POs in their branches"
ON public.purchase_orders FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin') OR branch_id = ANY(get_user_branches(auth.uid())));

CREATE POLICY "Users can update POs in their branches"
ON public.purchase_orders FOR UPDATE
USING (has_role(auth.uid(), 'admin') OR branch_id = ANY(get_user_branches(auth.uid())));

-- RLS Policies for purchase_order_items
CREATE POLICY "Users can view PO items"
ON public.purchase_order_items FOR SELECT
USING (EXISTS (
    SELECT 1 FROM public.purchase_orders po 
    WHERE po.id = purchase_order_items.po_id 
    AND (has_role(auth.uid(), 'admin') OR po.branch_id = ANY(get_user_branches(auth.uid())))
));

CREATE POLICY "Users can insert PO items"
ON public.purchase_order_items FOR INSERT
WITH CHECK (EXISTS (
    SELECT 1 FROM public.purchase_orders po 
    WHERE po.id = purchase_order_items.po_id 
    AND (has_role(auth.uid(), 'admin') OR po.branch_id = ANY(get_user_branches(auth.uid())))
));

CREATE POLICY "Users can update PO items"
ON public.purchase_order_items FOR UPDATE
USING (EXISTS (
    SELECT 1 FROM public.purchase_orders po 
    WHERE po.id = purchase_order_items.po_id 
    AND (has_role(auth.uid(), 'admin') OR po.branch_id = ANY(get_user_branches(auth.uid())))
));

-- RLS Policies for purchase_order_receipts
CREATE POLICY "Users can view receipts"
ON public.purchase_order_receipts FOR SELECT
USING (EXISTS (
    SELECT 1 FROM public.purchase_orders po 
    WHERE po.id = purchase_order_receipts.po_id 
    AND (has_role(auth.uid(), 'admin') OR po.branch_id = ANY(get_user_branches(auth.uid())))
));

CREATE POLICY "Users can insert receipts"
ON public.purchase_order_receipts FOR INSERT
WITH CHECK (true);