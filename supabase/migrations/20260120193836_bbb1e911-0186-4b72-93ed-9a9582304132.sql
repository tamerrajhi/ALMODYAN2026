
-- Phase 3-B CORRECTED: Drop conflicting functions first then recreate
-- =====================================================

-- Drop existing functions with different signatures
DROP FUNCTION IF EXISTS public.get_allow_unallocated_list(date, date, uuid, uuid);
DROP FUNCTION IF EXISTS public.classify_hb_legacy_payment(uuid, public.hb_legacy_classification, text, uuid);
DROP FUNCTION IF EXISTS public.backfill_payment_allocation(uuid, uuid, numeric, text, uuid);

-- =====================================================
-- B3: get_allow_unallocated_list - Updated to read from payment_unallocated_events
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_allow_unallocated_list(
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL
)
RETURNS TABLE(
  event_id uuid,
  payment_id uuid,
  payment_number text,
  payment_date date,
  amount numeric,
  supplier_id uuid,
  supplier_name text,
  branch_id uuid,
  branch_name text,
  actor_id uuid,
  reason text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    e.id AS event_id,
    p.id AS payment_id,
    p.payment_number,
    p.payment_date,
    p.amount,
    p.supplier_id,
    s.name AS supplier_name,
    p.branch_id,
    b.branch_name,
    e.actor_id,
    e.reason,
    e.created_at
  FROM payment_unallocated_events e
  INNER JOIN payments p ON p.id = e.payment_id
  LEFT JOIN suppliers s ON s.id = p.supplier_id
  LEFT JOIN branches b ON b.id = p.branch_id
  WHERE (p_from_date IS NULL OR p.payment_date >= p_from_date)
    AND (p_to_date IS NULL OR p.payment_date <= p_to_date)
    AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
    AND (p_supplier_id IS NULL OR p.supplier_id = p_supplier_id)
  ORDER BY e.created_at DESC;
END;
$$;

-- =====================================================
-- D) Atomic RPCs for Legacy Cleanup WITH IDEMPOTENCY
-- =====================================================

