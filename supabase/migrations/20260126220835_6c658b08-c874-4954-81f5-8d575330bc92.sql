-- P6-6X ROOT FIX: Allow void with metadata in single atomic UPDATE

-- B1) Fix invoices_posted_lock to allow status→voided WITH void metadata in same UPDATE
CREATE OR REPLACE FUNCTION public.invoices_posted_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_je_posted boolean;
BEGIN
  -- Check if invoice has a posted journal entry
  IF OLD.journal_entry_id IS NOT NULL THEN
    SELECT is_posted INTO v_je_posted
    FROM public.journal_entries
    WHERE id = OLD.journal_entry_id;
    
    IF v_je_posted = true THEN
      -- =====================================================
      -- CASE 1: Allow status change to 'voided' WITH void metadata
      -- This is the atomic void path from void_purchase_return_atomic
      -- =====================================================
      IF NEW.status = 'voided' AND OLD.status != 'voided' THEN
        -- Verify only void-related fields are changing (plus status)
        IF NEW.total_amount = OLD.total_amount
           AND NEW.subtotal = OLD.subtotal
           AND NEW.tax_amount = OLD.tax_amount
           AND NEW.discount_amount IS NOT DISTINCT FROM OLD.discount_amount
           AND NEW.customer_id IS NOT DISTINCT FROM OLD.customer_id
           AND NEW.supplier_id IS NOT DISTINCT FROM OLD.supplier_id
           AND NEW.branch_id IS NOT DISTINCT FROM OLD.branch_id
           AND NEW.journal_entry_id IS NOT DISTINCT FROM OLD.journal_entry_id
           AND NEW.invoice_number = OLD.invoice_number
           AND NEW.invoice_type = OLD.invoice_type
           AND NEW.invoice_date = OLD.invoice_date
        THEN
          RETURN NEW;
        END IF;
      END IF;
      
      -- =====================================================
      -- CASE 2: Allow payment/return cascade updates
      -- (paid_amount, remaining_amount, total_returned_amount)
      -- =====================================================
      IF NEW.paid_amount IS DISTINCT FROM OLD.paid_amount
         OR NEW.remaining_amount IS DISTINCT FROM OLD.remaining_amount
         OR NEW.total_returned_amount IS DISTINCT FROM OLD.total_returned_amount
      THEN
        IF NEW.total_amount = OLD.total_amount
           AND NEW.subtotal = OLD.subtotal
           AND NEW.tax_amount = OLD.tax_amount
           AND NEW.discount_amount IS NOT DISTINCT FROM OLD.discount_amount
           AND NEW.customer_id IS NOT DISTINCT FROM OLD.customer_id
           AND NEW.supplier_id IS NOT DISTINCT FROM OLD.supplier_id
           AND NEW.branch_id IS NOT DISTINCT FROM OLD.branch_id
           AND NEW.journal_entry_id IS NOT DISTINCT FROM OLD.journal_entry_id
           AND NEW.status = OLD.status
        THEN
          RETURN NEW;
        END IF;
      END IF;
      
      -- =====================================================
      -- CASE 3: Allow ZATCA field updates
      -- =====================================================
      IF NEW.zatca_status IS DISTINCT FROM OLD.zatca_status
         OR NEW.zatca_invoice_hash IS DISTINCT FROM OLD.zatca_invoice_hash
         OR NEW.zatca_qr_code IS DISTINCT FROM OLD.zatca_qr_code
         OR NEW.zatca_signed_xml IS DISTINCT FROM OLD.zatca_signed_xml
         OR NEW.zatca_cleared_xml IS DISTINCT FROM OLD.zatca_cleared_xml
         OR NEW.zatca_submitted_at IS DISTINCT FROM OLD.zatca_submitted_at
         OR NEW.zatca_response IS DISTINCT FROM OLD.zatca_response
      THEN
        IF NEW.total_amount = OLD.total_amount
           AND NEW.subtotal = OLD.subtotal
           AND NEW.tax_amount = OLD.tax_amount
           AND NEW.customer_id IS NOT DISTINCT FROM OLD.customer_id
           AND NEW.supplier_id IS NOT DISTINCT FROM OLD.supplier_id
           AND NEW.branch_id IS NOT DISTINCT FROM OLD.branch_id
        THEN
          RETURN NEW;
        END IF;
      END IF;
      
      -- =====================================================
      -- CASE 4: Allow void metadata updates for already voided/cancelled invoices
      -- =====================================================
      IF OLD.status IN ('cancelled', 'voided')
         AND NEW.status = OLD.status
         AND NEW.total_amount = OLD.total_amount
         AND NEW.subtotal = OLD.subtotal
         AND NEW.tax_amount = OLD.tax_amount
         AND NEW.journal_entry_id IS NOT DISTINCT FROM OLD.journal_entry_id
         AND NEW.branch_id IS NOT DISTINCT FROM OLD.branch_id
      THEN
        RETURN NEW;
      END IF;
      
      -- Block any other changes
      RAISE EXCEPTION 'POSTED_LOCKED: Cannot modify invoice after journal entry is posted. Use void operation instead.';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$function$;

