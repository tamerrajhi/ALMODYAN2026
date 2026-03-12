-- Add reference_code column if not exists
ALTER TABLE public.item_movements 
ADD COLUMN IF NOT EXISTS reference_code TEXT;

-- Add composite index for reference lookups
CREATE INDEX IF NOT EXISTS idx_item_movements_reference 
ON public.item_movements (reference_type, reference_id);

-- Add composite index for item + date (for pagination)
CREATE INDEX IF NOT EXISTS idx_item_movements_item_date 
ON public.item_movements (item_id, created_at DESC);

-- Add index for from_branch_id
CREATE INDEX IF NOT EXISTS idx_item_movements_from_branch 
ON public.item_movements (from_branch_id);

-- Add index for to_branch_id  
CREATE INDEX IF NOT EXISTS idx_item_movements_to_branch 
ON public.item_movements (to_branch_id);

-- Comment for documentation
COMMENT ON COLUMN public.item_movements.reference_code IS 'Document number (e.g., INV-001, SL-001) for display purposes';