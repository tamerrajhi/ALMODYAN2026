-- ============================================================================
-- B2-10: Fix convert_prs_to_pos_atomic to use canonical workflow functions
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
  
  v_begin_result jsonb;
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
  -- B2-10: USE CANONICAL WORKFLOW FUNCTIONS FOR IDEMPOTENCY
  -- ========================================================================
  v_client_request_id := p_payload->>'client_request_id';
  
  IF v_client_request_id IS NULL OR v_client_request_id = '' THEN
    RETURN jsonb_build_object(
      'success', false, 
      'error_code', 'VALIDATION',
      'error', 'client_request_id is required'
    );
  END IF;
  
  -- Calculate payload hash using md5
  v_payload_hash := md5(p_payload::text);
  
  -- Use canonical begin_workflow_request function
  -- This handles idempotency, payload_hash check, and locking
  v_begin_result := public.begin_workflow_request(
    v_client_request_id,
    'convert_prs_to_pos',
    p_payload
  );
  
  -- Check begin result
  IF v_begin_result->>'status' = 'DUPLICATE' THEN
    -- Request was already processed successfully, return cached result
    RETURN v_begin_result->'cached_result';
  ELSIF v_begin_result->>'status' = 'IN_PROGRESS' THEN
    -- Request is currently being processed
    RETURN jsonb_build_object(
      'success', false, 
      'error_code', 'IN_PROGRESS',
      'error', 'request is already processing'
    );
  ELSIF v_begin_result->>'status' = 'CONFLICT' THEN
    -- Payload hash mismatch
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'IDEMPOTENCY_CONFLICT',
      'error', 'client_request_id reused with different payload'
    );
  ELSIF v_begin_result->>'status' != 'OK' AND v_begin_result->>'status' != 'RETRY' THEN
    -- Unknown status from begin_workflow_request
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'WORKFLOW_ERROR',
      'error', COALESCE(v_begin_result->>'error', 'Failed to begin workflow request')
    );
  END IF;
  
  -- Status is OK or RETRY - proceed with processing
  
  -- ========================================================================
  -- PARSE PAYLOAD
  -- ========================================================================
  v_requested_by := (p_payload->>'requested_by')::uuid;
  v_branch_id := (p_payload->>'branch_id')::uuid;
  v_warehouse_id := NULLIF(p_payload->>'warehouse_id', '')::uuid;
  v_default_supplier_id := NULLIF(p_payload->>'default_supplier_id', '')::uuid;
  v_expected_delivery_date := NULLIF(p_payload->>'expected_delivery_date', '')::date;
  v_payment_terms := p_payload->>'payment_terms';
  v_delivery_terms := p_payload->>'delivery_terms';
  v_notes := p_payload->>'notes';
  v_created_by_name := p_payload->>'created_by_name';
  v_items := p_payload->'items';
  
  -- Parse pr_ids array
  SELECT array_agg(elem::text::uuid)
  INTO v_pr_ids
  FROM jsonb_array_elements_text(p_payload->'pr_ids') elem;
  
  IF v_pr_ids IS NULL OR array_length(v_pr_ids, 1) = 0 THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'pr_ids is required and must be non-empty');
    RETURN jsonb_build_object(
      'success', false, 
      'error_code', 'VALIDATION',
      'error', 'pr_ids is required and must be non-empty'
    );
  END IF;
  
  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'items is required and must be non-empty');
    RETURN jsonb_build_object(
      'success', false, 
      'error_code', 'VALIDATION',
      'error', 'items is required and must be non-empty'
    );
  END IF;
  
  IF v_branch_id IS NULL THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'branch_id is required');
    RETURN jsonb_build_object(
      'success', false, 
      'error_code', 'VALIDATION',
      'error', 'branch_id is required'
    );
  END IF;
  
  -- ========================================================================
  -- B2-7.3: CONCURRENCY LOCK ON PRs
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
      PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 
        'PR ' || v_pr_record.requisition_number || ' has invalid status: ' || v_pr_record.status);
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'VALIDATION',
        'error', 'PR ' || v_pr_record.requisition_number || ' has invalid status: ' || v_pr_record.status
      );
    END IF;
    
    -- Build PR numbers string for notes
    IF v_pr_numbers = '' THEN
      v_pr_numbers := v_pr_record.requisition_number;
    ELSE
      v_pr_numbers := v_pr_numbers || ', ' || v_pr_record.requisition_number;
    END IF;
  END LOOP;
  
  -- ========================================================================
  -- B2-7.4: VALIDATE ITEMS AND GROUP BY SUPPLIER
  -- ========================================================================
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_item_pr_item_id := (v_item->>'prItemId')::uuid;
    v_item_pr_id := (v_item->>'requisitionId')::uuid;
    v_item_convert_qty := (v_item->>'convertQuantity')::numeric;
    v_item_unit_price := COALESCE((v_item->>'unitPrice')::numeric, 0);
    v_item_supplier_id := COALESCE(
      NULLIF(v_item->>'supplierId', '')::uuid,
      v_default_supplier_id
    );
    v_item_description := v_item->>'description';
    v_item_warehouse_id := NULLIF(v_item->>'warehouseId', '')::uuid;
    v_item_cost_center_id := NULLIF(v_item->>'costCenterId', '')::uuid;
    
    -- Validate convertQuantity
    IF v_item_convert_qty IS NULL OR v_item_convert_qty <= 0 THEN
      CONTINUE;
    END IF;
    
    -- Validate PR belongs to provided pr_ids
    IF NOT (v_item_pr_id = ANY(v_pr_ids)) THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 
        'Item requisitionId ' || v_item_pr_id || ' not in provided pr_ids');
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'VALIDATION',
        'error', 'Item requisitionId ' || v_item_pr_id || ' not in provided pr_ids'
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
      PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 
        'PR item ' || v_item_pr_item_id || ' not found');
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'VALIDATION',
        'error', 'PR item ' || v_item_pr_item_id || ' not found'
      );
    END IF;
    
    -- Validate convertQuantity doesn't exceed remaining
    IF v_item_convert_qty > (v_pr_item.quantity - v_pr_item.converted_quantity) THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 
        'convertQuantity exceeds remaining for item ' || v_item_pr_item_id);
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'VALIDATION',
        'error', 'convertQuantity exceeds remaining for item ' || v_item_pr_item_id
      );
    END IF;
    
    -- Validate supplier is set
    IF v_item_supplier_id IS NULL THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 
        'Supplier is required for item ' || v_item_pr_item_id);
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'VALIDATION',
        'error', 'Supplier is required for item ' || v_item_pr_item_id
      );
    END IF;
    
    -- Use description from PR item if not provided
    IF v_item_description IS NULL OR v_item_description = '' THEN
      v_item_description := v_pr_item.item_description;
    END IF;
    
    -- Use warehouse from PR item if not provided
    IF v_item_warehouse_id IS NULL THEN
      v_item_warehouse_id := COALESCE(v_pr_item.warehouse_id, v_warehouse_id);
    END IF;
    
    -- Use cost center from PR item if not provided
    IF v_item_cost_center_id IS NULL THEN
      v_item_cost_center_id := v_pr_item.cost_center_id;
    END IF;
    
    -- Group by supplier
    v_supplier_id := v_item_supplier_id::text;
    
    IF v_supplier_groups ? v_supplier_id THEN
      v_supplier_groups := jsonb_set(
        v_supplier_groups,
        ARRAY[v_supplier_id],
        (v_supplier_groups->v_supplier_id) || jsonb_build_array(
          jsonb_build_object(
            'prItemId', v_item_pr_item_id,
            'requisitionId', v_item_pr_id,
            'convertQuantity', v_item_convert_qty,
            'unitPrice', v_item_unit_price,
            'description', v_item_description,
            'warehouseId', v_item_warehouse_id,
            'costCenterId', v_item_cost_center_id
          )
        )
      );
    ELSE
      v_supplier_groups := jsonb_set(
        v_supplier_groups,
        ARRAY[v_supplier_id],
        jsonb_build_array(
          jsonb_build_object(
            'prItemId', v_item_pr_item_id,
            'requisitionId', v_item_pr_id,
            'convertQuantity', v_item_convert_qty,
            'unitPrice', v_item_unit_price,
            'description', v_item_description,
            'warehouseId', v_item_warehouse_id,
            'costCenterId', v_item_cost_center_id
          )
        )
      );
    END IF;
  END LOOP;
  
  -- Check if any valid items exist
  IF v_supplier_groups = '{}'::jsonb THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'No valid items to convert');
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'No valid items to convert'
    );
  END IF;
  
  -- ========================================================================
  -- B2-7.4: CREATE PO FOR EACH SUPPLIER GROUP
  -- ========================================================================
  FOR v_supplier_id, v_supplier_items IN
    SELECT key, value FROM jsonb_each(v_supplier_groups)
  LOOP
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
      warehouse_id,
      cost_center_id,
      pr_item_id
    )
    SELECT
      v_new_po_id,
      'product',
      item->>'description',
      (item->>'convertQuantity')::numeric,
      (item->>'unitPrice')::numeric,
      (item->>'convertQuantity')::numeric * (item->>'unitPrice')::numeric,
      NULLIF(item->>'warehouseId', '')::uuid,
      NULLIF(item->>'costCenterId', '')::uuid,
      (item->>'prItemId')::uuid
    FROM jsonb_array_elements(v_supplier_items) AS item;
    
    -- Collect PR IDs for this PO
    SELECT array_agg(DISTINCT item->>'requisitionId')
    INTO v_pr_ids_for_po
    FROM jsonb_array_elements(v_supplier_items) AS item;
    
    -- Insert po_pr_links (with ON CONFLICT to handle duplicates)
    INSERT INTO public.po_pr_links (po_id, pr_id)
    SELECT v_new_po_id, unnest::uuid
    FROM unnest(v_pr_ids_for_po)
    ON CONFLICT (po_id, pr_id) DO NOTHING;
    
    -- Update converted_quantity for PR items
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_supplier_items)
    LOOP
      UPDATE public.purchase_requisition_items
      SET converted_quantity = COALESCE(converted_quantity, 0) + (v_item->>'convertQuantity')::numeric,
          updated_at = now()
      WHERE id = (v_item->>'prItemId')::uuid;
    END LOOP;
    
    -- Add to created POs array
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
    SELECT id, requisition_number FROM public.purchase_requisitions
    WHERE id = ANY(v_pr_ids)
  LOOP
    -- Check if all items are fully converted
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
      v_new_status := 'approved';
    END IF;
    
    UPDATE public.purchase_requisitions
    SET status = v_new_status,
        converted_at = CASE WHEN v_new_status = 'fully_converted' THEN now() ELSE converted_at END,
        updated_at = now()
    WHERE id = v_pr_record.id;
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
    user_name,
    metadata
  ) VALUES (
    'convert_pr_to_po',
    'purchase_requisition',
    v_pr_ids[1],
    'تم تحويل طلب/طلبات الشراء إلى ' || jsonb_array_length(v_created_pos) || ' أمر/أوامر شراء',
    v_requested_by,
    v_created_by_name,
    jsonb_build_object(
      'prIds', v_pr_ids,
      'createdPOs', v_created_pos,
      'clientRequestId', v_client_request_id
    )
  );
  
  -- ========================================================================
  -- B2-9C: BUILD UNIFIED RESULT WITH META
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
  
  -- Mark workflow as successful using canonical function
  PERFORM public.core_workflow_success(v_client_request_id, v_new_po_id, v_result);
  
  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  -- Mark workflow as failed using canonical function
  BEGIN
    PERFORM public.core_workflow_failed(v_client_request_id, COALESCE(SQLSTATE, 'DB_ERROR'), SQLERRM);
  EXCEPTION WHEN OTHERS THEN
    -- Ignore errors in cleanup
    NULL;
  END;
  
  RETURN jsonb_build_object(
    'success', false, 
    'error_code', 'DB_ERROR', 
    'error', 'DB_ERROR: ' || SQLERRM
  );
END;
$$;