-- ═══════════════════════════════════════════════════════════════════════════════
-- S-Clean-1: POS Piece Returns Atomic RPC — Hardening + Consolidation
-- Created: 2026-01-24
-- Purpose: Revoke anon access, consolidate logic, add invoice creation path
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 1: REVOKE ANON ACCESS FROM EXISTING RPC
-- Evidence: has_function_privilege('anon', 'complete_pos_return_atomic(jsonb)') = true
-- ═══════════════════════════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION public.complete_pos_return_atomic(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_pos_return_atomic(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_pos_return_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_pos_return_atomic(jsonb) TO service_role;

-- Also fix complete_pos_sales_return_atomic if exists
REVOKE ALL ON FUNCTION public.complete_pos_sales_return_atomic(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_pos_sales_return_atomic(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_pos_sales_return_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_pos_sales_return_atomic(jsonb) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 2: CREATE CONSOLIDATED ATOMIC RPC FOR PIECE RETURNS
-- This function handles the FULL lifecycle:
-- 1. Create return header (if not exists) with idempotency
-- 2. Create return items
-- 3. Update jewelry_items status
-- 4. Create item_movements
-- 5. Handle customer_credits (store_credit)
-- 6. Create journal entry
-- 7. Create sales_return invoice (for CustomersPage legacy path)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.complete_pos_piece_return_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  -- Idempotency
  v_gate jsonb;
  v_client_request_id text;
  
  -- Input params
  v_sale_id uuid;
  v_branch_id uuid;
  v_customer_id uuid;
  v_return_reason text;
  v_notes text;
  v_processed_by text;
  v_post_return_status text;
  v_refund_method text;
  v_create_invoice boolean;
  
  -- Items array
  v_items jsonb;
  v_item record;
  v_item_ids uuid[];
  v_items_count int;
  
  -- Return record
  v_return_id uuid;
  v_return_code text;
  v_existing_return record;
  
  -- Calculations
  v_total_amount numeric := 0;
  v_subtotal numeric := 0;
  v_tax_amount numeric := 0;
  v_items_cost numeric := 0;
  
  -- Sale info
  v_sale record;
  v_sale_branch_id uuid;
  
  -- Accounting
  v_je_id uuid;
  v_je_number text;
  v_inventory_account_code text;
  
  -- Customer credit
  v_customer_credit_id uuid;
  v_current_balance numeric;
  
  -- Invoice
  v_invoice_id uuid;
  v_invoice_number text;
  v_branch_code text;
  
  -- Counters
  v_updated_count int;
  v_locked_count int;
  
  -- Result
  v_result jsonb;
BEGIN
  -- ════════════════════════════════════════════════════════════════════════
  -- 1. PARSE PAYLOAD
  -- ════════════════════════════════════════════════════════════════════════
  v_client_request_id := p_payload->>'client_request_id';
  v_sale_id := (p_payload->>'sale_id')::uuid;
  v_branch_id := (p_payload->>'branch_id')::uuid;
  v_customer_id := (p_payload->>'customer_id')::uuid;
  v_return_reason := p_payload->>'return_reason';
  v_notes := p_payload->>'notes';
  v_processed_by := COALESCE(p_payload->>'processed_by', 'system');
  v_post_return_status := COALESCE(p_payload->>'post_return_status', 'inspection');
  v_refund_method := COALESCE(p_payload->>'refund_method', 'cash');
  v_create_invoice := COALESCE((p_payload->>'create_invoice')::boolean, false);
  v_items := COALESCE(p_payload->'items', '[]'::jsonb);
  
  -- Validate post_return_status
  IF v_post_return_status NOT IN ('available', 'inspection', 'returned') THEN
    v_post_return_status := 'inspection';
  END IF;
  
  -- ════════════════════════════════════════════════════════════════════════
  -- 2. IDEMPOTENCY GATE
  -- ════════════════════════════════════════════════════════════════════════
  IF v_client_request_id IS NULL OR v_client_request_id = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION_FAILED',
      'error_message', 'client_request_id مطلوب'
    );
  END IF;
  
  -- Check for existing return with same client_request_id
  SELECT id, return_code, status, journal_entry_id, customer_credit_id
  INTO v_existing_return
  FROM public.returns
  WHERE client_request_id = v_client_request_id;
  
  IF FOUND THEN
    -- Return cached result for idempotency
    RETURN jsonb_build_object(
      'success', true,
      'return_id', v_existing_return.id,
      'return_code', v_existing_return.return_code,
      'status', v_existing_return.status,
      'journal_entry_id', v_existing_return.journal_entry_id,
      'customer_credit_id', v_existing_return.customer_credit_id,
      'is_existing', true
    );
  END IF;
  
  -- ════════════════════════════════════════════════════════════════════════
  -- 3. VALIDATION
  -- ════════════════════════════════════════════════════════════════════════
  
  -- Validate sale exists
  SELECT s.id, s.sale_code, s.branch_id, s.customer_id, c.full_name as customer_name
  INTO v_sale
  FROM public.sales s
  LEFT JOIN public.customers c ON c.id = s.customer_id
  WHERE s.id = v_sale_id;
  
  IF v_sale IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'SALE_NOT_FOUND',
      'error_message', 'الفاتورة غير موجودة'
    );
  END IF;
  
  v_sale_branch_id := COALESCE(v_branch_id, v_sale.branch_id);
  v_customer_id := COALESCE(v_customer_id, v_sale.customer_id);
  
  -- Parse items array
  SELECT array_agg((item->>'jewelry_item_id')::uuid)
  INTO v_item_ids
  FROM jsonb_array_elements(v_items) AS item;
  
  v_items_count := COALESCE(array_length(v_item_ids, 1), 0);
  
  IF v_items_count = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'NO_ITEMS',
      'error_message', 'يجب تحديد قطعة واحدة على الأقل للإرجاع'
    );
  END IF;
  
  -- Store credit requires customer
  IF v_refund_method = 'store_credit' AND v_customer_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'CUSTOMER_REQUIRED',
      'error_message', 'رصيد المتجر يتطلب تحديد العميل'
    );
  END IF;
  
  -- ════════════════════════════════════════════════════════════════════════
  -- 4. LOCK ITEMS AND CALCULATE TOTALS
  -- ════════════════════════════════════════════════════════════════════════
  SELECT COUNT(*), COALESCE(SUM(cost), 0)
  INTO v_locked_count, v_items_cost
  FROM public.jewelry_items
  WHERE id = ANY(v_item_ids)
  FOR UPDATE;
  
  IF v_locked_count <> v_items_count THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'ITEMS_MISMATCH',
      'error_message', format('تم العثور على %s قطع من أصل %s', v_locked_count, v_items_count)
    );
  END IF;
  
  -- Calculate total from items
  SELECT COALESCE(SUM((item->>'line_amount')::numeric), 0)
  INTO v_total_amount
  FROM jsonb_array_elements(v_items) AS item;
  
  -- If no line_amount provided, use sold_price from jewelry_items
  IF v_total_amount = 0 THEN
    SELECT COALESCE(SUM(sold_price), 0)
    INTO v_total_amount
    FROM public.jewelry_items
    WHERE id = ANY(v_item_ids);
  END IF;
  
  -- Calculate tax (15% VAT)
  v_subtotal := ROUND(v_total_amount / 1.15, 2);
  v_tax_amount := ROUND(v_total_amount - v_subtotal, 2);
  
  -- ════════════════════════════════════════════════════════════════════════
  -- 5. GENERATE RETURN CODE
  -- ════════════════════════════════════════════════════════════════════════
  SELECT public.generate_pos_return_code() INTO v_return_code;
  
  -- ════════════════════════════════════════════════════════════════════════
  -- 6. CREATE RETURN HEADER
  -- ════════════════════════════════════════════════════════════════════════
  INSERT INTO public.returns (
    return_code,
    sale_id,
    branch_id,
    customer_id,
    reason,
    notes,
    total_amount,
    subtotal_before_tax,
    tax_amount,
    refund_method,
    post_return_status,
    status,
    processed_by,
    client_request_id,
    original_sale_branch_id
  ) VALUES (
    v_return_code,
    v_sale_id,
    v_sale_branch_id,
    v_customer_id,
    v_return_reason,
    v_notes,
    v_total_amount,
    v_subtotal,
    v_tax_amount,
    v_refund_method,
    v_post_return_status,
    'draft',
    v_processed_by,
    v_client_request_id,
    v_sale.branch_id
  )
  RETURNING id INTO v_return_id;
  
  -- ════════════════════════════════════════════════════════════════════════
  -- 7. CREATE RETURN ITEMS
  -- ════════════════════════════════════════════════════════════════════════
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) AS item
  LOOP
    INSERT INTO public.return_items (
      return_id,
      item_id,
      sale_item_id,
      return_price,
      unit_price,
      line_total,
      return_reason,
      item_code,
      item_name
    ) VALUES (
      v_return_id,
      (v_item.item->>'jewelry_item_id')::uuid,
      (v_item.item->>'sale_item_id')::uuid,
      COALESCE((v_item.item->>'line_amount')::numeric, 0),
      COALESCE((v_item.item->>'unit_price')::numeric, 0),
      COALESCE((v_item.item->>'line_amount')::numeric, 0),
      v_return_reason,
      v_item.item->>'item_code',
      v_item.item->>'item_name'
    );
  END LOOP;
  
  -- ════════════════════════════════════════════════════════════════════════
  -- 8. UPDATE JEWELRY ITEMS STATUS
  -- ════════════════════════════════════════════════════════════════════════
  UPDATE public.jewelry_items
  SET
    sold_at = NULL,
    sold_price = NULL,
    sale_id = NULL,
    sale_status = v_post_return_status,
    branch_id = v_sale_branch_id,
    is_available_for_sale = (v_post_return_status = 'available')
  WHERE id = ANY(v_item_ids);
  
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  
  IF v_updated_count <> v_items_count THEN
    RAISE EXCEPTION 'Failed to update all items: updated % of %', v_updated_count, v_items_count;
  END IF;
  
  -- ════════════════════════════════════════════════════════════════════════
  -- 9. CREATE ITEM MOVEMENTS
  -- ════════════════════════════════════════════════════════════════════════
  INSERT INTO public.item_movements (
    item_id,
    movement_type,
    to_branch_id,
    return_id,
    reference_type,
    reference_id,
    reference_code,
    notes,
    performed_by,
    cost
  )
  SELECT 
    ji.id,
    'RETURN_FROM_SALE',
    v_sale_branch_id,
    v_return_id,
    'pos_return',
    v_return_id,
    v_return_code,
    format('مرتجع من فاتورة %s', v_sale.sale_code),
    v_processed_by,
    COALESCE(ji.cost, 0)
  FROM public.jewelry_items ji
  WHERE ji.id = ANY(v_item_ids);
  
  -- ════════════════════════════════════════════════════════════════════════
  -- 10. HANDLE STORE CREDIT
  -- ════════════════════════════════════════════════════════════════════════
  IF v_refund_method = 'store_credit' AND v_customer_id IS NOT NULL THEN
    -- Get current balance
    SELECT COALESCE(SUM(
      CASE WHEN credit_type = 'credit' THEN credit_amount 
           WHEN credit_type = 'debit' THEN -credit_amount 
           ELSE 0 END
    ), 0)
    INTO v_current_balance
    FROM public.customer_credits
    WHERE customer_id = v_customer_id;
    
    INSERT INTO public.customer_credits (
      customer_id,
      branch_id,
      credit_amount,
      return_id,
      credit_type,
      balance_after,
      notes,
      created_by
    ) VALUES (
      v_customer_id,
      v_sale_branch_id,
      v_total_amount,
      v_return_id,
      'credit',
      v_current_balance + v_total_amount,
      format('رصيد من مرتجع %s - فاتورة %s', v_return_code, v_sale.sale_code),
      v_processed_by
    )
    RETURNING id INTO v_customer_credit_id;
    
    -- Link credit to return
    UPDATE public.returns
    SET customer_credit_id = v_customer_credit_id
    WHERE id = v_return_id;
  END IF;
  
  -- ════════════════════════════════════════════════════════════════════════
  -- 11. GET INVENTORY ACCOUNT FOR JOURNAL ENTRY
  -- ════════════════════════════════════════════════════════════════════════
  SELECT COALESCE(coa.account_code, '1410')
  INTO v_inventory_account_code
  FROM public.branch_inventory_accounts bia
  JOIN public.chart_of_accounts coa ON coa.id = bia.general_inventory_account_id
  WHERE bia.branch_id = v_sale_branch_id;
  
  IF v_inventory_account_code IS NULL THEN
    v_inventory_account_code := '1410'; -- Default inventory account
  END IF;
  
  -- ════════════════════════════════════════════════════════════════════════
  -- 12. CREATE JOURNAL ENTRY
  -- ════════════════════════════════════════════════════════════════════════
  -- Generate JE number
  SELECT 'RET-' || LPAD(COALESCE(
    (SELECT MAX(CAST(NULLIF(SUBSTRING(entry_number FROM 5), '') AS INT)) + 1
     FROM public.journal_entries 
     WHERE entry_number LIKE 'RET-%'), 1
  )::text, 6, '0')
  INTO v_je_number;
  
  INSERT INTO public.journal_entries (
    entry_number,
    entry_date,
    description,
    reference_type,
    reference_id,
    total_debit,
    total_credit,
    is_posted,
    branch_id,
    created_by
  ) VALUES (
    v_je_number,
    CURRENT_DATE,
    format('مرتجع مبيعات %s من فاتورة %s', v_return_code, v_sale.sale_code),
    'pos_return',
    v_return_id,
    v_total_amount,
    v_total_amount,
    true,
    v_sale_branch_id,
    v_processed_by
  )
  RETURNING id INTO v_je_id;
  
  -- Create JE lines based on refund method
  -- DR: Sales Returns (4110) - reduce revenue
  INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  SELECT v_je_id, id, v_subtotal, 0, 'مرتجع مبيعات'
  FROM public.chart_of_accounts WHERE account_code = '4110';
  
  -- DR: VAT Payable (2210) - reduce VAT liability
  INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  SELECT v_je_id, id, v_tax_amount, 0, 'ضريبة مرتجع'
  FROM public.chart_of_accounts WHERE account_code = '2210';
  
  -- CR: Refund account based on method
  IF v_refund_method = 'cash' THEN
    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    SELECT v_je_id, id, 0, v_total_amount, 'رد نقدي'
    FROM public.chart_of_accounts WHERE account_code = '1110';
  ELSIF v_refund_method = 'card' THEN
    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    SELECT v_je_id, id, 0, v_total_amount, 'رد بطاقة'
    FROM public.chart_of_accounts WHERE account_code = '1120';
  ELSIF v_refund_method = 'store_credit' THEN
    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    SELECT v_je_id, id, 0, v_total_amount, 'رصيد عميل'
    FROM public.chart_of_accounts WHERE account_code = '2120';
  END IF;
  
  -- DR: Inventory (restore cost)
  INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  SELECT v_je_id, id, v_items_cost, 0, 'إرجاع للمخزون'
  FROM public.chart_of_accounts WHERE account_code = v_inventory_account_code;
  
  -- CR: COGS (reduce cost of goods sold)
  INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  SELECT v_je_id, id, 0, v_items_cost, 'عكس تكلفة مبيعات'
  FROM public.chart_of_accounts WHERE account_code = '5110';
  
  -- ════════════════════════════════════════════════════════════════════════
  -- 13. CREATE INVOICE (if requested - for CustomersPage legacy path)
  -- ════════════════════════════════════════════════════════════════════════
  IF v_create_invoice THEN
    -- Get branch code for invoice number
    SELECT branch_code INTO v_branch_code
    FROM public.branches WHERE id = v_sale_branch_id;
    
    -- Generate invoice number
    SELECT public.generate_invoice_number('sales_return', COALESCE(v_branch_code, ''))
    INTO v_invoice_number;
    
    INSERT INTO public.invoices (
      invoice_number,
      invoice_type,
      invoice_date,
      customer_id,
      branch_id,
      return_id,
      total_amount,
      paid_amount,
      remaining_amount,
      status
    ) VALUES (
      v_invoice_number,
      'sales_return',
      CURRENT_DATE,
      v_customer_id,
      v_sale_branch_id,
      v_return_id,
      v_total_amount,
      v_total_amount,
      0,
      'paid'
    )
    RETURNING id INTO v_invoice_id;
    
    -- Link invoice to return
    UPDATE public.returns
    SET invoice_id = v_invoice_id
    WHERE id = v_return_id;
  END IF;
  
  -- ════════════════════════════════════════════════════════════════════════
  -- 14. UPDATE RETURN TO POSTED
  -- ════════════════════════════════════════════════════════════════════════
  UPDATE public.returns
  SET
    status = 'posted',
    posted_at = NOW(),
    posted_by = v_processed_by,
    journal_entry_id = v_je_id
  WHERE id = v_return_id;
  
  -- Update item_movements with journal_entry_id
  UPDATE public.item_movements
  SET journal_entry_id = v_je_id
  WHERE return_id = v_return_id;
  
  -- ════════════════════════════════════════════════════════════════════════
  -- 15. BUILD RESULT
  -- ════════════════════════════════════════════════════════════════════════
  v_result := jsonb_build_object(
    'success', true,
    'return_id', v_return_id,
    'return_code', v_return_code,
    'status', 'posted',
    'total_amount', v_total_amount,
    'items_count', v_items_count,
    'journal_entry_id', v_je_id,
    'journal_entry_number', v_je_number,
    'customer_credit_id', v_customer_credit_id,
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'is_existing', false
  );
  
  RETURN v_result;
  
