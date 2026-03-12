-- ================================================================
-- P4-6.2 STEP 3: Customer Receipts Posted Lock + Void + Guardrails
-- Date: 2026-01-24
-- ================================================================

-- ================================================================
-- PART 1: Add missing void columns to customer_receipts
-- ================================================================

-- Add voided_at column
ALTER TABLE public.customer_receipts 
ADD COLUMN IF NOT EXISTS voided_at timestamptz;

-- Add voided_by column
ALTER TABLE public.customer_receipts 
ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES auth.users(id);

-- Add void_reason column
ALTER TABLE public.customer_receipts 
ADD COLUMN IF NOT EXISTS void_reason text;

-- Update status CHECK constraint to include 'voided'
-- First drop existing constraint if any, then add new one
DO $$
BEGIN
  -- Try to drop any existing check constraint on status
  ALTER TABLE public.customer_receipts DROP CONSTRAINT IF EXISTS customer_receipts_status_check;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE public.customer_receipts 
ADD CONSTRAINT customer_receipts_status_check 
CHECK (status IN ('draft', 'confirmed', 'posted', 'voided'));

-- ================================================================
-- PART 2: Posted Lock Trigger - prevent modification of posted receipts
-- ================================================================

CREATE OR REPLACE FUNCTION public.customer_receipt_posted_lock()
RETURNS TRIGGER AS $$
DECLARE
  v_je_posted boolean;
BEGIN
  -- Check if receipt has a linked posted JE
  IF OLD.journal_entry_id IS NOT NULL THEN
    SELECT is_posted INTO v_je_posted 
    FROM journal_entries 
    WHERE id = OLD.journal_entry_id;
    
    IF v_je_posted = true THEN
      -- Check if trying to modify critical financial fields
      IF (
        OLD.amount IS DISTINCT FROM NEW.amount OR
        OLD.customer_id IS DISTINCT FROM NEW.customer_id OR
        OLD.invoice_id IS DISTINCT FROM NEW.invoice_id OR
        OLD.branch_id IS DISTINCT FROM NEW.branch_id OR
        OLD.payment_method IS DISTINCT FROM NEW.payment_method OR
        OLD.journal_entry_id IS DISTINCT FROM NEW.journal_entry_id
      ) THEN
        -- Allow only status change to 'voided' (handled by void RPC)
        IF NOT (NEW.status = 'voided' AND OLD.status != 'voided') THEN
          RAISE EXCEPTION 'POSTED_LOCKED: Cannot modify customer receipt after journal entry is posted. Use void instead.'
            USING ERRCODE = 'P0001';
        END IF;
      END IF;
    END IF;
  END IF;
  
  -- Prevent re-voiding
  IF OLD.status = 'voided' AND NEW.status != 'voided' THEN
    RAISE EXCEPTION 'ALREADY_VOIDED: Cannot modify voided receipt.'
      USING ERRCODE = 'P0002';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Drop existing trigger if any
DROP TRIGGER IF EXISTS trg_customer_receipt_posted_lock ON public.customer_receipts;

-- Create trigger
CREATE TRIGGER trg_customer_receipt_posted_lock
BEFORE UPDATE ON public.customer_receipts
FOR EACH ROW
EXECUTE FUNCTION public.customer_receipt_posted_lock();

-- ================================================================
-- PART 3: Prevent DELETE of posted receipts
-- ================================================================

CREATE OR REPLACE FUNCTION public.customer_receipt_prevent_delete()
RETURNS TRIGGER AS $$
DECLARE
  v_je_posted boolean;
BEGIN
  -- Check if receipt is voided - allow delete of voided receipts by admin
  IF OLD.status = 'voided' THEN
    RETURN OLD;
  END IF;
  
  -- Check if receipt has a linked posted JE
  IF OLD.journal_entry_id IS NOT NULL THEN
    SELECT is_posted INTO v_je_posted 
    FROM journal_entries 
    WHERE id = OLD.journal_entry_id;
    
    IF v_je_posted = true THEN
      RAISE EXCEPTION 'POSTED_LOCKED: Cannot delete customer receipt after journal entry is posted. Use void instead.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_customer_receipt_prevent_delete ON public.customer_receipts;

