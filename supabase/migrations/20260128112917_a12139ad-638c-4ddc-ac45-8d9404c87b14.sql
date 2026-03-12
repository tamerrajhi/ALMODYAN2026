-- ============================================
-- D2-6: Block Legacy invoice_id for General Returns
-- General void must use purchase_return_id (canonical) only
-- ============================================

CREATE OR REPLACE FUNCTION public.void_purchase_return_atomic(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_client_request_id uuid;
  v_canonical_id uuid;
  v_return_number text;
  v_invoice_id uuid;  -- Legacy fallback for UNIQUE only
  v_voided_by text;
  v_voided_by_uuid uuid;
  v_void_reason text;
  v_workflow_result jsonb;
  v_gate_status text;
  v_return_rec RECORD;
  v_reversal_result jsonb;
  v_result jsonb;
  v_item RECORD;
  v_reversal_je_id uuid;
  v_void_data jsonb;
  v_return_type text;
  v_items_restored_count int := 0;
  v_items_skipped_sold_count int := 0;
  v_mirror_invoice_id uuid;
  v_user_branch_ids uuid[];
  v_movements_reversed_count int := 0;
  v_requested_return_type text;  -- D2-6: Track requested type from payload
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
    v_invoice_id := NULLIF(v_void_data->>'invoice_id', '')::uuid;  -- Legacy fallback
    v_voided_by := COALESCE(v_void_data->>'voided_by', v_void_data->>'performed_by', p_payload->>'created_by', 'system');
    v_void_reason := COALESCE(v_void_data->>'reason', 'Voided');
    v_requested_return_type := NULLIF(v_void_data->>'return_type', '');  -- D2-6
  ELSE
    -- Fallback to flat structure
    v_canonical_id := NULLIF(p_payload->>'purchase_return_id', '')::uuid;
    IF v_canonical_id IS NULL THEN
      v_canonical_id := NULLIF(p_payload->>'return_id', '')::uuid;
    END IF;
    v_return_number := NULLIF(p_payload->>'return_number', '');
    v_invoice_id := NULLIF(p_payload->>'invoice_id', '')::uuid;  -- Legacy fallback
    v_voided_by := COALESCE(p_payload->>'voided_by', p_payload->>'performed_by', p_payload->>'created_by', 'system');
    v_void_reason := COALESCE(p_payload->>'void_reason', p_payload->>'reason', 'Voided');
    v_requested_return_type := NULLIF(p_payload->>'return_type', '');  -- D2-6
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

  -- ============================
  -- D2-6: Block invoice_id-only for General returns
  -- ============================
  IF v_canonical_id IS NULL AND v_return_number IS NULL AND v_invoice_id IS NOT NULL THEN
    -- invoice_id only provided - check if requested type is general
    IF v_requested_return_type = 'general' THEN
      RETURN jsonb_build_object(
        'success', false, 
        'error_code', 'LEGACY_INPUT_BLOCKED', 
        'error', 'General return void must use purchase_return_id (canonical). invoice_id is blocked post-cutover.'
      );
    END IF;
    -- For unique or unspecified type, allow legacy fallback (will resolve below)
  END IF;

  IF v_canonical_id IS NULL AND v_return_number IS NULL AND v_invoice_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 
      'error', 'At least one of: purchase_return_id, return_number, or invoice_id is required');
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
  -- 4. CANONICAL RESOLUTION: Both Unique & General from purchase_returns
  -- ============================
  SELECT 
    id, 
    return_number, 
    journal_entry_id, 
    status, 
    branch_id, 
    supplier_id, 
    total_amount,
    purchase_type,
    purchase_invoice_id
  INTO v_return_rec
  FROM public.purchase_returns
  WHERE (id = v_canonical_id) 
     OR (return_number = v_return_number AND v_canonical_id IS NULL)
  FOR UPDATE;

  -- Determine return type from purchase_type
  IF v_return_rec.id IS NOT NULL THEN
    IF v_return_rec.purchase_type = 'general' THEN
      v_return_type := 'general';
    ELSE
      -- import, unique, or null defaults to unique
      v_return_type := 'unique';
    END IF;
    v_return_number := v_return_rec.return_number;
  END IF;

  -- ============================
  -- 5. Legacy Fallback: invoice_id for UNIQUE returns ONLY (D2-6 hardened)
  -- General returns MUST use canonical purchase_return_id
  -- ============================
  IF v_return_rec.id IS NULL AND v_invoice_id IS NOT NULL THEN
    -- D2-6: Try to find UNIQUE return only via invoice linkage
    -- Block general returns from using this fallback path
    SELECT 
      pr.id, 
      pr.return_number, 
      pr.journal_entry_id, 
      pr.status, 
      pr.branch_id, 
      pr.supplier_id, 
      pr.total_amount,
      pr.purchase_type,
      pr.purchase_invoice_id
    INTO v_return_rec
    FROM public.purchase_returns pr
    JOIN public.invoices inv ON inv.journal_entry_id = pr.journal_entry_id
    WHERE inv.id = v_invoice_id
      AND inv.invoice_type = 'purchase_return'
      AND pr.purchase_type != 'general'  -- D2-6: Exclude general from legacy fallback
    FOR UPDATE OF pr;
    
    IF v_return_rec.id IS NOT NULL THEN
      v_return_type := 'unique';
      v_return_number := v_return_rec.return_number;
    ELSE
      -- D2-6: If invoice_id was provided but no unique return found, 
      -- check if there's a general return that should have used canonical
      PERFORM 1 
      FROM public.purchase_returns pr
      JOIN public.invoices inv ON inv.journal_entry_id = pr.journal_entry_id
      WHERE inv.id = v_invoice_id
        AND inv.invoice_type = 'purchase_return'
        AND pr.purchase_type = 'general';
      
      IF FOUND THEN
        PERFORM public.fail_workflow_request(v_client_request_id, 'LEGACY_INPUT_BLOCKED', 
          'General return found but invoice_id input is blocked. Use purchase_return_id instead.');
        RETURN jsonb_build_object(
          'success', false, 
          'error_code', 'LEGACY_INPUT_BLOCKED', 
          'error', 'General return void must use purchase_return_id (canonical). invoice_id is blocked post-cutover.'
        );
      END IF;
    END IF;
  END IF;

  -- No record found
  IF v_return_rec.id IS NULL THEN
    PERFORM public.fail_workflow_request(v_client_request_id, 'NOT_FOUND', 'Purchase return not found');
    RETURN jsonb_build_object('success', false, 'error_code', 'NOT_FOUND', 'error', 'Purchase return not found');
  END IF;

  -- ============================
  -- 6. Branch Authorization Check
  -- ============================
  SELECT array_agg(branch_id) INTO v_user_branch_ids
  FROM public.user_branches
  WHERE user_id = auth.uid();

  IF NOT (
    public.has_role(auth.uid(), 'admin') OR 
    v_return_rec.branch_id = ANY(v_user_branch_ids)
  ) THEN
    PERFORM public.fail_workflow_request(v_client_request_id, 'UNAUTHORIZED', 'User not authorized for this branch');
    RETURN jsonb_build_object('success', false, 'error_code', 'UNAUTHORIZED', 'error', 'User not authorized for this branch');
  END IF;

  -- ============================
  -- 7. Status Guard (Idempotent for already voided)
  -- ============================
  IF v_return_rec.status IN ('voided', 'cancelled') THEN
    v_result := jsonb_build_object(
      'success', true,
      'return_type', v_return_type,
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
  IF v_return_rec.status NOT IN ('confirmed', 'posted', 'pending', 'partial') THEN
    PERFORM public.fail_workflow_request(v_client_request_id, 'INVALID_STATUS', 'Cannot void return with status: ' || v_return_rec.status);
    RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_STATUS', 
      'error', 'Cannot void return with status: ' || v_return_rec.status);
  END IF;

  -- ============================
  -- 8. JE Reversal (Both Unique & General)
  -- ============================
  v_reversal_je_id := NULL;
  IF v_return_rec.journal_entry_id IS NOT NULL THEN
    v_reversal_result := public.reverse_journal_entry_atomic(
      v_return_rec.journal_entry_id,
      v_return_rec.id,
      'purchase_return_void',
      v_voided_by,
      v_return_rec.branch_id,
      'عكس مرتجع مشتريات ' || COALESCE(v_return_type, '') || ': ' || v_return_rec.return_number || ' - ' || v_void_reason
    );
    
    IF NOT (v_reversal_result->>'success')::boolean THEN
      PERFORM public.fail_workflow_request(v_client_request_id, 'JE_REVERSAL_FAILED', 
        COALESCE(v_reversal_result->>'error', 'Journal entry reversal failed'));
      RETURN jsonb_build_object('success', false, 'error_code', 'JE_REVERSAL_FAILED', 
        'error', COALESCE(v_reversal_result->>'error', 'Journal entry reversal failed'));
    END IF;
    
    v_reversal_je_id := (v_reversal_result->>'reversal_entry_id')::uuid;
  END IF;

  -- ============================
  -- 9. Update purchase_returns status (CANONICAL for BOTH types)
  -- ============================
  UPDATE public.purchase_returns
  SET 
    status = 'voided',
    voided_at = now(),
    voided_by = v_voided_by_uuid,
    void_reason = v_void_reason,
    updated_at = now()
  WHERE id = v_return_rec.id;

  -- ============================
  -- 10A. UNIQUE: Restore jewelry items
  -- ============================
  IF v_return_type = 'unique' THEN
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
      
      -- Create void movement record
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

    -- Update Invoice Mirror to cancelled (for unique returns that have mirrors)
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
  END IF;

  -- ============================
  -- 10B. GENERAL: Handle stock reversal if movements exist
  -- D2-5.1: NO INVOICE UPDATE for general - canonical only
  -- D2-6: General must use canonical path only
  -- ============================
  IF v_return_type = 'general' THEN
    v_mirror_invoice_id := NULL;  -- General returns do not update invoices
    
    -- Check for any raw_material_movements linked to this return
    FOR v_item IN
      SELECT rmm.id, rmm.material_id, rmm.product_id, rmm.branch_id, 
             rmm.quantity, rmm.unit_cost, rmm.movement_type
      FROM public.raw_material_movements rmm
      WHERE rmm.reference_type = 'purchase_return'
        AND rmm.reference_id = v_return_rec.id
    LOOP
      -- Create reversal movement (opposite quantity)
      INSERT INTO public.raw_material_movements (
        branch_id,
        material_id,
        product_id,
        movement_type,
        quantity,
        unit_cost,
        total_cost,
        reference_type,
        reference_id,
        reference_code,
        performed_by,
        notes,
        movement_date
      ) VALUES (
        v_item.branch_id,
        v_item.material_id,
        v_item.product_id,
        'purchase_return',
        -v_item.quantity,
        v_item.unit_cost,
        -v_item.quantity * COALESCE(v_item.unit_cost, 0),
        'purchase_return_void',
        v_return_rec.id,
        v_return_rec.return_number,
        v_voided_by,
        '[VOID_REVERSAL] return_id=' || v_return_rec.id::text,
        now()
      );
      
      -- Update raw_materials_stock if stock record exists
      UPDATE public.raw_materials_stock rms
      SET 
        quantity = rms.quantity - v_item.quantity,
        updated_at = now()
      WHERE rms.material_id = v_item.material_id
        AND (rms.branch_id = v_item.branch_id OR (rms.branch_id IS NULL AND v_item.branch_id IS NULL));
      
      v_movements_reversed_count := v_movements_reversed_count + 1;
    END LOOP;
  END IF;

  -- ============================
  -- 11. Insert Audit Event
  -- ============================
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
    CASE WHEN v_return_type = 'unique' THEN 'purchase_return_unique' ELSE 'purchase_return_general' END,
    v_return_rec.id,
    v_return_rec.return_number,
    v_return_rec.branch_id,
    jsonb_build_object(
      'reason', v_void_reason,
      'return_type', v_return_type,
      'journal_entry_id', v_return_rec.journal_entry_id,
      'reversal_je_id', v_reversal_je_id,
      'mirror_invoice_id', v_mirror_invoice_id,
      'items_restored_count', v_items_restored_count,
      'items_skipped_sold_after_void_count', v_items_skipped_sold_count,
      'movements_reversed_count', v_movements_reversed_count,
      'total_amount', v_return_rec.total_amount
    )
  WHERE NOT EXISTS (
    SELECT 1 FROM public.audit_events ae
    WHERE ae.action = 'purchase_return_void'
      AND ae.entity_id = v_return_rec.id
      AND ae.created_at > now() - interval '5 minutes'
  );

  -- ============================
  -- 12. Build Result
  -- ============================
  v_result := jsonb_build_object(
    'success', true,
    'return_type', v_return_type,
    'purchase_return_id', v_return_rec.id,
    'return_number', v_return_rec.return_number,
    'status', 'voided',
    'status_before', v_return_rec.status,
    'status_after', 'voided',
    'journal_entry_id', v_return_rec.journal_entry_id,
    'reversal_je_id', v_reversal_je_id,
    'mirror_invoice_id', v_mirror_invoice_id,
    'items_restored_count', v_items_restored_count,
    'items_skipped_sold_after_void_count', v_items_skipped_sold_count,
    'stock_reversal_movements_created', v_movements_reversed_count
  );
  
  PERFORM public.complete_workflow_request(v_client_request_id, v_result);
  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  PERFORM public.fail_workflow_request(v_client_request_id, 'EXCEPTION', SQLERRM);
  RETURN jsonb_build_object('success', false, 'error_code', 'EXCEPTION', 'error', SQLERRM);
END;
$function$;

-- D2-6 Documentation
COMMENT ON FUNCTION public.void_purchase_return_atomic(jsonb) IS 
'D2-5.1: General returns update only purchase_returns (canonical). No invoice updates for general.
D2-6: General return void MUST use purchase_return_id (canonical). invoice_id input is blocked post-cutover.
Unique returns may still use legacy invoice_id fallback if needed.';