-- إنشاء Index للأداء على invoice_id في payments
CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON public.payments(invoice_id);

-- إضافة Index للبحث السريع على فواتير المشتريات
CREATE INDEX IF NOT EXISTS idx_invoices_supplier_status ON public.invoices(supplier_id, status) WHERE invoice_type = 'purchase';

-- إضافة Index للبحث السريع على فواتير المبيعات
CREATE INDEX IF NOT EXISTS idx_invoices_customer_status ON public.invoices(customer_id, status) WHERE invoice_type = 'sales';