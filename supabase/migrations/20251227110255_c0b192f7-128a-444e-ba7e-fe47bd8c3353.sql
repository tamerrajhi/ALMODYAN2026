-- إضافة حقول إضافية لجدول الموردين
ALTER TABLE public.suppliers 
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS email TEXT,
ADD COLUMN IF NOT EXISTS vat_number TEXT,
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS contact_person TEXT,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- إنشاء جدول بنود فواتير المشتريات
CREATE TABLE public.purchase_invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,
  product_id UUID REFERENCES public.jewelry_items(id),
  product_code TEXT,
  description TEXT,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  is_inclusive BOOLEAN DEFAULT false,
  discount_amount NUMERIC DEFAULT 0,
  subtotal NUMERIC DEFAULT 0,
  tax_rate NUMERIC DEFAULT 15,
  tax_amount NUMERIC DEFAULT 0,
  total_amount NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.purchase_invoice_lines ENABLE ROW LEVEL SECURITY;

-- RLS Policies for purchase_invoice_lines
CREATE POLICY "Authenticated users can view purchase invoice lines"
ON public.purchase_invoice_lines
FOR SELECT
USING (true);

CREATE POLICY "Authenticated users can insert purchase invoice lines"
ON public.purchase_invoice_lines
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Authenticated users can update purchase invoice lines"
ON public.purchase_invoice_lines
FOR UPDATE
USING (true);

CREATE POLICY "Authenticated users can delete purchase invoice lines"
ON public.purchase_invoice_lines
FOR DELETE
USING (true);

-- إنشاء دالة لتوليد رقم فاتورة المشتريات
CREATE OR REPLACE FUNCTION public.generate_purchase_invoice_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    today_str TEXT;
    invoice_count INTEGER;
BEGIN
    today_str := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
    
    SELECT COUNT(*) + 1 INTO invoice_count
    FROM public.invoices
    WHERE invoice_number LIKE 'PI-' || today_str || '%'
    AND invoice_type = 'purchase';
    
    RETURN 'PI-' || today_str || '-' || LPAD(invoice_count::TEXT, 4, '0');
END;
$$;