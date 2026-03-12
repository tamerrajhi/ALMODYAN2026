-- =====================================================
-- P6-6X: ROOT FIX FOR VOID PURCHASE RETURN FAILURES
-- Fix 1: Replace created_by → performed_by in item_movements insert
-- Fix 2: General void should set status='voided' (not 'cancelled') to pass trigger
-- =====================================================

CREATE OR REPLACE FUNCTION public.void_purchase_return_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_client_request_id uuid;
  v_canonical_id uuid;
  v_return_number text;
  v_invoice_id uuid;
  v_voided_by text;
  v_voided_by_uuid uuid;
  v_void_reason text;
  v_workflow_result jsonb;
  v_gate_status text;
  v_return_rec RECORD;
  v_invoice_rec RECORD;
  v_reversal_result jsonb;
  v_result jsonb;
  v_item RECORD;
  v_reversal_je_id uuid;
  v_void_data jsonb;
  v_is_unique boolean := false;
  v_is_general boolean := false;
  v_items_restored_count int := 0;
  v_items_skipped_sold_count int := 0;
  v_mirror_invoice_id uuid;
  v_user_branch_ids uuid[];
  v_line_count int;
BEGIN
  -- ============================
  -- 1. Parse & Validate Input
  -- ============================
  v_client_request_id := (p_payload->>'client_request_id')::uuid;
  
  -- Support nested void object OR flat structure
  v_void_data := p_payload->'void';
  IF v_void_data IS NOT NULL THEN
    v_canonical_id := NULLIF(v_void_data->>'purchase_return_id', '')::uuid;
    v_return_number := NULLIF(v_void_data->>'return_number', '');
    v_invoice_id := NULLIF(v_void_data->>'invoice_id', '')::uuid;
    v_voided_by := COALESCE(v_void_data->>'voided_by', p_payload->>'created_by', 'system');
    v_void_reason := COALESCE(v_void_data->>'reason', 'Voided');
  ELSE
    -- Fallback to flat structure
    v_canonical_id := NULLIF(p_payload->>'return_id', '')::uuid;
    v_return_number := NULLIF(p_payload->>'return_number', '');
    v_invoice_id := NULLIF(p_payload->>'invoice_id', '')::uuid;
    v_voided_by := COALESCE(p_payload->>'created_by', 'system');
    v_void_reason := COALESCE(p_payload->>'void_reason', 'Voided');
  END IF;
  
  -- Try to parse voided_by as UUID
  BEGIN
    v_voided_by_uuid := v_voided_by::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_voided_by_uuid := auth.uid();
  END;

  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'client_request_id is required');
  END IF;

  IF v_canonical_id IS NULL AND v_return_number IS NULL AND v_invoice_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 
      'error', 'At least one of: canonical_id, return_number, or invoice_id is required');
  END IF;

  -- ============================
  -- 2. Advisory Lock
  -- ============================
  PERFORM pg_advisory_xact_lock(abs(hashtext(v_client_request_id::text)));

  -- ============================
  -- 3. Idempotency Gate
  -- ============================
  v_workflow_result := public.begin_workflow_request(v_client_request_id, 'purchase_return_void_atomic', p_payload);
  v_gate_status := v_workflow_result->>'status';

  IF v_gate_status = 'succeeded' THEN
    RETURN (v_workflow_result->'cached_result') || jsonb_build_object('idempotent', true);
  ELSIF v_gate_status = 'conflict' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'IDEMPOTENCY_CONFLICT', 'error', 'client_request_id reused with different payload');
  ELSIF v_gate_status = 'in_progress' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'IN_PROGRESS', 'error', 'Request is already being processed');
  END IF;

  -- ============================
  -- 4. Resolve: Unique Return First
  -- ============================
  SELECT id, return_number, journal_entry_id, status, branch_id, supplier_id, total_amount
  INTO v_return_rec
  FROM public.purchase_returns
  WHERE (id = v_canonical_id) OR (return_number = v_return_number AND v_canonical_id IS NULL)
  FOR UPDATE;

  IF v_return_rec.id IS NOT NULL THEN
    v_is_unique := true;
    v_return_number := v_return_rec.return_number;
  END IF;

  -- ============================
  -- 5. If not Unique, try General (invoice-based)
  -- ============================
  IF NOT v_is_unique THEN
    SELECT id, invoice_number, journal_entry_id, status, branch_id, supplier_id, total_amount
    INTO v_invoice_rec
    FROM public.invoices
    WHERE invoice_type = 'purchase_return'
      AND ((id = v_invoice_id) OR (invoice_number = v_return_number AND v_invoice_id IS NULL))
    FOR UPDATE;

    IF v_invoice_rec.id IS NOT NULL THEN
      -- Check if this is actually a mirror (line_count = 0) - if so, reject
      SELECT COUNT(*) INTO v_line_count
      FROM public.purchase_invoice_lines
      WHERE invoice_id = v_invoice_rec.id;
      
      IF v_line_count = 0 THEN
        PERFORM public.fail_workflow_request(v_client_request_id, 'MIRROR_ONLY', 
          'This is a mirror invoice with no lines. Void the original unique return instead.');
        RETURN jsonb_build_object('success', false, 'error_code', 'MIRROR_ONLY', 
          'error', 'This is a mirror invoice. Void the original unique return instead.');
      END IF;
      
      v_is_general := true;
      v_return_number := v_invoice_rec.invoice_number;
    END IF;
  END IF;

  -- No record found
  IF NOT v_is_unique AND NOT v_is_general THEN
    PERFORM public.fail_workflow_request(v_client_request_id, 'NOT_FOUND', 'Purchase return not found');
    RETURN jsonb_build_object('success', false, 'error_code', 'NOT_FOUND', 'error', 'Purchase return not found');
  END IF;

  -- ============================
  -- 6. Branch Authorization Check
  -- ============================
  SELECT array_agg(branch_id) INTO v_user_branch_ids
  FROM public.user_branches
  WHERE user_id = auth.uid();

  IF v_is_unique THEN
    IF NOT (
      public.has_role(auth.uid(), 'admin') OR 
      v_return_rec.branch_id = ANY(v_user_branch_ids)
    ) THEN
      PERFORM public.fail_workflow_request(v_client_request_id, 'UNAUTHORIZED', 'User not authorized for this branch');
      RETURN jsonb_build_object('success', false, 'error_code', 'UNAUTHORIZED', 'error', 'User not authorized for this branch');
    END IF;
  ELSIF v_is_general THEN
    IF NOT (
      public.has_role(auth.uid(), 'admin') OR 
      v_invoice_rec.branch_id = ANY(v_user_branch_ids)
    ) THEN
      PERFORM public.fail_workflow_request(v_client_request_id, 'UNAUTHORIZED', 'User not authorized for this branch');
      RETURN jsonb_build_object('success', false, 'error_code', 'UNAUTHORIZED', 'error', 'User not authorized for this branch');
    END IF;
  END IF;

  -- ============================
  -- 7A. Process UNIQUE Return Void
  -- ============================
  IF v_is_unique THEN
    -- Status check (idempotent for already voided)
    IF v_return_rec.status IN ('voided', 'cancelled') THEN
      v_result := jsonb_build_object(
        'success', true,
        'return_type', 'unique',
        'purchase_return_id', v_return_rec.id,
        'return_number', v_return_rec.return_number,
        'status', 'voided',
        'already_voided', true,
        'idempotent', true
      );
      PERFORM public.complete_workflow_request(v_client_request_id, v_result);
      RETURN v_result;
    END IF;

    -- Only allow voiding confirmed/posted returns
    IF v_return_rec.status NOT IN ('confirmed', 'posted') THEN
      PERFORM public.fail_workflow_request(v_client_request_id, 'INVALID_STATUS', 'Cannot void return with status: ' || v_return_rec.status);
      RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_STATUS', 
        'error', 'Cannot void return with status: ' || v_return_rec.status);
    END IF;

    -- Reverse Journal Entry
    v_reversal_je_id := NULL;
    IF v_return_rec.journal_entry_id IS NOT NULL THEN
      v_reversal_result := public.reverse_journal_entry_atomic(
        v_return_rec.journal_entry_id,
        v_return_rec.id,
        'purchase_return_void',
        v_voided_by,
        v_return_rec.branch_id,
        'عكس مرتجع مشتريات: ' || v_return_rec.return_number || ' - ' || v_void_reason
      );
      
      IF NOT (v_reversal_result->>'success')::boolean THEN
        PERFORM public.fail_workflow_request(v_client_request_id, 'JE_REVERSAL_FAILED', 
          COALESCE(v_reversal_result->>'error', 'Journal entry reversal failed'));
        RETURN jsonb_build_object('success', false, 'error_code', 'JE_REVERSAL_FAILED', 
          'error', COALESCE(v_reversal_result->>'error', 'Journal entry reversal failed'));
      END IF;
      
      v_reversal_je_id := (v_reversal_result->>'reversal_entry_id')::uuid;
    END IF;

    -- Update purchase_returns status with void metadata
    UPDATE public.purchase_returns
    SET 
      status = 'voided',
      voided_at = now(),
      voided_by = v_voided_by_uuid,
      void_reason = v_void_reason,
      updated_at = now()
    WHERE id = v_return_rec.id;

    -- Restore jewelry items (with sold-after guard)
    FOR v_item IN
      SELECT pri.jewelry_item_id, ji.sale_status, ji.sold_at
      FROM public.purchase_return_items pri
      JOIN public.jewelry_items ji ON ji.id = pri.jewelry_item_id
      WHERE pri.return_id = v_return_rec.id
    LOOP
      -- Skip if item was sold after the return (guard)
      IF v_item.sale_status = 'sold' AND v_item.sold_at IS NOT NULL THEN
        v_items_skipped_sold_count := v_items_skipped_sold_count + 1;
        CONTINUE;
      END IF;
      
      -- Restore item to available at original branch
      UPDATE public.jewelry_items
      SET 
        sale_status = 'available',
        is_available_for_sale = true,
        branch_id = v_return_rec.branch_id,
        sold_at = NULL,
        sale_id = NULL,
        updated_at = now()
      WHERE id = v_item.jewelry_item_id;
      
      v_items_restored_count := v_items_restored_count + 1;
      
      -- FIX: Use performed_by instead of created_by (column doesn't exist)
      INSERT INTO public.item_movements (
        item_id,
        movement_type,
        reference_type,
        reference_id,
        from_branch_id,
        to_branch_id,
        cost,
        notes,
        performed_by
      )
      SELECT 
        v_item.jewelry_item_id,
        'purchase_return_void',
        'purchase_return',
        v_return_rec.id,
        NULL,
        v_return_rec.branch_id,
        ji.cost,
        'Void return: ' || v_return_rec.return_number,
        v_voided_by
      FROM public.jewelry_items ji
      WHERE ji.id = v_item.jewelry_item_id
      ON CONFLICT DO NOTHING;
    END LOOP;

    -- Update Invoice Mirror to cancelled
    v_mirror_invoice_id := NULL;
    SELECT id INTO v_mirror_invoice_id
    FROM public.invoices inv
    WHERE inv.invoice_type = 'purchase_return'
      AND inv.invoice_number = v_return_rec.return_number
      AND NOT EXISTS (
        SELECT 1 FROM public.purchase_invoice_lines pil WHERE pil.invoice_id = inv.id
      );
    
    IF v_mirror_invoice_id IS NOT NULL THEN
      UPDATE public.invoices
      SET 
        status = 'cancelled',
        voided_at = now(),
        voided_by = v_voided_by_uuid,
        void_reason = v_void_reason,
        updated_at = now()
      WHERE id = v_mirror_invoice_id;
    END IF;

    -- Insert Audit Event
    INSERT INTO public.audit_events (
      actor_id,
      action,
      entity_type,
      entity_id,
      entity_number,
      branch_id,
      payload
    )
    SELECT
      v_voided_by_uuid,
      'purchase_return_void',
      'purchase_return_unique',
      v_return_rec.id,
      v_return_rec.return_number,
      v_return_rec.branch_id,
      jsonb_build_object(
        'reason', v_void_reason,
        'journal_entry_id', v_return_rec.journal_entry_id,
        'reversal_je_id', v_reversal_je_id,
        'mirror_invoice_id', v_mirror_invoice_id,
        'items_restored_count', v_items_restored_count,
        'items_skipped_sold_after_void_count', v_items_skipped_sold_count,
        'total_amount', v_return_rec.total_amount
      )
    WHERE NOT EXISTS (
      SELECT 1 FROM public.audit_events ae
      WHERE ae.action = 'purchase_return_void'
        AND ae.entity_type = 'purchase_return_unique'
        AND ae.entity_id = v_return_rec.id
        AND ae.created_at > now() - interval '5 minutes'
    );

    -- Build result
    v_result := jsonb_build_object(
      'success', true,
      'return_type', 'unique',
      'purchase_return_id', v_return_rec.id,
      'return_number', v_return_rec.return_number,
      'status', 'voided',
      'reversal_je_id', v_reversal_je_id,
      'mirror_invoice_id', v_mirror_invoice_id,
      'items_restored_count', v_items_restored_count,
      'items_skipped_sold_after_void_count', v_items_skipped_sold_count
    );
    
    PERFORM public.complete_workflow_request(v_client_request_id, v_result);
    RETURN v_result;
  END IF;

  -- ============================
  -- 7B. Process GENERAL Return Void
  -- ============================
  IF v_is_general THEN
    -- Status check (idempotent for already voided)
    IF v_invoice_rec.status IN ('voided', 'cancelled') THEN
      v_result := jsonb_build_object(
        'success', true,
        'return_type', 'general',
        'invoice_id', v_invoice_rec.id,
        'return_number', v_invoice_rec.invoice_number,
        'status', 'voided',
        'already_voided', true,
        'idempotent', true
      );
      PERFORM public.complete_workflow_request(v_client_request_id, v_result);
      RETURN v_result;
    END IF;

    -- Only allow voiding confirmed/posted returns
    IF v_invoice_rec.status NOT IN ('confirmed', 'posted', 'pending', 'partial') THEN
      PERFORM public.fail_workflow_request(v_client_request_id, 'INVALID_STATUS', 'Cannot void return with status: ' || v_invoice_rec.status);
      RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_STATUS', 
        'error', 'Cannot void return with status: ' || v_invoice_rec.status);
    END IF;

    -- Reverse Journal Entry if exists
    v_reversal_je_id := NULL;
    IF v_invoice_rec.journal_entry_id IS NOT NULL THEN
      v_reversal_result := public.reverse_journal_entry_atomic(
        v_invoice_rec.journal_entry_id,
        v_invoice_rec.id,
        'purchase_return_void',
        v_voided_by,
        v_invoice_rec.branch_id,
        'عكس مرتجع مشتريات عام: ' || v_invoice_rec.invoice_number || ' - ' || v_void_reason
      );
      
      IF NOT (v_reversal_result->>'success')::boolean THEN
        PERFORM public.fail_workflow_request(v_client_request_id, 'JE_REVERSAL_FAILED', 
          COALESCE(v_reversal_result->>'error', 'Journal entry reversal failed'));
        RETURN jsonb_build_object('success', false, 'error_code', 'JE_REVERSAL_FAILED', 
          'error', COALESCE(v_reversal_result->>'error', 'Journal entry reversal failed'));
      END IF;
      
      v_reversal_je_id := (v_reversal_result->>'reversal_entry_id')::uuid;
    END IF;

    -- FIX: Use 'voided' status (not 'cancelled') to pass trigger check
    UPDATE public.invoices
    SET 
      status = 'voided',
      voided_at = now(),
      voided_by = v_voided_by_uuid,
      void_reason = v_void_reason,
      updated_at = now()
    WHERE id = v_invoice_rec.id;

    -- Insert Audit Event
    INSERT INTO public.audit_events (
      actor_id,
      action,
      entity_type,
      entity_id,
      entity_number,
      branch_id,
      payload
    )
    SELECT
      v_voided_by_uuid,
      'purchase_return_void',
      'purchase_return_general',
      v_invoice_rec.id,
      v_invoice_rec.invoice_number,
      v_invoice_rec.branch_id,
      jsonb_build_object(
        'reason', v_void_reason,
        'journal_entry_id', v_invoice_rec.journal_entry_id,
        'reversal_je_id', v_reversal_je_id,
        'line_count', v_line_count,
        'total_amount', v_invoice_rec.total_amount
      )
    WHERE NOT EXISTS (
      SELECT 1 FROM public.audit_events ae
      WHERE ae.action = 'purchase_return_void'
        AND ae.entity_type = 'purchase_return_general'
        AND ae.entity_id = v_invoice_rec.id
        AND ae.created_at > now() - interval '5 minutes'
    );

    -- Build result
    v_result := jsonb_build_object(
      'success', true,
      'return_type', 'general',
      'invoice_id', v_invoice_rec.id,
      'return_number', v_invoice_rec.invoice_number,
      'status', 'voided',
      'reversal_je_id', v_reversal_je_id
    );
    
    PERFORM public.complete_workflow_request(v_client_request_id, v_result);
    RETURN v_result;
  END IF;

  -- Fallback (should never reach)
  PERFORM public.fail_workflow_request(v_client_request_id, 'UNKNOWN', 'Unknown error occurred');
  RETURN jsonb_build_object('success', false, 'error_code', 'UNKNOWN', 'error', 'Unknown error occurred');

EXCEPTION WHEN OTHERS THEN
  PERFORM public.fail_workflow_request(v_client_request_id, 'EXCEPTION', SQLERRM);
  RETURN jsonb_build_object('success', false, 'error_code', 'EXCEPTION', 'error', SQLERRM);
END;
$function$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.void_purchase_return_atomic(jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.void_purchase_return_atomic(jsonb) FROM PUBLIC;