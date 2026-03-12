-- ============================================================
-- PR-1: Atomic Void Purchase Return RPC (without workflow_types)
-- ============================================================

CREATE OR REPLACE FUNCTION public.void_purchase_return_atomic(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_client_request_id UUID;
  v_user_name TEXT;
  v_return_id UUID;
  v_return_type TEXT;
  v_void_reason TEXT;
  v_void_date DATE;
  v_payload_hash TEXT;
  v_return_record RECORD;
  v_original_je_id UUID;
  v_reversal_je_id UUID;
  v_reversal_entry_number TEXT;
  v_items RECORD;
  v_workflow_state TEXT;
BEGIN
  v_client_request_id := (p_payload->>'client_request_id')::UUID;
  v_user_name := COALESCE(p_payload->>'user_name', 'system');
  v_return_id := (p_payload->>'return_id')::UUID;
  v_return_type := COALESCE(p_payload->>'return_type', 'unique');
  v_void_reason := COALESCE(p_payload->>'void_reason', 'Voided by user');
  v_void_date := COALESCE((p_payload->>'void_date')::DATE, CURRENT_DATE);
  v_payload_hash := md5(p_payload::TEXT);

  -- Idempotency gate
  SELECT * INTO v_workflow_state FROM begin_workflow_request(v_client_request_id::TEXT, 'purchase_return_void', v_payload_hash);

  IF v_workflow_state = 'succeeded' THEN
    RETURN (SELECT result_payload FROM pos_workflow_requests WHERE client_request_id = v_client_request_id::TEXT LIMIT 1);
  ELSIF v_workflow_state = 'in_progress' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'IN_PROGRESS', 'error', 'Request in progress');
  ELSIF v_workflow_state = 'conflict' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'IDEMPOTENCY_CONFLICT', 'error', 'Payload conflict');
  END IF;

  -- Lock and fetch return
  SELECT * INTO v_return_record FROM purchase_returns WHERE id = v_return_id FOR UPDATE;
  
  IF NOT FOUND THEN
    PERFORM core_workflow_failed(v_client_request_id::TEXT, 'RETURN_NOT_FOUND', 'Return not found');
    RETURN jsonb_build_object('success', false, 'error_code', 'RETURN_NOT_FOUND', 'error', 'Return not found');
  END IF;
  
  IF v_return_record.status IN ('voided', 'cancelled') THEN
    PERFORM core_workflow_success(v_client_request_id::TEXT, jsonb_build_object('success', true, 'alreadyVoided', true, 'returnId', v_return_id, 'returnNumber', v_return_record.return_number));
    RETURN jsonb_build_object('success', true, 'alreadyVoided', true, 'returnId', v_return_id, 'returnNumber', v_return_record.return_number);
  END IF;
  
  v_original_je_id := v_return_record.journal_entry_id;

  -- Create reversal JE if needed
  IF v_original_je_id IS NOT NULL THEN
    SELECT COALESCE(prefix, 'JE-') || LPAD((COALESCE(next_value, 1))::TEXT, COALESCE(padding, 5), '0') INTO v_reversal_entry_number FROM code_sequences WHERE id = 'journal_entry' FOR UPDATE;
    UPDATE code_sequences SET next_value = COALESCE(next_value, 1) + 1, updated_at = NOW() WHERE id = 'journal_entry';
    
    INSERT INTO journal_entries (entry_number, entry_date, description, reference_type, reference_id, is_posted, posted_at, posted_by, total_debit, total_credit, created_by, branch_id)
    SELECT v_reversal_entry_number, v_void_date, 'عكس مرتجع - ' || v_return_record.return_number, 'purchase_return_void', v_return_id, true, NOW(), v_user_name, je.total_credit, je.total_debit, v_user_name, je.branch_id
    FROM journal_entries je WHERE je.id = v_original_je_id
    RETURNING id INTO v_reversal_je_id;
    
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    SELECT v_reversal_je_id, jel.account_id, jel.credit_amount, jel.debit_amount, 'عكس: ' || COALESCE(jel.description, '')
    FROM journal_entry_lines jel WHERE jel.journal_entry_id = v_original_je_id;
    
    UPDATE journal_entries SET is_reversed = true, reversed_by_entry_id = v_reversal_je_id, reversal_reason = v_void_reason WHERE id = v_original_je_id;
  END IF;

  -- Restore jewelry items
  FOR v_items IN SELECT jewelry_item_id FROM purchase_return_items WHERE return_id = v_return_id AND jewelry_item_id IS NOT NULL LOOP
    UPDATE jewelry_items SET sale_status = 'available', sold_at = NULL WHERE id = v_items.jewelry_item_id;
    INSERT INTO item_movements (item_id, movement_type, to_branch_id, reference_type, reference_id, notes, performed_by, movement_date, return_id)
    VALUES (v_items.jewelry_item_id, 'RETURN_VOID', v_return_record.branch_id, 'purchase_return_void', v_return_id, 'إلغاء مرتجع', v_user_name, NOW(), v_return_id);
  END LOOP;

  UPDATE purchase_returns SET status = 'voided', notes = COALESCE(notes, '') || E'\n[Voided] ' || v_void_reason, updated_at = NOW() WHERE id = v_return_id;

  PERFORM core_workflow_success(v_client_request_id::TEXT, jsonb_build_object('success', true, 'returnId', v_return_id, 'returnNumber', v_return_record.return_number, 'voided', true, 'reversalJournalEntryId', v_reversal_je_id, 'reversalEntryNumber', v_reversal_entry_number));
  RETURN jsonb_build_object('success', true, 'returnId', v_return_id, 'returnNumber', v_return_record.return_number, 'voided', true, 'reversalJournalEntryId', v_reversal_je_id, 'reversalEntryNumber', v_reversal_entry_number);

EXCEPTION WHEN OTHERS THEN
  PERFORM core_workflow_failed(v_client_request_id::TEXT, 'ERROR', SQLERRM);
  RETURN jsonb_build_object('success', false, 'error_code', 'ERROR', 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.void_purchase_return_atomic(JSONB) TO authenticated;