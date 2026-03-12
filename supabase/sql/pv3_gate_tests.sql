-- =====================================================
-- PV-3 Stage-1 Gate Tests
-- Run these after deployment to verify canonical restore
-- =====================================================

-- =====================================================
-- PREREQUISITE: Verify test data exists
-- =====================================================
DO $$
DECLARE
  v_supplier_id uuid;
  v_branch_id uuid;
  v_invoice1_id uuid;
  v_invoice2_id uuid;
BEGIN
  -- Get or report test data
  SELECT id INTO v_supplier_id FROM suppliers WHERE account_id IS NOT NULL LIMIT 1;
  SELECT id INTO v_branch_id FROM branches WHERE is_active = true LIMIT 1;
  SELECT id INTO v_invoice1_id FROM invoices WHERE type = 'purchase' AND remaining_amount > 100 LIMIT 1;
  SELECT id INTO v_invoice2_id FROM invoices WHERE type = 'purchase' AND remaining_amount > 100 AND id != v_invoice1_id LIMIT 1;
  
  RAISE NOTICE 'Test Prerequisites:';
  RAISE NOTICE '  supplier_id: %', v_supplier_id;
  RAISE NOTICE '  branch_id: %', v_branch_id;
  RAISE NOTICE '  invoice1_id: %', v_invoice1_id;
  RAISE NOTICE '  invoice2_id: %', v_invoice2_id;
  
  IF v_supplier_id IS NULL THEN
    RAISE NOTICE '  ⚠️ No supplier with account_id found - G1 will fail';
  END IF;
  IF v_branch_id IS NULL THEN
    RAISE NOTICE '  ⚠️ No active branch found - All tests will fail';
  END IF;
END $$;

-- =====================================================
-- G1) CREATE PAYMENT WITH ALLOCATIONS (2 invoices)
-- Expected: SUCCESS with payments row, allocations, balanced JE
-- =====================================================
DO $$
DECLARE
  v_result jsonb;
  v_supplier_id uuid;
  v_branch_id uuid;
  v_invoice1_id uuid;
  v_invoice2_id uuid;
  v_invoice1_remaining numeric;
  v_invoice2_remaining numeric;
  v_test_client_id uuid := gen_random_uuid();
  v_payment_id uuid;
  v_je_id uuid;
  v_alloc_count int;
  v_je_balanced boolean;
BEGIN
  -- Get test data
  SELECT id INTO v_supplier_id FROM suppliers WHERE account_id IS NOT NULL LIMIT 1;
  SELECT id INTO v_branch_id FROM branches WHERE is_active = true LIMIT 1;
  SELECT id, remaining_amount INTO v_invoice1_id, v_invoice1_remaining 
  FROM invoices WHERE type = 'purchase' AND remaining_amount > 100 LIMIT 1;
  SELECT id, remaining_amount INTO v_invoice2_id, v_invoice2_remaining 
  FROM invoices WHERE type = 'purchase' AND remaining_amount > 100 AND id != v_invoice1_id LIMIT 1;

  IF v_supplier_id IS NULL OR v_branch_id IS NULL OR v_invoice1_id IS NULL THEN
    RAISE NOTICE 'G1: ⏭️ SKIPPED - Missing test data (supplier/branch/invoices)';
    RETURN;
  END IF;

  -- Call RPC
  v_result := public.payment_voucher_atomic(jsonb_build_object(
    'client_request_id', v_test_client_id,
    'payment', jsonb_build_object(
      'payment_type', 'payment',
      'payment_date', CURRENT_DATE,
      'amount', 200,
      'payment_method', 'cash',
      'supplier_id', v_supplier_id,
      'branch_id', v_branch_id,
      'notes', 'G1 Test Payment'
    ),
    'allocations', jsonb_build_array(
      jsonb_build_object('invoice_id', v_invoice1_id, 'amount', 100),
      jsonb_build_object('invoice_id', v_invoice2_id, 'amount', 100)
    )
  ));

  IF (v_result->>'success')::boolean = true THEN
    v_payment_id := (v_result->>'payment_id')::uuid;
    v_je_id := (v_result->>'journal_entry_id')::uuid;
    
    -- Verify allocations created
    SELECT COUNT(*) INTO v_alloc_count 
    FROM supplier_payment_allocations 
    WHERE payment_id = v_payment_id;
    
    -- Verify JE is balanced and posted
    SELECT 
      je.is_posted = true AND je.total_debit = je.total_credit AND je.total_debit > 0
    INTO v_je_balanced
    FROM journal_entries je
    WHERE je.id = v_je_id;
    
    IF v_alloc_count = 2 AND v_je_balanced THEN
      RAISE NOTICE 'G1: ✅ PASS - Payment created with 2 allocations, balanced JE (is_posted=true)';
      RAISE NOTICE '    payment_id: %, entry_number: %', v_payment_id, v_result->>'entry_number';
    ELSE
      RAISE NOTICE 'G1: ❌ FAIL - alloc_count=%, je_balanced=%', v_alloc_count, v_je_balanced;
    END IF;
  ELSE
    RAISE NOTICE 'G1: ❌ FAIL - RPC returned error: %', v_result->>'error';
  END IF;
  
  -- Cleanup
  DELETE FROM supplier_payment_allocations WHERE payment_id = v_payment_id;
  DELETE FROM journal_entry_lines WHERE journal_entry_id = v_je_id;
  DELETE FROM journal_entries WHERE id = v_je_id;
  DELETE FROM payments WHERE id = v_payment_id;
