
-- ================================================================
-- PATCH: V2 RPC Workflow Protocol Alignment
-- Changes: 'started'/'new' -> 'ok'/'retry' and 'completed' -> 'succeeded'
-- ================================================================

-- 1) requisition_upsert_v2_atomic
CREATE OR REPLACE FUNCTION public.requisition_upsert_v2_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_client_request_id UUID;
  v_begin JSONB;
  v_status TEXT;
  v_requisition_id UUID;
  v_requisition_number TEXT;
  v_is_update BOOLEAN := false;
  v_pr JSONB;
  v_items JSONB;
  v_item JSONB;
  v_subtotal NUMERIC := 0;
  v_tax_total NUMERIC := 0;
  v_total NUMERIC := 0;
  v_item_total NUMERIC;
  v_item_tax NUMERIC;
  v_line_num INTEGER := 0;
  v_result JSONB;
BEGIN
  v_client_request_id := (p_payload->>'client_request_id')::UUID;
  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_REQUEST_ID', 'message', 'client_request_id is required');
  END IF;

  -- Begin workflow (idempotency check)
  v_begin := public.begin_workflow_request(v_client_request_id, 'requisition_upsert_v2', p_payload);
  v_status := v_begin->>'status';

  IF v_status = 'succeeded' THEN
    RETURN v_begin->'cached_result';
  END IF;

  IF v_status NOT IN ('ok', 'retry') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'WORKFLOW_CONFLICT', 'status', v_status);
  END IF;

  BEGIN
    v_pr := p_payload->'requisition';
    v_items := p_payload->'items';
    
    IF v_pr->>'id' IS NOT NULL AND v_pr->>'id' != '' THEN
      v_requisition_id := (v_pr->>'id')::UUID;
      v_is_update := true;
      
      IF NOT EXISTS (SELECT 1 FROM purchase_requisitions_v2 WHERE id = v_requisition_id AND status = 'draft') THEN
        PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'Requisition must be in draft status to update');
        RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'Only draft requisitions can be updated');
      END IF;
      
      SELECT requisition_number INTO v_requisition_number FROM purchase_requisitions_v2 WHERE id = v_requisition_id;
    ELSE
      v_requisition_id := gen_random_uuid();
      v_requisition_number := generate_pr_number_v2();
    END IF;

    IF v_items IS NOT NULL AND jsonb_array_length(v_items) > 0 THEN
      FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) LOOP
        v_item_total := COALESCE((v_item->>'quantity')::NUMERIC, 1) * COALESCE((v_item->>'estimated_unit_price')::NUMERIC, 0);
        v_item_tax := v_item_total * COALESCE((v_item->>'tax_rate')::NUMERIC, 0.15);
        v_subtotal := v_subtotal + v_item_total;
        v_tax_total := v_tax_total + v_item_tax;
      END LOOP;
    END IF;
    v_total := v_subtotal + v_tax_total;

    INSERT INTO purchase_requisitions_v2 (
      id, requisition_number, branch_id, department_id, cost_center_id,
      requisition_type, requisition_date, required_date, priority, status,
      required_approval_level, justification, notes, subtotal, tax_amount, total_amount,
      created_by, created_at, updated_at
    ) VALUES (
      v_requisition_id, v_requisition_number,
      (v_pr->>'branch_id')::UUID, (v_pr->>'department_id')::UUID, (v_pr->>'cost_center_id')::UUID,
      COALESCE(v_pr->>'requisition_type', 'standard'),
      COALESCE((v_pr->>'requisition_date')::DATE, CURRENT_DATE),
      (v_pr->>'required_date')::DATE,
      COALESCE(v_pr->>'priority', 'medium'), 'draft',
      COALESCE((v_pr->>'required_approval_level')::INTEGER, 1),
      v_pr->>'justification', v_pr->>'notes',
      v_subtotal, v_tax_total, v_total,
      (v_pr->>'created_by')::UUID, now(), now()
    )
    ON CONFLICT (id) DO UPDATE SET
      branch_id = EXCLUDED.branch_id, department_id = EXCLUDED.department_id,
      cost_center_id = EXCLUDED.cost_center_id, requisition_type = EXCLUDED.requisition_type,
      requisition_date = EXCLUDED.requisition_date, required_date = EXCLUDED.required_date,
      priority = EXCLUDED.priority, required_approval_level = EXCLUDED.required_approval_level,
      justification = EXCLUDED.justification, notes = EXCLUDED.notes,
      subtotal = EXCLUDED.subtotal, tax_amount = EXCLUDED.tax_amount,
      total_amount = EXCLUDED.total_amount, updated_at = now();

    IF v_is_update THEN
      DELETE FROM purchase_requisition_items_v2 WHERE requisition_id = v_requisition_id;
    END IF;

    IF v_items IS NOT NULL AND jsonb_array_length(v_items) > 0 THEN
      FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) LOOP
        v_line_num := v_line_num + 1;
        v_item_total := COALESCE((v_item->>'quantity')::NUMERIC, 1) * COALESCE((v_item->>'estimated_unit_price')::NUMERIC, 0);
        v_item_tax := v_item_total * COALESCE((v_item->>'tax_rate')::NUMERIC, 0.15);
        
        INSERT INTO purchase_requisition_items_v2 (
          requisition_id, line_number, item_code, item_description,
          quantity, unit_of_measure, estimated_unit_price, estimated_total,
          tax_rate, tax_amount, total_with_tax, suggested_supplier_id,
          warehouse_id, cost_center_id, notes
        ) VALUES (
          v_requisition_id, v_line_num, v_item->>'item_code',
          COALESCE(v_item->>'item_description', 'Item ' || v_line_num),
          COALESCE((v_item->>'quantity')::NUMERIC, 1),
          COALESCE(v_item->>'unit_of_measure', 'unit'),
          COALESCE((v_item->>'estimated_unit_price')::NUMERIC, 0), v_item_total,
          COALESCE((v_item->>'tax_rate')::NUMERIC, 0.15), v_item_tax, v_item_total + v_item_tax,
          (v_item->>'suggested_supplier_id')::UUID, (v_item->>'warehouse_id')::UUID,
          (v_item->>'cost_center_id')::UUID, v_item->>'notes'
        );
      END LOOP;
    END IF;

    INSERT INTO pr_approval_history_v2 (requisition_id, action, performed_by, performed_by_name, comments)
    VALUES (v_requisition_id, 'created', (v_pr->>'created_by')::UUID, v_pr->>'created_by_name', 
            CASE WHEN v_is_update THEN 'Requisition updated' ELSE 'Requisition created' END);

    v_result := jsonb_build_object(
      'success', true, 'requisition_id', v_requisition_id, 'requisition_number', v_requisition_number,
      'status', 'draft', 'is_update', v_is_update, 'total_amount', v_total, 'items_count', v_line_num
    );

    PERFORM public.core_workflow_success(v_client_request_id, v_requisition_id, v_result);
    RETURN v_result;
    
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.core_workflow_failed(v_client_request_id, SQLSTATE, SQLERRM);
    RETURN jsonb_build_object('success', false, 'error_code', 'EXCEPTION', 'error', SQLERRM);
  END;