EXCEPTION WHEN OTHERS THEN
  -- Rollback is automatic in case of exception
  RETURN jsonb_build_object(
    'success', false,
    'error_code', 'TRANSACTION_FAILED',
    'error_message', SQLERRM,
    'error_detail', SQLSTATE
  );
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 3: SET PROPER GRANTS
-- ═══════════════════════════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION public.complete_pos_piece_return_atomic(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_pos_piece_return_atomic(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_pos_piece_return_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_pos_piece_return_atomic(jsonb) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 4: VERIFICATION QUERIES (Run after migration)
-- ═══════════════════════════════════════════════════════════════════════════════

-- G1: Function exists + SECURITY DEFINER
-- SELECT proname, prosecdef FROM pg_proc p 
-- JOIN pg_namespace n ON p.pronamespace = n.oid 
-- WHERE n.nspname = 'public' AND proname = 'complete_pos_piece_return_atomic';
-- EXPECTED: prosecdef = true

-- G2: Privileges check
-- SELECT 
--   'anon' as role, has_function_privilege('anon', 'public.complete_pos_piece_return_atomic(jsonb)', 'EXECUTE') as can_execute
-- UNION ALL SELECT 
--   'authenticated', has_function_privilege('authenticated', 'public.complete_pos_piece_return_atomic(jsonb)', 'EXECUTE')
-- UNION ALL SELECT 
--   'service_role', has_function_privilege('service_role', 'public.complete_pos_piece_return_atomic(jsonb)', 'EXECUTE');
-- EXPECTED: anon=false, authenticated=true, service_role=true

-- G3: Idempotency index exists
-- SELECT indexname, indexdef FROM pg_indexes 
-- WHERE tablename = 'returns' AND indexdef LIKE '%client_request_id%';
-- EXPECTED: idx_returns_client_request_id_unique with WHERE clause

-- G4: Existing RPC also secured
-- SELECT 
--   'anon' as role, has_function_privilege('anon', 'public.complete_pos_return_atomic(jsonb)', 'EXECUTE') as can_execute
-- UNION ALL SELECT 
--   'authenticated', has_function_privilege('authenticated', 'public.complete_pos_return_atomic(jsonb)', 'EXECUTE');
-- EXPECTED: anon=false, authenticated=true
