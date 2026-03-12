-- =====================================================
-- RADICAL FIX: Bypass quantity validation for Unique Returns
-- Problem: validate_purchase_return_quantity trigger blocks unique returns 
-- because Excel imports have IMPORT-SUMMARY line with NULL product_id
-- Solution: Detect unique returns and validate from jewelry_items instead
-- =====================================================

CREATE OR REPLACE FUNCTION public.validate_purchase_return_quantity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    linked_inv_id UUID;
    invoice_type_val TEXT;
    available_qty NUMERIC;
    is_unique_item_return BOOLEAN := FALSE;
    v_item_status TEXT;
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
    
    -- ========== UNIQUE RETURN BYPASS ==========
    -- Check if product_id is actually a jewelry_item linked to this invoice
    -- This happens for Excel-imported invoices where items are tracked individually
    SELECT EXISTS(
        SELECT 1 FROM jewelry_items ji
        WHERE ji.id = NEW.product_id
        AND ji.purchase_invoice_id = linked_inv_id
    ) INTO is_unique_item_return;
    
    IF is_unique_item_return THEN
        -- For unique returns, validate item status instead of quantity
        SELECT sale_status INTO v_item_status
        FROM jewelry_items
        WHERE id = NEW.product_id
        AND purchase_invoice_id = linked_inv_id;
        
        IF v_item_status IS NULL THEN
            RAISE EXCEPTION 'Item not found for this invoice. القطعة غير موجودة في هذه الفاتورة.';
        END IF;
        
        IF v_item_status != 'available' THEN
            RAISE EXCEPTION 'Item not available for return (status: %). القطعة غير متاحة للإرجاع (الحالة: %).', v_item_status, v_item_status;
        END IF;
        
        -- Bypass quantity check - unique items are validated by status
        RETURN NEW;
    END IF;
    -- ========== END UNIQUE RETURN BYPASS ==========
    
    -- Original logic for General Returns
    -- Calculate available quantity for this product in the original invoice
    SELECT COALESCE(
        (SELECT SUM(pil.quantity) 
         FROM purchase_invoice_lines pil 
         WHERE pil.invoice_id = linked_inv_id 
         AND pil.product_id = NEW.product_id), 0
    ) - COALESCE(
        (SELECT SUM(pil2.quantity) 
         FROM purchase_invoice_lines pil2 
         JOIN invoices inv ON pil2.invoice_id = inv.id 
         WHERE inv.linked_invoice_id = linked_inv_id 
         AND inv.invoice_type = 'purchase_return'
         AND inv.id != NEW.invoice_id
         AND pil2.product_id = NEW.product_id), 0
    ) INTO available_qty;
    
    IF NEW.quantity > available_qty THEN
        RAISE EXCEPTION 'Cannot return quantity (%) greater than available (%). لا يمكن إرجاع كمية (%) أكبر من المتاح (%).', 
            NEW.quantity, available_qty, NEW.quantity, available_qty;
    END IF;
    
    RETURN NEW;
END;
$$;

-- Add comment for documentation
COMMENT ON FUNCTION public.validate_purchase_return_quantity() IS 
'Validates purchase return quantities. For unique items (jewelry from Excel imports), validates by sale_status. For general items, validates by available quantity.';