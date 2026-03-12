
-- P4-1A: Fix sale_status constraint and remediate legacy items

-- Step 1: Drop the old constraint
ALTER TABLE public.jewelry_items DROP CONSTRAINT IF EXISTS jewelry_items_sale_status_check;

-- Step 2: Add the updated constraint with 'inspection' status
ALTER TABLE public.jewelry_items 
ADD CONSTRAINT jewelry_items_sale_status_check 
CHECK (sale_status IN ('available', 'sold', 'reserved', 'returned', 'inspection'));

-- Step 3: Update legacy items with sale_status='returned' to 'inspection'
UPDATE public.jewelry_items
SET 
  sale_status = 'inspection',
  is_available_for_sale = false,
  sold_at = NULL
WHERE sale_status = 'returned';

-- Step 4: Add comment documenting the statuses
COMMENT ON COLUMN public.jewelry_items.sale_status IS 'Item sale status: available (for sale), sold (sold), reserved (held for customer), inspection (returned and awaiting review), returned (legacy status - should be migrated)';
