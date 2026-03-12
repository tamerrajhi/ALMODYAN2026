-- STEP 1: Purchase Type Rename Migration (local → general)

-- A) Defensive data update (should be 0 rows, but safe)
UPDATE public.invoices SET purchase_type = 'general' WHERE purchase_type = 'local';
UPDATE public.purchase_returns SET purchase_type = 'general' WHERE purchase_type = 'local';

-- B) Update default value
ALTER TABLE public.invoices ALTER COLUMN purchase_type SET DEFAULT 'general';

-- C) Drop old constraints
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS check_purchase_type_values;
ALTER TABLE public.purchase_returns DROP CONSTRAINT IF EXISTS check_purchase_return_type_values;

-- D) Recreate constraints with 'general' instead of 'local'
ALTER TABLE public.invoices 
ADD CONSTRAINT check_purchase_type_values 
CHECK (
  (invoice_type NOT IN ('purchase', 'purchase_return')) 
  OR (purchase_type IN ('general', 'import'))
);

ALTER TABLE public.purchase_returns 
ADD CONSTRAINT check_purchase_return_type_values 
CHECK (purchase_type IN ('general', 'import'));