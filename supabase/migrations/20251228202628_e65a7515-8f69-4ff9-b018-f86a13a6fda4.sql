-- إصلاح البيانات التاريخية: تحديث remaining_amount و paid_amount بناءً على المدفوعات الفعلية
-- للفواتير التي لم تُحدث قيمها بشكل صحيح

-- 1. أولاً: إصلاح الفواتير الجديدة التي لم يتم تعيين remaining_amount لها
UPDATE invoices 
SET 
  remaining_amount = total_amount,
  paid_amount = 0
WHERE remaining_amount IS NULL OR (remaining_amount = 0 AND paid_amount = 0 AND total_amount > 0 AND status = 'pending');

-- 2. إعادة حساب remaining_amount و paid_amount بناءً على المدفوعات الفعلية
WITH actual_payments AS (
  SELECT 
    invoice_id, 
    COALESCE(SUM(amount), 0) as total_paid
  FROM payments
  WHERE invoice_id IS NOT NULL
  GROUP BY invoice_id
)
UPDATE invoices i
SET 
  paid_amount = COALESCE(ap.total_paid, 0),
  remaining_amount = i.total_amount - COALESCE(ap.total_paid, 0),
  status = CASE 
    WHEN COALESCE(ap.total_paid, 0) >= i.total_amount THEN 'paid'
    WHEN COALESCE(ap.total_paid, 0) > 0 THEN 'partially_paid'
    ELSE 'pending'
  END
FROM actual_payments ap
WHERE i.id = ap.invoice_id;

-- 3. إنشاء دالة لتحديث حالة الفاتورة تلقائياً عند إضافة/تعديل/حذف سند
CREATE OR REPLACE FUNCTION update_invoice_payment_status()
RETURNS TRIGGER AS $$
DECLARE
  target_invoice_id UUID;
  total_paid NUMERIC;
  invoice_total NUMERIC;
BEGIN
  -- تحديد الفاتورة المستهدفة
  IF TG_OP = 'DELETE' THEN
    target_invoice_id := OLD.invoice_id;
  ELSE
    target_invoice_id := NEW.invoice_id;
  END IF;
  
  -- إذا لم يكن هناك فاتورة مرتبطة، تخطي
  IF target_invoice_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;
  END IF;
  
  -- حساب إجمالي المدفوعات للفاتورة
  SELECT COALESCE(SUM(amount), 0) INTO total_paid
  FROM payments
  WHERE invoice_id = target_invoice_id;
  
  -- جلب إجمالي الفاتورة
  SELECT total_amount INTO invoice_total
  FROM invoices
  WHERE id = target_invoice_id;
  
  -- تحديث الفاتورة
  UPDATE invoices
  SET 
    paid_amount = total_paid,
    remaining_amount = invoice_total - total_paid,
    status = CASE 
      WHEN total_paid >= invoice_total THEN 'paid'
      WHEN total_paid > 0 THEN 'partially_paid'
      ELSE 'pending'
    END,
    updated_at = now()
  WHERE id = target_invoice_id;
  
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 4. إنشاء Trigger على جدول payments
DROP TRIGGER IF EXISTS trigger_update_invoice_on_payment ON payments;

CREATE TRIGGER trigger_update_invoice_on_payment
AFTER INSERT OR UPDATE OR DELETE ON payments
FOR EACH ROW
EXECUTE FUNCTION update_invoice_payment_status();