-- =====================================================
-- Purchasing V2 Gate Tests
-- Run after V2 Big-Bang migration to verify schema + RPCs
-- =====================================================

-- G6: Create PR with items
DO $$
DECLARE
  v_result jsonb;
  v_requisition_id uuid;
BEGIN
  v_result := public.requisition_upsert_v2_atomic(jsonb_build_object(
    'client_request_id', gen_random_uuid()::text,
    'requester_name', 'Gate Tester',
    'priority', 'high',
    'items', jsonb_build_array(
      jsonb_build_object('item_description', 'Test Item 1', 'quantity', 5, 'unit_price', 100),
      jsonb_build_object('item_description', 'Test Item 2', 'quantity', 10, 'unit_price', 50)
    )
  ));
  
  IF (v_result->>'success')::boolean THEN
    v_requisition_id := (v_result->>'requisition_id')::uuid;
    RAISE NOTICE 'G6: ✅ PASS - PR created: %, total: %, items: %', 
      v_result->>'requisition_number', v_result->>'total_amount', v_result->>'items_count';
  ELSE
    RAISE NOTICE 'G6: ❌ FAIL - %', v_result->>'error';
  END IF;
END $$;

-- G7: Submit PR
DO $$
DECLARE
  v_result jsonb;
  v_pr_id uuid;
BEGIN
  SELECT id INTO v_pr_id FROM purchase_requisitions_v2 WHERE status = 'draft' ORDER BY created_at DESC LIMIT 1;
  IF v_pr_id IS NULL THEN RAISE NOTICE 'G7: ⏭️ SKIPPED - No draft PR'; RETURN; END IF;
  
  v_result := public.requisition_submit_v2_atomic(jsonb_build_object(
    'client_request_id', gen_random_uuid()::text,
    'requisition_id', v_pr_id::text
  ));
  
  IF (v_result->>'success')::boolean AND v_result->>'status' = 'submitted' THEN
    RAISE NOTICE 'G7: ✅ PASS - PR submitted, required_approval_level: %', v_result->>'required_approval_level';
  ELSE
    RAISE NOTICE 'G7: ❌ FAIL - %', v_result;
  END IF;
END $$;

-- G8: Approve PR
DO $$
DECLARE
  v_result jsonb;
  v_pr_id uuid;
BEGIN
  SELECT id INTO v_pr_id FROM purchase_requisitions_v2 WHERE status IN ('submitted', 'pending_approval') ORDER BY created_at DESC LIMIT 1;
  IF v_pr_id IS NULL THEN RAISE NOTICE 'G8: ⏭️ SKIPPED - No submitted/pending PR'; RETURN; END IF;
  
  v_result := public.requisition_approve_v2_atomic(jsonb_build_object(
    'client_request_id', gen_random_uuid()::text,
    'requisition_id', v_pr_id::text,
    'action', 'approved',
    'performed_by_name', 'Gate Approver'
  ));
  
  IF (v_result->>'success')::boolean THEN
    RAISE NOTICE 'G8: ✅ PASS - PR action completed, is_fully_approved: %', v_result->>'is_fully_approved';
  ELSE
    RAISE NOTICE 'G8: ❌ FAIL - %', v_result;
  END IF;
END $$;

-- G9: Convert PR to PO
DO $$
DECLARE
  v_result jsonb;
  v_pr_id uuid;
BEGIN
  SELECT id INTO v_pr_id FROM purchase_requisitions_v2 WHERE status = 'approved' ORDER BY created_at DESC LIMIT 1;
  IF v_pr_id IS NULL THEN RAISE NOTICE 'G9: ⏭️ SKIPPED - No approved PR'; RETURN; END IF;
  
  v_result := public.convert_pr_to_po_v2_atomic(jsonb_build_object(
    'client_request_id', gen_random_uuid()::text,
    'requisition_id', v_pr_id::text
  ));
  
  IF (v_result->>'success')::boolean AND v_result->>'order_id' IS NOT NULL THEN
    RAISE NOTICE 'G9: ✅ PASS - PO created: %, order_id: %, total: %', 
      v_result->>'order_number', v_result->>'order_id', v_result->>'total_amount';
  ELSE
    RAISE NOTICE 'G9: ❌ FAIL - %', v_result;
  END IF;
END $$;

-- G10: PO Status Transitions (draft -> submitted -> approved -> sent)
DO $$
DECLARE
  v_result jsonb;
  v_po_id uuid;