END $$;

-- =====================================================
-- G2) HARD BLOCK: Empty allocations + allow_unallocated=false
-- Expected: FAIL with error_code='SET_HB', no rows created
-- =====================================================
DO $$
DECLARE
  v_result jsonb;
  v_supplier_id uuid;
  v_branch_id uuid;
  v_test_client_id uuid := gen_random_uuid();
  v_payment_count_before int;
  v_payment_count_after int;
BEGIN
  -- Get test data
  SELECT id INTO v_supplier_id FROM suppliers WHERE account_id IS NOT NULL LIMIT 1;
  SELECT id INTO v_branch_id FROM branches WHERE is_active = true LIMIT 1;
  
  IF v_supplier_id IS NULL OR v_branch_id IS NULL THEN
    RAISE NOTICE 'G2: ⏭️ SKIPPED - Missing test data';
    RETURN;
  END IF;

  -- Count payments before
  SELECT COUNT(*) INTO v_payment_count_before FROM payments;

  -- Call RPC (should fail with SET_HB)
  v_result := public.payment_voucher_atomic(jsonb_build_object(
    'client_request_id', v_test_client_id,
    'payment', jsonb_build_object(
      'payment_type', 'payment',
      'payment_date', CURRENT_DATE,
      'amount', 100,
      'payment_method', 'cash',
      'supplier_id', v_supplier_id,
      'branch_id', v_branch_id
    ),
    'allocations', '[]'::jsonb,
    'allow_unallocated', false
  ));

  -- Count payments after
  SELECT COUNT(*) INTO v_payment_count_after FROM payments;

  IF (v_result->>'success')::boolean = false 
     AND v_result->>'error_code' = 'SET_HB'
     AND v_payment_count_before = v_payment_count_after
  THEN
    RAISE NOTICE 'G2: ✅ PASS - Hard Block enforced (SET_HB), no rows created';
  ELSE
    RAISE NOTICE 'G2: ❌ FAIL - success=%, error_code=%, payments_created=%', 
      v_result->>'success', v_result->>'error_code', v_payment_count_after - v_payment_count_before;
  END IF;
END $$;

-- =====================================================
-- G3) IDEMPOTENCY: Same client_request_id returns cached result
-- Expected: Second call returns cached result, no duplicate
-- =====================================================
DO $$
DECLARE
  v_result1 jsonb;
  v_result2 jsonb;
  v_supplier_id uuid;
  v_branch_id uuid;
  v_invoice_id uuid;
  v_test_client_id uuid := gen_random_uuid();
  v_payment_count int;
