-- إضافة أعمدة جديدة لجدول jewelry_items
ALTER TABLE jewelry_items 
ADD COLUMN IF NOT EXISTS mq_weight NUMERIC;

ALTER TABLE jewelry_items 
ADD COLUMN IF NOT EXISTS cs_weight NUMERIC;

ALTER TABLE jewelry_items 
ADD COLUMN IF NOT EXISTS m_value TEXT;

-- إضافة عمود default_clarity لجدول jewelry_sets
ALTER TABLE jewelry_sets 
ADD COLUMN IF NOT EXISTS default_clarity TEXT;

-- إضافة تعليقات توضيحية
COMMENT ON COLUMN jewelry_items.mq_weight IS 'قيمة MQ من ملف Excel - وزن أو كمية إضافية';
COMMENT ON COLUMN jewelry_items.cs_weight IS 'قيمة CS من ملف Excel - وزن أو كمية إضافية';
COMMENT ON COLUMN jewelry_items.m_value IS 'حقل M من ملف Excel - معلومات إضافية';
COMMENT ON COLUMN jewelry_sets.default_clarity IS 'درجة النقاء الافتراضية للطقم';