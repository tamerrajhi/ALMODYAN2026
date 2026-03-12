-- ================================================================
-- PURCHASING V2 STAGE-2 GATE TESTS
-- Run these queries after migration to verify V2 schema + RPCs
-- ================================================================

-- ================================================================
-- G1: SCHEMA VERIFICATION - Table Existence
-- ================================================================
SELECT 'G1: V2 Tables Existence' AS test_name;

SELECT 
  table_name,
  CASE WHEN table_name IS NOT NULL THEN '✅ EXISTS' ELSE '❌ MISSING' END AS status
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'purchase_requisitions_v2',
    'purchase_requisition_items_v2',
    'pr_approval_history_v2',
    'pr_approval_thresholds_v2',
    'purchase_orders_v2',
    'purchase_order_items_v2',
    'purchase_order_receipts_v2',
    'po_pr_links_v2'
  )
ORDER BY table_name;

-- ================================================================
-- G2: ROW COUNTS (should be 0 initially)
-- ================================================================
SELECT 'G2: V2 Tables Row Counts' AS test_name;

SELECT 'purchase_requisitions_v2' AS table_name, COUNT(*) AS row_count FROM purchase_requisitions_v2
UNION ALL SELECT 'purchase_requisition_items_v2', COUNT(*) FROM purchase_requisition_items_v2
UNION ALL SELECT 'pr_approval_history_v2', COUNT(*) FROM pr_approval_history_v2
UNION ALL SELECT 'pr_approval_thresholds_v2', COUNT(*) FROM pr_approval_thresholds_v2
UNION ALL SELECT 'purchase_orders_v2', COUNT(*) FROM purchase_orders_v2
UNION ALL SELECT 'purchase_order_items_v2', COUNT(*) FROM purchase_order_items_v2
UNION ALL SELECT 'purchase_order_receipts_v2', COUNT(*) FROM purchase_order_receipts_v2
UNION ALL SELECT 'po_pr_links_v2', COUNT(*) FROM po_pr_links_v2;

-- ================================================================
-- G3: RPC EXISTENCE
-- ================================================================
SELECT 'G3: V2 RPCs Existence' AS test_name;

SELECT 
  proname AS function_name,
  CASE WHEN proname IS NOT NULL THEN '✅ EXISTS' ELSE '❌ MISSING' END AS status
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN (
    'requisition_upsert_v2_atomic',
    'requisition_submit_v2_atomic',
    'requisition_approve_v2_atomic',
    'convert_pr_to_po_v2_atomic',
    'purchase_order_update_v2_atomic',
    'purchase_order_receive_v2_atomic',
    'generate_pr_number_v2',
    'generate_po_number_v2',
    'generate_receipt_number_v2'
  )
ORDER BY proname;

-- ================================================================
-- G4: VIEW EXISTENCE
-- ================================================================
SELECT 'G4: V2 Views Existence' AS test_name;

SELECT 
  table_name AS view_name,
  CASE WHEN table_name IS NOT NULL THEN '✅ EXISTS' ELSE '❌ MISSING' END AS status
FROM information_schema.views
WHERE table_schema = 'public'
  AND table_name IN (
    'purchase_requisitions_v2_view',
    'purchase_orders_v2_view',
    'purchase_order_detail_v2_view'
  )
ORDER BY table_name;

-- ================================================================
-- G5: RLS ENABLED CHECK
-- ================================================================
SELECT 'G5: RLS Enabled on V2 Tables' AS test_name;

SELECT 
  relname AS table_name,
  CASE WHEN relrowsecurity THEN '✅ RLS ENABLED' ELSE '❌ RLS DISABLED' END AS rls_status
FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relname IN (
    'purchase_requisitions_v2',
    'purchase_requisition_items_v2',
    'pr_approval_history_v2',
    'pr_approval_thresholds_v2',
    'purchase_orders_v2',
    'purchase_order_items_v2',
    'purchase_order_receipts_v2',
    'po_pr_links_v2'
  )
ORDER BY relname;

-- ================================================================
-- G6: FUNCTIONAL TEST - Create PR
-- ================================================================
SELECT 'G6: Functional Test - Create PR' AS test_name;

-- Test PR creation
SELECT requisition_upsert_v2_atomic('{
  "client_request_id": "11111111-1111-1111-1111-111111111111",
  "requisition": {
    "branch_id": null,
    "requisition_type": "standard",
    "priority": "medium",
    "justification": "Gate test PR"
  },
  "items": [
    {"item_description": "Test Item 1", "quantity": 5, "estimated_unit_price": 100, "tax_rate": 0.15},
    {"item_description": "Test Item 2", "quantity": 10, "estimated_unit_price": 50, "tax_rate": 0.15}
  ]
}'::jsonb) AS create_pr_result;