CREATE TRIGGER trg_customer_receipt_prevent_delete
BEFORE DELETE ON public.customer_receipts
FOR EACH ROW
EXECUTE FUNCTION public.customer_receipt_prevent_delete();

-- ================================================================
-- PART 4: Create void_customer_receipt_atomic RPC
-- ================================================================

CREATE OR REPLACE FUNCTION public.void_customer_receipt_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_request_id text;
  v_receipt_id uuid;
  v_void_reason text;
  v_receipt RECORD;
  v_je_reversal_id uuid;
  v_je_reversal_number text;
  v_original_je RECORD;
  v_begin_result jsonb;
  v_result_payload jsonb;
  v_user_id uuid;
  v_user_name text;
  v_line RECORD;
BEGIN
  -- Extract parameters
  v_client_request_id := p_payload->>'client_request_id';
  v_receipt_id := (p_payload->>'receipt_id')::uuid;
  v_void_reason := COALESCE(p_payload->>'void_reason', 'User requested void');
  
  -- Validate required fields
  IF v_client_request_id IS NULL THEN 
    RETURN jsonb_build_object('success', false, 'error', 'client_request_id is required', 'errorCode', 'VALIDATION_ERROR'); 
  END IF;
  IF v_receipt_id IS NULL THEN 
    RETURN jsonb_build_object('success', false, 'error', 'receipt_id is required', 'errorCode', 'VALIDATION_ERROR'); 
  END IF;
  
  -- Idempotency check
  v_begin_result := public.atomic_begin_request(v_client_request_id, 'void_customer_receipt', p_payload, NULL);
  IF v_begin_result->>'status' = 'completed' THEN RETURN v_begin_result->'result'; END IF;
  IF v_begin_result->>'status' = 'failed' THEN RETURN v_begin_result->'result'; END IF;
  
  -- Get current user info
  v_user_id := auth.uid();
  SELECT COALESCE(raw_user_meta_data->>'full_name', email, 'System') INTO v_user_name 
  FROM auth.users WHERE id = v_user_id;
  
  -- Fetch receipt
  SELECT * INTO v_receipt FROM customer_receipts WHERE id = v_receipt_id;
  IF NOT FOUND THEN
    v_result_payload := jsonb_build_object('success', false, 'error', 'Receipt not found', 'errorCode', 'NOT_FOUND');
    PERFORM public.atomic_failed(v_client_request_id, 'void_customer_receipt', v_result_payload, 'NOT_FOUND', 'Receipt not found');
    RETURN v_result_payload;
  END IF;
  
  -- Check if already voided
  IF v_receipt.status = 'voided' THEN
    v_result_payload := jsonb_build_object('success', false, 'error', 'Receipt is already voided', 'errorCode', 'ALREADY_VOIDED');
    PERFORM public.atomic_failed(v_client_request_id, 'void_customer_receipt', v_result_payload, 'ALREADY_VOIDED', 'Receipt is already voided');
    RETURN v_result_payload;
  END IF;
  
  -- Branch access check (if not admin)
  IF NOT has_role(v_user_id, 'admin'::app_role) THEN
    IF v_receipt.branch_id IS NOT NULL AND v_receipt.branch_id != ALL(get_user_branches(v_user_id)) THEN
      v_result_payload := jsonb_build_object('success', false, 'error', 'Access denied: Receipt is in a different branch', 'errorCode', 'BRANCH_ACCESS_DENIED');
      PERFORM public.atomic_failed(v_client_request_id, 'void_customer_receipt', v_result_payload, 'BRANCH_ACCESS_DENIED', 'Access denied');
      RETURN v_result_payload;
    END IF;
  END IF;
  
  -- Create reversal JE if original JE exists
  IF v_receipt.journal_entry_id IS NOT NULL THEN
    -- Get original JE
    SELECT * INTO v_original_je FROM journal_entries WHERE id = v_receipt.journal_entry_id;
    
    IF FOUND THEN
      v_je_reversal_number := public.generate_journal_entry_number();
      
      INSERT INTO journal_entries (
        entry_number, entry_date, reference_type, reference_id, 
        description, total_debit, total_credit, status, is_posted, 
        branch_id, created_by, created_by_name
      ) VALUES (
        v_je_reversal_number, CURRENT_DATE, 'customer_receipt_void', v_receipt_id,
        'VOID: Customer Receipt ' || v_receipt.receipt_number, 
        v_original_je.total_debit, v_original_je.total_credit, 
        'posted', true, v_receipt.branch_id, v_user_id, v_user_name
      ) RETURNING id INTO v_je_reversal_id;
      
      -- Reverse all lines (swap debit/credit)
      FOR v_line IN 
        SELECT * FROM journal_entry_lines WHERE journal_entry_id = v_original_je.id
      LOOP
        INSERT INTO journal_entry_lines (
          journal_entry_id, account_id, debit_amount, credit_amount, 
          description, cost_center_id
        ) VALUES (
          v_je_reversal_id, v_line.account_id, 
          v_line.credit_amount, v_line.debit_amount,  -- SWAPPED
          'VOID: ' || COALESCE(v_line.description, ''),
          v_line.cost_center_id
        );
      END LOOP;
    END IF;
  END IF;
  
  -- Update receipt to voided
  UPDATE customer_receipts SET
    status = 'voided',
    voided_at = NOW(),
    voided_by = v_user_id,
    void_reason = v_void_reason,
    updated_at = NOW()
  WHERE id = v_receipt_id;
  
  -- Reverse invoice payment if linked
  IF v_receipt.invoice_id IS NOT NULL THEN
    UPDATE invoices SET
      paid_amount = GREATEST(0, COALESCE(paid_amount, 0) - v_receipt.amount),
      remaining_amount = COALESCE(remaining_amount, 0) + v_receipt.amount,
      status = CASE 
        WHEN COALESCE(paid_amount, 0) - v_receipt.amount <= 0 THEN 'pending'
        ELSE 'partial'
      END,
      updated_at = NOW()
    WHERE id = v_receipt.invoice_id;
  END IF;
  
  -- Success
  v_result_payload := jsonb_build_object(
    'success', true,
    'receipt_id', v_receipt_id,
    'receipt_number', v_receipt.receipt_number,
    'reversal_journal_entry_id', v_je_reversal_id,
    'reversal_journal_entry_number', v_je_reversal_number,
    'voided_at', NOW()
  );
  
  PERFORM public.atomic_complete(v_client_request_id, 'void_customer_receipt', v_result_payload);
  RETURN v_result_payload;
  
