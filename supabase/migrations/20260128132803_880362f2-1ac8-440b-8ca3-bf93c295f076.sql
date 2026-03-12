-- ============================================================
-- D2-5.1 B1: Recalc returned_qty when purchase_returns.status changes (GENERAL)
-- Gap: current trigger only fires on purchase_return_lines changes,
-- not when header status changes to voided/cancelled
-- ============================================================

-- B1-1) Create function to recalculate returned_qty for general return status changes
CREATE OR REPLACE FUNCTION public.recalc_returned_qty_on_general_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_invoice_line_id uuid;
  v_new_returned_qty numeric;
BEGIN
  -- Only process general returns
  IF NEW.purchase_type != 'general' THEN
    RETURN NEW;
  END IF;
  
  -- Only recalc if status changed to/from voided/cancelled
  IF NOT (
    (NEW.status IN ('voided', 'cancelled') AND OLD.status NOT IN ('voided', 'cancelled'))
    OR 
    (OLD.status IN ('voided', 'cancelled') AND NEW.status NOT IN ('voided', 'cancelled'))
  ) THEN
    RETURN NEW;
  END IF;
  
  -- Recalculate returned_qty for all invoice lines linked to this return's lines
  FOR v_invoice_line_id IN 
    SELECT DISTINCT prl.invoice_line_id
    FROM public.purchase_return_lines prl
    WHERE prl.return_id = NEW.id
      AND prl.invoice_line_id IS NOT NULL
  LOOP
    -- Calculate total returned quantity from ALL canonical general return lines
    SELECT COALESCE(SUM(prl.quantity), 0)
    INTO v_new_returned_qty
    FROM public.purchase_return_lines prl
    JOIN public.purchase_returns pr ON pr.id = prl.return_id
    WHERE prl.invoice_line_id = v_invoice_line_id
      AND pr.purchase_type = 'general'
      AND pr.status NOT IN ('voided', 'cancelled');
    
    -- Update the original purchase invoice line's returned_qty
    UPDATE public.purchase_invoice_lines
    SET returned_qty = v_new_returned_qty,
        updated_at = now()
    WHERE id = v_invoice_line_id;
  END LOOP;
  
  RETURN NEW;
END;
$$;

-- B1-2) Create trigger on purchase_returns for status changes
DROP TRIGGER IF EXISTS trg_recalc_returned_qty_on_return_status ON public.purchase_returns;

CREATE TRIGGER trg_recalc_returned_qty_on_return_status
AFTER UPDATE OF status ON public.purchase_returns
FOR EACH ROW
WHEN (
  OLD.status IS DISTINCT FROM NEW.status
  AND (
    NEW.status IN ('voided', 'cancelled') 
    OR OLD.status IN ('voided', 'cancelled')
  )
)
EXECUTE FUNCTION public.recalc_returned_qty_on_general_status_change();

-- Add comment for governance
COMMENT ON FUNCTION public.recalc_returned_qty_on_general_status_change() IS 
  'D2-5.1 B1: Recalculates returned_qty on purchase_invoice_lines when a general purchase_return status changes to/from voided/cancelled. Does NOT touch public.invoices.';

COMMENT ON TRIGGER trg_recalc_returned_qty_on_return_status ON public.purchase_returns IS 
  'D2-5.1 B1: Fires when status changes to/from voided/cancelled to recalculate returned_qty on invoice lines.';