-- Backfill: ربط journal_entry_id للحركات القديمة
-- هذا الـ migration يربط الحركات بالقيود المحاسبية عبر reference_type و reference_id

-- 1. Backfill journal_entry_id من journal_entries
UPDATE item_movements im
SET journal_entry_id = je.id
FROM journal_entries je
WHERE im.reference_type = je.reference_type
  AND im.reference_id::text = je.reference_id::text
  AND im.journal_entry_id IS NULL
  AND je.id IS NOT NULL
  AND im.reference_type IS NOT NULL
  AND im.reference_id IS NOT NULL;

-- 2. Backfill حركات SALE للقطع المباعة التي ليس لها حركة بيع
INSERT INTO item_movements (
  item_id,
  movement_type,
  movement_date,
  reference_type,
  reference_id,
  reference_code,
  from_branch_id,
  performed_by,
  cost,
  notes,
  created_at
)
SELECT 
  ji.id as item_id,
  'SALE' as movement_type,
  COALESCE(ji.sold_at, ji.created_at) as movement_date,
  'pos_sale' as reference_type,
  ji.sale_id as reference_id,
  s.sale_code as reference_code,
  s.branch_id as from_branch_id,
  s.sold_by as performed_by,
  ji.sold_price as cost,
  'تم الإنشاء تلقائياً - حركة بيع سابقة' as notes,
  COALESCE(ji.sold_at, ji.created_at) as created_at
FROM jewelry_items ji
JOIN sales s ON ji.sale_id = s.id
WHERE ji.sale_id IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM item_movements im 
  WHERE im.item_id = ji.id 
  AND im.movement_type = 'SALE'
);

-- 3. ربط journal_entry_id لحركات SALE الجديدة
UPDATE item_movements im
SET journal_entry_id = je.id
FROM journal_entries je
WHERE im.movement_type = 'SALE'
  AND im.reference_type = 'pos_sale'
  AND im.reference_type = je.reference_type
  AND im.reference_id::text = je.reference_id::text
  AND im.journal_entry_id IS NULL
  AND je.id IS NOT NULL;