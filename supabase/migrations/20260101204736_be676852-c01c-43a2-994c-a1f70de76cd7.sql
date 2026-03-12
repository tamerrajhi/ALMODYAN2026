-- إضافة أعمدة رقمية جديدة للأوزان
ALTER TABLE jewelry_items 
ADD COLUMN IF NOT EXISTS stone_weight NUMERIC DEFAULT 0;

ALTER TABLE jewelry_items 
ADD COLUMN IF NOT EXISTS metal_weight NUMERIC DEFAULT 0;

ALTER TABLE jewelry_items 
ADD COLUMN IF NOT EXISTS m_weight NUMERIC DEFAULT 0;

-- تعليقات توضيحية
COMMENT ON COLUMN jewelry_items.stone_weight IS 'وزن الأحجار من عمود Stone - رقمي';
COMMENT ON COLUMN jewelry_items.metal_weight IS 'وزن المعدن من عمود Metal - رقمي';
COMMENT ON COLUMN jewelry_items.m_weight IS 'قيمة M الرقمية من عمود M';

-- تحديث القيم الافتراضية للأعمدة الموجودة
ALTER TABLE jewelry_items 
ALTER COLUMN g_weight SET DEFAULT 0;

ALTER TABLE jewelry_items 
ALTER COLUMN d_weight SET DEFAULT 0;

ALTER TABLE jewelry_items 
ALTER COLUMN b_weight SET DEFAULT 0;

ALTER TABLE jewelry_items 
ALTER COLUMN mq_weight SET DEFAULT 0;

ALTER TABLE jewelry_items 
ALTER COLUMN cs_weight SET DEFAULT 0;