END;
$function$;

-- 2) requisition_submit_v2_atomic
CREATE OR REPLACE FUNCTION public.requisition_submit_v2_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_client_request_id UUID;
  v_begin JSONB;
  v_status TEXT;
  v_requisition_id UUID;
  v_current_status TEXT;
  v_requisition_number TEXT;
  v_total_amount NUMERIC;
  v_required_level INTEGER;
  v_result JSONB;
BEGIN
  v_client_request_id := (p_payload->>'client_request_id')::UUID;
  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_REQUEST_ID');
  END IF;

  v_begin := public.begin_workflow_request(v_client_request_id, 'requisition_submit_v2', p_payload);
  v_status := v_begin->>'status';

  IF v_status = 'succeeded' THEN
    RETURN v_begin->'cached_result';
  END IF;

  IF v_status NOT IN ('ok', 'retry') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'WORKFLOW_CONFLICT', 'status', v_status);
  END IF;

  BEGIN
    v_requisition_id := (p_payload->>'requisition_id')::UUID;
    
    SELECT status, requisition_number, total_amount, required_approval_level
    INTO v_current_status, v_requisition_number, v_total_amount, v_required_level
    FROM purchase_requisitions_v2
    WHERE id = v_requisition_id;
    
    IF v_current_status IS NULL THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'Requisition not found');
      RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'Requisition not found');
    END IF;
    
    IF v_current_status != 'draft' THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'Can only submit draft requisitions');
      RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'Can only submit draft requisitions');
    END IF;

    SELECT COALESCE(MAX(approval_order), 1) INTO v_required_level
    FROM pr_approval_thresholds_v2
    WHERE is_active = true AND min_amount <= v_total_amount
      AND (max_amount IS NULL OR max_amount >= v_total_amount);

    UPDATE purchase_requisitions_v2
    SET status = 'submitted', current_approval_level = 0, required_approval_level = v_required_level, updated_at = now()
    WHERE id = v_requisition_id;

    INSERT INTO pr_approval_history_v2 (requisition_id, action, approval_level, performed_by, performed_by_name, comments)
    VALUES (v_requisition_id, 'submitted', 0, (p_payload->>'performed_by')::UUID, p_payload->>'performed_by_name', p_payload->>'comments');

    v_result := jsonb_build_object(
      'success', true, 'requisition_id', v_requisition_id, 'requisition_number', v_requisition_number,
      'status', 'submitted', 'required_approval_level', v_required_level
    );

    PERFORM public.core_workflow_success(v_client_request_id, v_requisition_id, v_result);
    RETURN v_result;

  EXCEPTION WHEN OTHERS THEN
    PERFORM public.core_workflow_failed(v_client_request_id, SQLSTATE, SQLERRM);
    RETURN jsonb_build_object('success', false, 'error_code', 'EXCEPTION', 'error', SQLERRM);
  END;