EXCEPTION WHEN OTHERS THEN
  v_result_payload := jsonb_build_object(
    'success', false, 
    'error', SQLERRM,
    'errorCode', SQLSTATE
  );
  PERFORM public.atomic_failed(v_client_request_id, 'void_customer_receipt', v_result_payload, SQLSTATE, SQLERRM);
  RETURN v_result_payload;
END;
$$;

-- ================================================================
-- PART 5: Add over-allocation check to create_customer_receipt_atomic
-- ================================================================

-- We need to update the existing RPC to add overpay check
-- First let's create an updated version

CREATE OR REPLACE FUNCTION public.create_customer_receipt_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_request_id text;
  v_receipt_id uuid;
  v_receipt_number text;
  v_customer_id uuid;
  v_branch_id uuid;
  v_invoice_id uuid;
  v_amount numeric;
  v_receipt_date date;
  v_payment_method text;
  v_notes text;
  v_allow_overpay boolean;
  v_customer_record RECORD;
  v_invoice_record RECORD;
  v_je_id uuid;
  v_je_number text;
  v_ar_account_id uuid;
  v_cash_account_id uuid;
  v_bank_account_id uuid;
  v_payment_account_id uuid;
  v_begin_result jsonb;
  v_result_payload jsonb;
  v_user_id uuid;
  v_user_name text;