-- D1: classify_hb_legacy_payment with idempotency (new signature with client_request_id)
CREATE OR REPLACE FUNCTION public.classify_hb_legacy_payment(
  p_client_request_id uuid,
  p_payment_id uuid,
  p_classification public.hb_legacy_classification,
  p_notes text DEFAULT NULL,
  p_approved_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_payment payments%ROWTYPE;
  v_hb_enable_date timestamp := '2026-01-19'::timestamp;
  v_existing_request pos_workflow_requests%ROWTYPE;
BEGIN
  -- IDEMPOTENCY CHECK
  SELECT * INTO v_existing_request 
  FROM pos_workflow_requests 
  WHERE client_request_id = p_client_request_id;
  
  IF v_existing_request IS NOT NULL THEN
    RETURN COALESCE(v_existing_request.result_payload, jsonb_build_object(
      'success', v_existing_request.status = 'completed',
      'idempotent', true,
      'payment_id', p_payment_id
    ));
  END IF;
  
  -- Register workflow request
  INSERT INTO pos_workflow_requests (
    client_request_id,
    workflow_type,
    entity_id,
    status,
    request_payload,
    created_at
  ) VALUES (
    p_client_request_id,
    'classify_hb_legacy',
    p_payment_id,
    'in_progress',
    jsonb_build_object('payment_id', p_payment_id, 'classification', p_classification::text),
    NOW()
  );
  
  -- Validate payment exists and is legacy
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id;
  
  IF v_payment IS NULL THEN
    UPDATE pos_workflow_requests SET
      status = 'failed',
      error_message = 'Payment not found',
      result_payload = jsonb_build_object('success', false, 'error', 'Payment not found'),
      updated_at = NOW()
    WHERE client_request_id = p_client_request_id;
    RETURN jsonb_build_object('success', false, 'error', 'Payment not found');
  END IF;
  
  IF v_payment.payment_type != 'payment' OR v_payment.supplier_id IS NULL THEN
    UPDATE pos_workflow_requests SET
      status = 'failed',
      error_message = 'Not a supplier payment',
      result_payload = jsonb_build_object('success', false, 'error', 'Not a supplier payment'),
      updated_at = NOW()
    WHERE client_request_id = p_client_request_id;
    RETURN jsonb_build_object('success', false, 'error', 'Not a supplier payment');
  END IF;
  
  IF v_payment.created_at >= v_hb_enable_date THEN
    UPDATE pos_workflow_requests SET
      status = 'failed',
      error_message = 'Payment is after HB enable date',
      result_payload = jsonb_build_object('success', false, 'error', 'Payment is after HB enable date'),
      updated_at = NOW()
    WHERE client_request_id = p_client_request_id;
    RETURN jsonb_build_object('success', false, 'error', 'Payment is after HB enable date - not a legacy case');
  END IF;
  
  -- Verify it has no allocations
  IF EXISTS (SELECT 1 FROM supplier_payment_allocations WHERE payment_id = p_payment_id) THEN
    UPDATE pos_workflow_requests SET
      status = 'failed',
      error_message = 'Payment already has allocations',
      result_payload = jsonb_build_object('success', false, 'error', 'Payment already has allocations'),
      updated_at = NOW()
    WHERE client_request_id = p_client_request_id;
    RETURN jsonb_build_object('success', false, 'error', 'Payment already has allocations');
  END IF;
  
  -- Update classification (ONLY payments table)
  UPDATE payments SET
    hb_legacy_classification = p_classification,
    hb_legacy_notes = p_notes,
    hb_legacy_approved_by = CASE WHEN p_classification = 'approved_exception' THEN p_approved_by ELSE NULL END,
    hb_legacy_approved_at = CASE WHEN p_classification = 'approved_exception' THEN NOW() ELSE NULL END
  WHERE id = p_payment_id;
  
  -- Mark workflow complete
  UPDATE pos_workflow_requests SET
    status = 'completed',
    result_payload = jsonb_build_object(
      'success', true,
      'payment_id', p_payment_id,
      'classification', p_classification::text
    ),
    updated_at = NOW()
  WHERE client_request_id = p_client_request_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'payment_id', p_payment_id,
    'classification', p_classification::text
  );
END;
$$;