END;
$function$;

-- 3) requisition_approve_v2_atomic
CREATE OR REPLACE FUNCTION public.requisition_approve_v2_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_client_request_id UUID;
  v_begin JSONB;
  v_status TEXT;
  v_requisition_id UUID;
  v_action TEXT;
  v_current_status TEXT;
  v_current_level INTEGER;
  v_required_level INTEGER;
  v_new_status TEXT;
  v_new_level INTEGER;
  v_result JSONB;
BEGIN
  v_client_request_id := (p_payload->>'client_request_id')::UUID;
  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_REQUEST_ID');
  END IF;

  v_begin := public.begin_workflow_request(v_client_request_id, 'requisition_approve_v2', p_payload);
  v_status := v_begin->>'status';

  IF v_status = 'succeeded' THEN
    RETURN v_begin->'cached_result';
  END IF;

  IF v_status NOT IN ('ok', 'retry') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'WORKFLOW_CONFLICT', 'status', v_status);
  END IF;

  BEGIN
    v_requisition_id := (p_payload->>'requisition_id')::UUID;
    v_action := COALESCE(p_payload->>'action', 'approve');

    SELECT status, current_approval_level, required_approval_level
    INTO v_current_status, v_current_level, v_required_level
    FROM purchase_requisitions_v2
    WHERE id = v_requisition_id;

    IF v_current_status IS NULL THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'Requisition not found');
      RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'Requisition not found');
    END IF;

    IF v_current_status NOT IN ('submitted', 'draft') THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'Cannot approve/reject from current status');
      RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'Cannot approve/reject from current status');
    END IF;

    IF v_action = 'reject' THEN
      v_new_status := 'rejected';
      v_new_level := v_current_level;
    ELSIF v_action = 'approve' THEN
      v_new_level := v_current_level + 1;
      IF v_new_level >= v_required_level THEN
        v_new_status := 'approved';
      ELSE
        v_new_status := 'submitted';
      END IF;
    ELSE
      v_new_status := v_current_status;
      v_new_level := v_current_level;
    END IF;

    UPDATE purchase_requisitions_v2
    SET status = v_new_status, current_approval_level = v_new_level,
        rejection_reason = CASE WHEN v_action = 'reject' THEN p_payload->>'comments' ELSE rejection_reason END,
        updated_at = now()
    WHERE id = v_requisition_id;

    INSERT INTO pr_approval_history_v2 (requisition_id, action, approval_level, performed_by, performed_by_name, performed_by_role, comments)
    VALUES (v_requisition_id, v_action, v_new_level, (p_payload->>'performed_by')::UUID, 
            p_payload->>'performed_by_name', p_payload->>'performed_by_role', p_payload->>'comments');

    v_result := jsonb_build_object(
      'success', true, 'requisition_id', v_requisition_id, 'action', v_action,
      'previous_status', v_current_status, 'new_status', v_new_status,
      'approval_level', v_new_level, 'is_fully_approved', v_new_status = 'approved'
    );

    PERFORM public.core_workflow_success(v_client_request_id, v_requisition_id, v_result);
    RETURN v_result;

  EXCEPTION WHEN OTHERS THEN
    PERFORM public.core_workflow_failed(v_client_request_id, SQLSTATE, SQLERRM);
    RETURN jsonb_build_object('success', false, 'error_code', 'EXCEPTION', 'error', SQLERRM);
  END;
