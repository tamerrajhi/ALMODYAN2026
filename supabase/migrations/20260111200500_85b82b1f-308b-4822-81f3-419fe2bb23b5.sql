
-- Add trigram indexes for fast supplier search
CREATE INDEX IF NOT EXISTS idx_suppliers_name_trgm 
ON suppliers USING gin (supplier_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_suppliers_code_trgm 
ON suppliers USING gin (supplier_code gin_trgm_ops);

-- Add btree index for active status filter (commonly used in queries)
CREATE INDEX IF NOT EXISTS idx_suppliers_status_active 
ON suppliers (status) WHERE status = 'active';

-- Backfill journal_entry_id for movements that have reference_type/reference_id
-- but missing journal_entry_id

-- Update for pos_sale movements (reference_type = 'pos_sale' matches journal_entries.reference_type = 'sale')
UPDATE item_movements im
SET journal_entry_id = je.id
FROM journal_entries je
WHERE im.reference_type = 'pos_sale'
  AND je.reference_type = 'sale'
  AND im.reference_id::text = je.reference_id::text
  AND im.journal_entry_id IS NULL;

-- Update for pos_return movements
UPDATE item_movements im
SET journal_entry_id = je.id
FROM journal_entries je
WHERE im.reference_type = 'pos_return'
  AND je.reference_type = 'return'
  AND im.reference_id::text = je.reference_id::text
  AND im.journal_entry_id IS NULL;

-- Update for sales_return movements
UPDATE item_movements im
SET journal_entry_id = je.id
FROM journal_entries je
WHERE im.reference_type = 'sales_return'
  AND je.reference_type = 'return'
  AND im.reference_id::text = je.reference_id::text
  AND im.journal_entry_id IS NULL;

-- Update for transfer movements
UPDATE item_movements im
SET journal_entry_id = je.id
FROM journal_entries je
WHERE im.reference_type = 'transfer'
  AND je.reference_type = 'transfer'
  AND im.reference_id::text = je.reference_id::text
  AND im.journal_entry_id IS NULL;

-- Update for purchase_invoice movements
UPDATE item_movements im
SET journal_entry_id = je.id
FROM journal_entries je
WHERE im.reference_type = 'purchase_invoice'
  AND je.reference_type = 'purchase_invoice'
  AND im.reference_id::text = je.reference_id::text
  AND im.journal_entry_id IS NULL;
