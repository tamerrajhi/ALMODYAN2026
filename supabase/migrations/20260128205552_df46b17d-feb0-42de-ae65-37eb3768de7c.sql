-- ============================================================================
-- P-RTRN-GEN STEP 3: Lock triggers for General Purchase Returns
-- Prevents modification of confirmed/posted returns (header + lines)
-- ============================================================================

-- A1: Lock Header Trigger Function
-- Blocks sensitive field changes on confirmed/posted general returns
-- Allows: status transition to voided/cancelled + void metadata fields
CREATE OR REPLACE FUNCTION public.guard_posted_general_return()
RETURNS TRIGGER AS $$
BEGIN
  -- Only apply to general returns
  IF OLD.purchase_type = 'general' THEN
    -- Check if return is in locked state
    IF OLD.status IN ('confirmed', 'posted') THEN
      
      -- ALLOW: Status transition to voided/cancelled with void metadata
      IF (NEW.status IN ('voided', 'cancelled') 
          AND NEW.status IS DISTINCT FROM OLD.status) THEN
        -- Only allow status + void fields changes
        IF (NEW.purchase_invoice_id IS DISTINCT FROM OLD.purchase_invoice_id
            OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
            OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
            OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
            OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount
            OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
            OR NEW.purchase_type IS DISTINCT FROM OLD.purchase_type
            OR NEW.return_number IS DISTINCT FROM OLD.return_number) THEN
          RAISE EXCEPTION 'RETURN_LOCKED_CANNOT_MODIFY_POSTED_RETURN: % is locked', OLD.return_number;
        END IF;
        -- Allow the void/cancel transition
        RETURN NEW;
      END IF;
      
      -- BLOCK: Any sensitive field change when not voiding
      IF (NEW.purchase_invoice_id IS DISTINCT FROM OLD.purchase_invoice_id
          OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
          OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
          OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
          OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount
          OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
          OR NEW.purchase_type IS DISTINCT FROM OLD.purchase_type
          OR NEW.return_number IS DISTINCT FROM OLD.return_number) THEN
        RAISE EXCEPTION 'RETURN_LOCKED_CANNOT_MODIFY_POSTED_RETURN: % is locked', OLD.return_number;
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create header lock trigger
DROP TRIGGER IF EXISTS trg_lock_posted_general_return ON public.purchase_returns;
CREATE TRIGGER trg_lock_posted_general_return
  BEFORE UPDATE ON public.purchase_returns
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_posted_general_return();

-- ============================================================================
-- A2: Lock Lines Trigger Function
-- Blocks UPDATE/DELETE on lines when parent return is locked
-- ============================================================================
CREATE OR REPLACE FUNCTION public.guard_posted_return_lines()
RETURNS TRIGGER AS $$
DECLARE
  v_parent_status TEXT;
  v_parent_type TEXT;
BEGIN
  -- Get parent return status and type
  IF TG_OP = 'DELETE' THEN
    SELECT status, purchase_type INTO v_parent_status, v_parent_type
    FROM public.purchase_returns WHERE id = OLD.return_id;
  ELSE
    SELECT status, purchase_type INTO v_parent_status, v_parent_type
    FROM public.purchase_returns WHERE id = NEW.return_id;
  END IF;
  
  -- Only apply to general returns
  IF v_parent_type = 'general' THEN
    -- Check if parent is locked
    IF v_parent_status IN ('confirmed', 'posted') THEN
      
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'RETURN_LOCKED_CANNOT_MODIFY_POSTED_LINES: Cannot delete lines from locked return';
      END IF;
      
      -- UPDATE: Block sensitive field changes
      IF TG_OP = 'UPDATE' THEN
        IF (NEW.item_id IS DISTINCT FROM OLD.item_id
            OR NEW.quantity IS DISTINCT FROM OLD.quantity
            OR NEW.unit_cost IS DISTINCT FROM OLD.unit_cost
            OR NEW.vat_rate IS DISTINCT FROM OLD.vat_rate
            OR NEW.line_total IS DISTINCT FROM OLD.line_total
            OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount
            OR NEW.invoice_line_id IS DISTINCT FROM OLD.invoice_line_id
            OR NEW.purchase_invoice_id IS DISTINCT FROM OLD.purchase_invoice_id) THEN
          RAISE EXCEPTION 'RETURN_LOCKED_CANNOT_MODIFY_POSTED_LINES: Cannot modify lines in locked return';
        END IF;
      END IF;
    END IF;
  END IF;
  
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create lines lock triggers (UPDATE + DELETE)
DROP TRIGGER IF EXISTS trg_lock_posted_return_lines_u ON public.purchase_return_lines;
DROP TRIGGER IF EXISTS trg_lock_posted_return_lines_d ON public.purchase_return_lines;

CREATE TRIGGER trg_lock_posted_return_lines_u
  BEFORE UPDATE ON public.purchase_return_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_posted_return_lines();

CREATE TRIGGER trg_lock_posted_return_lines_d
  BEFORE DELETE ON public.purchase_return_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_posted_return_lines();

-- ============================================================================
-- Add comment for documentation
-- ============================================================================
COMMENT ON FUNCTION public.guard_posted_general_return() IS 
'P-RTRN-GEN STEP 3: Prevents modification of confirmed/posted general returns. Allows void/cancel path with status + void metadata only.';

COMMENT ON FUNCTION public.guard_posted_return_lines() IS 
'P-RTRN-GEN STEP 3: Prevents modification/deletion of lines on locked general returns.';