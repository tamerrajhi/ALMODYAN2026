-- P6-5 CLOSEOUT: Trigger Refinement + Legacy Void Metadata Backfill
-- =====================================================
-- Strategy: Disable blocking trigger during backfill, then restore

-- B1a) Refine prevent_non_draft_invoice_update to allow void metadata updates
CREATE OR REPLACE FUNCTION public.prevent_non_draft_invoice_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Only allow updates if the invoice is a draft, or if we're only updating allowed fields
  IF OLD.status != 'draft' THEN
    -- Allow updates to zatca fields only
    IF NEW.status = OLD.status 
       AND NEW.total_amount = OLD.total_amount
       AND NEW.subtotal = OLD.subtotal
       AND NEW.tax_amount = OLD.tax_amount
       AND NEW.discount_amount = OLD.discount_amount
       AND NEW.customer_id IS NOT DISTINCT FROM OLD.customer_id
       AND NEW.branch_id IS NOT DISTINCT FROM OLD.branch_id
       AND NEW.invoice_date = OLD.invoice_date
       AND NEW.due_date IS NOT DISTINCT FROM OLD.due_date
       AND NEW.notes IS NOT DISTINCT FROM OLD.notes
    THEN
      -- This is a ZATCA update, void metadata update, or payment update - allow it
      RETURN NEW;
    END IF;
    
    -- Check if only payment-related fields are being updated
    IF NEW.paid_amount IS DISTINCT FROM OLD.paid_amount
       OR NEW.remaining_amount IS DISTINCT FROM OLD.remaining_amount
       OR NEW.status IS DISTINCT FROM OLD.status
    THEN
      -- Allow payment status updates
      RETURN NEW;
    END IF;
    
    -- Allow void metadata-only updates for cancelled/voided invoices
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

-- B1b) Refine invoices_posted_lock to also allow cascading updates
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
      -- Allow status change to 'voided' (via void RPC)
      IF NEW.status = 'voided' AND OLD.status != 'voided' THEN
        RETURN NEW;
      END IF;
      
      -- Allow payment/return cascade updates (paid_amount, remaining_amount, total_returned_amount)
      IF NEW.paid_amount IS DISTINCT FROM OLD.paid_amount
         OR NEW.remaining_amount IS DISTINCT FROM OLD.remaining_amount
         OR NEW.total_returned_amount IS DISTINCT FROM OLD.total_returned_amount
      THEN
        IF NEW.total_amount = OLD.total_amount
           AND NEW.subtotal = OLD.subtotal
           AND NEW.tax_amount = OLD.tax_amount
           AND NEW.discount_amount IS NOT DISTINCT FROM OLD.discount_amount
           AND NEW.customer_id IS NOT DISTINCT FROM OLD.customer_id
           AND NEW.branch_id IS NOT DISTINCT FROM OLD.branch_id
           AND NEW.journal_entry_id IS NOT DISTINCT FROM OLD.journal_entry_id
           AND NEW.status = OLD.status
        THEN
          RETURN NEW;
        END IF;
      END IF;
      
      -- Allow ZATCA field updates
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
           AND NEW.branch_id IS NOT DISTINCT FROM OLD.branch_id
        THEN
          RETURN NEW;
        END IF;
      END IF;
      
      -- Allow void metadata updates for already voided/cancelled invoices
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

-- B2) Temporarily disable blocking triggers for backfill
ALTER TABLE public.invoices DISABLE TRIGGER trg_invoices_posted_lock;
ALTER TABLE public.invoices DISABLE TRIGGER prevent_non_draft_invoice_update_trigger;
ALTER TABLE public.invoices DISABLE TRIGGER update_linked_invoice_on_return_trigger;

-- B3) Backfill the 2 legacy general returns with void metadata
UPDATE public.invoices
SET
  voided_at = COALESCE(voided_at, updated_at, now()),
  void_reason = COALESCE(void_reason, 'Legacy cancellation backfill (pre-governance)'),
  updated_at = now()
WHERE id IN (
  'bd6a6667-85fd-414b-b73b-59feac49a2c9',
  'f6403a46-a758-436b-ac56-5f6ca9e64a1d'
)
AND (voided_at IS NULL OR void_reason IS NULL);

-- B4) Re-enable all triggers
ALTER TABLE public.invoices ENABLE TRIGGER trg_invoices_posted_lock;
ALTER TABLE public.invoices ENABLE TRIGGER prevent_non_draft_invoice_update_trigger;
ALTER TABLE public.invoices ENABLE TRIGGER update_linked_invoice_on_return_trigger;