-- =====================================================================
-- P4-8: ERP Sales Invoice Hardening - Comprehensive Migration
-- Date: 2026-01-24
-- Steps: RLS Fix + Void Columns + Posted Lock + Void RPC
-- =====================================================================

-- =====================================================================
-- STEP 1: Fix sales_invoice_items RLS (remove permissive TRUE)
-- =====================================================================

-- Drop existing permissive TRUE policies
DROP POLICY IF EXISTS "Users can view sales invoice items" ON public.sales_invoice_items;
DROP POLICY IF EXISTS "Users can insert sales invoice items" ON public.sales_invoice_items;
DROP POLICY IF EXISTS "Users can update sales invoice items" ON public.sales_invoice_items;
DROP POLICY IF EXISTS "Users can delete sales invoice items" ON public.sales_invoice_items;

-- Ensure RLS is enabled
ALTER TABLE public.sales_invoice_items ENABLE ROW LEVEL SECURITY;

-- Create branch-scoped policies via parent invoice
CREATE POLICY "Users can view sales invoice items in their branches"
ON public.sales_invoice_items FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = sales_invoice_items.invoice_id
    AND i.branch_id = ANY(get_user_branches(auth.uid()))
  )
);

CREATE POLICY "Users can insert sales invoice items in their branches"
ON public.sales_invoice_items FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = sales_invoice_items.invoice_id
    AND i.branch_id = ANY(get_user_branches(auth.uid()))
  )
);

CREATE POLICY "Users can update sales invoice items in their branches"
ON public.sales_invoice_items FOR UPDATE
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = sales_invoice_items.invoice_id
    AND i.branch_id = ANY(get_user_branches(auth.uid()))
  )
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = sales_invoice_items.invoice_id
    AND i.branch_id = ANY(get_user_branches(auth.uid()))
  )
);

CREATE POLICY "Admins can delete sales invoice items"
ON public.sales_invoice_items FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));

-- =====================================================================
-- STEP 2: Add void columns to invoices
-- =====================================================================

ALTER TABLE public.invoices 
ADD COLUMN IF NOT EXISTS voided_at timestamptz,
ADD COLUMN IF NOT EXISTS voided_by uuid,
ADD COLUMN IF NOT EXISTS void_reason text;

-- =====================================================================
-- STEP 3: Stronger Posted Lock trigger (JE-based)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.invoices_posted_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_je_posted boolean;
BEGIN
  -- Check if invoice has a posted journal entry
  IF OLD.journal_entry_id IS NOT NULL THEN
    SELECT is_posted INTO v_je_posted
    FROM public.journal_entries
    WHERE id = OLD.journal_entry_id;
    
    IF v_je_posted = true THEN
      -- Allow ONLY status change to 'voided' (via void RPC)
      IF NEW.status = 'voided' AND OLD.status != 'voided' THEN
        RETURN NEW;
      END IF;
      
      -- Allow payment-related updates only
      IF NEW.paid_amount IS DISTINCT FROM OLD.paid_amount
         OR NEW.remaining_amount IS DISTINCT FROM OLD.remaining_amount THEN
        IF NEW.total_amount = OLD.total_amount
           AND NEW.subtotal = OLD.subtotal
           AND NEW.tax_amount = OLD.tax_amount
           AND NEW.discount_amount = OLD.discount_amount
           AND NEW.customer_id IS NOT DISTINCT FROM OLD.customer_id
           AND NEW.branch_id IS NOT DISTINCT FROM OLD.branch_id
           AND NEW.journal_entry_id IS NOT DISTINCT FROM OLD.journal_entry_id
        THEN
          RETURN NEW;
        END IF;
      END IF;
      
      -- Allow ZATCA field updates only
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
      
      -- Block any other changes
      RAISE EXCEPTION 'POSTED_LOCKED: Cannot modify invoice after journal entry is posted. Use void operation instead.';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoices_posted_lock ON public.invoices;