-- D2: backfill_payment_allocation with idempotency - NO INVOICE UPDATE
CREATE OR REPLACE FUNCTION public.backfill_payment_allocation(
  p_client_request_id uuid,
  p_payment_id uuid,
  p_invoice_id uuid,
  p_amount numeric,
  p_notes text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_payment payments%ROWTYPE;
  v_invoice invoices%ROWTYPE;
  v_allocation_id uuid;
  v_hb_enable_date timestamp := '2026-01-19'::timestamp;
  v_existing_request pos_workflow_requests%ROWTYPE;
BEGIN
  -- IDEMPOTENCY CHECK
  SELECT * INTO v_existing_request 
  FROM pos_workflow_requests 
  WHERE client_request_id = p_client_request_id;
  
  IF v_existing_request IS NOT NULL THEN
    RETURN COALESCE(v_existing_request.result_payload, jsonb_build_object(
      'success', v_existing_request.status = 'completed',
      'idempotent', true,
      'payment_id', p_payment_id
    ));
  END IF;
  
  -- Register workflow request
  INSERT INTO pos_workflow_requests (
    client_request_id,
    workflow_type,
    entity_id,
    status,
    request_payload,
    created_at
  ) VALUES (
    p_client_request_id,
    'backfill_allocation',
    p_payment_id,
    'in_progress',
    jsonb_build_object('payment_id', p_payment_id, 'invoice_id', p_invoice_id, 'amount', p_amount),
    NOW()
  );
  
  -- Validate payment exists and is legacy
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id;
  
  IF v_payment IS NULL THEN
    UPDATE pos_workflow_requests SET
      status = 'failed',
      error_message = 'Payment not found',
      result_payload = jsonb_build_object('success', false, 'error', 'Payment not found'),
      updated_at = NOW()
    WHERE client_request_id = p_client_request_id;
    RETURN jsonb_build_object('success', false, 'error', 'Payment not found');
  END IF;
  
  IF v_payment.created_at >= v_hb_enable_date THEN
    UPDATE pos_workflow_requests SET
      status = 'failed',
      error_message = 'Payment is after HB enable date',
      result_payload = jsonb_build_object('success', false, 'error', 'Payment is after HB enable date - use regular allocation flow'),
      updated_at = NOW()
    WHERE client_request_id = p_client_request_id;
    RETURN jsonb_build_object('success', false, 'error', 'Payment is after HB enable date - use regular allocation flow');
  END IF;
  
  -- Validate invoice exists
  SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id;
  
  IF v_invoice IS NULL THEN
    UPDATE pos_workflow_requests SET
      status = 'failed',
      error_message = 'Invoice not found',
      result_payload = jsonb_build_object('success', false, 'error', 'Invoice not found'),
      updated_at = NOW()
    WHERE client_request_id = p_client_request_id;
    RETURN jsonb_build_object('success', false, 'error', 'Invoice not found');
  END IF;
  
  -- Validate same supplier
  IF v_payment.supplier_id != v_invoice.supplier_id THEN
    UPDATE pos_workflow_requests SET
      status = 'failed',
      error_message = 'Supplier mismatch',
      result_payload = jsonb_build_object('success', false, 'error', 'Supplier mismatch between payment and invoice'),
      updated_at = NOW()
    WHERE client_request_id = p_client_request_id;
    RETURN jsonb_build_object('success', false, 'error', 'Supplier mismatch between payment and invoice');
  END IF;
  
  -- Validate amount
  IF p_amount <= 0 THEN
    UPDATE pos_workflow_requests SET
      status = 'failed',
      error_message = 'Amount must be positive',
      result_payload = jsonb_build_object('success', false, 'error', 'Amount must be positive'),
      updated_at = NOW()
    WHERE client_request_id = p_client_request_id;
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
  END IF;
  
  IF p_amount > v_payment.amount THEN
    UPDATE pos_workflow_requests SET
      status = 'failed',
      error_message = 'Amount exceeds payment amount',
      result_payload = jsonb_build_object('success', false, 'error', 'Amount exceeds payment amount'),
      updated_at = NOW()
    WHERE client_request_id = p_client_request_id;
    RETURN jsonb_build_object('success', false, 'error', 'Amount exceeds payment amount');
  END IF;
  
  -- Create allocation (ONLY inserts into supplier_payment_allocations - NO invoices update)
  INSERT INTO supplier_payment_allocations (
    payment_id,
    invoice_id,
    amount,
    notes,
    created_at
  ) VALUES (
    p_payment_id,
    p_invoice_id,
    p_amount,
    COALESCE(p_notes, 'Backfilled legacy allocation'),
    NOW()
  )
  RETURNING id INTO v_allocation_id;
  
  -- Update payment classification ONLY (NO invoices table update)
  UPDATE payments SET
    hb_legacy_classification = 'backfilled',
    hb_legacy_notes = COALESCE(p_notes, 'Backfilled legacy allocation')
  WHERE id = p_payment_id;
  
  -- Mark workflow complete
  UPDATE pos_workflow_requests SET
    status = 'completed',
    result_payload = jsonb_build_object(
      'success', true,
      'allocation_id', v_allocation_id,
      'payment_id', p_payment_id,
      'invoice_id', p_invoice_id,
      'amount', p_amount,
      'note', 'Invoice paid_amount/remaining_amount NOT updated - use reconciliation if needed'
    ),
    updated_at = NOW()
  WHERE client_request_id = p_client_request_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'allocation_id', v_allocation_id,
    'payment_id', p_payment_id,
    'invoice_id', p_invoice_id,
    'amount', p_amount,
    'note', 'Invoice paid_amount/remaining_amount NOT updated - use reconciliation if needed'
  );
END;
$$;