BEGIN
  -- Get test data
  SELECT id INTO v_supplier_id FROM suppliers WHERE account_id IS NOT NULL LIMIT 1;
  SELECT id INTO v_branch_id FROM branches WHERE is_active = true LIMIT 1;
  SELECT id INTO v_invoice_id FROM invoices WHERE type = 'purchase' AND remaining_amount > 50 LIMIT 1;
  
  IF v_supplier_id IS NULL OR v_branch_id IS NULL OR v_invoice_id IS NULL THEN
    RAISE NOTICE 'G3: ⏭️ SKIPPED - Missing test data';
    RETURN;
  END IF;

  -- First call
  v_result1 := public.payment_voucher_atomic(jsonb_build_object(
    'client_request_id', v_test_client_id,
    'payment', jsonb_build_object(
      'payment_type', 'payment',
      'payment_date', CURRENT_DATE,
      'amount', 50,
      'payment_method', 'cash',
      'supplier_id', v_supplier_id,
      'branch_id', v_branch_id
    ),
    'allocations', jsonb_build_array(
      jsonb_build_object('invoice_id', v_invoice_id, 'amount', 50)
    )
  ));

  -- Second call with SAME client_request_id
  v_result2 := public.payment_voucher_atomic(jsonb_build_object(
    'client_request_id', v_test_client_id,
    'payment', jsonb_build_object(
      'payment_type', 'payment',
      'payment_date', CURRENT_DATE,
      'amount', 50,
      'payment_method', 'cash',
      'supplier_id', v_supplier_id,
      'branch_id', v_branch_id
    ),
    'allocations', jsonb_build_array(
      jsonb_build_object('invoice_id', v_invoice_id, 'amount', 50)
    )
  ));

  -- Count payments with this payment_id
  SELECT COUNT(*) INTO v_payment_count 
  FROM payments 
  WHERE id = (v_result1->>'payment_id')::uuid;

  IF (v_result1->>'success')::boolean = true 
     AND (v_result2->>'success')::boolean = true
     AND v_result1->>'payment_id' = v_result2->>'payment_id'
     AND v_payment_count = 1
  THEN
    RAISE NOTICE 'G3: ✅ PASS - Idempotency works, same payment_id returned, only 1 row created';
    RAISE NOTICE '    payment_id: %', v_result1->>'payment_id';
  ELSE
    RAISE NOTICE 'G3: ❌ FAIL - result1.payment_id=%, result2.payment_id=%, count=%', 
      v_result1->>'payment_id', v_result2->>'payment_id', v_payment_count;
  END IF;
  
  -- Cleanup
  DECLARE
    v_payment_id uuid := (v_result1->>'payment_id')::uuid;
    v_je_id uuid := (v_result1->>'journal_entry_id')::uuid;
  BEGIN
    DELETE FROM supplier_payment_allocations WHERE payment_id = v_payment_id;
    DELETE FROM journal_entry_lines WHERE journal_entry_id = v_je_id;
    DELETE FROM journal_entries WHERE id = v_je_id;
    DELETE FROM payments WHERE id = v_payment_id;
  END;
END $$;

-- =====================================================
-- G4) GOVERNANCE: No direct writes to atomic_workflow_requests
-- Expected: Function uses canonical writers only
-- =====================================================
DO $$
DECLARE
  v_function_source text;
  v_has_insert boolean;
  v_has_update boolean;
  v_has_delete boolean;
  v_has_begin_workflow boolean;
  v_has_core_success boolean;
  v_has_core_failed boolean;
BEGIN
  -- Get function source
  SELECT prosrc INTO v_function_source
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'payment_voucher_atomic';

  -- Check for prohibited direct writes
  v_has_insert := v_function_source ~* 'INSERT\s+INTO\s+atomic_workflow_requests';
  v_has_update := v_function_source ~* 'UPDATE\s+atomic_workflow_requests';
  v_has_delete := v_function_source ~* 'DELETE\s+FROM\s+atomic_workflow_requests';
  
  -- Check for canonical writers
  v_has_begin_workflow := v_function_source ~* 'begin_workflow_request';
  v_has_core_success := v_function_source ~* 'core_workflow_success';
  v_has_core_failed := v_function_source ~* 'core_workflow_failed';

  IF NOT v_has_insert AND NOT v_has_update AND NOT v_has_delete
     AND v_has_begin_workflow AND v_has_core_success AND v_has_core_failed
  THEN
    RAISE NOTICE 'G4: ✅ PASS - No direct writes to atomic_workflow_requests';
    RAISE NOTICE '    Uses: begin_workflow_request=%, core_workflow_success=%, core_workflow_failed=%',
      v_has_begin_workflow, v_has_core_success, v_has_core_failed;
  ELSE
    RAISE NOTICE 'G4: ❌ FAIL - Direct writes detected or missing canonical writers';
    RAISE NOTICE '    INSERT=%, UPDATE=%, DELETE=%', v_has_insert, v_has_update, v_has_delete;
    RAISE NOTICE '    begin_workflow=%, core_success=%, core_failed=%',
      v_has_begin_workflow, v_has_core_success, v_has_core_failed;
  END IF;
