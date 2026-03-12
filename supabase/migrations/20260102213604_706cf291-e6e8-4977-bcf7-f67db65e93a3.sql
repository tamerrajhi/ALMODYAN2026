-- Create trigger to prevent updating invoices that are not drafts
CREATE OR REPLACE FUNCTION public.prevent_non_draft_invoice_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Only allow updates if the invoice is a draft, or if we're only updating zatca fields
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
      -- This is a ZATCA update or payment update, allow it
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
    
    RAISE EXCEPTION 'لا يمكن تعديل الفاتورة إلا في حالة المسودة. Invoice can only be edited when in draft status.';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger on invoices table
DROP TRIGGER IF EXISTS prevent_non_draft_invoice_update_trigger ON public.invoices;
CREATE TRIGGER prevent_non_draft_invoice_update_trigger
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_non_draft_invoice_update();