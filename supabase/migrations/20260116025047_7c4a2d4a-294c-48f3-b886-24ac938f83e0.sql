-- ============================================================
-- Purchase Type System: Automatic Local vs Import Classification
-- ============================================================

-- 1. Add purchase_type column to purchase_invoices
ALTER TABLE public.invoices 
ADD COLUMN IF NOT EXISTS purchase_type TEXT;

-- 2. Set default value for existing invoices (backward compatibility)
UPDATE public.invoices 
SET purchase_type = 'local' 
WHERE invoice_type IN ('purchase', 'purchase_return') 
AND purchase_type IS NULL;

-- 3. Add NOT NULL constraint after setting defaults
ALTER TABLE public.invoices 
ALTER COLUMN purchase_type SET DEFAULT 'local';

-- 4. Add CHECK constraint for valid values
ALTER TABLE public.invoices 
ADD CONSTRAINT check_purchase_type_values 
CHECK (
  -- Only enforce for purchase-related invoices
  (invoice_type NOT IN ('purchase', 'purchase_return')) 
  OR 
  (purchase_type IN ('local', 'import'))
);

-- 5. Add purchase_type to purchase_returns table for inheritance tracking
ALTER TABLE public.purchase_returns 
ADD COLUMN IF NOT EXISTS purchase_type TEXT;

-- 6. Backfill purchase_returns from their original invoices
UPDATE public.purchase_returns pr
SET purchase_type = COALESCE(
  (SELECT i.purchase_type FROM public.invoices i WHERE i.id = pr.purchase_invoice_id),
  'local'
)
WHERE pr.purchase_type IS NULL;

-- 7. Add default and constraint to purchase_returns
ALTER TABLE public.purchase_returns 
ALTER COLUMN purchase_type SET DEFAULT 'local';

ALTER TABLE public.purchase_returns 
ADD CONSTRAINT check_purchase_return_type_values 
CHECK (purchase_type IN ('local', 'import'));

-- 8. Add index for efficient filtering
CREATE INDEX IF NOT EXISTS idx_invoices_purchase_type 
ON public.invoices(purchase_type) 
WHERE invoice_type IN ('purchase', 'purchase_return');

-- 9. Create trigger to prevent purchase_type modification after creation
CREATE OR REPLACE FUNCTION public.prevent_purchase_type_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Only check for purchase-related invoices
  IF OLD.invoice_type IN ('purchase', 'purchase_return') THEN
    IF OLD.purchase_type IS DISTINCT FROM NEW.purchase_type THEN
      RAISE EXCEPTION 'PURCHASE_TYPE_IMMUTABLE: Cannot change purchase_type after invoice creation. Original: %, Attempted: %', 
        OLD.purchase_type, NEW.purchase_type;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public, extensions;

DROP TRIGGER IF EXISTS trg_prevent_purchase_type_change ON public.invoices;
CREATE TRIGGER trg_prevent_purchase_type_change
BEFORE UPDATE ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.prevent_purchase_type_change();

-- 10. Create trigger for purchase_returns to prevent type change
CREATE OR REPLACE FUNCTION public.prevent_purchase_return_type_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.purchase_type IS DISTINCT FROM NEW.purchase_type THEN
    RAISE EXCEPTION 'PURCHASE_TYPE_IMMUTABLE: Cannot change purchase_type after return creation. Original: %, Attempted: %', 
      OLD.purchase_type, NEW.purchase_type;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public, extensions;

DROP TRIGGER IF EXISTS trg_prevent_purchase_return_type_change ON public.purchase_returns;
CREATE TRIGGER trg_prevent_purchase_return_type_change
BEFORE UPDATE ON public.purchase_returns
FOR EACH ROW
EXECUTE FUNCTION public.prevent_purchase_return_type_change();

-- 11. Create function to auto-inherit purchase_type for returns
CREATE OR REPLACE FUNCTION public.auto_inherit_purchase_type_for_return()
RETURNS TRIGGER AS $$
DECLARE
  v_purchase_type TEXT;
BEGIN
  -- Get purchase_type from original invoice
  SELECT purchase_type INTO v_purchase_type
  FROM public.invoices
  WHERE id = NEW.purchase_invoice_id;
  
  -- If original invoice exists, inherit its type
  IF v_purchase_type IS NOT NULL THEN
    NEW.purchase_type := v_purchase_type;
  ELSE
    -- Default to local if somehow no invoice found
    NEW.purchase_type := COALESCE(NEW.purchase_type, 'local');
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public, extensions;

DROP TRIGGER IF EXISTS trg_auto_inherit_purchase_type ON public.purchase_returns;
CREATE TRIGGER trg_auto_inherit_purchase_type
BEFORE INSERT ON public.purchase_returns
FOR EACH ROW
EXECUTE FUNCTION public.auto_inherit_purchase_type_for_return();

-- 12. Add comment for documentation
COMMENT ON COLUMN public.invoices.purchase_type IS 
'Type of purchase invoice: local (manual creation) or import (Excel import). Automatically determined at creation, immutable after.';

COMMENT ON COLUMN public.purchase_returns.purchase_type IS 
'Inherited from original purchase invoice. Cannot be changed manually.';