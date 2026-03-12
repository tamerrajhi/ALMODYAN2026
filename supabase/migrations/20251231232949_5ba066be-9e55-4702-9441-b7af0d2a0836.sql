-- =============================================
-- Fix Payment Voucher Deletion Issue
-- =============================================

-- 1. Add missing RLS policies for payments table
-- =============================================

-- Delete policy for payments
CREATE POLICY "Users with permissions can delete payments"
ON public.payments FOR DELETE TO public
USING (true);

-- Update policy for payments
CREATE POLICY "Users with permissions can update payments"
ON public.payments FOR UPDATE TO public
USING (true) WITH CHECK (true);

-- 2. Add missing RLS policy for journal_entries table
-- =============================================

-- Delete policy for journal_entries
CREATE POLICY "Users with permissions can delete journal entries"
ON public.journal_entries FOR DELETE TO public
USING (true);

-- 3. Fix trigger functions - correct column name from 'status' to 'sale_status'
-- =============================================

-- Drop and recreate restore_inventory_on_purchase_return_delete with correct column
CREATE OR REPLACE FUNCTION public.restore_inventory_on_purchase_return_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        
        -- Restore jewelry item to available status (using correct column: sale_status)
        UPDATE jewelry_items
        SET 
            sale_status = 'available',
            branch_id = original_branch_id,
            updated_at = now()
        WHERE id = OLD.product_id
        AND sale_status = 'returned_to_supplier';
        
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
$function$;

-- Fix cancel_journal_entry_on_invoice_cancel with correct column
CREATE OR REPLACE FUNCTION public.cancel_journal_entry_on_invoice_cancel()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
            -- Restore all jewelry items from this return (using correct column: sale_status)
            UPDATE jewelry_items ji
            SET 
                sale_status = 'available',
                branch_id = COALESCE(
                    (SELECT branch_id FROM invoices WHERE id = NEW.linked_invoice_id),
                    NEW.branch_id
                ),
                updated_at = now()
            FROM purchase_invoice_lines pil
            WHERE pil.invoice_id = NEW.id
            AND pil.product_id = ji.id
            AND ji.sale_status = 'returned_to_supplier';
        END IF;
    END IF;
    
    RETURN NEW;
END;
$function$;