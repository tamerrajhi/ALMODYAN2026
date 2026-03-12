-- Drop the constraints that use the conflicting indexes
ALTER TABLE public.item_movements DROP CONSTRAINT IF EXISTS uq_item_movements_sale;
ALTER TABLE public.item_movements DROP CONSTRAINT IF EXISTS uq_item_movements_ref;

-- The indexes will be dropped automatically with the constraints

-- Create a clean unique constraint matching the ON CONFLICT clause order
-- (movement_type, reference_type, reference_id, item_id)
ALTER TABLE public.item_movements 
ADD CONSTRAINT uq_item_movements_sale_v2 
UNIQUE (movement_type, reference_type, reference_id, item_id);