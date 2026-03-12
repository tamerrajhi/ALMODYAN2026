-- =====================================================
-- إصلاح دورة مرتجع المشتريات - استعادة المخزون والقيود عند الإلغاء/الحذف
-- Purchase Return Cycle Fix - Restore Inventory & Journal on Delete/Cancel
-- =====================================================

-- 1. إنشاء دالة لاستعادة المخزون عند حذف سطر مرتجع مشتريات
CREATE OR REPLACE FUNCTION public.restore_inventory_on_purchase_return_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    return_invoice_id UUID;
    invoice_type_val TEXT;
    original_branch_id UUID;
    linked_inv_id UUID;
    journal_entry_id UUID;
    item_code_val TEXT;
BEGIN
    -- Get the invoice details
    SELECT invoice_type, branch_id, linked_invoice_id, journal_entry_id 
    INTO invoice_type_val, original_branch_id, linked_inv_id, journal_entry_id
    FROM invoices 
    WHERE id = OLD.invoice_id;
    
    -- Only process for purchase returns
    IF invoice_type_val != 'purchase_return' THEN
        RETURN OLD;
    END IF;
    
    -- Restore jewelry item if it exists
    IF OLD.product_id IS NOT NULL THEN
        -- Get original branch from linked invoice if available
        IF linked_inv_id IS NOT NULL THEN
            SELECT branch_id INTO original_branch_id
            FROM invoices 
            WHERE id = linked_inv_id;
        END IF;
        
        -- Restore jewelry item to available status
        UPDATE jewelry_items
        SET 
            status = 'available',
            branch_id = original_branch_id,
            updated_at = now()
        WHERE id = OLD.product_id
        AND status = 'returned_to_supplier';
        
        -- Get item code for movement note
        SELECT item_code INTO item_code_val
        FROM jewelry_items
        WHERE id = OLD.product_id;
        
        -- Record cancellation movement
        INSERT INTO item_movements (
            item_id, 
            movement_type, 
            to_branch_id, 
            reference_type, 
            reference_id, 
            notes
        ) VALUES (
            OLD.product_id, 
            'PURCHASE_RETURN_CANCELLED', 
            original_branch_id,
            'purchase_return_cancelled', 
            OLD.invoice_id,
            'إلغاء مرتجع مشتريات - استعادة الصنف للمخزون: ' || COALESCE(item_code_val, OLD.product_code)
        );
    END IF;
    
    RETURN OLD;
END;
$$;

-- 2. إنشاء trigger لاستعادة المخزون عند حذف سطور المرتجع
DROP TRIGGER IF EXISTS restore_on_purchase_return_line_delete ON purchase_invoice_lines;

CREATE TRIGGER restore_on_purchase_return_line_delete
    BEFORE DELETE ON purchase_invoice_lines
    FOR EACH ROW
    EXECUTE FUNCTION restore_inventory_on_purchase_return_delete();

-- 3. إنشاء دالة لإلغاء القيد المحاسبي المرتبط بالمرتجع عند إلغائه
CREATE OR REPLACE FUNCTION public.cancel_journal_entry_on_invoice_cancel()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    je_id UUID;
BEGIN
    -- Only process if status changed to 'cancelled'
    IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' THEN
        -- Get journal entry ID
        SELECT journal_entry_id INTO je_id FROM invoices WHERE id = NEW.id;
        
        -- Mark journal entry as cancelled (soft delete)
        IF je_id IS NOT NULL THEN
            UPDATE journal_entries
            SET 
                is_posted = false,
                description = description || ' [ملغي - Cancelled]',
                updated_at = now()
            WHERE id = je_id;
        END IF;
        
        -- If this is a purchase return, restore inventory items
        IF NEW.invoice_type = 'purchase_return' THEN
            -- This will be handled by the restore_on_purchase_return_line_delete trigger
            -- when lines are deleted, but we also handle direct cancellation here
            
            -- Restore all jewelry items from this return
            UPDATE jewelry_items ji
            SET 
                status = 'available',
                branch_id = COALESCE(
                    (SELECT branch_id FROM invoices WHERE id = NEW.linked_invoice_id),
                    NEW.branch_id
                ),
                updated_at = now()
            FROM purchase_invoice_lines pil
            WHERE pil.invoice_id = NEW.id
            AND pil.product_id = ji.id
            AND ji.status = 'returned_to_supplier';
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$;

-- 4. إنشاء trigger لإلغاء القيد عند تغيير حالة الفاتورة
DROP TRIGGER IF EXISTS cancel_journal_on_invoice_cancel ON invoices;

CREATE TRIGGER cancel_journal_on_invoice_cancel
    AFTER UPDATE OF status ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION cancel_journal_entry_on_invoice_cancel();

-- 5. إضافة تحقق من حالة الفاتورة الأصلية قبل إنشاء المرتجع
CREATE OR REPLACE FUNCTION public.validate_return_original_invoice_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    original_status TEXT;
BEGIN
    -- Only validate for purchase returns with linked invoice
    IF NEW.invoice_type = 'purchase_return' AND NEW.linked_invoice_id IS NOT NULL THEN
        -- Check original invoice status
        SELECT status INTO original_status
        FROM invoices 
        WHERE id = NEW.linked_invoice_id;
        
        IF original_status = 'cancelled' THEN
            RAISE EXCEPTION 'لا يمكن إنشاء مرتجع من فاتورة ملغاة. Cannot create return from cancelled invoice.';
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$;

-- 6. إنشاء trigger للتحقق من حالة الفاتورة الأصلية
DROP TRIGGER IF EXISTS validate_return_original_invoice ON invoices;

CREATE TRIGGER validate_return_original_invoice
    BEFORE INSERT ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION validate_return_original_invoice_status();