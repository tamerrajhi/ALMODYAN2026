-- D2-5.4: Fix updated_at column reference in sync triggers
-- Remove references to non-existent updated_at column in purchase_invoice_lines

-- 1. Fix sync_returned_qty_from_canonical_lines function
CREATE OR REPLACE FUNCTION public.sync_returned_qty_from_canonical_lines()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_line_id uuid;
  v_new_returned_qty numeric;
  v_return_record RECORD;
BEGIN
  -- Determine which invoice_line_id to update based on the operation
  IF TG_OP = 'DELETE' THEN
    v_invoice_line_id := OLD.invoice_line_id;
  ELSE
    v_invoice_line_id := NEW.invoice_line_id;
  END IF;

  -- Skip if no invoice_line_id
  IF v_invoice_line_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  -- Get the return record to check status
  IF TG_OP = 'DELETE' THEN
    SELECT pr.* INTO v_return_record
    FROM public.purchase_returns pr
    WHERE pr.id = OLD.purchase_return_id;
  ELSE
    SELECT pr.* INTO v_return_record
    FROM public.purchase_returns pr
    WHERE pr.id = NEW.purchase_return_id;
  END IF;

  -- Only sync if return is not voided/cancelled
  IF v_return_record.status IN ('voided', 'cancelled') THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  -- Calculate new returned_qty from all active return lines
  SELECT COALESCE(SUM(prl.quantity), 0) INTO v_new_returned_qty
  FROM public.purchase_return_lines prl
  JOIN public.purchase_returns pr ON pr.id = prl.purchase_return_id
  WHERE prl.invoice_line_id = v_invoice_line_id
    AND pr.status NOT IN ('voided', 'cancelled');

  -- Update the invoice line (removed updated_at - column does not exist)
  UPDATE public.purchase_invoice_lines
  SET returned_qty = v_new_returned_qty
  WHERE id = v_invoice_line_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

-- 2. Fix recalc_returned_qty_on_general_status_change function
CREATE OR REPLACE FUNCTION public.recalc_returned_qty_on_general_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line RECORD;
  v_new_returned_qty numeric;
BEGIN
  -- Only process if status changed to voided or cancelled
  IF NEW.status IN ('voided', 'cancelled') AND OLD.status NOT IN ('voided', 'cancelled') THEN
    -- Recalculate returned_qty for all invoice lines affected by this return
    FOR v_line IN
      SELECT DISTINCT prl.invoice_line_id
      FROM public.purchase_return_lines prl
      WHERE prl.purchase_return_id = NEW.id
        AND prl.invoice_line_id IS NOT NULL
    LOOP
      -- Calculate new returned_qty excluding voided/cancelled returns
      SELECT COALESCE(SUM(prl.quantity), 0) INTO v_new_returned_qty
      FROM public.purchase_return_lines prl
      JOIN public.purchase_returns pr ON pr.id = prl.purchase_return_id
      WHERE prl.invoice_line_id = v_line.invoice_line_id
        AND pr.status NOT IN ('voided', 'cancelled');

      -- Update the invoice line (removed updated_at - column does not exist)
      UPDATE public.purchase_invoice_lines
      SET returned_qty = v_new_returned_qty
      WHERE id = v_line.invoice_line_id;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

-- Add comments for documentation
COMMENT ON FUNCTION public.sync_returned_qty_from_canonical_lines() IS 
'D2-5.4: Syncs returned_qty on purchase_invoice_lines from purchase_return_lines. Fixed to remove updated_at reference.';

COMMENT ON FUNCTION public.recalc_returned_qty_on_general_status_change() IS 
'D2-5.4: Recalculates returned_qty when a purchase return is voided/cancelled. Fixed to remove updated_at reference.';