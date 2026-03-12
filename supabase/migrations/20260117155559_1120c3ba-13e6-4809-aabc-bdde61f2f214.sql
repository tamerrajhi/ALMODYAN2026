-- ============================================================================
-- B2-9: Ledger Contract Hardening + Payload Hash + Enhanced Idempotency
-- ============================================================================

-- B2-9A: Add payload_hash column and indexes
ALTER TABLE public.atomic_workflow_requests
ADD COLUMN IF NOT EXISTS payload_hash text;

CREATE INDEX IF NOT EXISTS idx_atomic_workflow_requests_workflow_type
ON public.atomic_workflow_requests (workflow_type);

CREATE INDEX IF NOT EXISTS idx_atomic_workflow_requests_status
ON public.atomic_workflow_requests (status);

CREATE INDEX IF NOT EXISTS idx_atomic_workflow_requests_created_at
ON public.atomic_workflow_requests (created_at DESC);

-- ============================================================================
-- B2-9B/C/D: Enhanced Atomic RPC with payload_hash, replay safety, and 
-- unified result contract
-- ============================================================================

CREATE OR REPLACE FUNCTION public.convert_prs_to_pos_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_client_request_id text;
  v_payload_hash text;
  v_requested_by uuid;
  v_branch_id uuid;
  v_warehouse_id uuid;
  v_pr_ids uuid[];
  v_default_supplier_id uuid;
  v_expected_delivery_date date;
  v_payment_terms text;
  v_delivery_terms text;
  v_notes text;
  v_created_by_name text;
  
  v_existing_request record;
  v_pr_record record;
  v_pr_item record;
  v_item jsonb;
  v_items jsonb;
  
  v_supplier_groups jsonb := '{}';
  v_supplier_id text;
  v_supplier_items jsonb;
  v_po_number text;
  v_new_po_id uuid;
  v_total_amount numeric;
  v_pr_numbers text := '';
  
  v_created_pos jsonb := '[]';
  v_pr_ids_for_po text[];
  v_result jsonb;
  v_meta jsonb;
  
  v_item_pr_id uuid;
  v_item_convert_qty numeric;
  v_item_unit_price numeric;
  v_item_supplier_id uuid;
  v_item_description text;
  v_item_warehouse_id uuid;
  v_item_cost_center_id uuid;
  v_item_pr_item_id uuid;
  
  v_current_converted numeric;
  v_new_converted numeric;
  v_all_converted boolean;
  v_any_converted boolean;
  v_new_status text;