-- Verify PR created
SELECT 
  'PR Created' AS check_point,
  id,
  requisition_number,
  status,
  total_amount,
  (SELECT COUNT(*) FROM purchase_requisition_items_v2 WHERE requisition_id = pr.id) AS items_count
FROM purchase_requisitions_v2 pr
WHERE requisition_number LIKE 'PR-%'
ORDER BY created_at DESC
LIMIT 1;

-- ================================================================
-- G7: FUNCTIONAL TEST - Submit PR (Status Transition)
-- ================================================================
SELECT 'G7: Functional Test - Submit PR' AS test_name;

-- Get the PR we just created
DO $$
DECLARE
  v_pr_id UUID;
  v_result JSONB;
BEGIN
  SELECT id INTO v_pr_id FROM purchase_requisitions_v2 ORDER BY created_at DESC LIMIT 1;
  
  -- Submit it
  SELECT requisition_submit_v2_atomic(jsonb_build_object(
    'client_request_id', '22222222-2222-2222-2222-222222222222',
    'requisition_id', v_pr_id,
    'performed_by_name', 'Gate Tester'
  )) INTO v_result;
  
  RAISE NOTICE 'Submit Result: %', v_result;
END $$;

-- Verify status changed
SELECT 
  'PR Submitted' AS check_point,
  requisition_number,
  status,
  current_approval_level,
  required_approval_level
FROM purchase_requisitions_v2
ORDER BY created_at DESC
LIMIT 1;

-- ================================================================
-- G8: FUNCTIONAL TEST - Approve PR
-- ================================================================
SELECT 'G8: Functional Test - Approve PR' AS test_name;

DO $$
DECLARE
  v_pr_id UUID;
  v_result JSONB;
BEGIN
  SELECT id INTO v_pr_id FROM purchase_requisitions_v2 ORDER BY created_at DESC LIMIT 1;
  
  -- Approve it
  SELECT requisition_approve_v2_atomic(jsonb_build_object(
    'client_request_id', '33333333-3333-3333-3333-333333333333',
    'requisition_id', v_pr_id,
    'action', 'approve',
    'performed_by_name', 'Approver Test',
    'performed_by_role', 'manager'
  )) INTO v_result;
  
  RAISE NOTICE 'Approve Result: %', v_result;
END $$;

-- Verify approval
SELECT 
  'PR Approved' AS check_point,
  requisition_number,
  status,
  current_approval_level
FROM purchase_requisitions_v2
ORDER BY created_at DESC
LIMIT 1;

-- Verify history logged
SELECT 
  'Approval History' AS check_point,
  action,
  approval_level,
  performed_by_name,
  performed_by_role
FROM pr_approval_history_v2
WHERE requisition_id = (SELECT id FROM purchase_requisitions_v2 ORDER BY created_at DESC LIMIT 1)
ORDER BY created_at;

-- ================================================================
-- G9: FUNCTIONAL TEST - Convert PR to PO
-- ================================================================
SELECT 'G9: Functional Test - Convert PR to PO' AS test_name;

DO $$
DECLARE
  v_pr_id UUID;
  v_result JSONB;
BEGIN
  SELECT id INTO v_pr_id FROM purchase_requisitions_v2 WHERE status = 'approved' ORDER BY created_at DESC LIMIT 1;
  
  IF v_pr_id IS NULL THEN
    RAISE NOTICE 'No approved PR found, skipping conversion test';
    RETURN;
  END IF;
  
  -- Convert to PO
  SELECT convert_pr_to_po_v2_atomic(jsonb_build_object(
    'client_request_id', '44444444-4444-4444-4444-444444444444',
    'requisition_id', v_pr_id,
    'order_type', 'standard',
    'items', (
      SELECT jsonb_agg(jsonb_build_object(
        'item_description', item_description,
        'quantity', quantity,
        'unit_price', estimated_unit_price,
        'tax_rate', tax_rate,
        'pr_item_id', id
      ))
      FROM purchase_requisition_items_v2
      WHERE requisition_id = v_pr_id
    )
  )) INTO v_result;
  
  RAISE NOTICE 'Convert Result: %', v_result;
END $$;

