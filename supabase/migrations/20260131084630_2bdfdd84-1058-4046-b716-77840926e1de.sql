-- Drop the existing partial index if it exists
DROP INDEX IF EXISTS ux_item_movements_sale_unique;

-- Create a partial unique index that matches the ON CONFLICT clause exactly
CREATE UNIQUE INDEX ux_item_movements_sale_unique 
ON public.item_movements (movement_type, reference_type, reference_id, item_id)
WHERE (movement_type = 'SALE' AND reference_type = 'sale');

-- Also create one for lowercase 'sale' movement_type for consistency
DROP INDEX IF EXISTS ux_item_movements_sale_lower;
CREATE UNIQUE INDEX ux_item_movements_sale_lower
ON public.item_movements (movement_type, reference_type, reference_id, item_id)
WHERE (movement_type = 'sale' AND reference_type = 'sale');