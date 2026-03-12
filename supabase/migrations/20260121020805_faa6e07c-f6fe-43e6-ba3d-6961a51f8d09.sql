-- =====================================================
-- Fix: Void/Cancel should recalculate returned_qty on invoice lines
-- Gate Test 12 revealed that cancelling a return does NOT update returned_qty
-- =====================================================

-- Create or replace the trigger function to also update returned_qty on status change
CREATE OR REPLACE FUNCTION public.update_linked_invoice_on_return_change()
RETURNS TRIGGER AS $$
DECLARE
    total_returns NUMERIC;
    original_total NUMERIC;
    paid_amt NUMERIC;
    linked_inv_id UUID;
BEGIN
    -- Only process for purchase returns with linked invoice
    IF NEW.invoice_type != 'purchase_return' OR NEW.linked_invoice_id IS NULL THEN
        RETURN NEW;
    END IF;
    
    linked_inv_id := NEW.linked_invoice_id;
    
    -- Calculate total returns for the original invoice (excluding cancelled)
    SELECT COALESCE(SUM(i.total_amount), 0) INTO total_returns
    FROM invoices i
    WHERE i.linked_invoice_id = linked_inv_id 
    AND i.invoice_type = 'purchase_return'
    AND i.status != 'cancelled';
    
    -- Get original invoice details
    SELECT total_amount, COALESCE(paid_amount, 0) 
    INTO original_total, paid_amt
    FROM invoices 
    WHERE id = linked_inv_id;
    
    -- Update original invoice header
    UPDATE invoices 
    SET 
        total_returned_amount = total_returns,
        remaining_amount = original_total - paid_amt - total_returns,
        updated_at = now()
    WHERE id = linked_inv_id;
    
    -- =====================================================
    -- FIX: Also recalculate returned_qty on original invoice lines
    -- This handles the case when a return is cancelled/voided
    -- =====================================================
    UPDATE purchase_invoice_lines pil
    SET returned_qty = (
        SELECT COALESCE(SUM(rl.quantity), 0)
        FROM purchase_invoice_lines rl
        JOIN invoices ri ON ri.id = rl.invoice_id
        WHERE ri.linked_invoice_id = linked_inv_id
        AND ri.invoice_type = 'purchase_return'
        AND ri.status != 'cancelled'
        AND (
            (pil.product_id IS NOT NULL AND rl.product_id = pil.product_id)
            OR (pil.product_id IS NULL AND pil.product_code IS NOT NULL AND rl.product_code = pil.product_code)
            OR (pil.product_id IS NULL AND pil.product_code IS NULL AND rl.line_number = pil.line_number)
        )
    )
    WHERE pil.invoice_id = linked_inv_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Ensure trigger fires on UPDATE (including status change)
DROP TRIGGER IF EXISTS update_linked_invoice_on_return_trigger ON public.invoices;

CREATE TRIGGER update_linked_invoice_on_return_trigger
AFTER INSERT OR UPDATE ON public.invoices
FOR EACH ROW
WHEN (NEW.invoice_type = 'purchase_return' AND NEW.linked_invoice_id IS NOT NULL)
EXECUTE FUNCTION update_linked_invoice_on_return_change();

-- =====================================================
-- Repair: Fix the orphan JE (JE-20260121-0002) which is a void entry
-- =====================================================
-- First, let's see what it's about
-- Since it's a void entry with 0 lines, we should either:
-- 1. Delete it if the void was incomplete
-- 2. Or mark it as a known legacy issue

-- For now, we'll repair by adding reversal lines if possible
-- or mark for manual review