BEGIN
  -- Extract parameters
  v_client_request_id := p_payload->>'client_request_id';
  v_customer_id := (p_payload->>'customer_id')::uuid;
  v_branch_id := (p_payload->>'branch_id')::uuid;
  v_invoice_id := (p_payload->>'invoice_id')::uuid;
  v_amount := COALESCE((p_payload->>'amount')::numeric, 0);
  v_receipt_date := COALESCE((p_payload->>'receipt_date')::date, CURRENT_DATE);
  v_payment_method := COALESCE(p_payload->>'payment_method', 'cash');
  v_notes := p_payload->>'notes';
  v_allow_overpay := COALESCE((p_payload->>'allow_overpay')::boolean, false);

  -- Validate required fields
  IF v_client_request_id IS NULL THEN 
    RETURN jsonb_build_object('success', false, 'error', 'client_request_id is required', 'errorCode', 'VALIDATION_ERROR'); 
  END IF;
  IF v_customer_id IS NULL THEN 
    RETURN jsonb_build_object('success', false, 'error', 'customer_id is required', 'errorCode', 'VALIDATION_ERROR'); 
  END IF;
  IF v_amount <= 0 THEN 
    RETURN jsonb_build_object('success', false, 'error', 'amount must be positive', 'errorCode', 'VALIDATION_ERROR'); 
  END IF;

  -- Idempotency check
  v_begin_result := public.atomic_begin_request(v_client_request_id, 'customer_receipt', p_payload, NULL);
  IF v_begin_result->>'status' = 'completed' THEN RETURN v_begin_result->'result'; END IF;
  IF v_begin_result->>'status' = 'failed' THEN RETURN v_begin_result->'result'; END IF;

  -- Get current user info
  v_user_id := auth.uid();
  SELECT COALESCE(raw_user_meta_data->>'full_name', email, 'System') INTO v_user_name 
  FROM auth.users WHERE id = v_user_id;

  -- Fetch customer
  SELECT * INTO v_customer_record FROM customers WHERE id = v_customer_id;
  IF NOT FOUND THEN
    v_result_payload := jsonb_build_object('success', false, 'error', 'Customer not found', 'errorCode', 'NOT_FOUND');
    PERFORM public.atomic_failed(v_client_request_id, 'customer_receipt', v_result_payload, 'NOT_FOUND', 'Customer not found');
    RETURN v_result_payload;
  END IF;

  -- OVER-ALLOCATION CHECK: If invoice_id is provided, check remaining amount
  IF v_invoice_id IS NOT NULL AND NOT v_allow_overpay THEN
    SELECT * INTO v_invoice_record FROM invoices WHERE id = v_invoice_id;
    IF FOUND THEN
      IF v_amount > COALESCE(v_invoice_record.remaining_amount, v_invoice_record.total_amount) THEN
        v_result_payload := jsonb_build_object(
          'success', false, 
          'error', 'Receipt amount exceeds invoice remaining amount', 
          'errorCode', 'OVERPAY_NOT_ALLOWED',
          'invoice_remaining', COALESCE(v_invoice_record.remaining_amount, v_invoice_record.total_amount),
          'receipt_amount', v_amount
        );
        PERFORM public.atomic_failed(v_client_request_id, 'customer_receipt', v_result_payload, 'OVERPAY_NOT_ALLOWED', 'Overpay not allowed');
        RETURN v_result_payload;
      END IF;
    END IF;
  END IF;

  -- Get AR account
  v_ar_account_id := v_customer_record.account_id;
  IF v_ar_account_id IS NULL THEN 
    SELECT id INTO v_ar_account_id FROM chart_of_accounts WHERE account_code = '1201' AND is_active = true LIMIT 1; 
  END IF;

  -- Get payment accounts
  SELECT id INTO v_cash_account_id FROM chart_of_accounts WHERE account_code = '1101' AND is_active = true LIMIT 1;
  SELECT id INTO v_bank_account_id FROM chart_of_accounts WHERE account_code = '1102' AND is_active = true LIMIT 1;

  IF v_payment_method = 'cash' THEN 
    v_payment_account_id := v_cash_account_id;
  ELSE 
    v_payment_account_id := v_bank_account_id;
  END IF;

  -- Generate IDs
  v_receipt_id := gen_random_uuid();
  v_receipt_number := public.generate_receipt_number();
  v_je_number := public.generate_journal_entry_number();
  
  -- Create Journal Entry
  INSERT INTO journal_entries (
    entry_number, entry_date, reference_type, reference_id, 
    description, total_debit, total_credit, status, is_posted, 
    branch_id, created_by, created_by_name
  ) VALUES (
    v_je_number, v_receipt_date, 'customer_receipt', v_receipt_id, 
    'Customer Receipt: ' || v_receipt_number, v_amount, v_amount, 
    'posted', true, v_branch_id, v_user_id, v_user_name
  ) RETURNING id INTO v_je_id;

  -- Create JE Lines
  IF v_payment_account_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) 
    VALUES (v_je_id, v_payment_account_id, v_amount, 0, 'Cash/Bank received');
  END IF;
  IF v_ar_account_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) 
    VALUES (v_je_id, v_ar_account_id, 0, v_amount, 'Customer receivable reduced');
  END IF;

  -- Create Receipt
  INSERT INTO customer_receipts (
    id, receipt_number, customer_id, branch_id, invoice_id, 
    amount, receipt_date, payment_method, notes, status, 
    journal_entry_id, created_by
  ) VALUES (
    v_receipt_id, v_receipt_number, v_customer_id, v_branch_id, v_invoice_id, 
    v_amount, v_receipt_date, v_payment_method, v_notes, 'posted', 
    v_je_id, v_user_id
  );

  -- Update invoice if linked
  IF v_invoice_id IS NOT NULL THEN
    UPDATE invoices SET 
      paid_amount = COALESCE(paid_amount, 0) + v_amount, 
      remaining_amount = GREATEST(0, COALESCE(remaining_amount, total_amount) - v_amount),
      status = CASE 
        WHEN GREATEST(0, COALESCE(remaining_amount, total_amount) - v_amount) <= 0 THEN 'paid'
        ELSE 'partial'
      END,
      updated_at = NOW() 
    WHERE id = v_invoice_id;
  END IF;

  -- Success
  v_result_payload := jsonb_build_object(
    'success', true,
    'receipt_id', v_receipt_id,
    'receipt_number', v_receipt_number,
    'journal_entry_id', v_je_id,
    'journal_entry_number', v_je_number,
    'amount', v_amount
  );

  PERFORM public.atomic_complete(v_client_request_id, 'customer_receipt', v_result_payload);
  RETURN v_result_payload;

EXCEPTION WHEN OTHERS THEN
  v_result_payload := jsonb_build_object(
    'success', false, 
    'error', SQLERRM,
    'errorCode', SQLSTATE
  );
  PERFORM public.atomic_failed(v_client_request_id, 'customer_receipt', v_result_payload, SQLSTATE, SQLERRM);
  RETURN v_result_payload;
END;
$$;

-- ================================================================
-- PART 6: Grant execute permissions
-- ================================================================
GRANT EXECUTE ON FUNCTION public.void_customer_receipt_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_customer_receipt_atomic(jsonb) TO authenticated;