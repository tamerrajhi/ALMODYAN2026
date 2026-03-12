-- =====================================================
-- P2-1: PO/Receiving V2 Cutover - Complete Atomic RPCs
-- =====================================================

-- ===========================
-- 1. Create purchase_order_create_v2_atomic
-- ===========================
CREATE OR REPLACE FUNCTION public.purchase_order_create_v2_atomic(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_request_id UUID;
  v_begin JSONB;
  v_status TEXT;
  v_order_id UUID;
  v_order_number TEXT;
  v_supplier_id UUID;
  v_branch_id UUID;
  v_order_type TEXT;
  v_expected_delivery_date DATE;
  v_notes TEXT;
  v_created_by TEXT;
  v_result JSONB;
BEGIN
  -- Extract and validate client_request_id
  v_client_request_id := (p_payload->>'client_request_id')::UUID;
  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_REQUEST_ID', 'error', 'client_request_id is required');
  END IF;

  -- Check idempotency via workflow request
  v_begin := public.begin_workflow_request(v_client_request_id, 'purchase_order_create_v2', p_payload);
  v_status := v_begin->>'status';

  -- Return cached result if already succeeded
  IF v_status = 'succeeded' THEN
    RETURN v_begin->'cached_result';
  END IF;

  -- Block if workflow is in conflicted state
  IF v_status NOT IN ('ok', 'retry') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'WORKFLOW_CONFLICT', 'status', v_status);
  END IF;

  BEGIN
    -- Extract payload fields
    v_supplier_id := (p_payload->>'supplier_id')::UUID;
    v_branch_id := (p_payload->>'branch_id')::UUID;
    v_order_type := COALESCE(p_payload->>'order_type', 'gold');
    v_expected_delivery_date := (p_payload->>'expected_delivery_date')::DATE;
    v_notes := p_payload->>'notes';
    v_created_by := COALESCE(p_payload->>'created_by', 'system');

    -- Generate PO number using existing sequence function
    SELECT public.generate_po_number() INTO v_order_number;

    -- Generate new UUID for order
    v_order_id := gen_random_uuid();

    -- Insert purchase order
    INSERT INTO purchase_orders (
      id,
      po_number,
      supplier_id,
      branch_id,
      order_type,
      expected_delivery_date,
      notes,
      created_by,
      status,
      total_amount,
      total_gold_weight,
      created_at,
      updated_at
    ) VALUES (
      v_order_id,
      v_order_number,
      v_supplier_id,
      v_branch_id,
      v_order_type,
      v_expected_delivery_date,
      v_notes,
      v_created_by,
      'draft',
      0,
      0,
      now(),
      now()
    );

    -- Log audit
    INSERT INTO audit_logs (
      action_type,
      entity_type,
      entity_id,
      entity_code,
      description,
      timestamp
    ) VALUES (
      'Create',
      'PurchaseOrder',
      v_order_id,
      v_order_number,
      'إنشاء أمر شراء جديد عبر V2 Atomic',
      now()
    );

    -- Build result
    v_result := jsonb_build_object(
      'success', true,
      'order_id', v_order_id,
      'order_number', v_order_number
    );

    -- Mark workflow as succeeded
    PERFORM public.core_workflow_success(v_client_request_id, v_order_id, v_result);
    
    RETURN v_result;

  EXCEPTION WHEN OTHERS THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'EXCEPTION', SQLERRM);
    RETURN jsonb_build_object('success', false, 'error_code', 'EXCEPTION', 'error', SQLERRM);
  END;
END;
$$;

