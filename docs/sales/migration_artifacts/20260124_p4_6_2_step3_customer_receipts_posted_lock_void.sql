-- ============================================================================
-- P4-6.2 STEP 3 — Customer Receipts Posted Lock + Void + Guardrails (FINAL)
-- ============================================================================
-- Date: 2026-01-24
-- Gate: P4-6 Customer Receipts Hardening
-- Step: STEP 3 (RISK-1, RISK-2, RISK-3 fixes)
-- ============================================================================

-- ============================================================================
-- RISK-1 FIX: Recreate void_customer_receipt_atomic WITHOUT status column
-- (journal_entries does NOT have 'status' column - confirmed via schema check)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.void_customer_receipt_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt_id uuid;
  v_receipt customer_receipts%ROWTYPE;
  v_void_reason text;
  v_user_id uuid;
  v_user_branches uuid[];
  v_reversal_je_id uuid;
  v_reversal_je_number text;
  v_original_je journal_entries%ROWTYPE;
  v_new_paid numeric;
  v_new_remaining numeric;
  v_new_status text;
  v_invoice invoices%ROWTYPE;
BEGIN
  -- Extract parameters
  v_receipt_id := (p_payload->>'receipt_id')::uuid;
  v_void_reason := COALESCE(p_payload->>'void_reason', 'Voided by user');
  v_user_id := auth.uid();
  
  -- Validate user
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'UNAUTHENTICATED', 'error_message', 'User not authenticated');
  END IF;
  
  -- Get user branches
  v_user_branches := get_user_branches(v_user_id);
  
  -- Get receipt with lock
  SELECT * INTO v_receipt FROM customer_receipts WHERE id = v_receipt_id FOR UPDATE;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'NOT_FOUND', 'error_message', 'Receipt not found');
  END IF;
  
  -- Branch access check (unless admin)
  IF NOT has_role(v_user_id, 'admin') AND NOT (v_receipt.branch_id = ANY(v_user_branches)) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ACCESS_DENIED', 'error_message', 'No access to this branch');
  END IF;
  
  -- Already voided check
  IF v_receipt.status = 'voided' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ALREADY_VOIDED', 'error_message', 'Receipt is already voided');
  END IF;
  
  -- Posted lock check - if JE is posted, still allow void but create reversal
  IF v_receipt.journal_entry_id IS NOT NULL THEN
    SELECT * INTO v_original_je FROM journal_entries WHERE id = v_receipt.journal_entry_id;
    
    IF v_original_je.is_posted = true THEN
      -- Create reversal JE
      v_reversal_je_number := 'REV-' || v_original_je.entry_number;
      
      INSERT INTO journal_entries (
        entry_number,
        entry_date,
        description,
        reference_type,
        reference_id,
        is_posted,
        posted_at,
        posted_by,
        total_debit,
        total_credit,
        created_by,
        branch_id,
        is_reversed
      ) VALUES (
        v_reversal_je_number,
        CURRENT_DATE,
        'عكس قيد سند قبض - Reversal of receipt ' || v_receipt.receipt_number,
        'customer_receipt_void',
        v_receipt_id,
        true,
        now(),
        v_user_id::text,
        v_original_je.total_debit,
        v_original_je.total_credit,
        v_user_id::text,
        v_receipt.branch_id,
        false
      ) RETURNING id INTO v_reversal_je_id;
      
      -- Copy lines with reversed debits/credits
      INSERT INTO journal_entry_lines (
        journal_entry_id,
        account_id,
        debit,
        credit,
        description,
        cost_center_id
      )
      SELECT 
        v_reversal_je_id,
        account_id,
        credit,  -- Swap: original credit becomes debit
        debit,   -- Swap: original debit becomes credit
        'عكس - Reversal: ' || COALESCE(description, ''),
        cost_center_id
      FROM journal_entry_lines
      WHERE journal_entry_id = v_original_je.id;
      
      -- Mark original JE as reversed
      UPDATE journal_entries 
      SET is_reversed = true, 
          reversed_by_entry_id = v_reversal_je_id,
          reversal_reason = v_void_reason
      WHERE id = v_original_je.id;
    END IF;
  END IF;
  
  -- Update receipt to voided
  UPDATE customer_receipts
  SET status = 'voided',
      voided_at = now(),
      voided_by = v_user_id,
      void_reason = v_void_reason,
      updated_at = now()
  WHERE id = v_receipt_id;
  
  -- RISK-3 FIX: Reverse invoice payment with safety clamps
  IF v_receipt.invoice_id IS NOT NULL THEN
    SELECT * INTO v_invoice FROM invoices WHERE id = v_receipt.invoice_id FOR UPDATE;
    
    IF FOUND THEN
      -- Calculate new values with safety clamps
      v_new_paid := GREATEST(0, COALESCE(v_invoice.paid_amount, 0) - v_receipt.amount);
      v_new_remaining := LEAST(
        COALESCE(v_invoice.total_amount, 0),
        GREATEST(0, COALESCE(v_invoice.total_amount, 0) - v_new_paid)
      );
      
      -- Determine new status based on payment
      IF v_new_paid <= 0 THEN
        v_new_status := 'pending';
      ELSIF v_new_paid < v_invoice.total_amount THEN
        v_new_status := 'partial';
      ELSE
        v_new_status := 'paid';
      END IF;
      
      UPDATE invoices
      SET paid_amount = v_new_paid,
          remaining_amount = v_new_remaining,
          status = v_new_status,
          updated_at = now()
      WHERE id = v_receipt.invoice_id;
    END IF;
  END IF;
  
  RETURN jsonb_build_object(
    'success', true,
    'receipt_id', v_receipt_id,
    'reversal_journal_entry_id', v_reversal_je_id,
    'reversal_journal_entry_number', v_reversal_je_number,
    'message', 'Receipt voided successfully'
  );
  
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error_code', 'VOID_FAILED',
    'error_message', SQLERRM
  );
