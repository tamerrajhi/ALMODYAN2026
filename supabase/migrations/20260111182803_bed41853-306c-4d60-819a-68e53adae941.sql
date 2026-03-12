-- Backfill: إضافة حركة IMPORT للقطع التي ليس لها أي حركات مسجلة
-- This is idempotent - only inserts for items that don't have any movements

INSERT INTO item_movements (
  item_id,
  movement_type,
  movement_date,
  reference_type,
  reference_id,
  to_branch_id,
  notes,
  created_at
)
SELECT 
  ji.id as item_id,
  'IMPORT' as movement_type,
  ji.created_at as movement_date,
  'batch' as reference_type,
  ji.batch_id as reference_id,
  ji.branch_id as to_branch_id,
  'تم الإنشاء تلقائياً - حركة استيراد أولية' as notes,
  ji.created_at as created_at
FROM jewelry_items ji
WHERE NOT EXISTS (
  SELECT 1 FROM item_movements im WHERE im.item_id = ji.id
);