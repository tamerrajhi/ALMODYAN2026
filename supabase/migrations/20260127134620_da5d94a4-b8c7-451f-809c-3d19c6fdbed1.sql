-- ============================================================
-- P-PURCH-D2-3: POST-CUTOVER LOCKDOWN
-- Prevent future creation of invoices mirror for general returns
-- ============================================================

-- B1) Create trigger function to block general return mirrors
CREATE OR REPLACE FUNCTION public.block_general_return_invoice_mirror()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Block INSERT of invoice_type='purchase_return' AND purchase_type='general'
  -- Only import track is allowed to create invoices mirror
  IF NEW.invoice_type = 'purchase_return' AND NEW.purchase_type = 'general' THEN
    RAISE EXCEPTION 'GENERAL_RETURN_LOCKDOWN: General purchase returns must use canonical tables (purchase_returns + purchase_return_lines). Invoice mirror creation is blocked.';
  END IF;
  
  RETURN NEW;
END;
$$;

-- B1.2) Create trigger on invoices to enforce the lockdown
DROP TRIGGER IF EXISTS trg_block_general_return_mirror ON public.invoices;
CREATE TRIGGER trg_block_general_return_mirror
  BEFORE INSERT ON public.invoices
  FOR EACH ROW
  WHEN (NEW.invoice_type = 'purchase_return' AND NEW.purchase_type = 'general')
  EXECUTE FUNCTION public.block_general_return_invoice_mirror();

-- Add comment for documentation
COMMENT ON TRIGGER trg_block_general_return_mirror ON public.invoices IS 
  'D2-3 Lockdown: Prevents creation of invoice mirror for general purchase returns. General returns must use canonical purchase_returns + purchase_return_lines tables only.';