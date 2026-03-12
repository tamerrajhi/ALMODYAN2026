-- 1. Add cost_entry_id column to purchase_invoice_lines
ALTER TABLE public.purchase_invoice_lines
ADD COLUMN cost_entry_id uuid REFERENCES public.cost_entries(id) ON DELETE SET NULL;

-- 2. Drop the existing foreign key constraint pointing to jewelry_items
ALTER TABLE public.purchase_invoice_lines
DROP CONSTRAINT IF EXISTS purchase_invoice_lines_product_id_fkey;

-- 3. Make product_id nullable (already is, but ensure it)
ALTER TABLE public.purchase_invoice_lines
ALTER COLUMN product_id DROP NOT NULL;

-- 4. Add a CHECK constraint: either product_id OR cost_entry_id must be set, but not both
-- (item_type determines which one is used)
-- We'll use a flexible approach: at least one should be set, OR both null is allowed if item_type describes it
-- For now, we allow nulls for backward compatibility but enforce via application logic

-- 5. Create index for cost_entry_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_purchase_invoice_lines_cost_entry_id 
ON public.purchase_invoice_lines(cost_entry_id);

-- 6. Add RLS policy for the new column relationship
-- (existing policies should already cover the table, but ensure cost_entries access is available)