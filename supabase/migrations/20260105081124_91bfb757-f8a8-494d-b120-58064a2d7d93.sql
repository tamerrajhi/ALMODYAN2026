-- =====================================================
-- جداول نظام استيراد دفعات الموردين من Excel
-- =====================================================

-- Enum لحالة الـ Batch
CREATE TYPE import_payment_batch_status AS ENUM ('new', 'partially_imported', 'fully_imported', 'closed');

-- Enum لحالة الصف
CREATE TYPE import_payment_row_status AS ENUM ('pending', 'valid', 'imported', 'failed');

-- =====================================================
-- جدول الـ Batches
-- =====================================================
CREATE TABLE public.import_payment_batches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_number TEXT NOT NULL UNIQUE,
  batch_name TEXT NOT NULL,
  uploaded_file_name TEXT,
  uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  uploaded_by TEXT,
  uploaded_by_id UUID,
  status import_payment_batch_status NOT NULL DEFAULT 'new',
  total_rows INTEGER NOT NULL DEFAULT 0,
  pending_rows INTEGER NOT NULL DEFAULT 0,
  valid_rows INTEGER NOT NULL DEFAULT 0,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  failed_rows INTEGER NOT NULL DEFAULT 0,
  total_amount NUMERIC(15,2) DEFAULT 0,
  imported_amount NUMERIC(15,2) DEFAULT 0,
  notes TEXT,
  closed_at TIMESTAMP WITH TIME ZONE,
  closed_by TEXT,
  closed_by_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.import_payment_batches ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view import_payment_batches" 
ON public.import_payment_batches FOR SELECT 
USING (true);

CREATE POLICY "Users can insert import_payment_batches" 
ON public.import_payment_batches FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Users can update import_payment_batches" 
ON public.import_payment_batches FOR UPDATE 
USING (true);

CREATE POLICY "Users can delete import_payment_batches" 
ON public.import_payment_batches FOR DELETE 
USING (status = 'new' AND imported_rows = 0);

-- Index for faster lookups
CREATE INDEX idx_import_payment_batches_status ON public.import_payment_batches(status);
CREATE INDEX idx_import_payment_batches_uploaded_at ON public.import_payment_batches(uploaded_at DESC);

-- =====================================================
-- جدول صفوف الاستيراد
-- =====================================================
CREATE TABLE public.import_payment_rows (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id UUID NOT NULL REFERENCES public.import_payment_batches(id) ON DELETE CASCADE,
  original_row_number INTEGER NOT NULL,
  
  -- البيانات من الملف الأصلي
  supplier_code_raw TEXT,
  supplier_name_raw TEXT,
  invoice_number_raw TEXT,
  payment_amount NUMERIC(15,2) NOT NULL,
  currency TEXT DEFAULT 'SAR',
  exchange_rate NUMERIC(10,4) DEFAULT 1,
  payment_date DATE,
  payment_method TEXT,
  bank_ref TEXT,
  notes TEXT,
  
  -- الربط مع النظام
  mapped_supplier_id UUID REFERENCES public.suppliers(id),
  mapped_invoice_id UUID REFERENCES public.invoices(id),
  created_payment_id UUID REFERENCES public.payments(id),
  
  -- حالة المعالجة
  status import_payment_row_status NOT NULL DEFAULT 'pending',
  error_code TEXT,
  error_message TEXT,
  
  -- تتبع المعالجة
  validated_at TIMESTAMP WITH TIME ZONE,
  imported_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.import_payment_rows ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view import_payment_rows" 
ON public.import_payment_rows FOR SELECT 
USING (true);

CREATE POLICY "Users can insert import_payment_rows" 
ON public.import_payment_rows FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Users can update import_payment_rows" 
ON public.import_payment_rows FOR UPDATE 
USING (true);

CREATE POLICY "Users can delete import_payment_rows" 
ON public.import_payment_rows FOR DELETE 
USING (status != 'imported');

-- Indexes for faster lookups
CREATE INDEX idx_import_payment_rows_batch_id ON public.import_payment_rows(batch_id);
CREATE INDEX idx_import_payment_rows_status ON public.import_payment_rows(status);
CREATE INDEX idx_import_payment_rows_mapped_supplier ON public.import_payment_rows(mapped_supplier_id);
CREATE INDEX idx_import_payment_rows_mapped_invoice ON public.import_payment_rows(mapped_invoice_id);

-- =====================================================
-- دالة تحديث إحصائيات الـ Batch
-- =====================================================
CREATE OR REPLACE FUNCTION update_import_payment_batch_stats()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  batch_uuid UUID;
  stats RECORD;
BEGIN
  -- تحديد الـ batch_id
  IF TG_OP = 'DELETE' THEN
    batch_uuid := OLD.batch_id;
  ELSE
    batch_uuid := NEW.batch_id;
  END IF;
  
  -- حساب الإحصائيات
  SELECT 
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE status = 'pending') as pending,
    COUNT(*) FILTER (WHERE status = 'valid') as valid,
    COUNT(*) FILTER (WHERE status = 'imported') as imported,
    COUNT(*) FILTER (WHERE status = 'failed') as failed,
    COALESCE(SUM(payment_amount), 0) as total_amount,
    COALESCE(SUM(payment_amount) FILTER (WHERE status = 'imported'), 0) as imported_amount
  INTO stats
  FROM import_payment_rows
  WHERE batch_id = batch_uuid;
  
  -- تحديث الـ Batch
  UPDATE import_payment_batches
  SET 
    total_rows = stats.total,
    pending_rows = stats.pending,
    valid_rows = stats.valid,
    imported_rows = stats.imported,
    failed_rows = stats.failed,
    total_amount = stats.total_amount,
    imported_amount = stats.imported_amount,
    status = CASE
      WHEN stats.imported = stats.total AND stats.total > 0 THEN 'fully_imported'::import_payment_batch_status
      WHEN stats.imported > 0 THEN 'partially_imported'::import_payment_batch_status
      ELSE 'new'::import_payment_batch_status
    END,
    updated_at = now()
  WHERE id = batch_uuid;
  
  RETURN NEW;
