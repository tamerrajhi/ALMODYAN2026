-- =====================================================
-- P4-7.1 Migration #1: credit_notes Schema Hardening
-- =====================================================

-- 1) Add void columns if not exist
ALTER TABLE public.credit_notes 
ADD COLUMN IF NOT EXISTS voided_at timestamptz,
ADD COLUMN IF NOT EXISTS voided_by uuid,
ADD COLUMN IF NOT EXISTS void_reason text;

-- 2) Update status constraint to include voided
ALTER TABLE public.credit_notes DROP CONSTRAINT IF EXISTS credit_notes_status_check;
ALTER TABLE public.credit_notes ADD CONSTRAINT credit_notes_status_check 
  CHECK (status IN ('draft', 'pending', 'approved', 'issued', 'posted', 'voided', 'applied'));

-- 3) Posted Lock Trigger - prevent updates to financial fields when JE is posted
CREATE OR REPLACE FUNCTION public.credit_note_posted_lock()
RETURNS TRIGGER AS $$
DECLARE
  v_je_posted boolean;
BEGIN
  -- Skip if setting to voided (allowed via void RPC)
  IF NEW.status = 'voided' AND OLD.status != 'voided' THEN
    RETURN NEW;
  END IF;
  
  -- Check if original JE is posted
  IF OLD.journal_entry_id IS NOT NULL THEN
    SELECT is_posted INTO v_je_posted FROM journal_entries WHERE id = OLD.journal_entry_id;
    
    IF v_je_posted = true THEN
      -- Block changes to financial fields
      IF OLD.total_amount IS DISTINCT FROM NEW.total_amount
        OR OLD.subtotal IS DISTINCT FROM NEW.subtotal
        OR OLD.tax_amount IS DISTINCT FROM NEW.tax_amount
        OR OLD.customer_id IS DISTINCT FROM NEW.customer_id
        OR OLD.invoice_id IS DISTINCT FROM NEW.invoice_id
        OR OLD.branch_id IS DISTINCT FROM NEW.branch_id
        OR OLD.journal_entry_id IS DISTINCT FROM NEW.journal_entry_id
      THEN
        RAISE EXCEPTION 'POSTED_LOCKED: Cannot modify credit note after journal entry is posted';
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_credit_note_posted_lock ON public.credit_notes;
CREATE TRIGGER trg_credit_note_posted_lock
  BEFORE UPDATE ON public.credit_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.credit_note_posted_lock();

-- 4) Prevent Delete Trigger - admin only at DB level
CREATE OR REPLACE FUNCTION public.credit_note_prevent_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Allow admin only
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'DELETE_FORBIDDEN: Only admins can delete credit notes';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_credit_note_prevent_delete ON public.credit_notes;
CREATE TRIGGER trg_credit_note_prevent_delete
  BEFORE DELETE ON public.credit_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.credit_note_prevent_delete();

-- =====================================================
-- P4-7.1 Migration #2: RLS Hardening
-- =====================================================

-- credit_notes: Fix UPDATE policy with WITH CHECK + add DELETE policy
DROP POLICY IF EXISTS "Users can update credit notes in their branches" ON public.credit_notes;
CREATE POLICY "Users can update credit notes in their branches" ON public.credit_notes
  FOR UPDATE
  USING (has_role(auth.uid(), 'admin') OR branch_id = ANY(get_user_branches(auth.uid())))
  WITH CHECK (has_role(auth.uid(), 'admin') OR branch_id = ANY(get_user_branches(auth.uid())));

DROP POLICY IF EXISTS "Admins can delete credit notes" ON public.credit_notes;
CREATE POLICY "Admins can delete credit notes" ON public.credit_notes
  FOR DELETE
  USING (has_role(auth.uid(), 'admin'));

-- credit_note_items: Replace permissive TRUE with branch-scoped via parent
DROP POLICY IF EXISTS "Users can view credit note items" ON public.credit_note_items;
DROP POLICY IF EXISTS "Users can insert credit note items" ON public.credit_note_items;
DROP POLICY IF EXISTS "Users can update credit note items" ON public.credit_note_items;
DROP POLICY IF EXISTS "Users can delete credit note items" ON public.credit_note_items;

