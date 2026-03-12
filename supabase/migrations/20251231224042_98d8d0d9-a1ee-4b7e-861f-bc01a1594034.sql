-- Fix get_available_qty_for_return to use flexible matching (product_id, product_code, or line_number)
CREATE OR REPLACE FUNCTION public.get_available_qty_for_return(
    p_original_invoice_id UUID,
    p_product_id UUID,
    p_product_code TEXT DEFAULT NULL,
    p_line_number INTEGER DEFAULT NULL,
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
    -- Get original quantity using flexible matching
    SELECT COALESCE(quantity, 0) INTO original_qty
    FROM purchase_invoice_lines
    WHERE invoice_id = p_original_invoice_id
    AND (
        (p_product_id IS NOT NULL AND product_id = p_product_id)
        OR (p_product_id IS NULL AND p_product_code IS NOT NULL AND product_code = p_product_code)
        OR (p_product_id IS NULL AND p_product_code IS NULL AND p_line_number IS NOT NULL AND line_number = p_line_number)
    )
    LIMIT 1;
    
    IF original_qty IS NULL THEN
        RETURN 0;
    END IF;
    
    -- Calculate total already returned using same flexible matching
    SELECT COALESCE(SUM(pil.quantity), 0) INTO total_returned
    FROM purchase_invoice_lines pil
    JOIN invoices i ON i.id = pil.invoice_id
    WHERE i.linked_invoice_id = p_original_invoice_id
    AND i.invoice_type = 'purchase_return'
    AND i.status != 'cancelled'
    AND (
        (p_product_id IS NOT NULL AND pil.product_id = p_product_id)
        OR (p_product_id IS NULL AND p_product_code IS NOT NULL AND pil.product_code = p_product_code)
        OR (p_product_id IS NULL AND p_product_code IS NULL AND p_line_number IS NOT NULL AND pil.line_number = p_line_number)
    )
    AND (p_exclude_return_id IS NULL OR i.id != p_exclude_return_id);
    
    RETURN original_qty - total_returned;
END;
$$;

-- Fix validate_purchase_return_quantity to pass product_code and line_number
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
    
    -- Get available quantity using flexible matching
    available_qty := get_available_qty_for_return(
        linked_inv_id, 
        NEW.product_id,
        NEW.product_code,
        NEW.line_number,
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

-- Fix update_invoice_after_purchase_return to use flexible matching
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
    
    -- Update returned_qty in original invoice lines using flexible matching
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
    
    RETURN COALESCE(NEW, OLD);
END;
$$;