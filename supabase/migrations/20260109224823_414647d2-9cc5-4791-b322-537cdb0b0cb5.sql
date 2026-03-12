-- 1. إضافة عمود line_kind لتحديد نوع سطر الفاتورة
ALTER TABLE public.purchase_invoice_lines 
ADD COLUMN IF NOT EXISTS line_kind text NOT NULL DEFAULT 'normal';

-- 2. إضافة قيد فريد لمنع تكرار Summary Line لنفس الفاتورة
CREATE UNIQUE INDEX IF NOT EXISTS unique_import_summary_per_invoice 
ON public.purchase_invoice_lines (invoice_id) 
WHERE line_kind = 'import_summary';

-- 3. فهرس على jewelry_items.purchase_invoice_id للأداء
CREATE INDEX IF NOT EXISTS idx_jewelry_items_purchase_invoice_id 
ON public.jewelry_items (purchase_invoice_id);

-- 4. فهرس مركب على jewelry_items للتصفح بالصفحات
CREATE INDEX IF NOT EXISTS idx_jewelry_items_purchase_invoice_created 
ON public.jewelry_items (purchase_invoice_id, created_at);

-- 5. فهرس على purchase_invoice_lines.invoice_id
CREATE INDEX IF NOT EXISTS idx_purchase_invoice_lines_invoice_id 
ON public.purchase_invoice_lines (invoice_id);

-- 6. فهرس مركب على invoice_id و line_kind
CREATE INDEX IF NOT EXISTS idx_purchase_invoice_lines_invoice_kind 
ON public.purchase_invoice_lines (invoice_id, line_kind);