CREATE POLICY "Users can view credit note items" ON public.credit_note_items
  FOR SELECT
  USING (
    has_role(auth.uid(), 'admin') 
    OR EXISTS (
      SELECT 1 FROM credit_notes cn 
      WHERE cn.id = credit_note_items.credit_note_id 
      AND cn.branch_id = ANY(get_user_branches(auth.uid()))
    )
  );

CREATE POLICY "Users can insert credit note items" ON public.credit_note_items
  FOR INSERT
  WITH CHECK (
    has_role(auth.uid(), 'admin') 
    OR EXISTS (
      SELECT 1 FROM credit_notes cn 
      WHERE cn.id = credit_note_items.credit_note_id 
      AND cn.branch_id = ANY(get_user_branches(auth.uid()))
    )
  );

CREATE POLICY "Users can update credit note items" ON public.credit_note_items
  FOR UPDATE
  USING (
    has_role(auth.uid(), 'admin') 
    OR EXISTS (
      SELECT 1 FROM credit_notes cn 
      WHERE cn.id = credit_note_items.credit_note_id 
      AND cn.branch_id = ANY(get_user_branches(auth.uid()))
    )
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin') 
    OR EXISTS (
      SELECT 1 FROM credit_notes cn 
      WHERE cn.id = credit_note_items.credit_note_id 
      AND cn.branch_id = ANY(get_user_branches(auth.uid()))
    )
  );

CREATE POLICY "Admins can delete credit note items" ON public.credit_note_items
  FOR DELETE
  USING (has_role(auth.uid(), 'admin'));

-- =====================================================
-- P4-7.1 Migration #3: Void RPC
-- =====================================================

CREATE OR REPLACE FUNCTION public.void_credit_note_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_request_id text;
  v_credit_note_id uuid;
  v_void_reason text;
  v_credit_note RECORD;
  v_original_je RECORD;
  v_reversal_je_id uuid;
  v_reversal_je_number text;
  v_begin_result jsonb;
  v_result_payload jsonb;
  v_user_id uuid;
  v_user_name text;
  v_line RECORD;
