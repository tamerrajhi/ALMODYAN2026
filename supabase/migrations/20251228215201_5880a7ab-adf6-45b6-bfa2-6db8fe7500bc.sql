-- Add returned_qty column to purchase_invoice_lines
ALTER TABLE public.purchase_invoice_lines 
ADD COLUMN IF NOT EXISTS returned_qty NUMERIC DEFAULT 0;

-- Add return tracking columns to invoices
ALTER TABLE public.invoices 
ADD COLUMN IF NOT EXISTS total_returned_amount NUMERIC DEFAULT 0;

-- Create function to calculate available quantity for returns
CREATE OR REPLACE FUNCTION public.get_available_qty_for_return(
    p_original_invoice_id UUID,
    p_product_id UUID,
    p_exclude_return_id UUID DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    original_qty NUMERIC;
    total_returned NUMERIC;
BEGIN
    -- Get original quantity from the original invoice
    SELECT COALESCE(quantity, 0) INTO original_qty
    FROM purchase_invoice_lines
    WHERE invoice_id = p_original_invoice_id
    AND product_id = p_product_id
    LIMIT 1;
    
    IF original_qty IS NULL THEN
        RETURN 0;
    END IF;
    
    -- Calculate total already returned (excluding current return if editing)
    SELECT COALESCE(SUM(pil.quantity), 0) INTO total_returned
    FROM purchase_invoice_lines pil
    JOIN invoices i ON i.id = pil.invoice_id
    WHERE i.linked_invoice_id = p_original_invoice_id
    AND i.invoice_type = 'purchase_return'
    AND i.status != 'cancelled'
    AND pil.product_id = p_product_id
    AND (p_exclude_return_id IS NULL OR i.id != p_exclude_return_id);
    
    RETURN original_qty - total_returned;
END;
$$;

-- Create function to validate return quantity before insert/update
CREATE OR REPLACE FUNCTION public.validate_purchase_return_quantity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    linked_inv_id UUID;
    invoice_type_val TEXT;
    available_qty NUMERIC;
BEGIN
    -- Get invoice info
    SELECT invoice_type, linked_invoice_id 
    INTO invoice_type_val, linked_inv_id
    FROM invoices 
    WHERE id = NEW.invoice_id;
    
    -- Only validate for purchase returns with linked invoice
    IF invoice_type_val != 'purchase_return' OR linked_inv_id IS NULL THEN
        RETURN NEW;
    END IF;
    
    -- Get available quantity
    available_qty := get_available_qty_for_return(
        linked_inv_id, 
        NEW.product_id,
        CASE WHEN TG_OP = 'UPDATE' THEN NEW.invoice_id ELSE NULL END
    );
    
    -- Add back current line quantity if updating
    IF TG_OP = 'UPDATE' THEN
        available_qty := available_qty + OLD.quantity;
    END IF;
    
    -- Validate
    IF NEW.quantity > available_qty THEN
        RAISE EXCEPTION 'Cannot return quantity (%) greater than available (%). الكمية المطلوب إرجاعها (%) أكبر من الكمية المتاحة (%).', 
            NEW.quantity, available_qty, NEW.quantity, available_qty;
    END IF;
    
    RETURN NEW;
END;
$$;

-- Create trigger for validation
DROP TRIGGER IF EXISTS validate_purchase_return_qty_trigger ON purchase_invoice_lines;
CREATE TRIGGER validate_purchase_return_qty_trigger
    BEFORE INSERT OR UPDATE ON purchase_invoice_lines
    FOR EACH ROW
    EXECUTE FUNCTION validate_purchase_return_quantity();

-- Create function to update invoice balances after return changes
CREATE OR REPLACE FUNCTION public.update_invoice_after_purchase_return()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    linked_inv_id UUID;
    invoice_type_val TEXT;
    total_returns NUMERIC;
    original_total NUMERIC;
    paid_amt NUMERIC;
BEGIN
    -- Get the invoice details
    SELECT invoice_type, linked_invoice_id 
    INTO invoice_type_val, linked_inv_id
    FROM invoices 
    WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
    
    -- Only process for purchase returns with linked invoice
    IF invoice_type_val != 'purchase_return' OR linked_inv_id IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    
    -- Calculate total returns for the original invoice
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
    
    -- Update original invoice
    UPDATE invoices 
    SET 
        total_returned_amount = total_returns,
        remaining_amount = original_total - paid_amt - total_returns,
        updated_at = now()
    WHERE id = linked_inv_id;
    
    -- Update returned_qty in original invoice lines
    UPDATE purchase_invoice_lines pil
    SET returned_qty = (
        SELECT COALESCE(SUM(rl.quantity), 0)
        FROM purchase_invoice_lines rl
        JOIN invoices ri ON ri.id = rl.invoice_id
        WHERE ri.linked_invoice_id = linked_inv_id
        AND ri.invoice_type = 'purchase_return'
        AND ri.status != 'cancelled'
        AND rl.product_id = pil.product_id
    )
    WHERE pil.invoice_id = linked_inv_id;
    
    RETURN COALESCE(NEW, OLD);
END;
$$;

-- Create trigger to update balances after purchase return line changes
DROP TRIGGER IF EXISTS update_invoice_after_return_trigger ON purchase_invoice_lines;
CREATE TRIGGER update_invoice_after_return_trigger
    AFTER INSERT OR UPDATE OR DELETE ON purchase_invoice_lines
    FOR EACH ROW
    EXECUTE FUNCTION update_invoice_after_purchase_return();

-- Create function to calculate supplier balance
CREATE OR REPLACE FUNCTION public.get_supplier_balance(p_supplier_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    total_invoices NUMERIC;
    total_returns NUMERIC;
    total_payments NUMERIC;
BEGIN
    -- Total purchase invoices
    SELECT COALESCE(SUM(total_amount), 0) INTO total_invoices
    FROM invoices 
    WHERE supplier_id = p_supplier_id 
    AND invoice_type = 'purchase'
    AND status != 'cancelled';
    
    -- Total purchase returns
    SELECT COALESCE(SUM(total_amount), 0) INTO total_returns
    FROM invoices 
    WHERE supplier_id = p_supplier_id 
    AND invoice_type = 'purchase_return'
    AND status != 'cancelled';
    
    -- Total payments to supplier
    SELECT COALESCE(SUM(amount), 0) INTO total_payments
    FROM payments 
    WHERE supplier_id = p_supplier_id 
    AND payment_type = 'payment'
    AND status != 'cancelled';
    
    -- Balance = Invoices - Returns - Payments
    RETURN total_invoices - total_returns - total_payments;
END;
$$;

-- Also create a trigger on invoices level for when return invoice status changes
CREATE OR REPLACE FUNCTION public.update_linked_invoice_on_return_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    total_returns NUMERIC;
    original_total NUMERIC;
    paid_amt NUMERIC;
BEGIN
    -- Only process for purchase returns with linked invoice
    IF NEW.invoice_type != 'purchase_return' OR NEW.linked_invoice_id IS NULL THEN
        RETURN NEW;
    END IF;
    
    -- Calculate total returns for the original invoice
    SELECT COALESCE(SUM(i.total_amount), 0) INTO total_returns
    FROM invoices i
    WHERE i.linked_invoice_id = NEW.linked_invoice_id 
    AND i.invoice_type = 'purchase_return'
    AND i.status != 'cancelled';
    
    -- Get original invoice details
    SELECT total_amount, COALESCE(paid_amount, 0) 
    INTO original_total, paid_amt
    FROM invoices 
    WHERE id = NEW.linked_invoice_id;
    
    -- Update original invoice
    UPDATE invoices 
    SET 
        total_returned_amount = total_returns,
        remaining_amount = original_total - paid_amt - total_returns,
        updated_at = now()
    WHERE id = NEW.linked_invoice_id;
    
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_linked_invoice_on_return_trigger ON invoices;
CREATE TRIGGER update_linked_invoice_on_return_trigger
    AFTER INSERT OR UPDATE ON invoices
    FOR EACH ROW
    WHEN (NEW.invoice_type = 'purchase_return' AND NEW.linked_invoice_id IS NOT NULL)
    EXECUTE FUNCTION update_linked_invoice_on_return_change();