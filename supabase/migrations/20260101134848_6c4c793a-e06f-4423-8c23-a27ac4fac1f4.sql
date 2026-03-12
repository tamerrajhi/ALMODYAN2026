-- إضافة عمود المورد لجدول بنود أمر الشراء
ALTER TABLE purchase_order_items 
ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id);

COMMENT ON COLUMN purchase_order_items.supplier_id IS 'المورد الخاص بهذا البند (اختياري - إذا كان مختلفاً عن مورد رأس الأمر)';