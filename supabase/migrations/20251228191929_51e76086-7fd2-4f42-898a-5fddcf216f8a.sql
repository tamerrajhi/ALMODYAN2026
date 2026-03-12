-- Add accounting and inventory linking columns to products table
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS inventory_account_id uuid REFERENCES public.chart_of_accounts(id),
ADD COLUMN IF NOT EXISTS expense_account_id uuid REFERENCES public.chart_of_accounts(id),
ADD COLUMN IF NOT EXISTS default_warehouse_id uuid REFERENCES public.branches(id),
ADD COLUMN IF NOT EXISTS barcode text,
ADD COLUMN IF NOT EXISTS sku text,
ADD COLUMN IF NOT EXISTS product_sub_type text DEFAULT 'general';

-- Add comment for clarity
COMMENT ON COLUMN public.products.inventory_account_id IS 'GL Account for inventory tracking';
COMMENT ON COLUMN public.products.expense_account_id IS 'GL Account for cost/expense tracking';
COMMENT ON COLUMN public.products.default_warehouse_id IS 'Default warehouse/branch for this product';
COMMENT ON COLUMN public.products.product_sub_type IS 'Sub-type: consumable, raw_material, etc.';