END;
$function$;

-- 4) convert_pr_to_po_v2_atomic
CREATE OR REPLACE FUNCTION public.convert_pr_to_po_v2_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_client_request_id UUID;
  v_begin JSONB;
  v_status TEXT;
  v_requisition_id UUID;
  v_order_id UUID;
  v_order_number TEXT;
  v_pr_status TEXT;
  v_pr_branch_id UUID;
  v_items JSONB;
  v_item JSONB;
  v_subtotal NUMERIC := 0;
  v_tax_total NUMERIC := 0;
  v_total NUMERIC := 0;
  v_line_num INTEGER := 0;
  v_item_total NUMERIC;
  v_item_tax NUMERIC;
  v_po_item_id UUID;
  v_result JSONB;
BEGIN
  v_client_request_id := (p_payload->>'client_request_id')::UUID;
  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_REQUEST_ID');
  END IF;

  v_begin := public.begin_workflow_request(v_client_request_id, 'convert_pr_to_po_v2', p_payload);
  v_status := v_begin->>'status';

  IF v_status = 'succeeded' THEN
    RETURN v_begin->'cached_result';
  END IF;

  IF v_status NOT IN ('ok', 'retry') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'WORKFLOW_CONFLICT', 'status', v_status);
  END IF;

  BEGIN
    v_requisition_id := (p_payload->>'requisition_id')::UUID;
    v_items := p_payload->'items';

    SELECT status, branch_id INTO v_pr_status, v_pr_branch_id
    FROM purchase_requisitions_v2 WHERE id = v_requisition_id;

    IF v_pr_status IS NULL THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'Requisition not found');
      RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'Requisition not found');
    END IF;

    IF v_pr_status != 'approved' THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'Requisition must be approved to convert');
      RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'Requisition must be approved');
    END IF;

    v_order_id := gen_random_uuid();
    v_order_number := generate_po_number_v2();

    IF v_items IS NOT NULL AND jsonb_array_length(v_items) > 0 THEN
      FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) LOOP
        v_item_total := COALESCE((v_item->>'quantity')::NUMERIC, 1) * COALESCE((v_item->>'unit_price')::NUMERIC, 0);
        v_item_tax := v_item_total * COALESCE((v_item->>'tax_rate')::NUMERIC, 0.15);
        v_subtotal := v_subtotal + v_item_total;
        v_tax_total := v_tax_total + v_item_tax;
      END LOOP;
    END IF;
    v_total := v_subtotal + v_tax_total;

    INSERT INTO purchase_orders_v2 (
      id, order_number, branch_id, supplier_id, order_type, order_date, expected_delivery_date,
      status, payment_terms, delivery_terms, subtotal, tax_amount, total_amount, notes, created_by
    ) VALUES (
      v_order_id, v_order_number,
      COALESCE((p_payload->>'branch_id')::UUID, v_pr_branch_id),
      (p_payload->>'supplier_id')::UUID,
      COALESCE(p_payload->>'order_type', 'standard'),
      COALESCE((p_payload->>'order_date')::DATE, CURRENT_DATE),
      (p_payload->>'expected_delivery_date')::DATE,
      'draft', p_payload->>'payment_terms', p_payload->>'delivery_terms',
      v_subtotal, v_tax_total, v_total, p_payload->>'notes', (p_payload->>'created_by')::UUID
    );

    IF v_items IS NOT NULL AND jsonb_array_length(v_items) > 0 THEN
      FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) LOOP
        v_line_num := v_line_num + 1;
        v_po_item_id := gen_random_uuid();
        v_item_total := COALESCE((v_item->>'quantity')::NUMERIC, 1) * COALESCE((v_item->>'unit_price')::NUMERIC, 0);
        v_item_tax := v_item_total * COALESCE((v_item->>'tax_rate')::NUMERIC, 0.15);

        INSERT INTO purchase_order_items_v2 (
          id, order_id, line_number, item_type, product_id, item_code, item_description,
          quantity, unit_of_measure, unit_price, tax_rate, tax_amount, line_total, pr_item_id, notes
        ) VALUES (
          v_po_item_id, v_order_id, v_line_num,
          COALESCE(v_item->>'item_type', 'product'),
          (v_item->>'product_id')::UUID, v_item->>'item_code',
          COALESCE(v_item->>'item_description', 'Item ' || v_line_num),
          COALESCE((v_item->>'quantity')::NUMERIC, 1),
          COALESCE(v_item->>'unit_of_measure', 'unit'),
          COALESCE((v_item->>'unit_price')::NUMERIC, 0),
          COALESCE((v_item->>'tax_rate')::NUMERIC, 0.15),
          v_item_tax, v_item_total + v_item_tax,
          (v_item->>'pr_item_id')::UUID, v_item->>'notes'
        );
      END LOOP;
    END IF;

    INSERT INTO po_pr_links_v2 (order_id, requisition_id) VALUES (v_order_id, v_requisition_id);

    v_result := jsonb_build_object(
      'success', true, 'order_id', v_order_id, 'order_number', v_order_number,
      'requisition_id', v_requisition_id, 'status', 'draft', 'total_amount', v_total, 'items_count', v_line_num
    );

    PERFORM public.core_workflow_success(v_client_request_id, v_order_id, v_result);
    RETURN v_result;

  EXCEPTION WHEN OTHERS THEN
    PERFORM public.core_workflow_failed(v_client_request_id, SQLSTATE, SQLERRM);
    RETURN jsonb_build_object('success', false, 'error_code', 'EXCEPTION', 'error', SQLERRM);
  END;
