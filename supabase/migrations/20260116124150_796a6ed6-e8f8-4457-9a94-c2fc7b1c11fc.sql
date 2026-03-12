-- إضافة الأعمدة المفقودة لجدول transfer_items لحفظ snapshot من بيانات القطعة وقت النقل
ALTER TABLE public.transfer_items 
ADD COLUMN IF NOT EXISTS item_code TEXT,
ADD COLUMN IF NOT EXISTS weight_grams NUMERIC,
ADD COLUMN IF NOT EXISTS unit_cost NUMERIC DEFAULT 0;

-- إضافة تعليق توضيحي للأعمدة
COMMENT ON COLUMN public.transfer_items.item_code IS 'كود القطعة وقت النقل (snapshot)';
COMMENT ON COLUMN public.transfer_items.weight_grams IS 'وزن القطعة بالجرام وقت النقل (snapshot)';
COMMENT ON COLUMN public.transfer_items.unit_cost IS 'تكلفة القطعة وقت النقل (snapshot)';