END;
$$;

-- Trigger لتحديث الإحصائيات
CREATE TRIGGER trg_update_import_payment_batch_stats
AFTER INSERT OR UPDATE OR DELETE ON public.import_payment_rows
FOR EACH ROW
EXECUTE FUNCTION update_import_payment_batch_stats();

-- =====================================================
-- دالة توليد رقم الـ Batch
-- =====================================================
CREATE OR REPLACE FUNCTION generate_import_payment_batch_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_num INTEGER;
  year_prefix TEXT;
BEGIN
  year_prefix := 'IPB-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-';
  
  SELECT COALESCE(MAX(
    NULLIF(regexp_replace(batch_number, '^IPB-\d{4}-', ''), '')::INTEGER
  ), 0) + 1
  INTO next_num
  FROM import_payment_batches
  WHERE batch_number LIKE year_prefix || '%';
  
  NEW.batch_number := year_prefix || LPAD(next_num::TEXT, 4, '0');
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_generate_import_payment_batch_number
BEFORE INSERT ON public.import_payment_batches
FOR EACH ROW
WHEN (NEW.batch_number IS NULL OR NEW.batch_number = '')
EXECUTE FUNCTION generate_import_payment_batch_number();

-- =====================================================
-- دالة تحديث updated_at
-- =====================================================
CREATE TRIGGER update_import_payment_batches_updated_at
BEFORE UPDATE ON public.import_payment_batches
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_import_payment_rows_updated_at
BEFORE UPDATE ON public.import_payment_rows
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- تعليقات توضيحية
-- =====================================================
COMMENT ON TABLE public.import_payment_batches IS 'جدول دفعات استيراد المدفوعات من ملفات Excel';
COMMENT ON TABLE public.import_payment_rows IS 'جدول صفوف استيراد المدفوعات من ملفات Excel';
COMMENT ON COLUMN public.import_payment_rows.supplier_code_raw IS 'كود المورد كما ورد في ملف Excel الأصلي';
COMMENT ON COLUMN public.import_payment_rows.mapped_supplier_id IS 'المورد المرتبط في النظام بعد التحقق أو الربط اليدوي';
COMMENT ON COLUMN public.import_payment_rows.created_payment_id IS 'سند الصرف المنشأ بعد الاستيراد الناجح';