END;
$function$;

-- 5) purchase_order_update_v2_atomic
CREATE OR REPLACE FUNCTION public.purchase_order_update_v2_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_client_request_id UUID;
  v_begin JSONB;
  v_status TEXT;
  v_order_id UUID;
  v_action TEXT;
  v_current_status TEXT;
  v_new_status TEXT;
  v_order_number TEXT;
  v_result JSONB;
BEGIN
  v_client_request_id := (p_payload->>'client_request_id')::UUID;
  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_REQUEST_ID');
  END IF;

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

    SELECT status, order_number INTO v_current_status, v_order_number
    FROM purchase_orders_v2 WHERE id = v_order_id;

    IF v_current_status IS NULL THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'Order not found');
      RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'Order not found');
    END IF;

    CASE v_action
      WHEN 'submit' THEN
        IF v_current_status != 'draft' THEN
          PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'Only draft orders can be submitted');
          RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'Only draft orders can be submitted');
        END IF;
        v_new_status := 'submitted';
      WHEN 'approve' THEN
        IF v_current_status != 'submitted' THEN
          PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'Only submitted orders can be approved');
          RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'Only submitted orders can be approved');
        END IF;
        v_new_status := 'approved';
      WHEN 'send' THEN
        IF v_current_status != 'approved' THEN
          PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'Only approved orders can be sent');
          RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'Only approved orders can be sent');
        END IF;
        v_new_status := 'sent';
      WHEN 'cancel' THEN
        IF v_current_status IN ('received', 'cancelled') THEN
          PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'Cannot cancel completed orders');
          RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'Cannot cancel completed orders');
        END IF;
        v_new_status := 'cancelled';
      ELSE
        v_new_status := v_current_status;
    END CASE;

    UPDATE purchase_orders_v2 SET status = v_new_status, updated_at = now() WHERE id = v_order_id;

    v_result := jsonb_build_object(
      'success', true, 'order_id', v_order_id, 'order_number', v_order_number,
      'action', v_action, 'previous_status', v_current_status, 'new_status', v_new_status
    );

    PERFORM public.core_workflow_success(v_client_request_id, v_order_id, v_result);
    RETURN v_result;

  EXCEPTION WHEN OTHERS THEN
    PERFORM public.core_workflow_failed(v_client_request_id, SQLSTATE, SQLERRM);
    RETURN jsonb_build_object('success', false, 'error_code', 'EXCEPTION', 'error', SQLERRM);
  END;
END;
$function$;

-- 6) purchase_order_receive_v2_atomic
CREATE OR REPLACE FUNCTION public.purchase_order_receive_v2_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_client_request_id UUID;
  v_begin JSONB;
  v_status TEXT;
  v_order_id UUID;
  v_order_status TEXT;
  v_receipts JSONB;
  v_receipt JSONB;
  v_receipt_number TEXT;
  v_receipt_id UUID;
  v_order_item_id UUID;
  v_current_received NUMERIC;
  v_ordered_qty NUMERIC;
  v_new_received NUMERIC;
  v_total_received INTEGER := 0;
  v_all_received BOOLEAN := true;
  v_branch_id UUID;
  v_result JSONB;
