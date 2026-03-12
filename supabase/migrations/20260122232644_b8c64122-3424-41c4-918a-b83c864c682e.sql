-- Fix gold_vault_transactions column reference: karat_id not gold_karat_id
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
  v_received_by_id UUID;
  v_received_by_name TEXT;
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
    -- Handle received_by as either UUID or text (use text for name)
    v_received_by_id := NULLIF(p_payload->>'received_by_id', '')::UUID;
    v_received_by_name := COALESCE(p_payload->>'received_by', p_payload->>'received_by_name', 'system');

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
      COALESCE(v_warehouse_id, v_branch_id), 'completed', v_notes, v_received_by_id, v_received_by_name
    );

    -- Process each receipt item
    FOR v_receipt IN SELECT * FROM jsonb_array_elements(v_receipts) LOOP
      -- Support both 'item_id' and 'po_item_id' for flexibility
      v_item_id := COALESCE((v_receipt->>'po_item_id')::UUID, (v_receipt->>'item_id')::UUID);
      v_quantity_received := COALESCE((v_receipt->>'quantity_received')::NUMERIC, 0);
      v_weight_received := COALESCE((v_receipt->>'weight_received')::NUMERIC, 0);
      v_quantity_rejected := COALESCE((v_receipt->>'quantity_rejected')::NUMERIC, 0);

      -- Skip if nothing received
      IF v_quantity_received <= 0 AND v_weight_received <= 0 THEN
        CONTINUE;
      END IF;

      -- Get PO item details using correct column names: karat_id, received_quantity, received_weight
      SELECT 
        item_type, description, karat_id, gemstone_type_id,
        quantity, weight_grams, unit_price,
        COALESCE(received_quantity, 0), COALESCE(received_weight, 0)
      INTO 
        v_item_type, v_description, v_karat_id, v_gemstone_type_id,
        v_quantity_ordered, v_weight_ordered, v_unit_price,
        v_prev_received_qty, v_prev_received_weight
      FROM purchase_order_items
      WHERE id = v_item_id
      FOR UPDATE;

      IF v_item_type IS NULL THEN
        CONTINUE; -- Skip unknown items
      END IF;

      -- Calculate new received totals
      v_new_received_qty := v_prev_received_qty + v_quantity_received;
      v_new_received_weight := v_prev_received_weight + v_weight_received;

      -- Create goods receipt item using correct column name: karat_id
      INSERT INTO goods_receipt_items (
        grn_id, po_item_id, item_type, description, karat_id, gemstone_type_id,
        quantity_ordered, weight_ordered, quantity_received, weight_received, quantity_rejected,
        unit_price, total_amount
      ) VALUES (
        v_grn_id, v_item_id, v_item_type, v_description, v_karat_id, v_gemstone_type_id,
        v_quantity_ordered, v_weight_ordered, v_quantity_received, v_weight_received, v_quantity_rejected,
        v_unit_price, v_unit_price * GREATEST(v_quantity_received, v_weight_received)
      );

      -- Update PO item received quantities using correct column names
      UPDATE purchase_order_items 
      SET 
        received_quantity = v_new_received_qty,
        received_weight = v_new_received_weight
      WHERE id = v_item_id;

      v_total_received := v_total_received + 1;

      -- Handle gold vault transaction if gold item - use karat_id not gold_karat_id
      IF v_item_type = 'gold' AND v_vault_id IS NOT NULL AND v_weight_received > 0 THEN
        INSERT INTO gold_vault_transactions (
          vault_id, transaction_type, weight_grams, karat_id,
          transaction_date, reference_type, reference_id, notes,
          performed_by
        ) VALUES (
          v_vault_id, 'deposit', v_weight_received, v_karat_id,
          CURRENT_DATE, 'goods_receipt', v_grn_id, 'GRN: ' || v_grn_number,
          v_received_by_name
        );
      END IF;

      -- Handle gemstone inventory if gemstone item
      IF v_item_type = 'gemstone' AND v_gemstone_type_id IS NOT NULL THEN
        -- Update or insert gemstone inventory
        INSERT INTO gemstone_inventory (gemstone_type_id, branch_id, quantity, total_weight)
        VALUES (v_gemstone_type_id, v_branch_id, v_quantity_received, v_weight_received)
        ON CONFLICT (gemstone_type_id, branch_id) 
        DO UPDATE SET 
          quantity = gemstone_inventory.quantity + EXCLUDED.quantity,
          total_weight = gemstone_inventory.total_weight + EXCLUDED.total_weight,
          updated_at = now();

        -- Create gemstone transaction
        INSERT INTO gemstone_transactions (
          gemstone_type_id, branch_id, transaction_type, quantity, weight,
          reference_type, reference_id, notes
        ) VALUES (
          v_gemstone_type_id, v_branch_id, 'receipt', v_quantity_received, v_weight_received,
          'goods_receipt', v_grn_id, 'GRN: ' || v_grn_number
        );
      END IF;
    END LOOP;

    -- Check if all items are fully received
    SELECT COUNT(*) INTO v_remaining_items
    FROM purchase_order_items
    WHERE po_id = v_order_id
      AND (
        (weight_grams > 0 AND COALESCE(received_weight, 0) < weight_grams) OR
        (quantity > 0 AND COALESCE(received_quantity, 0) < quantity)
      );

    -- Update PO status
    IF v_remaining_items = 0 THEN
      v_new_po_status := 'fully_received';
    ELSE
      v_new_po_status := 'partially_received';
    END IF;

    UPDATE purchase_orders 
    SET status = v_new_po_status, updated_at = now()
    WHERE id = v_order_id;

    -- Audit log
    INSERT INTO audit_logs (action_type, entity_type, entity_id, entity_code, description, timestamp)
    VALUES ('Receive', 'PurchaseOrder', v_order_id, v_order_number, 
            'استلام أمر الشراء - ' || v_total_received || ' صنف', now());

    v_result := jsonb_build_object(
      'success', true,
      'grn_id', v_grn_id,
      'grn_number', v_grn_number,
      'order_id', v_order_id,
      'order_number', v_order_number,
      'new_status', v_new_po_status,
      'items_received', v_total_received
    );

    PERFORM public.core_workflow_success(v_client_request_id, v_grn_id, v_result);
    RETURN v_result;

  EXCEPTION WHEN OTHERS THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'EXCEPTION', SQLERRM);
    RETURN jsonb_build_object('success', false, 'error_code', 'EXCEPTION', 'error', SQLERRM);
  END;
END;
$$;