-- B2) Fix prevent_non_draft_invoice_update to allow void transition + metadata
CREATE OR REPLACE FUNCTION public.prevent_non_draft_invoice_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Only allow updates if the invoice is a draft, or if we're only updating allowed fields
  IF OLD.status != 'draft' THEN
    -- =====================================================
    -- CASE 1: Allow transition to voided status with void metadata
    -- =====================================================
    IF NEW.status = 'voided' AND OLD.status != 'voided' THEN
      IF NEW.total_amount = OLD.total_amount
         AND NEW.subtotal = OLD.subtotal
         AND NEW.tax_amount = OLD.tax_amount
         AND NEW.discount_amount IS NOT DISTINCT FROM OLD.discount_amount
         AND NEW.customer_id IS NOT DISTINCT FROM OLD.customer_id
         AND NEW.supplier_id IS NOT DISTINCT FROM OLD.supplier_id
         AND NEW.branch_id IS NOT DISTINCT FROM OLD.branch_id
         AND NEW.journal_entry_id IS NOT DISTINCT FROM OLD.journal_entry_id
      THEN
        RETURN NEW;
      END IF;
    END IF;
    
    -- =====================================================
    -- CASE 2: Allow ZATCA/metadata updates (status unchanged, financials unchanged)
    -- =====================================================
    IF NEW.status = OLD.status 
       AND NEW.total_amount = OLD.total_amount
       AND NEW.subtotal = OLD.subtotal
       AND NEW.tax_amount = OLD.tax_amount
       AND NEW.discount_amount IS NOT DISTINCT FROM OLD.discount_amount
       AND NEW.customer_id IS NOT DISTINCT FROM OLD.customer_id
       AND NEW.branch_id IS NOT DISTINCT FROM OLD.branch_id
       AND NEW.invoice_date = OLD.invoice_date
       AND NEW.due_date IS NOT DISTINCT FROM OLD.due_date
       AND NEW.notes IS NOT DISTINCT FROM OLD.notes
    THEN
      RETURN NEW;
    END IF;
    
    -- =====================================================
    -- CASE 3: Allow payment-related field updates
    -- =====================================================
    IF NEW.paid_amount IS DISTINCT FROM OLD.paid_amount
       OR NEW.remaining_amount IS DISTINCT FROM OLD.remaining_amount
       OR NEW.total_returned_amount IS DISTINCT FROM OLD.total_returned_amount
       OR NEW.status IS DISTINCT FROM OLD.status
    THEN
      -- Allow payment status updates if core financials unchanged
      IF NEW.total_amount = OLD.total_amount
         AND NEW.subtotal = OLD.subtotal
         AND NEW.tax_amount = OLD.tax_amount
      THEN
        RETURN NEW;
      END IF;
    END IF;
    
    -- =====================================================
    -- CASE 4: Allow void metadata-only updates for cancelled/voided invoices
    -- =====================================================
    IF OLD.status IN ('cancelled', 'voided') 
       AND NEW.status = OLD.status
       AND NEW.total_amount = OLD.total_amount
       AND NEW.subtotal = OLD.subtotal
       AND NEW.tax_amount = OLD.tax_amount
       AND NEW.journal_entry_id IS NOT DISTINCT FROM OLD.journal_entry_id
    THEN
      RETURN NEW;
    END IF;
    
    RAISE EXCEPTION 'لا يمكن تعديل الفاتورة إلا في حالة المسودة. Invoice can only be edited when in draft status.';
  END IF;
  
  RETURN NEW;
END;
$function$;