BEGIN
  v_client_request_id := (p_payload->>'client_request_id')::UUID;
  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_REQUEST_ID');
  END IF;

  v_begin := public.begin_workflow_request(v_client_request_id, 'purchase_order_receive_v2', p_payload);
  v_status := v_begin->>'status';

  IF v_status = 'succeeded' THEN
    RETURN v_begin->'cached_result';
  END IF;

  IF v_status NOT IN ('ok', 'retry') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'WORKFLOW_CONFLICT', 'status', v_status);
  END IF;

  BEGIN
    v_order_id := (p_payload->>'order_id')::UUID;
    v_receipts := p_payload->'receipts';
    v_branch_id := (p_payload->>'branch_id')::UUID;

    SELECT status, branch_id INTO v_order_status, v_branch_id
    FROM purchase_orders_v2 WHERE id = v_order_id;

    IF v_order_status IS NULL THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'Order not found');
      RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'Order not found');
    END IF;

    IF v_order_status NOT IN ('sent', 'approved', 'partially_received') THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'Order cannot receive items in current status');
      RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'Order cannot receive items in current status');
    END IF;

    IF v_receipts IS NOT NULL AND jsonb_array_length(v_receipts) > 0 THEN
      FOR v_receipt IN SELECT * FROM jsonb_array_elements(v_receipts) LOOP
        v_order_item_id := (v_receipt->>'order_item_id')::UUID;
        
        SELECT quantity, received_quantity INTO v_ordered_qty, v_current_received
        FROM purchase_order_items_v2 WHERE id = v_order_item_id AND order_id = v_order_id;

        IF v_ordered_qty IS NULL THEN CONTINUE; END IF;

        v_new_received := COALESCE((v_receipt->>'received_quantity')::NUMERIC, 0);
        IF v_new_received <= 0 THEN CONTINUE; END IF;

        v_receipt_number := generate_receipt_number_v2();
        v_receipt_id := gen_random_uuid();

        INSERT INTO purchase_order_receipts_v2 (
          id, receipt_number, order_id, order_item_id, branch_id, receipt_date,
          received_quantity, rejected_quantity, received_weight, vault_id, notes,
          received_by, received_by_name
        ) VALUES (
          v_receipt_id, v_receipt_number, v_order_id, v_order_item_id,
          COALESCE((v_receipt->>'branch_id')::UUID, v_branch_id),
          COALESCE((v_receipt->>'receipt_date')::DATE, CURRENT_DATE),
          v_new_received, COALESCE((v_receipt->>'rejected_quantity')::NUMERIC, 0),
          (v_receipt->>'received_weight')::NUMERIC, (v_receipt->>'vault_id')::UUID,
          v_receipt->>'notes', (p_payload->>'received_by')::UUID, p_payload->>'received_by_name'
        );

        UPDATE purchase_order_items_v2 SET received_quantity = received_quantity + v_new_received WHERE id = v_order_item_id;
        v_total_received := v_total_received + 1;
      END LOOP;
    END IF;

    SELECT NOT EXISTS (
      SELECT 1 FROM purchase_order_items_v2 WHERE order_id = v_order_id AND received_quantity < quantity
    ) INTO v_all_received;

    UPDATE purchase_orders_v2
    SET status = CASE WHEN v_all_received THEN 'received' ELSE 'partially_received' END, updated_at = now()
    WHERE id = v_order_id;

    v_result := jsonb_build_object(
      'success', true, 'order_id', v_order_id, 'receipts_created', v_total_received,
      'all_received', v_all_received, 'new_status', CASE WHEN v_all_received THEN 'received' ELSE 'partially_received' END
    );

    PERFORM public.core_workflow_success(v_client_request_id, v_order_id, v_result);
    RETURN v_result;

  EXCEPTION WHEN OTHERS THEN
    PERFORM public.core_workflow_failed(v_client_request_id, SQLSTATE, SQLERRM);
    RETURN jsonb_build_object('success', false, 'error_code', 'EXCEPTION', 'error', SQLERRM);
  END;
END;
$function$;