CREATE TRIGGER trg_invoices_posted_lock
BEFORE UPDATE ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.invoices_posted_lock();

-- =====================================================================
-- STEP 4: Create void_sales_invoice_atomic RPC
-- =====================================================================

CREATE OR REPLACE FUNCTION public.void_sales_invoice_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_client_request_id text;
  v_invoice_id uuid;
  v_void_reason text;
  v_invoice RECORD;
  v_user_id uuid;
  v_user_branches uuid[];
  v_je_posted boolean;
  v_reversal_je_id uuid;
  v_reversal_je_number text;
  v_original_je RECORD;
  v_line RECORD;
  v_item RECORD;
  v_gate jsonb;
BEGIN
  -- Parse payload
  v_client_request_id := p_payload->>'client_request_id';
  v_invoice_id := (p_payload->>'invoice_id')::uuid;
  v_void_reason := COALESCE(p_payload->>'void_reason', 'Voided by user');
  
  -- Validate required fields
  IF v_invoice_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'VALIDATION_ERROR', 'error', 'invoice_id is required');
  END IF;
  
  -- Idempotency gate
  IF v_client_request_id IS NOT NULL THEN
    v_gate := begin_workflow_request(v_client_request_id::uuid, 'sales_invoice_void', p_payload);
    IF (v_gate->>'action') = 'return_cached' THEN
      RETURN (v_gate->'result') || jsonb_build_object('idempotent', true);
    ELSIF (v_gate->>'action') = 'conflict_in_progress' THEN
      RETURN jsonb_build_object('success', false, 'errorCode', 'CONFLICT_IN_PROGRESS', 'error', 'Void operation already in progress');
    END IF;
  END IF;
  
  -- Get current user
  v_user_id := auth.uid();
  v_user_branches := get_user_branches(v_user_id);
  
  -- Lock and fetch invoice
  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = v_invoice_id
  FOR UPDATE;
  
  IF v_invoice IS NULL THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'NOT_FOUND', 'error', 'Invoice not found');
  END IF;
  
  -- Access control: admin or branch access
  IF NOT has_role(v_user_id, 'admin'::app_role) THEN
    IF v_invoice.branch_id IS NOT NULL AND NOT (v_invoice.branch_id = ANY(v_user_branches)) THEN
      RETURN jsonb_build_object('success', false, 'errorCode', 'ACCESS_DENIED', 'error', 'No access to this invoice branch');
    END IF;
  END IF;
  
  -- Check if already voided
  IF v_invoice.status = 'voided' THEN
    RETURN jsonb_build_object('success', true, 'errorCode', 'ALREADY_VOIDED', 'error', 'Invoice is already voided', 'invoice_id', v_invoice_id);
  END IF;
  
  -- Check if invoice type is sales
  IF v_invoice.invoice_type NOT IN ('sales', 'sales_return') THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'INVALID_TYPE', 'error', 'This RPC is for sales invoices only');
  END IF;
  
  -- JE Reversal if exists and posted
  IF v_invoice.journal_entry_id IS NOT NULL THEN
    SELECT * INTO v_original_je
    FROM public.journal_entries
    WHERE id = v_invoice.journal_entry_id;
    
    IF v_original_je IS NOT NULL AND v_original_je.is_posted = true THEN
      v_reversal_je_number := generate_journal_entry_number();
      
      INSERT INTO public.journal_entries (
        entry_number, entry_date, reference_type, reference_id,
        description, total_debit, total_credit, status, is_posted,
        branch_id, created_by, created_by_name
      )
      VALUES (
        v_reversal_je_number, CURRENT_DATE, 'sales_invoice_void', v_invoice_id,
        'Reversal: ' || COALESCE(v_original_je.description, 'Sales Invoice ' || v_invoice.invoice_number),
        v_original_je.total_credit, v_original_je.total_debit,
        'posted', true, v_invoice.branch_id, v_user_id,
        (SELECT COALESCE(raw_user_meta_data->>'full_name', email) FROM auth.users WHERE id = v_user_id)
      )
      RETURNING id INTO v_reversal_je_id;
      
      INSERT INTO public.journal_entry_lines (
        journal_entry_id, account_id, debit_amount, credit_amount,
        description, cost_center_id
      )
      SELECT
        v_reversal_je_id, jel.account_id,
        jel.credit_amount, jel.debit_amount,
        'Reversal: ' || COALESCE(jel.description, ''), jel.cost_center_id
      FROM public.journal_entry_lines jel
      WHERE jel.journal_entry_id = v_original_je.id;
      
      UPDATE public.journal_entries
      SET is_reversed = true, reversed_by_entry_id = v_reversal_je_id
      WHERE id = v_original_je.id;
    END IF;
  END IF;
  
  -- Restore inventory: jewelry_items linked to this invoice
  FOR v_item IN
    SELECT sii.jewelry_item_id
    FROM public.sales_invoice_items sii
    WHERE sii.invoice_id = v_invoice_id
    AND sii.jewelry_item_id IS NOT NULL
  LOOP
    UPDATE public.jewelry_items
    SET sale_status = 'available', sale_id = NULL, sold_at = NULL,
        is_available_for_sale = true, updated_at = now()
    WHERE id = v_item.jewelry_item_id;
    
    INSERT INTO public.finished_goods_movements (
      item_id, item_code, movement_type, to_branch_id, to_location,
      notes, performed_by
    )
    SELECT 
      ji.id, ji.item_code, 'void_sale', v_invoice.branch_id, 'showroom',
      'Void sale - Invoice ' || v_invoice.invoice_number,
      (SELECT COALESCE(email, 'system') FROM auth.users WHERE id = v_user_id)
    FROM public.jewelry_items ji
    WHERE ji.id = v_item.jewelry_item_id;
  END LOOP;
  
  -- Update invoice to voided
  UPDATE public.invoices
  SET status = 'voided', voided_at = now(), voided_by = v_user_id,
      void_reason = v_void_reason, updated_at = now()
  WHERE id = v_invoice_id;
  
  -- Complete workflow request
  IF v_client_request_id IS NOT NULL THEN
    PERFORM complete_workflow_request(
      v_client_request_id::uuid, 'completed',
      jsonb_build_object(
        'success', true, 'invoice_id', v_invoice_id,
        'reversal_journal_entry_id', v_reversal_je_id,
        'reversal_journal_entry_number', v_reversal_je_number,
        'voided_at', now()
      )
    );
  END IF;
  
  RETURN jsonb_build_object(
    'success', true, 'invoice_id', v_invoice_id,
    'reversal_journal_entry_id', v_reversal_je_id,
    'reversal_journal_entry_number', v_reversal_je_number,
    'voided_at', now()
  );

EXCEPTION WHEN OTHERS THEN
  IF v_client_request_id IS NOT NULL THEN
    PERFORM complete_workflow_request(
      v_client_request_id::uuid, 'failed',
      jsonb_build_object('success', false, 'error', SQLERRM)
    );
  END IF;
  
  RETURN jsonb_build_object(
    'success', false, 'errorCode', 'INTERNAL_ERROR', 'error', SQLERRM
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.void_sales_invoice_atomic(jsonb) TO authenticated;

-- =====================================================================
-- VERIFICATION QUERIES
-- =====================================================================
-- Run these after migration to verify:
--
-- 1. RLS policies on sales_invoice_items (should have 4, no TRUE):
-- SELECT policyname, cmd, LEFT(qual::text, 50) FROM pg_policies WHERE tablename = 'sales_invoice_items';
--
-- 2. Void columns exist:
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'invoices' AND column_name LIKE 'void%';
--
-- 3. Posted lock trigger exists:
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.invoices'::regclass AND tgname = 'trg_invoices_posted_lock';
--
-- 4. Void RPC exists:
-- SELECT routine_name FROM information_schema.routines WHERE routine_name = 'void_sales_invoice_atomic';