BEGIN
  -- ========================================================================
  -- B2-9B: IDEMPOTENCY WITH PAYLOAD HASH
  -- ========================================================================
  v_client_request_id := p_payload->>'client_request_id';
  
  IF v_client_request_id IS NULL OR v_client_request_id = '' THEN
    RETURN jsonb_build_object(
      'success', false, 
      'error_code', 'VALIDATION',
      'error', 'client_request_id is required'
    );
  END IF;
  
  -- Calculate payload hash using md5 (pgcrypto may not be available)
  v_payload_hash := md5(p_payload::text);
  
  -- Check for existing request with FOR UPDATE lock
  SELECT * INTO v_existing_request
  FROM public.atomic_workflow_requests
  WHERE client_request_id = v_client_request_id
  FOR UPDATE;
  
  IF FOUND THEN
    -- Check for payload hash mismatch (IDEMPOTENCY_CONFLICT)
    IF v_existing_request.payload_hash IS NOT NULL 
       AND v_existing_request.payload_hash <> v_payload_hash THEN
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'IDEMPOTENCY_CONFLICT',
        'error', 'client_request_id reused with different payload'
      );
    END IF;
    
    IF v_existing_request.status = 'success' THEN
      -- Return cached result
      RETURN v_existing_request.result_payload;
    ELSIF v_existing_request.status = 'in_progress' THEN
      RETURN jsonb_build_object(
        'success', false, 
        'error_code', 'IN_PROGRESS',
        'error', 'request is already processing'
      );
    ELSE
      -- Failed before with same payload, allow retry
      UPDATE public.atomic_workflow_requests
      SET status = 'in_progress',
          request_payload = p_payload,
          payload_hash = v_payload_hash,
          error_message = NULL,
          error_code = NULL,
          completed_at = NULL
      WHERE client_request_id = v_client_request_id;
    END IF;
  ELSE
    -- Insert new request with payload_hash
    INSERT INTO public.atomic_workflow_requests (
      client_request_id,
      workflow_type,
      status,
      request_payload,
      payload_hash,
      created_by
    ) VALUES (
      v_client_request_id,
      'convert_prs_to_pos',
      'in_progress',
      p_payload,
      v_payload_hash,
      (p_payload->>'requested_by')::uuid
    );
  END IF;
  
  -- ========================================================================
  -- PARSE PAYLOAD
  -- ========================================================================
  v_requested_by := (p_payload->>'requested_by')::uuid;
  v_branch_id := (p_payload->>'branch_id')::uuid;
  v_warehouse_id := (p_payload->>'warehouse_id')::uuid;
  v_default_supplier_id := (p_payload->>'default_supplier_id')::uuid;
  v_expected_delivery_date := (p_payload->>'expected_delivery_date')::date;
  v_payment_terms := p_payload->>'payment_terms';
  v_delivery_terms := p_payload->>'delivery_terms';
  v_notes := p_payload->>'notes';
  v_created_by_name := p_payload->>'created_by_name';
  v_items := p_payload->'items';
  
  -- Parse PR IDs
  SELECT array_agg(x::uuid)
  INTO v_pr_ids
  FROM jsonb_array_elements_text(p_payload->'pr_ids') AS x;
  
  IF v_pr_ids IS NULL OR array_length(v_pr_ids, 1) = 0 THEN
    UPDATE public.atomic_workflow_requests
    SET status = 'failed', 
        error_code = 'VALIDATION',
        error_message = 'pr_ids is required', 
        completed_at = now()
    WHERE client_request_id = v_client_request_id;
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'pr_ids is required');
  END IF;
  
  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
    UPDATE public.atomic_workflow_requests
    SET status = 'failed', 
        error_code = 'VALIDATION',
        error_message = 'items is required', 
        completed_at = now()
    WHERE client_request_id = v_client_request_id;
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'items is required');
  END IF;
  
  -- ========================================================================
  -- B2-7.3: CONCURRENCY LOCKING - Lock PRs
  -- ========================================================================
  FOR v_pr_record IN
    SELECT id, status, requisition_number
    FROM public.purchase_requisitions
    WHERE id = ANY(v_pr_ids)
    ORDER BY id
    FOR UPDATE
  LOOP
    -- Validate PR status
    IF v_pr_record.status NOT IN ('approved', 'partially_converted') THEN
      UPDATE public.atomic_workflow_requests
      SET status = 'failed', 
          error_code = 'VALIDATION',
          error_message = format('PR %s has invalid status: %s', v_pr_record.requisition_number, v_pr_record.status),
          completed_at = now()
      WHERE client_request_id = v_client_request_id;
      RETURN jsonb_build_object(
        'success', false, 
        'error_code', 'VALIDATION',
        'error', format('طلب الشراء %s في حالة غير مسموحة: %s', v_pr_record.requisition_number, v_pr_record.status)
      );
    END IF;
    
    -- Build PR numbers string
    IF v_pr_numbers = '' THEN
      v_pr_numbers := v_pr_record.requisition_number;
    ELSE
      v_pr_numbers := v_pr_numbers || ', ' || v_pr_record.requisition_number;
    END IF;
  END LOOP;
  
  -- Check we found all PRs
  IF NOT EXISTS (SELECT 1 FROM public.purchase_requisitions WHERE id = ANY(v_pr_ids)) THEN
    UPDATE public.atomic_workflow_requests
    SET status = 'failed', 
        error_code = 'VALIDATION',
        error_message = 'No PRs found with given IDs', 
        completed_at = now()
    WHERE client_request_id = v_client_request_id;
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'No PRs found with given IDs');
  END IF;
  
  -- ========================================================================
  -- B2-7.4: VALIDATE ITEMS AND GROUP BY SUPPLIER
  -- ========================================================================
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_item_pr_item_id := (v_item->>'prItemId')::uuid;
    v_item_convert_qty := COALESCE((v_item->>'convertQuantity')::numeric, 0);
    v_item_unit_price := COALESCE((v_item->>'unitPrice')::numeric, 0);
    v_item_supplier_id := COALESCE((v_item->>'supplierId')::uuid, v_default_supplier_id);
    
    -- Skip items with zero quantity
    IF v_item_convert_qty <= 0 THEN
      CONTINUE;
    END IF;
    
    -- Validate supplier exists
    IF v_item_supplier_id IS NULL THEN
      UPDATE public.atomic_workflow_requests
      SET status = 'failed', 
          error_code = 'VALIDATION',
          error_message = 'All items must have a supplier', 
          completed_at = now()
      WHERE client_request_id = v_client_request_id;
      RETURN jsonb_build_object(
        'success', false, 
        'error_code', 'VALIDATION',
        'error', 'برجاء اختيار مورد لأمر الشراء أو لكل بند قبل الحفظ'
      );
    END IF;
    
    -- Lock and validate PR item
    SELECT pri.id, pri.requisition_id, pri.quantity, COALESCE(pri.converted_quantity, 0) as converted_quantity,
           pri.item_description, pri.warehouse_id, pri.cost_center_id
    INTO v_pr_item
    FROM public.purchase_requisition_items pri
    WHERE pri.id = v_item_pr_item_id
    FOR UPDATE;
    
    IF NOT FOUND THEN
      UPDATE public.atomic_workflow_requests
      SET status = 'failed', 
          error_code = 'VALIDATION',
          error_message = format('PR item not found: %s', v_item_pr_item_id), 
          completed_at = now()
      WHERE client_request_id = v_client_request_id;
      RETURN jsonb_build_object(
        'success', false, 
        'error_code', 'VALIDATION',
        'error', format('بند طلب الشراء غير موجود: %s', v_item_pr_item_id)
      );
    END IF;
    
    -- Validate item belongs to one of the PRs
    IF NOT (v_pr_item.requisition_id = ANY(v_pr_ids)) THEN
      UPDATE public.atomic_workflow_requests
      SET status = 'failed', 
          error_code = 'VALIDATION',
          error_message = 'Item does not belong to selected PRs', 
          completed_at = now()
      WHERE client_request_id = v_client_request_id;
      RETURN jsonb_build_object(
        'success', false, 
        'error_code', 'VALIDATION',
        'error', 'البند لا ينتمي لطلبات الشراء المحددة'
      );
    END IF;
    
    -- Validate quantity
    IF v_item_convert_qty > (v_pr_item.quantity - v_pr_item.converted_quantity) THEN
      UPDATE public.atomic_workflow_requests
      SET status = 'failed', 
          error_code = 'VALIDATION',
          error_message = format('Convert quantity exceeds available for item %s', v_pr_item.item_description),
          completed_at = now()
      WHERE client_request_id = v_client_request_id;
      RETURN jsonb_build_object(
        'success', false, 
        'error_code', 'VALIDATION',
        'error', format('الكمية المطلوب تحويلها (%s) أكبر من المتاح (%s) للبند: %s', 
               v_item_convert_qty, v_pr_item.quantity - v_pr_item.converted_quantity, v_pr_item.item_description)
      );
    END IF;
    
    -- Group by supplier
    v_supplier_id := v_item_supplier_id::text;
    IF NOT v_supplier_groups ? v_supplier_id THEN
      v_supplier_groups := v_supplier_groups || jsonb_build_object(v_supplier_id, '[]'::jsonb);
    END IF;
    
    v_supplier_groups := jsonb_set(
      v_supplier_groups,
      ARRAY[v_supplier_id],
      (v_supplier_groups->v_supplier_id) || jsonb_build_array(
        jsonb_build_object(
          'prItemId', v_item_pr_item_id,
          'requisitionId', v_pr_item.requisition_id,
          'convertQuantity', v_item_convert_qty,
          'unitPrice', v_item_unit_price,
          'description', COALESCE(v_item->>'description', v_pr_item.item_description),
          'warehouseId', COALESCE((v_item->>'warehouseId')::uuid, v_pr_item.warehouse_id, v_warehouse_id),
          'costCenterId', COALESCE((v_item->>'costCenterId')::uuid, v_pr_item.cost_center_id)
        )
      )
    );
  END LOOP;
  
  -- Check we have items to convert
  IF v_supplier_groups = '{}'::jsonb THEN
    UPDATE public.atomic_workflow_requests
    SET status = 'failed', 
        error_code = 'VALIDATION',
        error_message = 'No items to convert', 
        completed_at = now()
    WHERE client_request_id = v_client_request_id;
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'الرجاء تحديد بند واحد على الأقل');
  END IF;
  
  -- ========================================================================
  -- B2-7.4: CREATE POs FOR EACH SUPPLIER GROUP
  -- ========================================================================
  FOR v_supplier_id IN SELECT * FROM jsonb_object_keys(v_supplier_groups)
  LOOP
    v_supplier_items := v_supplier_groups->v_supplier_id;
    
    -- Generate PO number
    SELECT public.generate_po_number() INTO v_po_number;
    
    -- Calculate total
    SELECT COALESCE(SUM(
      (item->>'convertQuantity')::numeric * (item->>'unitPrice')::numeric
    ), 0)
    INTO v_total_amount
    FROM jsonb_array_elements(v_supplier_items) AS item;
    
    -- Insert PO
    INSERT INTO public.purchase_orders (
      po_number,
      supplier_id,
      branch_id,
      warehouse_id,
      order_date,
      expected_delivery_date,
      status,
      order_type,
      total_amount,
      payment_terms,
      delivery_terms,
      notes,
      created_by
    ) VALUES (
      v_po_number,
      v_supplier_id::uuid,
      v_branch_id,
      v_warehouse_id,
      CURRENT_DATE,
      v_expected_delivery_date,
      'draft',
      'gold',
      v_total_amount,
      v_payment_terms,
      v_delivery_terms,
      COALESCE(v_notes, 'تم إنشاؤه من طلب/طلبات الشراء: ' || v_pr_numbers),
      v_created_by_name
    )
    RETURNING id INTO v_new_po_id;
    
    -- Insert PO items
    INSERT INTO public.purchase_order_items (
      po_id,
      item_type,
      description,
      quantity,
      unit_price,
      total_price,
      pr_item_id,
      warehouse_id,
      cost_center_id,
      supplier_id
    )
    SELECT 
      v_new_po_id,
      'jewelry',
      item->>'description',
      (item->>'convertQuantity')::numeric,
      (item->>'unitPrice')::numeric,
      (item->>'convertQuantity')::numeric * (item->>'unitPrice')::numeric,
      (item->>'prItemId')::uuid,
      (item->>'warehouseId')::uuid,
      (item->>'costCenterId')::uuid,
      v_supplier_id::uuid
    FROM jsonb_array_elements(v_supplier_items) AS item;
    
    -- Collect unique PR IDs for this PO
    SELECT array_agg(DISTINCT (item->>'requisitionId')::text)
    INTO v_pr_ids_for_po
    FROM jsonb_array_elements(v_supplier_items) AS item;
    
    -- Insert po_pr_links (with ON CONFLICT DO NOTHING for safety)
    INSERT INTO public.po_pr_links (po_id, pr_id, created_by)
    SELECT v_new_po_id, pr_id::uuid, v_requested_by
    FROM unnest(v_pr_ids_for_po) AS pr_id
    ON CONFLICT DO NOTHING;
    
    -- Update converted_quantity for PR items in this group
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_supplier_items)
    LOOP
      UPDATE public.purchase_requisition_items
      SET converted_quantity = COALESCE(converted_quantity, 0) + (v_item->>'convertQuantity')::numeric
      WHERE id = (v_item->>'prItemId')::uuid;
    END LOOP;
    
    -- Add to result
    v_created_pos := v_created_pos || jsonb_build_array(
      jsonb_build_object(
        'poId', v_new_po_id,
        'poNumber', v_po_number,
        'supplierId', v_supplier_id,
        'prIds', v_pr_ids_for_po
      )
    );
  END LOOP;
  
  -- ========================================================================
  -- UPDATE PR STATUSES
  -- ========================================================================
  FOR v_pr_record IN
    SELECT pr.id, pr.requisition_number
    FROM public.purchase_requisitions pr
    WHERE pr.id = ANY(v_pr_ids)
  LOOP
    -- Check if all items are converted
    SELECT 
      bool_and(COALESCE(converted_quantity, 0) >= quantity),
      bool_or(COALESCE(converted_quantity, 0) > 0)
    INTO v_all_converted, v_any_converted
    FROM public.purchase_requisition_items
    WHERE requisition_id = v_pr_record.id;
    
    IF v_all_converted THEN
      v_new_status := 'fully_converted';
    ELSIF v_any_converted THEN
      v_new_status := 'partially_converted';
    ELSE
      v_new_status := NULL;
    END IF;
    
    IF v_new_status IS NOT NULL THEN
      UPDATE public.purchase_requisitions
      SET status = v_new_status,
          converted_at = CASE WHEN v_new_status = 'fully_converted' THEN now() ELSE converted_at END
      WHERE id = v_pr_record.id;
      
      -- Insert approval history
      INSERT INTO public.pr_approval_history (
        requisition_id,
        action,
        action_by,
        action_by_name,
        comments
      ) VALUES (
        v_pr_record.id,
        CASE WHEN v_new_status = 'fully_converted' THEN 'converted' ELSE 'partially_converted' END,
        v_requested_by,
        v_created_by_name,
        'تم التحويل إلى أمر/أوامر شراء: ' || (
          SELECT string_agg(po->>'poNumber', ', ')
          FROM jsonb_array_elements(v_created_pos) AS po
        )
      );
    END IF;
  END LOOP;
  
  -- ========================================================================
  -- INSERT AUDIT LOG
  -- ========================================================================
  INSERT INTO public.audit_logs (
    action_type,
    entity_type,
    entity_id,
    description,
    user_id,
    user_name
  )
  SELECT 
    'Create',
    'PurchaseOrder',
    (po->>'poId')::uuid,
    'إنشاء أمر شراء من طلب/طلبات: ' || v_pr_numbers,
    v_requested_by,
    v_created_by_name
  FROM jsonb_array_elements(v_created_pos) AS po;
  
  -- ========================================================================
  -- B2-9C: SUCCESS WITH META
  -- ========================================================================
  v_meta := jsonb_build_object(
    'workflowType', 'convert_prs_to_pos',
    'clientRequestId', v_client_request_id,
    'payloadHash', v_payload_hash
  );
  
  v_result := jsonb_build_object(
    'success', true,
    'createdPOs', v_created_pos,
    'meta', v_meta
  );
  
  UPDATE public.atomic_workflow_requests
  SET status = 'success',
      result_payload = v_result,
      completed_at = now()
  WHERE client_request_id = v_client_request_id;
  
  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  -- B2-9D: Error Hygiene - store detailed error, return sanitized
  UPDATE public.atomic_workflow_requests
  SET status = 'failed',
      error_code = COALESCE(SQLSTATE, 'DB_ERROR'),
      error_message = SQLERRM,
      completed_at = now()
  WHERE client_request_id = v_client_request_id;
  
  RETURN jsonb_build_object(
    'success', false, 
    'error_code', 'DB_ERROR',
    'error', 'DB_ERROR: ' || SQLERRM
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.convert_prs_to_pos_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convert_prs_to_pos_atomic(jsonb) TO service_role;