-- Verify PO created
SELECT 
  'PO Created' AS check_point,
  po.id,
  po.order_number,
  po.status,
  po.total_amount,
  (SELECT COUNT(*) FROM purchase_order_items_v2 WHERE order_id = po.id) AS items_count,
  (SELECT COUNT(*) FROM po_pr_links_v2 WHERE order_id = po.id) AS linked_prs
FROM purchase_orders_v2 po
ORDER BY po.created_at DESC
LIMIT 1;

-- ================================================================
-- G10: FUNCTIONAL TEST - PO Status Transitions
-- ================================================================
SELECT 'G10: Functional Test - PO Status Transitions' AS test_name;

DO $$
DECLARE
  v_po_id UUID;
  v_result JSONB;
BEGIN
  SELECT id INTO v_po_id FROM purchase_orders_v2 ORDER BY created_at DESC LIMIT 1;
  
  IF v_po_id IS NULL THEN
    RAISE NOTICE 'No PO found, skipping status transition test';
    RETURN;
  END IF;
  
  -- Submit
  SELECT purchase_order_update_v2_atomic(jsonb_build_object(
    'client_request_id', '55555555-5555-5555-5555-555555555555',
    'order_id', v_po_id,
    'action', 'submit'
  )) INTO v_result;
  RAISE NOTICE 'Submit Result: %', v_result;
  
  -- Approve
  SELECT purchase_order_update_v2_atomic(jsonb_build_object(
    'client_request_id', '66666666-6666-6666-6666-666666666666',
    'order_id', v_po_id,
    'action', 'approve'
  )) INTO v_result;
  RAISE NOTICE 'Approve Result: %', v_result;
  
  -- Send
  SELECT purchase_order_update_v2_atomic(jsonb_build_object(
    'client_request_id', '77777777-7777-7777-7777-777777777777',
    'order_id', v_po_id,
    'action', 'send'
  )) INTO v_result;
  RAISE NOTICE 'Send Result: %', v_result;
END $$;

-- Verify final status
SELECT 
  'PO Status Transitions' AS check_point,
  order_number,
  status
FROM purchase_orders_v2
ORDER BY created_at DESC
LIMIT 1;

-- ================================================================
-- G11: FUNCTIONAL TEST - Receive PO
-- ================================================================
SELECT 'G11: Functional Test - Receive PO' AS test_name;

DO $$
DECLARE
  v_po_id UUID;
  v_items JSONB;
  v_result JSONB;
BEGIN
  SELECT id INTO v_po_id FROM purchase_orders_v2 WHERE status = 'sent' ORDER BY created_at DESC LIMIT 1;
  
  IF v_po_id IS NULL THEN
    RAISE NOTICE 'No sent PO found, skipping receive test';
    RETURN;
  END IF;
  
  -- Build receipts for all items
  SELECT jsonb_agg(jsonb_build_object(
    'order_item_id', id,
    'received_quantity', quantity,
    'rejected_quantity', 0
  )) INTO v_items
  FROM purchase_order_items_v2
  WHERE order_id = v_po_id;
  
  -- Receive
  SELECT purchase_order_receive_v2_atomic(jsonb_build_object(
    'client_request_id', '88888888-8888-8888-8888-888888888888',
    'order_id', v_po_id,
    'received_by_name', 'Warehouse Gate Test',
    'receipts', v_items
  )) INTO v_result;
  
  RAISE NOTICE 'Receive Result: %', v_result;
END $$;

-- Verify receipts created
SELECT 
  'Receipts Created' AS check_point,
  COUNT(*) AS receipt_count
FROM purchase_order_receipts_v2;

-- Verify PO status updated
SELECT 
  'PO After Receive' AS check_point,
  order_number,
  status
FROM purchase_orders_v2
ORDER BY created_at DESC
LIMIT 1;

-- ================================================================
-- G12: IDEMPOTENCY TEST
-- ================================================================
SELECT 'G12: Idempotency Test' AS test_name;

-- Call same client_request_id twice
SELECT requisition_upsert_v2_atomic('{
  "client_request_id": "11111111-1111-1111-1111-111111111111",
  "requisition": {
    "requisition_type": "standard",
    "priority": "high",
    "justification": "Duplicate call test"
  },
  "items": [
    {"item_description": "New Item", "quantity": 100, "estimated_unit_price": 999}
  ]
}'::jsonb) AS idempotency_result;

-- Verify only 1 PR with that workflow exists
SELECT 
  'Idempotency Check' AS check_point,
  COUNT(*) AS pr_count_for_workflow
FROM atomic_workflow_requests
WHERE client_request_id = '11111111-1111-1111-1111-111111111111';