BEGIN
  SELECT id INTO v_po_id FROM purchase_orders_v2 WHERE status = 'draft' ORDER BY created_at DESC LIMIT 1;
  IF v_po_id IS NULL THEN RAISE NOTICE 'G10: ⏭️ SKIPPED - No draft PO'; RETURN; END IF;
  
  -- Submit
  v_result := public.purchase_order_update_v2_atomic(jsonb_build_object(
    'client_request_id', gen_random_uuid()::text, 
    'order_id', v_po_id::text, 
    'action', 'submit'
  ));
  IF NOT (v_result->>'success')::boolean THEN 
    RAISE NOTICE 'G10: ❌ FAIL on submit - %', v_result->>'error'; 
    RETURN; 
  END IF;
  
  -- Approve
  v_result := public.purchase_order_update_v2_atomic(jsonb_build_object(
    'client_request_id', gen_random_uuid()::text, 
    'order_id', v_po_id::text, 
    'action', 'approve'
  ));
  IF NOT (v_result->>'success')::boolean THEN 
    RAISE NOTICE 'G10: ❌ FAIL on approve - %', v_result->>'error'; 
    RETURN; 
  END IF;
  
  -- Send
  v_result := public.purchase_order_update_v2_atomic(jsonb_build_object(
    'client_request_id', gen_random_uuid()::text, 
    'order_id', v_po_id::text, 
    'action', 'send'
  ));
  IF (v_result->>'success')::boolean AND v_result->>'new_status' = 'sent' THEN
    RAISE NOTICE 'G10: ✅ PASS - PO transitions: draft→submitted→approved→sent';
  ELSE
    RAISE NOTICE 'G10: ❌ FAIL on send - %', v_result;
  END IF;
END $$;

-- G11: Receive PO
DO $$
DECLARE
  v_result jsonb;
  v_po_id uuid;
  v_receipts jsonb;
BEGIN
  SELECT id INTO v_po_id FROM purchase_orders_v2 WHERE status = 'sent' ORDER BY created_at DESC LIMIT 1;
  IF v_po_id IS NULL THEN RAISE NOTICE 'G11: ⏭️ SKIPPED - No sent PO'; RETURN; END IF;
  
  SELECT jsonb_agg(jsonb_build_object('order_item_id', id::text, 'quantity_received', quantity))
  INTO v_receipts FROM purchase_order_items_v2 WHERE order_id = v_po_id;
  
  v_result := public.purchase_order_receive_v2_atomic(jsonb_build_object(
    'client_request_id', gen_random_uuid()::text,
    'order_id', v_po_id::text,
    'receipts', COALESCE(v_receipts, '[]'::jsonb),
    'performed_by_name', 'Gate Receiver'
  ));
  
  IF (v_result->>'success')::boolean THEN
    RAISE NOTICE 'G11: ✅ PASS - receipts_created: %, all_received: %, new_status: %', 
      v_result->>'receipts_created', v_result->>'all_received', v_result->>'new_status';
  ELSE
    RAISE NOTICE 'G11: ❌ FAIL - %', v_result;
  END IF;
END $$;

-- G12: Idempotency (same client_request_id returns cached result)
DO $$
DECLARE
  v_result1 jsonb;
  v_result2 jsonb;
  v_client_id text := gen_random_uuid()::text;
BEGIN
  v_result1 := public.requisition_upsert_v2_atomic(jsonb_build_object(
    'client_request_id', v_client_id,
    'requester_name', 'Idempotency Test',
    'items', jsonb_build_array(jsonb_build_object('item_description', 'Idempotency Item', 'quantity', 1, 'unit_price', 10))
  ));
  
  v_result2 := public.requisition_upsert_v2_atomic(jsonb_build_object(
    'client_request_id', v_client_id,
    'requester_name', 'Idempotency Test',
    'items', jsonb_build_array(jsonb_build_object('item_description', 'Idempotency Item', 'quantity', 1, 'unit_price', 10))
  ));
  
  IF v_result1->>'requisition_id' = v_result2->>'requisition_id' THEN
    RAISE NOTICE 'G12: ✅ PASS - Idempotency verified, same requisition_id returned';
  ELSE
    RAISE NOTICE 'G12: ❌ FAIL - Different IDs: % vs %', v_result1->>'requisition_id', v_result2->>'requisition_id';
  END IF;
END $$;

SELECT 'Purchasing V2 Gate Tests Complete' AS status;
