-- ============================================================
-- P4-9 (C) Smoke Tests — SQL Queries
-- Date: 2026-01-24
-- Status: BLOCKED (Missing EXECUTE grants on RPCs)
-- ============================================================

-- ==============================================
-- C0) Pre-Flight: Functions + Policies + Patch
-- ==============================================

-- C0.1 Functions existence
-- EXPECTED: 4 functions
-- ACTUAL: ✅ PASS - All 4 functions exist
SELECT proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
AND proname IN (
  'complete_erp_sales_return_atomic',
  'void_erp_sales_return_atomic',
  'generate_sales_return_number',
  'generate_journal_entry_number'
)
ORDER BY proname;
-- RESULT:
-- complete_erp_sales_return_atomic | p_payload jsonb
-- generate_journal_entry_number    | (none)
-- generate_sales_return_number     | (none)
-- void_erp_sales_return_atomic     | p_payload jsonb

-- C0.2 Verify cost column usage in RPC body
-- EXPECTED: has_cost_pos > 0 AND has_cost_price_pos = 0 (or only in comments)
-- ACTUAL: has_cost_price_pos=7287 (in comment), has_cost_pos=7401
SELECT
  position('cost_price' IN pg_get_functiondef(p.oid)) AS has_cost_price_pos,
  position('COALESCE(cost,' IN pg_get_functiondef(p.oid)) AS has_cost_pos
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
AND p.proname = 'complete_erp_sales_return_atomic';

-- C0.2 Additional Proof: Extract actual column used
-- EXPECTED: cogs_column_expr = 'cost'
-- ACTUAL: ✅ PASS - cogs_column_expr = 'cost'
SELECT
  (regexp_match(pg_get_functiondef(p.oid), 
    'SELECT\s+COALESCE\(([^,]+),\s*0\)\s+INTO\s+v_unit_cogs'))[1] AS cogs_column_expr
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
AND p.proname = 'complete_erp_sales_return_atomic';
-- RESULT: cost

-- C0.3 RLS on finished_goods_movements INSERT is not permissive TRUE
-- EXPECTED: with_check is NOT 'true' for INSERT
-- ACTUAL: ✅ PASS - Branch-scoped check
SELECT policyname, cmd, permissive, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'finished_goods_movements'
ORDER BY cmd, policyname;
-- RESULT:
-- INSERT | PERMISSIVE | with_check = (has_role(...) OR (branch scoped))


-- ==============================================
-- C1) Test Data Selection
-- ==============================================

-- C1.1 Pick a recent sales invoice with jewelry items
-- EXPECTED: At least 1 sales invoice
-- ACTUAL: ❌ No sales invoices found (only purchase invoices exist)
SELECT i.id, i.invoice_number, i.branch_id, i.customer_id, i.total_amount, i.status
FROM invoices i
WHERE i.invoice_type = 'sales'
AND i.status <> 'voided'
ORDER BY i.created_at DESC
LIMIT 10;

-- Alternative: Use available test data for standalone return
-- branch_id: 40588085-9d0c-4ab4-a682-662b937196df (HQ)
-- customer_id: d4291164-1a8b-4936-980d-6f7fc968b616
-- jewelry_item_id: 399ae786-e511-4f59-86f5-485112ab5a21


-- ==============================================
-- C2) Smoke Test Create Return via RPC
-- ==============================================

-- C2.1 Create Return RPC Call
-- STATUS: ❌ BLOCKED - permission denied for function complete_erp_sales_return_atomic
SELECT public.complete_erp_sales_return_atomic(
  jsonb_build_object(
    'client_request_id', 'P4-9-C-TEST-001',
    'branch_id', '40588085-9d0c-4ab4-a682-662b937196df',
    'customer_id', 'd4291164-1a8b-4936-980d-6f7fc968b616',
    'linked_invoice_id', NULL,
    'return_date', current_date::text,
    'notes', 'P4-9 Smoke Test Return',
    'items', jsonb_build_array(
      jsonb_build_object(
        'jewelry_item_id', '399ae786-e511-4f59-86f5-485112ab5a21',
        'description', 'Return item (smoke test)',
        'quantity', 1,
        'unit_price', 1000,
        'tax_rate', 0.15,
        'discount_amount', 0,
        'discount_percentage', 0
      )
    )
  )
) AS rpc_result;

-- BLOCKER: Missing EXECUTE grants on:
-- - complete_erp_sales_return_atomic
-- - void_erp_sales_return_atomic

-- Grant check:
SELECT grantee, privilege_type, routine_name
FROM information_schema.routine_privileges 
WHERE routine_schema = 'public'
AND routine_name IN ('complete_erp_sales_return_atomic', 'void_erp_sales_return_atomic');
-- RESULT: No rows (missing grants)


-- ==============================================
-- C3) Smoke Test Void Return via RPC
-- ==============================================

-- C3.1 Void Return RPC Call
-- STATUS: ❌ BLOCKED - No return created (depends on C2)


-- ==============================================
-- C4) Post-Checks: No Direct Writes
-- ==============================================

-- Manual code review performed:
-- SalesReturnFormPage.tsx: Uses .rpc('complete_erp_sales_return_atomic')
-- SalesReturnViewPage.tsx: Uses .rpc('void_erp_sales_return_atomic')
-- RESULT: ✅ PASS - Zero direct writes


-- ==============================================
-- FIX REQUIRED: Add EXECUTE grants
-- ==============================================

-- Run this migration to unblock smoke tests:
-- GRANT EXECUTE ON FUNCTION public.complete_erp_sales_return_atomic(jsonb) TO PUBLIC;
-- GRANT EXECUTE ON FUNCTION public.void_erp_sales_return_atomic(jsonb) TO PUBLIC;
