-- Backfill journal_entry_id بشكل صحيح مع تطابق أسماء reference_type
-- pos_sale -> sale
UPDATE item_movements im
SET journal_entry_id = je.id
FROM journal_entries je
WHERE im.movement_type = 'SALE'
  AND im.reference_type = 'pos_sale'
  AND je.reference_type = 'sale'
  AND im.reference_id::text = je.reference_id::text
  AND im.journal_entry_id IS NULL
  AND je.id IS NOT NULL;

-- pos_return -> sale_return  
UPDATE item_movements im
SET journal_entry_id = je.id
FROM journal_entries je
WHERE im.movement_type = 'RETURN_FROM_SALE'
  AND im.reference_type = 'pos_return'
  AND je.reference_type = 'sale_return'
  AND im.reference_id::text = je.reference_id::text
  AND im.journal_entry_id IS NULL
  AND je.id IS NOT NULL;