-- =====================================================
-- Update get_monitoring_summary to use payment_unallocated_events
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_monitoring_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_hb_enable_date text := '2026-01-19';
  v_workflow_timeout_minutes int := 15;
  v_tolerance numeric := 0.01;
  v_hb_new_violations int;
  v_hb_legacy_count int;
  v_allow_unallocated_count int;
  v_formula_mismatch_count int;
  v_negative_remaining_count int;
  v_overpaid_count int;
  v_stuck_workflows_count int;
  v_unbalanced_je_count int;
  v_notes text[] := ARRAY[]::text[];
BEGIN
  -- HB New Violations
  SELECT COALESCE((
    SELECT COUNT(*) FROM (
      SELECT p.id
      FROM payments p
      LEFT JOIN supplier_payment_allocations a ON a.payment_id = p.id
      WHERE p.payment_type = 'payment'
        AND p.supplier_id IS NOT NULL
        AND p.created_at >= v_hb_enable_date::timestamp
      GROUP BY p.id
      HAVING COUNT(a.id) = 0
    ) sub
  ), 0) INTO v_hb_new_violations;

  -- HB Legacy Count
  SELECT COALESCE((
    SELECT COUNT(*) FROM (
      SELECT p.id
      FROM payments p
      LEFT JOIN supplier_payment_allocations a ON a.payment_id = p.id
      WHERE p.payment_type = 'payment'
        AND p.supplier_id IS NOT NULL
        AND p.created_at < v_hb_enable_date::timestamp
      GROUP BY p.id
      HAVING COUNT(a.id) = 0
    ) sub
  ), 0) INTO v_hb_legacy_count;

  -- Allow Unallocated Count - from payment_unallocated_events table
  SELECT COUNT(*) INTO v_allow_unallocated_count
  FROM payment_unallocated_events;

  -- Formula Mismatch Count
  SELECT COUNT(*) INTO v_formula_mismatch_count
  FROM invoices
  WHERE ABS(remaining_amount - (total_amount - COALESCE(total_returned_amount, 0) - COALESCE(paid_amount, 0))) > v_tolerance;

  -- Negative Remaining Count
  SELECT COUNT(*) INTO v_negative_remaining_count
  FROM invoices
  WHERE remaining_amount < -v_tolerance;

  -- Overpaid Count
  SELECT COUNT(*) INTO v_overpaid_count
  FROM invoices
  WHERE paid_amount > (total_amount - COALESCE(total_returned_amount, 0)) + v_tolerance;

  -- Stuck Workflows Count
  SELECT COUNT(*) INTO v_stuck_workflows_count
  FROM pos_workflow_requests
  WHERE status = 'in_progress'
    AND created_at < NOW() - (v_workflow_timeout_minutes || ' minutes')::interval;

  -- Unbalanced Journal Entries Count
  SELECT COUNT(*) INTO v_unbalanced_je_count
  FROM journal_entries
  WHERE ABS(COALESCE(total_debit, 0) - COALESCE(total_credit, 0)) > v_tolerance;

  RETURN jsonb_build_object(
    'hb_enable_date', v_hb_enable_date,
    'workflow_timeout_minutes', v_workflow_timeout_minutes,
    'tolerance', v_tolerance,
    'hb_new_violations', v_hb_new_violations,
    'hb_legacy_count', v_hb_legacy_count,
    'allow_unallocated_count', v_allow_unallocated_count,
    'formula_mismatch_count', v_formula_mismatch_count,
    'negative_remaining_count', v_negative_remaining_count,
    'overpaid_count', v_overpaid_count,
    'stuck_workflows_count', v_stuck_workflows_count,
    'unbalanced_je_count', v_unbalanced_je_count,
    'generated_at', NOW()::text,
    'notes', to_jsonb(v_notes)
  );
END;
$$;

-- =====================================================
-- Security Grants
-- =====================================================
REVOKE ALL ON FUNCTION public.get_allow_unallocated_list(date, date, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_allow_unallocated_list(date, date, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.classify_hb_legacy_payment(uuid, uuid, public.hb_legacy_classification, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.classify_hb_legacy_payment(uuid, uuid, public.hb_legacy_classification, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.backfill_payment_allocation(uuid, uuid, uuid, numeric, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.backfill_payment_allocation(uuid, uuid, uuid, numeric, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_monitoring_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_monitoring_summary() TO authenticated;