-- ===========================
-- 2. Extend purchase_order_update_v2_atomic to support item CRUD
-- ===========================
CREATE OR REPLACE FUNCTION public.purchase_order_update_v2_atomic(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_request_id UUID;
  v_begin JSONB;
  v_status TEXT;
  v_order_id UUID;
  v_action TEXT;
  v_current_status TEXT;
  v_new_status TEXT;
  v_order_number TEXT;
  v_item JSONB;
  v_item_id UUID;
  v_new_item_id UUID;
  v_item_type TEXT;
  v_description TEXT;
  v_karat_id UUID;
  v_gemstone_type_id UUID;
  v_raw_material_id UUID;
  v_quantity NUMERIC;
  v_weight_grams NUMERIC;
  v_unit_price NUMERIC;
  v_total_price NUMERIC;
  v_current_total NUMERIC;
  v_current_weight NUMERIC;
  v_result JSONB;
BEGIN
  -- Extract and validate client_request_id
  v_client_request_id := (p_payload->>'client_request_id')::UUID;
  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_REQUEST_ID');
  END IF;

  -- Check idempotency via workflow request
  v_begin := public.begin_workflow_request(v_client_request_id, 'purchase_order_update_v2', p_payload);
  v_status := v_begin->>'status';

  IF v_status = 'succeeded' THEN
    RETURN v_begin->'cached_result';
  END IF;

  IF v_status NOT IN ('ok', 'retry') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'WORKFLOW_CONFLICT', 'status', v_status);
  END IF;

  BEGIN
    v_order_id := (p_payload->>'order_id')::UUID;
    v_action := COALESCE(p_payload->>'action', 'submit');

    -- Lock and fetch PO
    SELECT status, po_number, total_amount, total_gold_weight 
    INTO v_current_status, v_order_number, v_current_total, v_current_weight
    FROM purchase_orders
    WHERE id = v_order_id
    FOR UPDATE;

    IF v_current_status IS NULL THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'NOT_FOUND', 'Order not found');
      RETURN jsonb_build_object('success', false, 'error_code', 'NOT_FOUND', 'error', 'Order not found');
    END IF;

    v_new_status := v_current_status;

    -- Handle different actions
    CASE v_action
      -- Status transitions
      WHEN 'submit' THEN
        IF v_current_status != 'draft' THEN
          PERFORM public.core_workflow_failed(v_client_request_id, 'INVALID_TRANSITION', 'Only draft orders can be submitted');
          RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_TRANSITION', 'error', 'Only draft orders can be submitted');
        END IF;
        v_new_status := 'pending';
        
        UPDATE purchase_orders SET status = v_new_status, updated_at = now() WHERE id = v_order_id;
        
        INSERT INTO audit_logs (action_type, entity_type, entity_id, entity_code, description, timestamp)
        VALUES ('Update', 'PurchaseOrder', v_order_id, v_order_number, 'تقديم أمر الشراء للاعتماد', now());

      WHEN 'approve' THEN
        IF v_current_status NOT IN ('pending', 'draft') THEN
          PERFORM public.core_workflow_failed(v_client_request_id, 'INVALID_TRANSITION', 'Only pending/draft orders can be approved');
          RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_TRANSITION', 'error', 'Only pending/draft orders can be approved');
        END IF;
        v_new_status := 'approved';
        
        UPDATE purchase_orders 
        SET status = v_new_status, 
            approved_by = (p_payload->>'approved_by')::UUID,
            approved_at = now(),
            updated_at = now() 
        WHERE id = v_order_id;
        
        INSERT INTO audit_logs (action_type, entity_type, entity_id, entity_code, description, timestamp)
        VALUES ('Approve', 'PurchaseOrder', v_order_id, v_order_number, 'اعتماد أمر الشراء', now());

      WHEN 'send' THEN
        IF v_current_status != 'approved' THEN
          PERFORM public.core_workflow_failed(v_client_request_id, 'INVALID_TRANSITION', 'Only approved orders can be sent');
          RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_TRANSITION', 'error', 'Only approved orders can be sent');
        END IF;
        v_new_status := 'sent';
        
        UPDATE purchase_orders 
        SET sent_to_supplier = true, sent_at = now(), updated_at = now() 
        WHERE id = v_order_id;
        
        INSERT INTO audit_logs (action_type, entity_type, entity_id, entity_code, description, timestamp)
        VALUES ('Update', 'PurchaseOrder', v_order_id, v_order_number, 'إرسال أمر الشراء للمورد', now());

      WHEN 'cancel' THEN
        IF v_current_status IN ('fully_received', 'cancelled') THEN
          PERFORM public.core_workflow_failed(v_client_request_id, 'INVALID_TRANSITION', 'Cannot cancel completed orders');
          RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_TRANSITION', 'error', 'Cannot cancel completed orders');
        END IF;
        v_new_status := 'cancelled';
        
        UPDATE purchase_orders SET status = v_new_status, updated_at = now() WHERE id = v_order_id;

      -- Item operations (only allowed in draft status)
      WHEN 'add_item' THEN
        IF v_current_status != 'draft' THEN
          PERFORM public.core_workflow_failed(v_client_request_id, 'INVALID_TRANSITION', 'Items can only be added to draft orders');
          RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_TRANSITION', 'error', 'Items can only be added to draft orders');
        END IF;

        v_item := p_payload->'item';
        v_item_type := COALESCE(v_item->>'item_type', 'gold');
        v_description := v_item->>'description';
        v_karat_id := (v_item->>'karat_id')::UUID;
        v_gemstone_type_id := (v_item->>'gemstone_type_id')::UUID;
        v_raw_material_id := (v_item->>'raw_material_id')::UUID;
        v_quantity := COALESCE((v_item->>'quantity')::NUMERIC, 0);
        v_weight_grams := COALESCE((v_item->>'weight_grams')::NUMERIC, 0);
        v_unit_price := COALESCE((v_item->>'unit_price')::NUMERIC, 0);

        -- Calculate total price
        IF v_weight_grams > 0 THEN
          v_total_price := v_weight_grams * v_unit_price;
        ELSE
          v_total_price := v_quantity * v_unit_price;
        END IF;

        v_new_item_id := gen_random_uuid();

        INSERT INTO purchase_order_items (
          id, po_id, item_type, description, karat_id, gemstone_type_id, raw_material_id,
          quantity, weight_grams, unit_price, total_price, received_quantity, received_weight, status
        ) VALUES (
          v_new_item_id, v_order_id, v_item_type, v_description, v_karat_id, v_gemstone_type_id, v_raw_material_id,
          v_quantity, v_weight_grams, v_unit_price, v_total_price, 0, 0, 'pending'
        );

        -- Update PO totals
        UPDATE purchase_orders
        SET total_amount = COALESCE(v_current_total, 0) + v_total_price,
            total_gold_weight = COALESCE(v_current_weight, 0) + (CASE WHEN v_item_type = 'gold' THEN v_weight_grams ELSE 0 END),
            updated_at = now()
        WHERE id = v_order_id;

        v_result := jsonb_build_object(
          'success', true,
          'action', 'add_item',
          'order_id', v_order_id,
          'order_number', v_order_number,
          'item_id', v_new_item_id,
          'new_total', COALESCE(v_current_total, 0) + v_total_price
        );
        
        PERFORM public.core_workflow_success(v_client_request_id, v_order_id, v_result);
        RETURN v_result;

      WHEN 'delete_item' THEN
        IF v_current_status != 'draft' THEN
          PERFORM public.core_workflow_failed(v_client_request_id, 'INVALID_TRANSITION', 'Items can only be deleted from draft orders');
          RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_TRANSITION', 'error', 'Items can only be deleted from draft orders');
        END IF;

        v_item_id := (p_payload->>'item_id')::UUID;

        -- Get item details for total adjustment
        SELECT item_type, total_price, weight_grams 
        INTO v_item_type, v_total_price, v_weight_grams
        FROM purchase_order_items
        WHERE id = v_item_id AND po_id = v_order_id;

        IF v_total_price IS NULL THEN
          PERFORM public.core_workflow_failed(v_client_request_id, 'NOT_FOUND', 'Item not found');
          RETURN jsonb_build_object('success', false, 'error_code', 'NOT_FOUND', 'error', 'Item not found');
        END IF;

        DELETE FROM purchase_order_items WHERE id = v_item_id;

        -- Update PO totals
        UPDATE purchase_orders
        SET total_amount = GREATEST(0, COALESCE(v_current_total, 0) - COALESCE(v_total_price, 0)),
            total_gold_weight = GREATEST(0, COALESCE(v_current_weight, 0) - (CASE WHEN v_item_type = 'gold' THEN COALESCE(v_weight_grams, 0) ELSE 0 END)),
            updated_at = now()
        WHERE id = v_order_id;

        v_result := jsonb_build_object(
          'success', true,
          'action', 'delete_item',
          'order_id', v_order_id,
          'order_number', v_order_number,
          'deleted_item_id', v_item_id,
          'new_total', GREATEST(0, COALESCE(v_current_total, 0) - COALESCE(v_total_price, 0))
        );
        
        PERFORM public.core_workflow_success(v_client_request_id, v_order_id, v_result);
        RETURN v_result;

      ELSE
        -- Unknown action, just return current state
        NULL;
    END CASE;

    -- Build result for status transition actions
    v_result := jsonb_build_object(
      'success', true,
      'order_id', v_order_id,
      'order_number', v_order_number,
      'action', v_action,
      'previous_status', v_current_status,
      'new_status', v_new_status
    );

    PERFORM public.core_workflow_success(v_client_request_id, v_order_id, v_result);
    RETURN v_result;

  EXCEPTION WHEN OTHERS THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'EXCEPTION', SQLERRM);
    RETURN jsonb_build_object('success', false, 'error_code', 'EXCEPTION', 'error', SQLERRM);
  END;