-- ================================================================
-- G13: GOVERNANCE CHECK - No DIRECT_WRITE_BLOCKED
-- ================================================================
SELECT 'G13: Governance Check - No DIRECT_WRITE_BLOCKED' AS test_name;

SELECT 
  CASE 
    WHEN COUNT(*) = 0 THEN '✅ NO DIRECT_WRITE_BLOCKED ERRORS'
    ELSE '❌ FOUND DIRECT_WRITE_BLOCKED ERRORS'
  END AS governance_status,
  COUNT(*) AS blocked_count
FROM atomic_workflow_requests
WHERE status = 'failed'
  AND error_code = 'DIRECT_WRITE_BLOCKED'
  AND workflow_type LIKE '%_v2%';

-- ================================================================
-- G14: FOREIGN KEY INTEGRITY
-- ================================================================
SELECT 'G14: Foreign Key Integrity' AS test_name;

-- Check all items have valid requisition_id
SELECT 
  'PR Items FK Check' AS check_point,
  CASE 
    WHEN COUNT(*) = 0 THEN '✅ ALL VALID'
    ELSE '❌ ORPHAN ITEMS FOUND'
  END AS status,
  COUNT(*) AS orphan_count
FROM purchase_requisition_items_v2 pri
WHERE NOT EXISTS (SELECT 1 FROM purchase_requisitions_v2 WHERE id = pri.requisition_id);

-- Check all PO items have valid order_id
SELECT 
  'PO Items FK Check' AS check_point,
  CASE 
    WHEN COUNT(*) = 0 THEN '✅ ALL VALID'
    ELSE '❌ ORPHAN ITEMS FOUND'
  END AS status,
  COUNT(*) AS orphan_count
FROM purchase_order_items_v2 poi
WHERE NOT EXISTS (SELECT 1 FROM purchase_orders_v2 WHERE id = poi.order_id);

-- Check all links are valid
SELECT 
  'PO-PR Links FK Check' AS check_point,
  CASE 
    WHEN COUNT(*) = 0 THEN '✅ ALL VALID'
    ELSE '❌ ORPHAN LINKS FOUND'
  END AS status,
  COUNT(*) AS orphan_count
FROM po_pr_links_v2 lnk
WHERE NOT EXISTS (SELECT 1 FROM purchase_orders_v2 WHERE id = lnk.order_id)
   OR NOT EXISTS (SELECT 1 FROM purchase_requisitions_v2 WHERE id = lnk.requisition_id);

-- ================================================================
-- G15: SUMMARY REPORT
-- ================================================================
SELECT 'G15: Final Summary' AS test_name;

SELECT 
  'V2 Schema Status' AS metric,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE '%_v2') AS v2_tables,
  (SELECT COUNT(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE '%_v2%') AS v2_functions,
  (SELECT COUNT(*) FROM information_schema.views WHERE table_schema = 'public' AND table_name LIKE '%_v2%') AS v2_views;

SELECT 
  'V2 Data Status' AS metric,
  (SELECT COUNT(*) FROM purchase_requisitions_v2) AS prs,
  (SELECT COUNT(*) FROM purchase_orders_v2) AS pos,
  (SELECT COUNT(*) FROM purchase_order_receipts_v2) AS receipts,
  (SELECT COUNT(*) FROM po_pr_links_v2) AS links;

-- ================================================================
-- CLEANUP (Optional - run manually if needed)
-- ================================================================
-- DELETE FROM purchase_order_receipts_v2 WHERE receipt_number LIKE 'RCV-%';
-- DELETE FROM po_pr_links_v2;
-- DELETE FROM purchase_order_items_v2;
-- DELETE FROM purchase_orders_v2 WHERE order_number LIKE 'PO-%';
-- DELETE FROM pr_approval_history_v2;
-- DELETE FROM purchase_requisition_items_v2;
-- DELETE FROM purchase_requisitions_v2 WHERE requisition_number LIKE 'PR-%';
-- DELETE FROM atomic_workflow_requests WHERE client_request_id IN (
--   '11111111-1111-1111-1111-111111111111',
--   '22222222-2222-2222-2222-222222222222',
--   '33333333-3333-3333-3333-333333333333',
--   '44444444-4444-4444-4444-444444444444',
--   '55555555-5555-5555-5555-555555555555',
--   '66666666-6666-6666-6666-666666666666',
--   '77777777-7777-7777-7777-777777777777',
--   '88888888-8888-8888-8888-888888888888'
-- );