BEGIN
  -- Extract parameters
  v_client_request_id := p_payload->>'client_request_id';
  v_credit_note_id := (p_payload->>'credit_note_id')::uuid;
  v_void_reason := p_payload->>'void_reason';
  
  -- Validation
  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'MISSING_CLIENT_REQUEST_ID');
  END IF;
  
  IF v_credit_note_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'MISSING_CREDIT_NOTE_ID');
  END IF;
  
  IF v_void_reason IS NULL OR v_void_reason = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'MISSING_VOID_REASON');
  END IF;
  
  -- Idempotency check
  v_begin_result := public.atomic_begin_request(v_client_request_id, 'credit_note_void', p_payload, NULL);
  IF v_begin_result->>'status' = 'completed' THEN RETURN v_begin_result->'result'; END IF;
  IF v_begin_result->>'status' = 'failed' THEN RETURN v_begin_result->'result'; END IF;
  
  -- Get user info
  v_user_id := auth.uid();
  SELECT COALESCE(raw_user_meta_data->>'full_name', email, 'System') INTO v_user_name 
  FROM auth.users WHERE id = v_user_id;
  
  -- Fetch credit note
  SELECT * INTO v_credit_note FROM credit_notes WHERE id = v_credit_note_id FOR UPDATE;
  
  IF NOT FOUND THEN
    v_result_payload := jsonb_build_object('success', false, 'error', 'CREDIT_NOTE_NOT_FOUND');
    PERFORM public.atomic_failed(v_client_request_id, 'credit_note_void', v_result_payload, 'CREDIT_NOTE_NOT_FOUND', 'Credit note not found');
    RETURN v_result_payload;
  END IF;
  
  -- Check if already voided
  IF v_credit_note.status = 'voided' THEN
    v_result_payload := jsonb_build_object('success', false, 'error', 'ALREADY_VOIDED');
    PERFORM public.atomic_failed(v_client_request_id, 'credit_note_void', v_result_payload, 'ALREADY_VOIDED', 'Credit note already voided');
    RETURN v_result_payload;
  END IF;
  
  -- Branch access check (unless admin)
  IF NOT has_role(v_user_id, 'admin') THEN
    IF v_credit_note.branch_id IS NOT NULL 
       AND NOT (v_credit_note.branch_id = ANY(get_user_branches(v_user_id))) THEN
      v_result_payload := jsonb_build_object('success', false, 'error', 'ACCESS_DENIED');
      PERFORM public.atomic_failed(v_client_request_id, 'credit_note_void', v_result_payload, 'ACCESS_DENIED', 'No branch access');
      RETURN v_result_payload;
    END IF;
  END IF;
  
  -- If original JE exists and is posted, create reversal
  IF v_credit_note.journal_entry_id IS NOT NULL THEN
    SELECT * INTO v_original_je FROM journal_entries WHERE id = v_credit_note.journal_entry_id;
    
    IF FOUND AND v_original_je.is_posted = true THEN
      -- Generate reversal JE number
      v_reversal_je_number := public.generate_journal_entry_number();
      v_reversal_je_id := gen_random_uuid();
      
      -- Create reversal journal entry
      INSERT INTO journal_entries (
        id, entry_number, entry_date, reference_type, reference_id,
        description, is_posted, total_debit, total_credit, branch_id, created_by
      ) VALUES (
        v_reversal_je_id,
        v_reversal_je_number,
        CURRENT_DATE,
        'credit_note_void',
        v_credit_note_id,
        'إلغاء إشعار دائن: ' || v_credit_note.credit_note_number || ' - ' || v_void_reason,
        true,
        v_original_je.total_debit,
        v_original_je.total_credit,
        v_credit_note.branch_id,
        v_user_name
      );
      
      -- Create reversed lines (swap debit/credit)
      FOR v_line IN SELECT * FROM journal_entry_lines WHERE journal_entry_id = v_original_je.id
      LOOP
        INSERT INTO journal_entry_lines (
          journal_entry_id, account_id, debit_amount, credit_amount, description, cost_center_id
        ) VALUES (
          v_reversal_je_id,
          v_line.account_id,
          v_line.credit_amount, -- Swap
          v_line.debit_amount,  -- Swap
          'عكس: ' || COALESCE(v_line.description, ''),
          v_line.cost_center_id
        );
      END LOOP;
      
      -- Mark original JE as reversed
      UPDATE journal_entries SET 
        is_reversed = true,
        reversed_by_entry_id = v_reversal_je_id
      WHERE id = v_original_je.id;
    END IF;
  END IF;
  
  -- Reverse invoice impact if linked
  IF v_credit_note.invoice_id IS NOT NULL THEN
    UPDATE invoices SET
      remaining_amount = LEAST(total_amount, GREATEST(0, remaining_amount + v_credit_note.total_amount)),
      paid_amount = GREATEST(0, paid_amount - v_credit_note.total_amount),
      status = CASE 
        WHEN GREATEST(0, paid_amount - v_credit_note.total_amount) <= 0 THEN 'pending'
        WHEN LEAST(total_amount, GREATEST(0, remaining_amount + v_credit_note.total_amount)) <= 0 THEN 'paid'
        ELSE 'partial'
      END
    WHERE id = v_credit_note.invoice_id;
  END IF;
  
  -- Update credit note to voided
  UPDATE credit_notes SET
    status = 'voided',
    voided_at = now(),
    voided_by = v_user_id,
    void_reason = v_void_reason,
    updated_at = now()
  WHERE id = v_credit_note_id;
  
  -- Build success result
  v_result_payload := jsonb_build_object(
    'success', true,
    'credit_note_id', v_credit_note_id,
    'credit_note_number', v_credit_note.credit_note_number,
    'reversal_journal_entry_id', v_reversal_je_id,
    'reversal_journal_entry_number', v_reversal_je_number,
    'voided_at', now()
  );
  
  PERFORM public.atomic_complete(v_client_request_id, 'credit_note_void', v_result_payload);
  
  RETURN v_result_payload;
END;
$$;

-- Grant execute
GRANT EXECUTE ON FUNCTION public.void_credit_note_atomic(jsonb) TO authenticated;