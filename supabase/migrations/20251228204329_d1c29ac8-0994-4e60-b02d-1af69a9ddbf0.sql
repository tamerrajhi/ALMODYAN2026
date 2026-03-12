-- إنشاء جدول مرتجعات المشتريات
CREATE TABLE public.purchase_returns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  return_number TEXT NOT NULL UNIQUE,
  return_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  supplier_id UUID REFERENCES public.suppliers(id),
  purchase_invoice_id UUID REFERENCES public.invoices(id),
  branch_id UUID REFERENCES public.branches(id),
  subtotal NUMERIC NOT NULL DEFAULT 0,
  tax_amount NUMERIC NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  reason TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed',
  journal_entry_id UUID REFERENCES public.journal_entries(id),
  processed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- إنشاء جدول بنود مرتجعات المشتريات
CREATE TABLE public.purchase_return_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  return_id UUID NOT NULL REFERENCES public.purchase_returns(id) ON DELETE CASCADE,
  jewelry_item_id UUID REFERENCES public.jewelry_items(id),
  description TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  discount_amount NUMERIC NOT NULL DEFAULT 0,
  tax_rate NUMERIC NOT NULL DEFAULT 0.15,
  tax_amount NUMERIC NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  weight_grams NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- تمكين RLS
ALTER TABLE public.purchase_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_return_items ENABLE ROW LEVEL SECURITY;

-- سياسات RLS لمرتجعات المشتريات
CREATE POLICY "Users can view purchase returns in their branches"
ON public.purchase_returns FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role) OR branch_id = ANY(get_user_branches(auth.uid())));

CREATE POLICY "Users can insert purchase returns in their branches"
ON public.purchase_returns FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR branch_id = ANY(get_user_branches(auth.uid())));

CREATE POLICY "Users can update purchase returns in their branches"
ON public.purchase_returns FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role) OR branch_id = ANY(get_user_branches(auth.uid())));

-- سياسات RLS لبنود مرتجعات المشتريات
CREATE POLICY "Users can view purchase return items"
ON public.purchase_return_items FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.purchase_returns pr
  WHERE pr.id = purchase_return_items.return_id
  AND (has_role(auth.uid(), 'admin'::app_role) OR pr.branch_id = ANY(get_user_branches(auth.uid())))
));

CREATE POLICY "Users can insert purchase return items"
ON public.purchase_return_items FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM public.purchase_returns pr
  WHERE pr.id = purchase_return_items.return_id
  AND (has_role(auth.uid(), 'admin'::app_role) OR pr.branch_id = ANY(get_user_branches(auth.uid())))
));

CREATE POLICY "Users can update purchase return items"
ON public.purchase_return_items FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM public.purchase_returns pr
  WHERE pr.id = purchase_return_items.return_id
  AND (has_role(auth.uid(), 'admin'::app_role) OR pr.branch_id = ANY(get_user_branches(auth.uid())))
));

CREATE POLICY "Users can delete purchase return items"
ON public.purchase_return_items FOR DELETE
USING (EXISTS (
  SELECT 1 FROM public.purchase_returns pr
  WHERE pr.id = purchase_return_items.return_id
  AND (has_role(auth.uid(), 'admin'::app_role) OR pr.branch_id = ANY(get_user_branches(auth.uid())))
));

-- إضافة حقل invoice_id لجدول returns الحالي للربط مع فواتير المبيعات
ALTER TABLE public.returns ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES public.invoices(id);

-- دالة توليد رقم مرتجع المشتريات
CREATE OR REPLACE FUNCTION public.generate_purchase_return_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    today_str TEXT;
    return_count INTEGER;
BEGIN
    today_str := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
    
    SELECT COUNT(*) + 1 INTO return_count
    FROM public.purchase_returns
    WHERE return_number LIKE 'PR-' || today_str || '%';
    
    RETURN 'PR-' || today_str || '-' || LPAD(return_count::TEXT, 4, '0');
END;
$$;

-- دالة توليد رقم مرتجع المبيعات (تحديث إن وجدت)
CREATE OR REPLACE FUNCTION public.generate_sales_return_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    today_str TEXT;
    return_count INTEGER;
BEGIN
    today_str := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
    
    SELECT COUNT(*) + 1 INTO return_count
    FROM public.returns
    WHERE return_code LIKE 'SR-' || today_str || '%';
    
    RETURN 'SR-' || today_str || '-' || LPAD(return_count::TEXT, 4, '0');
END;
$$;

-- Trigger لتحديث updated_at
CREATE TRIGGER update_purchase_returns_updated_at
BEFORE UPDATE ON public.purchase_returns
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();