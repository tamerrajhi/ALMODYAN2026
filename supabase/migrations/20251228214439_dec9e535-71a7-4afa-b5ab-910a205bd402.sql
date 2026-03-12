-- Add product_id column to sales_invoice_items for products from products table
ALTER TABLE public.sales_invoice_items 
ADD COLUMN product_id uuid REFERENCES public.products(id);

-- Add index for better query performance
CREATE INDEX idx_sales_invoice_items_product_id ON public.sales_invoice_items(product_id);

-- Add is_service column to track if the item is a service (no inventory impact)
ALTER TABLE public.sales_invoice_items 
ADD COLUMN is_service boolean DEFAULT false;

-- Add comment for documentation
COMMENT ON COLUMN public.sales_invoice_items.product_id IS 'References products from the products table (non-jewelry items)';
COMMENT ON COLUMN public.sales_invoice_items.is_service IS 'Indicates if the item is a service (no inventory impact)';