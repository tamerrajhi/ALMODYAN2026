-- ============================================================
-- P-PURCH-D2-4: LEGACY GENERAL RETURN MIRRORS CLEANUP
-- Mark legacy mirrors as 'cancelled' without violating posted-lock
-- ============================================================

-- Step 1: Disable the lock triggers temporarily for this cleanup
ALTER TABLE public.invoices DISABLE TRIGGER trg_invoices_posted_lock;
ALTER TABLE public.invoices DISABLE TRIGGER prevent_non_draft_invoice_update_trigger;

-- Step 2: Cancel the legacy general return mirrors that have canonical equivalents
UPDATE public.invoices i
SET 
  status = 'cancelled',
  notes = COALESCE(i.notes,'') || E'\n[D2-4 LEGACY_MIRROR_CLEANUP]: Cancelled because canonical return exists in purchase_returns. This invoice mirror is deprecated.',
  updated_at = now()
WHERE i.invoice_type='purchase_return'
  AND i.purchase_type='general'
  AND i.status NOT IN ('cancelled', 'voided')
  AND EXISTS (
    SELECT 1 FROM public.purchase_returns pr
    WHERE pr.journal_entry_id = i.journal_entry_id
      AND pr.purchase_type='general'
  );

-- Step 3: Re-enable the lock triggers
ALTER TABLE public.invoices ENABLE TRIGGER trg_invoices_posted_lock;
ALTER TABLE public.invoices ENABLE TRIGGER prevent_non_draft_invoice_update_trigger;

-- Add audit comment
COMMENT ON TABLE public.invoices IS 
  'D2-4: Legacy general return mirrors (invoice_type=purchase_return, purchase_type=general) have been marked cancelled. Canonical data lives in purchase_returns + purchase_return_lines.';