END;
$$;

-- ===========================
-- 3. Enhance purchase_order_receive_v2_atomic with full inventory logic
-- ===========================
CREATE OR REPLACE FUNCTION public.purchase_order_receive_v2_atomic(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_request_id UUID;
  v_begin JSONB;
  v_status TEXT;
  v_order_id UUID;
  v_order_status TEXT;
  v_order_number TEXT;
  v_supplier_id UUID;
  v_branch_id UUID;
  v_receipts JSONB;
  v_receipt JSONB;
  v_grn_number TEXT;
  v_grn_id UUID;
  v_item_id UUID;
  v_item_type TEXT;
  v_description TEXT;
  v_karat_id UUID;
  v_gemstone_type_id UUID;
  v_quantity_ordered NUMERIC;
  v_weight_ordered NUMERIC;
  v_quantity_received NUMERIC;
  v_weight_received NUMERIC;
  v_quantity_rejected NUMERIC;
  v_unit_price NUMERIC;
  v_prev_received_qty NUMERIC;
  v_prev_received_weight NUMERIC;
  v_new_received_qty NUMERIC;
  v_new_received_weight NUMERIC;
  v_is_fully_received BOOLEAN;
  v_vault_id UUID;
  v_warehouse_id UUID;
  v_notes TEXT;
  v_received_by TEXT;
  v_total_received INTEGER := 0;
  v_all_received BOOLEAN := true;
  v_remaining_items INTEGER;
  v_new_po_status TEXT;
  v_result JSONB;
BEGIN
  -- Extract and validate client_request_id
  v_client_request_id := (p_payload->>'client_request_id')::UUID;
  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_REQUEST_ID', 'error', 'client_request_id is required');
  END IF;

  -- Check idempotency
  v_begin := public.begin_workflow_request(v_client_request_id, 'purchase_order_receive_v2', p_payload);
  v_status := v_begin->>'status';

  IF v_status = 'succeeded' THEN
    RETURN v_begin->'cached_result';
  END IF;

  IF v_status NOT IN ('ok', 'retry') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'WORKFLOW_CONFLICT', 'status', v_status);
  END IF;

  BEGIN
    -- Extract payload
    v_order_id := (p_payload->>'order_id')::UUID;
    v_receipts := p_payload->'receipts';
    v_vault_id := (p_payload->>'vault_id')::UUID;
    v_warehouse_id := (p_payload->>'warehouse_id')::UUID;
    v_notes := p_payload->>'notes';
    v_received_by := COALESCE(p_payload->>'received_by', 'system');

    -- Lock and fetch PO
    SELECT status, po_number, supplier_id, branch_id 
    INTO v_order_status, v_order_number, v_supplier_id, v_branch_id
    FROM purchase_orders
    WHERE id = v_order_id
    FOR UPDATE;

    IF v_order_status IS NULL THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'NOT_FOUND', 'Order not found');
      RETURN jsonb_build_object('success', false, 'error_code', 'NOT_FOUND', 'error', 'Order not found');
    END IF;

    -- Validate status allows receiving
    IF v_order_status NOT IN ('approved', 'sent', 'partially_received') THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'INVALID_TRANSITION', 'Order cannot receive items in current status: ' || v_order_status);
      RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_TRANSITION', 'error', 'Order cannot receive items in status: ' || v_order_status);
    END IF;

    IF v_receipts IS NULL OR jsonb_array_length(v_receipts) = 0 THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'No receipt items provided');
      RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'No receipt items provided');
    END IF;

    -- Generate GRN number and create header
    SELECT public.generate_grn_number() INTO v_grn_number;
    v_grn_id := gen_random_uuid();

    INSERT INTO goods_receipt_notes (
      id, grn_number, po_id, receipt_date, supplier_id, branch_id, 
      warehouse_id, status, notes, received_by, received_by_name
    ) VALUES (
      v_grn_id, v_grn_number, v_order_id, CURRENT_DATE, v_supplier_id, v_branch_id,
      COALESCE(v_warehouse_id, v_branch_id), 'completed', v_notes, v_received_by, v_received_by
    );

    -- Process each receipt item
    FOR v_receipt IN SELECT * FROM jsonb_array_elements(v_receipts) LOOP
      v_item_id := (v_receipt->>'item_id')::UUID;
      v_quantity_received := COALESCE((v_receipt->>'quantity_received')::NUMERIC, 0);
      v_weight_received := COALESCE((v_receipt->>'weight_received')::NUMERIC, 0);
      v_quantity_rejected := COALESCE((v_receipt->>'quantity_rejected')::NUMERIC, 0);

      -- Skip if nothing received
      IF v_quantity_received <= 0 AND v_weight_received <= 0 THEN
        CONTINUE;
      END IF;

      -- Lock and fetch item details
      SELECT item_type, description, karat_id, gemstone_type_id, 
             quantity, weight_grams, unit_price, received_quantity, received_weight
      INTO v_item_type, v_description, v_karat_id, v_gemstone_type_id,
           v_quantity_ordered, v_weight_ordered, v_unit_price, v_prev_received_qty, v_prev_received_weight
      FROM purchase_order_items
      WHERE id = v_item_id AND po_id = v_order_id
      FOR UPDATE;

      IF v_item_type IS NULL THEN
        CONTINUE; -- Skip invalid items
      END IF;

      -- Calculate new received amounts
      v_new_received_qty := COALESCE(v_prev_received_qty, 0) + v_quantity_received;
      v_new_received_weight := COALESCE(v_prev_received_weight, 0) + v_weight_received;

      -- Validate not over-receiving
      IF v_item_type = 'gold' THEN
        IF v_new_received_weight > COALESCE(v_weight_ordered, 0) * 1.1 THEN -- Allow 10% tolerance
          PERFORM public.core_workflow_failed(v_client_request_id, 'OVER_RECEIVE', 'Cannot receive more than ordered weight');
          RETURN jsonb_build_object('success', false, 'error_code', 'OVER_RECEIVE', 'error', 'Weight exceeds ordered amount');
        END IF;
        v_is_fully_received := v_new_received_weight >= COALESCE(v_weight_ordered, 0);
      ELSE
        IF v_new_received_qty > COALESCE(v_quantity_ordered, 0) * 1.1 THEN
          PERFORM public.core_workflow_failed(v_client_request_id, 'OVER_RECEIVE', 'Cannot receive more than ordered quantity');
          RETURN jsonb_build_object('success', false, 'error_code', 'OVER_RECEIVE', 'error', 'Quantity exceeds ordered amount');
        END IF;
        v_is_fully_received := v_new_received_qty >= COALESCE(v_quantity_ordered, 0);
      END IF;

      -- Create GRN item
      INSERT INTO goods_receipt_items (
        grn_id, po_item_id, item_type, description,
        quantity_ordered, quantity_received, quantity_rejected,
        weight_ordered, weight_received, unit_price,
        total_amount, warehouse_id, karat_id, gemstone_type_id, notes
      ) VALUES (
        v_grn_id, v_item_id, v_item_type, v_description,
        v_quantity_ordered, v_quantity_received, v_quantity_rejected,
        v_weight_ordered, v_weight_received, v_unit_price,
        CASE WHEN v_weight_received > 0 THEN v_weight_received * COALESCE(v_unit_price, 0) ELSE v_quantity_received * COALESCE(v_unit_price, 0) END,
        COALESCE(v_warehouse_id, v_branch_id), v_karat_id, v_gemstone_type_id, v_receipt->>'notes'
      );

      -- Update PO item received amounts
      UPDATE purchase_order_items
      SET received_quantity = v_new_received_qty,
          received_weight = v_new_received_weight,
          status = CASE WHEN v_is_fully_received THEN 'received' ELSE 'partially_received' END
      WHERE id = v_item_id;

      -- Handle gold vault transaction
      IF v_item_type = 'gold' AND v_vault_id IS NOT NULL AND v_weight_received > 0 THEN
        INSERT INTO gold_vault_transactions (
          vault_id, transaction_type, weight_grams, karat_id, gold_type,
          supplier_id, reference_type, reference_id, performed_by, notes
        ) VALUES (
          v_vault_id, 'purchase', v_weight_received, v_karat_id, 'raw',
          v_supplier_id, 'goods_receipt', v_grn_id, v_received_by,
          'استلام من أمر شراء ' || v_order_number || ' - GRN: ' || v_grn_number
        );
      END IF;

      -- Handle gemstone inventory (simplified - creates gemstone_inventory entries)
      IF v_item_type = 'gemstone' AND v_quantity_received > 0 THEN
        FOR i IN 1..v_quantity_received::INTEGER LOOP
          INSERT INTO gemstone_inventory (
            gemstone_type_id, branch_id, supplier_id, carat_weight, purchase_price, status, notes
          ) VALUES (
            v_gemstone_type_id, v_branch_id, v_supplier_id, 
            v_weight_received / NULLIF(v_quantity_received, 0),
            COALESCE(v_unit_price, 0), 'available',
            'من أمر شراء ' || v_order_number || ' - GRN: ' || v_grn_number
          );
        END LOOP;
      END IF;

      v_total_received := v_total_received + 1;
    END LOOP;

    -- Check if all items are now received
    SELECT COUNT(*) INTO v_remaining_items
    FROM purchase_order_items
    WHERE po_id = v_order_id AND status != 'received';

    v_new_po_status := CASE WHEN v_remaining_items = 0 THEN 'fully_received' ELSE 'partially_received' END;

    -- Update PO status
    UPDATE purchase_orders
    SET status = v_new_po_status, updated_at = now()
    WHERE id = v_order_id;

    -- Audit log
    INSERT INTO audit_logs (
      action_type, entity_type, entity_id, entity_code, description, timestamp, new_value
    ) VALUES (
      'Create', 'GoodsReceipt', v_grn_id, v_grn_number,
      'استلام بضاعة من أمر شراء ' || v_order_number,
      now(),
      jsonb_build_object('grn_number', v_grn_number, 'po_number', v_order_number, 'items_count', v_total_received)
    );

    -- Build result
    v_result := jsonb_build_object(
      'success', true,
      'grn_id', v_grn_id,
      'grn_number', v_grn_number,
      'order_id', v_order_id,
      'order_number', v_order_number,
      'items_received', v_total_received,
      'new_po_status', v_new_po_status,
      'all_received', v_remaining_items = 0
    );

    PERFORM public.core_workflow_success(v_client_request_id, v_grn_id, v_result);
    RETURN v_result;

  EXCEPTION WHEN OTHERS THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'EXCEPTION', SQLERRM);
    RETURN jsonb_build_object('success', false, 'error_code', 'EXCEPTION', 'error', SQLERRM);
  END;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.purchase_order_create_v2_atomic(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_order_update_v2_atomic(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_order_receive_v2_atomic(JSONB) TO authenticated;