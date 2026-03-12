-- 1. إضافة supplier_id إلى purchase_batches مع FK
ALTER TABLE public.purchase_batches 
ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id);

-- 2. إضافة CHECK constraint لمنع إدخال قطعة مستوردة بدون supplier_id
-- نستخدم trigger بدلاً من CHECK constraint لأنها أكثر مرونة
CREATE OR REPLACE FUNCTION public.validate_imported_item_supplier()
RETURNS TRIGGER AS $$
BEGIN
  -- إذا كانت القطعة مرتبطة بدفعة (batch_id not null)، يجب أن يكون لها supplier_id
  IF NEW.batch_id IS NOT NULL AND NEW.supplier_id IS NULL THEN
    RAISE EXCEPTION 'القطع المستوردة (batch_id not null) يجب أن تحتوي على supplier_id';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- إنشاء trigger للتحقق عند الإدراج والتحديث
DROP TRIGGER IF EXISTS trigger_validate_imported_item_supplier ON public.jewelry_items;
CREATE TRIGGER trigger_validate_imported_item_supplier
BEFORE INSERT OR UPDATE ON public.jewelry_items
FOR EACH ROW
EXECUTE FUNCTION public.validate_imported_item_supplier();

-- 3. تحديث القطع الموجودة التي لها batch_id بدون supplier_id
-- نحاول استخراج supplier_id من batch إذا كان موجوداً
UPDATE public.jewelry_items ji
SET supplier_id = pb.supplier_id
FROM public.purchase_batches pb
WHERE ji.batch_id = pb.id 
  AND ji.supplier_id IS NULL 
  AND pb.supplier_id IS NOT NULL;

-- 4. إنشاء index لتحسين الأداء
CREATE INDEX IF NOT EXISTS idx_purchase_batches_supplier_id ON public.purchase_batches(supplier_id);
CREATE INDEX IF NOT EXISTS idx_jewelry_items_batch_supplier ON public.jewelry_items(batch_id, supplier_id);