END $$;

-- =====================================================
-- G5) ACCOUNTING: Verify reference_type, is_posted, totals
-- Expected: JE has reference_type='payment_voucher', is_posted=true, totals>0
-- =====================================================
DO $$
DECLARE
  v_result jsonb;
  v_supplier_id uuid;
  v_branch_id uuid;
  v_invoice_id uuid;
  v_test_client_id uuid := gen_random_uuid();
  v_je_id uuid;
  v_je_reference_type text;
  v_je_is_posted boolean;
  v_je_total_debit numeric;
  v_je_total_credit numeric;
BEGIN
  -- Get test data
  SELECT id INTO v_supplier_id FROM suppliers WHERE account_id IS NOT NULL LIMIT 1;
  SELECT id INTO v_branch_id FROM branches WHERE is_active = true LIMIT 1;
  SELECT id INTO v_invoice_id FROM invoices WHERE type = 'purchase' AND remaining_amount > 75 LIMIT 1;
  
  IF v_supplier_id IS NULL OR v_branch_id IS NULL OR v_invoice_id IS NULL THEN
    RAISE NOTICE 'G5: ⏭️ SKIPPED - Missing test data';
    RETURN;
  END IF;

  -- Create payment
  v_result := public.payment_voucher_atomic(jsonb_build_object(
    'client_request_id', v_test_client_id,
    'payment', jsonb_build_object(
      'payment_type', 'payment',
      'payment_date', CURRENT_DATE,
      'amount', 75,
      'payment_method', 'bank_transfer',
      'supplier_id', v_supplier_id,
      'branch_id', v_branch_id
    ),
    'allocations', jsonb_build_array(
      jsonb_build_object('invoice_id', v_invoice_id, 'amount', 75)
    )
  ));

  IF (v_result->>'success')::boolean = true THEN
    v_je_id := (v_result->>'journal_entry_id')::uuid;
    
    -- Check JE properties
    SELECT reference_type, is_posted, total_debit, total_credit
    INTO v_je_reference_type, v_je_is_posted, v_je_total_debit, v_je_total_credit
    FROM journal_entries
    WHERE id = v_je_id;

    IF v_je_reference_type = 'payment_voucher'
       AND v_je_is_posted = true
       AND v_je_total_debit > 0
       AND v_je_total_debit = v_je_total_credit
    THEN
      RAISE NOTICE 'G5: ✅ PASS - Accounting contracts satisfied';
      RAISE NOTICE '    reference_type=%, is_posted=%, total_debit=%, total_credit=%',
        v_je_reference_type, v_je_is_posted, v_je_total_debit, v_je_total_credit;
    ELSE
      RAISE NOTICE 'G5: ❌ FAIL - Accounting contracts violated';
      RAISE NOTICE '    reference_type=% (expected payment_voucher)', v_je_reference_type;
      RAISE NOTICE '    is_posted=% (expected true)', v_je_is_posted;
      RAISE NOTICE '    total_debit=%, total_credit=%', v_je_total_debit, v_je_total_credit;
    END IF;
    
    -- Cleanup
    DECLARE
      v_payment_id uuid := (v_result->>'payment_id')::uuid;
    BEGIN
      DELETE FROM supplier_payment_allocations WHERE payment_id = v_payment_id;
      DELETE FROM journal_entry_lines WHERE journal_entry_id = v_je_id;
      DELETE FROM journal_entries WHERE id = v_je_id;
      DELETE FROM payments WHERE id = v_payment_id;
    END;
  ELSE
    RAISE NOTICE 'G5: ❌ FAIL - RPC returned error: %', v_result->>'error';
  END IF;
END $$;

-- =====================================================
-- SUMMARY: Run all gate tests
-- =====================================================
SELECT 'PV-3 Gate Tests Complete - Check NOTICE messages above for results' AS status;
