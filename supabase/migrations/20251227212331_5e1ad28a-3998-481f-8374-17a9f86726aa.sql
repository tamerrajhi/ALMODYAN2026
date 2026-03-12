-- جدول سندات القبض من العملاء
CREATE TABLE IF NOT EXISTS public.customer_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number TEXT NOT NULL UNIQUE,
  receipt_date DATE NOT NULL DEFAULT CURRENT_DATE,
  customer_id UUID NOT NULL REFERENCES public.customers(id),
  invoice_id UUID REFERENCES public.invoices(id),
  branch_id UUID REFERENCES public.branches(id),
  amount NUMERIC NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  reference_number TEXT,
  bank_name TEXT,
  check_number TEXT,
  check_date DATE,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed',
  journal_entry_id UUID REFERENCES public.journal_entries(id),
  created_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- جدول الإشعارات الدائنة (Credit Notes)
CREATE TABLE IF NOT EXISTS public.credit_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_number TEXT NOT NULL UNIQUE,
  credit_note_date DATE NOT NULL DEFAULT CURRENT_DATE,
  invoice_id UUID REFERENCES public.invoices(id),
  customer_id UUID NOT NULL REFERENCES public.customers(id),
  branch_id UUID REFERENCES public.branches(id),
  reason TEXT,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  tax_amount NUMERIC NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  applied_to_invoice_id UUID REFERENCES public.invoices(id),
  journal_entry_id UUID REFERENCES public.journal_entries(id),
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- جدول بنود الإشعار الدائن
CREATE TABLE IF NOT EXISTS public.credit_note_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_id UUID NOT NULL REFERENCES public.credit_notes(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  tax_rate NUMERIC DEFAULT 0.15,
  tax_amount NUMERIC NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  jewelry_item_id UUID REFERENCES public.jewelry_items(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- جدول بنود فواتير المبيعات
CREATE TABLE IF NOT EXISTS public.sales_invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  discount_amount NUMERIC DEFAULT 0,
  discount_percentage NUMERIC DEFAULT 0,
  tax_rate NUMERIC DEFAULT 0.15,
  tax_amount NUMERIC NOT NULL DEFAULT 0,
  total_before_tax NUMERIC NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  jewelry_item_id UUID REFERENCES public.jewelry_items(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- تفعيل RLS
ALTER TABLE public.customer_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_note_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_invoice_items ENABLE ROW LEVEL SECURITY;

-- سياسات سندات القبض
CREATE POLICY "Users can view customer receipts in their branches"
ON public.customer_receipts FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role) OR branch_id = ANY(get_user_branches(auth.uid())));

CREATE POLICY "Users can insert customer receipts in their branches"
ON public.customer_receipts FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR branch_id = ANY(get_user_branches(auth.uid())));

CREATE POLICY "Users can update customer receipts in their branches"
ON public.customer_receipts FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role) OR branch_id = ANY(get_user_branches(auth.uid())));

-- سياسات الإشعارات الدائنة
CREATE POLICY "Users can view credit notes in their branches"
ON public.credit_notes FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role) OR branch_id = ANY(get_user_branches(auth.uid())));

CREATE POLICY "Users can insert credit notes in their branches"
ON public.credit_notes FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR branch_id = ANY(get_user_branches(auth.uid())));

CREATE POLICY "Users can update credit notes in their branches"
ON public.credit_notes FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role) OR branch_id = ANY(get_user_branches(auth.uid())));

-- سياسات بنود الإشعارات الدائنة
CREATE POLICY "Users can view credit note items"
ON public.credit_note_items FOR SELECT USING (true);

CREATE POLICY "Users can insert credit note items"
ON public.credit_note_items FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update credit note items"
ON public.credit_note_items FOR UPDATE USING (true);

CREATE POLICY "Users can delete credit note items"
ON public.credit_note_items FOR DELETE USING (true);

-- سياسات بنود فواتير المبيعات
CREATE POLICY "Users can view sales invoice items"
ON public.sales_invoice_items FOR SELECT USING (true);

CREATE POLICY "Users can insert sales invoice items"
ON public.sales_invoice_items FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update sales invoice items"
ON public.sales_invoice_items FOR UPDATE USING (true);

CREATE POLICY "Users can delete sales invoice items"
ON public.sales_invoice_items FOR DELETE USING (true);

-- إضافة عمود حالة الهيئة للفواتير
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'zatca_status'
  ) THEN
    ALTER TABLE public.invoices ADD COLUMN zatca_status TEXT DEFAULT 'not_submitted';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'zatca_invoice_hash'
  ) THEN
    ALTER TABLE public.invoices ADD COLUMN zatca_invoice_hash TEXT;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'delivery_date'
  ) THEN
    ALTER TABLE public.invoices ADD COLUMN delivery_date DATE;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'payment_terms'
  ) THEN
    ALTER TABLE public.invoices ADD COLUMN payment_terms TEXT;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'payment_method'
  ) THEN
    ALTER TABLE public.invoices ADD COLUMN payment_method TEXT DEFAULT 'cash';
  END IF;
END $$;

-- دالة توليد رقم سند القبض
CREATE OR REPLACE FUNCTION generate_receipt_number()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  next_num INTEGER;
  new_code TEXT;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(receipt_number FROM 4) AS INTEGER)), 0) + 1
  INTO next_num
  FROM customer_receipts;
  
  new_code := 'REC' || LPAD(next_num::TEXT, 6, '0');
  RETURN new_code;
END;
$$;

-- دالة توليد رقم الإشعار الدائن
CREATE OR REPLACE FUNCTION generate_credit_note_number()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  next_num INTEGER;
  new_code TEXT;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(credit_note_number FROM 3) AS INTEGER)), 0) + 1
  INTO next_num
  FROM credit_notes;
  
  new_code := 'CN' || LPAD(next_num::TEXT, 6, '0');
  RETURN new_code;
END;
$$;