END;
$$;

-- ============================================================================
-- RISK-2 FIX: Make DELETE admin-only
-- ============================================================================

DROP POLICY IF EXISTS "Users can delete customer receipts in their branches" ON customer_receipts;

CREATE POLICY "Admins can delete customer receipts"
  ON customer_receipts FOR DELETE
  USING (has_role(auth.uid(), 'admin'::app_role));

-- ============================================================================
-- Update trigger to enforce admin-only delete at DB level
-- ============================================================================

CREATE OR REPLACE FUNCTION public.customer_receipt_prevent_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow admin to delete
  IF has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN OLD;
  END IF;
  
  -- Block all non-admin deletes
  RAISE EXCEPTION 'DELETE_NOT_ALLOWED: Only admins can delete customer receipts. Use void instead.'
    USING ERRCODE = 'P0001';
END;
$$;

-- Ensure trigger exists
DROP TRIGGER IF EXISTS trg_customer_receipt_prevent_delete ON customer_receipts;
CREATE TRIGGER trg_customer_receipt_prevent_delete
  BEFORE DELETE ON customer_receipts
  FOR EACH ROW
  EXECUTE FUNCTION customer_receipt_prevent_delete();

-- ============================================================================
-- Grant execute on void function
-- ============================================================================

GRANT EXECUTE ON FUNCTION void_customer_receipt_atomic(jsonb) TO authenticated;

-- ============================================================================
-- Posted Lock Trigger (from prior migration - confirmed active)
-- ============================================================================
-- customer_receipt_posted_lock() - prevents UPDATE on financial fields
-- when associated JE is posted (is_posted = true)
-- 
-- Financial fields protected:
--   amount, account_id, invoice_id, branch_id, customer_id, payment_method
--
-- Trigger: trg_customer_receipt_posted_lock ON customer_receipts BEFORE UPDATE

-- ============================================================================
-- Verification Queries (for manual testing)
-- ============================================================================

-- V1: Check policies on customer_receipts
-- SELECT policyname, cmd, permissive, qual, with_check
-- FROM pg_policies WHERE tablename = 'customer_receipts';

-- V2: Check functions created
-- SELECT routine_name FROM information_schema.routines 
-- WHERE routine_schema = 'public' 
-- AND routine_name IN ('void_customer_receipt_atomic', 'customer_receipt_posted_lock', 'customer_receipt_prevent_delete');

-- V3: Check triggers on customer_receipts
-- SELECT trigger_name, event_manipulation, event_object_table 
-- FROM information_schema.triggers 
-- WHERE event_object_table = 'customer_receipts';

-- ============================================================================
-- VERIFICATION RESULTS (STEP 3)
-- ============================================================================
-- V1: Create receipt via RPC → JE created + linked ✅
-- V2: Overpay > remaining → OVERPAY_NOT_ALLOWED ✅
-- V3: UPDATE amount after JE posted → POSTED_LOCKED (trigger blocks) ✅
-- V4: Void posted receipt → status=voided + reversal JE ✅
-- V5: Invoice tie-out after void → GREATEST/LEAST clamps applied ✅
-- V6: Non-admin DELETE → Blocked by RLS + trigger ✅
-- ============================================================================
-- END OF STEP 3 MIGRATION
-- ============================================================================
