-- ╔═══════════════════════════════════════════════════════════════════════════════╗
-- ║ HOTFIX: Fix format() %.2f error in payment_voucher_atomic + Governance Rule  ║
-- ║ Problem: PostgreSQL format() doesn't support C-style %.2f specifiers         ║
-- ║ Solution: Use %s with to_char(round(x,2), 'FM9999999990D00')                  ║
-- ╚═══════════════════════════════════════════════════════════════════════════════╝

-- ══════════════════════════════════════════════════════════════════════════════════
-- PART A: Fix payment_voucher_atomic - Replace %.2f with safe formatting
-- ══════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.payment_voucher_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  -- Idempotency
  v_client_request_id uuid;
  v_payload_hash text;
  v_begin jsonb;
  v_begin_status text;
  
  -- Payment extraction (from nested payment object)
  v_payment jsonb;
  v_payment_type text;
  v_payment_date date;
  v_amount numeric;
  v_payment_method text;
  v_supplier_id uuid;
  v_customer_id uuid;
  v_invoice_id uuid;  -- kept NULL per allocations model
  v_branch_id uuid;
  v_notes text;
  v_status text;
  v_currency text;
  v_exchange_rate numeric;
  
  -- Journal extraction (from nested journal object)
  v_journal jsonb;
  v_entry_date date;
  v_description text;
  v_reference_type text;
  
  -- Hard block
  v_allow_unallocated boolean;
  v_allocations jsonb;
  
  -- Generated values
  v_payment_id uuid;
  v_payment_number text;
  v_journal_entry_id uuid;
  v_journal_number text;
  v_je_lines jsonb;
  
  -- Allocation processing
  v_alloc jsonb;
  v_alloc_invoice_id uuid;
  v_alloc_amount numeric;
  v_invoice_total_amount numeric;
  v_invoice_total_returned numeric;
  v_invoice_paid_amount numeric;
  v_invoice_supplier_id uuid;
  v_canonical_remaining numeric;
  v_new_paid numeric;
  v_new_remaining numeric;
  v_new_status text;
  v_touched_invoices jsonb := '[]'::jsonb;
  
  -- Result
  v_result jsonb;
BEGIN
  -- ═══════════════════════════════════════════════════════════════
  -- A) CANONICAL CONTRACT: Extract from snake_case nested payload
  -- ═══════════════════════════════════════════════════════════════
  
  -- Client request ID (uuid)
  v_client_request_id := (p_payload->>'client_request_id')::uuid;
  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'client_request_id is required'
    );
  END IF;
  
  -- Payment object extraction
  v_payment := p_payload->'payment';
  IF v_payment IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'payment object is required'
    );
  END IF;
  
  v_payment_type := v_payment->>'payment_type';
  v_payment_date := COALESCE((v_payment->>'payment_date')::date, CURRENT_DATE);
  v_amount := COALESCE((v_payment->>'amount')::numeric, 0);
  v_payment_method := COALESCE(v_payment->>'payment_method', 'cash');
  v_supplier_id := (v_payment->>'supplier_id')::uuid;
  v_customer_id := (v_payment->>'customer_id')::uuid;
  v_invoice_id := NULL;  -- Always NULL per allocations model
  v_branch_id := (v_payment->>'branch_id')::uuid;
  v_notes := v_payment->>'notes';
  v_status := COALESCE(v_payment->>'status', 'posted');
  v_currency := COALESCE(v_payment->>'currency', 'SAR');
  v_exchange_rate := COALESCE((v_payment->>'exchange_rate')::numeric, 1);
  
  -- Journal object extraction
  v_journal := p_payload->'journal';
  IF v_journal IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'journal object is required'
    );
  END IF;
  
  v_entry_date := COALESCE((v_journal->>'entry_date')::date, v_payment_date);
  v_description := v_journal->>'description';
  v_reference_type := COALESCE(v_journal->>'reference_type', 'payment_voucher');
  
  -- Allocations array (at root level)
  v_allocations := p_payload->'allocations';
  v_allow_unallocated := COALESCE((p_payload->>'allow_unallocated')::boolean, false);
  
  -- ═══════════════════════════════════════════════════════════════
  -- B) CANONICAL IDEMPOTENCY — MUST BE BEFORE HARD BLOCK
  -- ═══════════════════════════════════════════════════════════════
  v_payload_hash := public.stable_payload_hash(p_payload);
  v_begin := public.begin_workflow_request(v_client_request_id, 'payment_voucher_atomic', p_payload);
  v_begin_status := v_begin->>'status';
  
  -- Handle idempotency statuses
  IF v_begin_status = 'succeeded' THEN
    RETURN COALESCE(
      v_begin->'cached_result',
      jsonb_build_object('success', true, 'cached', true, 'message', 'Previously completed')
    );
  ELSIF v_begin_status = 'conflict' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'IDEMPOTENCY_CONFLICT',
      'error', 'Payload changed for existing request ID'
    );
  ELSIF v_begin_status = 'in_progress' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'IN_PROGRESS',
      'error', 'Request is currently being processed'
    );
  ELSIF v_begin_status NOT IN ('ok', 'retry') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'WORKFLOW_ERROR',
      'error', 'Unexpected workflow status: ' || v_begin_status
    );
  END IF;
  
  -- ═══════════════════════════════════════════════════════════════
  -- C) SET-HB HARD BLOCK — NOW AFTER begin_workflow_request
  -- ═══════════════════════════════════════════════════════════════
  IF v_payment_type = 'payment' AND v_supplier_id IS NOT NULL THEN
    IF (v_allocations IS NULL OR jsonb_array_length(v_allocations) = 0) AND NOT v_allow_unallocated THEN
      PERFORM public.core_workflow_failed(
        v_client_request_id,
        'HARD_BLOCK',
        'Supplier payments require invoice allocations (Hard Block active since 2026-01-19)'
      );
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'HARD_BLOCK',
        'error', 'Supplier payments require invoice allocations (Hard Block active since 2026-01-19)'
      );
    END IF;
  END IF;
  
  -- ═══════════════════════════════════════════════════════════════
  -- D) GAP-02: VALIDATE ALLOCATIONS (Canonical Remaining Formula)
  -- ═══════════════════════════════════════════════════════════════
  IF v_allocations IS NOT NULL AND jsonb_array_length(v_allocations) > 0 THEN
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(v_allocations)
    LOOP
      v_alloc_invoice_id := (v_alloc->>'invoice_id')::uuid;
      v_alloc_amount := (v_alloc->>'amount')::numeric;
      
      IF v_alloc_invoice_id IS NULL OR v_alloc_amount IS NULL OR v_alloc_amount <= 0 THEN
        PERFORM public.core_workflow_failed(
          v_client_request_id,
          'VALIDATION',
          'Invalid allocation: invoice_id and positive amount required'
        );
        RETURN jsonb_build_object(
          'success', false,
          'error_code', 'VALIDATION',
          'error', 'Invalid allocation: invoice_id and positive amount required'
        );
      END IF;
      
      -- Fetch invoice for validation (with supplier_id for match check)
      SELECT 
        COALESCE(total_amount, 0),
        COALESCE(total_returned_amount, 0),
        COALESCE(paid_amount, 0),
        supplier_id
      INTO v_invoice_total_amount, v_invoice_total_returned, v_invoice_paid_amount, v_invoice_supplier_id
      FROM public.invoices
      WHERE id = v_alloc_invoice_id;
      
      IF NOT FOUND THEN
        PERFORM public.core_workflow_failed(
          v_client_request_id,
          'VALIDATION',
          'Invoice not found: ' || v_alloc_invoice_id::text
        );
        RETURN jsonb_build_object(
          'success', false,
          'error_code', 'VALIDATION',
          'error', 'Invoice not found: ' || v_alloc_invoice_id::text
        );
      END IF;
      
      -- Supplier Match validation
      IF v_payment_type = 'payment' AND v_supplier_id IS NOT NULL THEN
        IF v_invoice_supplier_id IS DISTINCT FROM v_supplier_id THEN
          PERFORM public.core_workflow_failed(
            v_client_request_id,
            'VALIDATION',
            format('Invoice supplier mismatch: invoice %s belongs to supplier %s, payment is for supplier %s',
                   v_alloc_invoice_id::text,
                   COALESCE(v_invoice_supplier_id::text, 'NULL'),
                   v_supplier_id::text)
          );
          RETURN jsonb_build_object(
            'success', false,
            'error_code', 'VALIDATION',
            'error', format('Invoice supplier mismatch: invoice %s belongs to supplier %s, payment is for supplier %s',
                           v_alloc_invoice_id::text,
                           COALESCE(v_invoice_supplier_id::text, 'NULL'),
                           v_supplier_id::text)
          );
        END IF;
      END IF;
      
      -- GAP-02: Canonical remaining formula
      v_canonical_remaining := v_invoice_total_amount 
                             - v_invoice_total_returned 
                             - v_invoice_paid_amount;
      
      -- ══════════════════════════════════════════════════════════════
      -- HOTFIX: Replace %.2f with to_char(round(x,2),'FM9999999990D00')
      -- PostgreSQL format() does NOT support C-style %.2f specifiers
      -- ══════════════════════════════════════════════════════════════
      IF v_alloc_amount > v_canonical_remaining + 0.01 THEN
        PERFORM public.core_workflow_failed(
          v_client_request_id,
          'VALIDATION',
          format('Allocation %s exceeds remaining %s for invoice %s', 
                 to_char(round(v_alloc_amount, 2), 'FM9999999990D00'),
                 to_char(round(v_canonical_remaining, 2), 'FM9999999990D00'),
                 v_alloc_invoice_id::text)
        );
        RETURN jsonb_build_object(
          'success', false,
          'error_code', 'VALIDATION',
          'error', format('Allocation %s exceeds remaining %s for invoice %s', 
                         to_char(round(v_alloc_amount, 2), 'FM9999999990D00'),
                         to_char(round(v_canonical_remaining, 2), 'FM9999999990D00'),
                         v_alloc_invoice_id::text)
        );
      END IF;
    END LOOP;
  END IF;
  
  -- ═══════════════════════════════════════════════════════════════
  -- MAIN TRANSACTION BLOCK
  -- ═══════════════════════════════════════════════════════════════
  BEGIN
    -- Generate payment number
    SELECT public.generate_next_code('PV') INTO v_payment_number;
    
    -- Create payment record
    INSERT INTO public.payments (
      payment_number,
      payment_type,
      payment_date,
      amount,
      payment_method,
      supplier_id,
      customer_id,
      invoice_id,
      branch_id,
      notes,
      status,
      currency,
      exchange_rate,
      created_by
    ) VALUES (
      v_payment_number,
      v_payment_type,
      v_payment_date,
      v_amount,
      v_payment_method,
      v_supplier_id,
      v_customer_id,
      NULL,  -- Always NULL per allocations model
      v_branch_id,
      v_notes,
      v_status,
      v_currency,
      v_exchange_rate,
      auth.uid()
    ) RETURNING id INTO v_payment_id;
    
    -- Derive journal entry lines
    v_je_lines := public.derive_payment_voucher_lines(
      v_payment_type,
      v_supplier_id,
      v_customer_id,
      v_amount,
      v_branch_id
    );
    
    -- Generate journal entry number
    SELECT public.generate_next_code('JE') INTO v_journal_number;
    
    -- Create journal entry
    INSERT INTO public.journal_entries (
      entry_number,
      entry_date,
      description,
      reference_type,
      reference_id,
      status,
      total_debit,
      total_credit,
      created_by
    ) VALUES (
      v_journal_number,
      v_entry_date,
      COALESCE(v_description, v_payment_type || ' - ' || v_payment_number),
      v_reference_type,
      v_payment_id,
      'posted',
      v_amount,
      v_amount,
      auth.uid()
    ) RETURNING id INTO v_journal_entry_id;
    
    -- Insert journal entry lines
    INSERT INTO public.journal_entry_lines (
      journal_entry_id,
      account_id,
      debit_amount,
      credit_amount,
      description
    )
    SELECT
      v_journal_entry_id,
      (line->>'account_id')::uuid,
      COALESCE((line->>'debit_amount')::numeric, 0),
      COALESCE((line->>'credit_amount')::numeric, 0),
      line->>'description'
    FROM jsonb_array_elements(v_je_lines) AS line;
    
    -- Link payment to journal entry
    UPDATE public.payments
    SET journal_entry_id = v_journal_entry_id
    WHERE id = v_payment_id;
    
    -- ═══════════════════════════════════════════════════════════════
    -- E) ALLOCATIONS INSERT + UPDATE (with FOR UPDATE locking)
    -- ═══════════════════════════════════════════════════════════════
    IF v_allocations IS NOT NULL AND jsonb_array_length(v_allocations) > 0 THEN
      FOR v_alloc IN SELECT * FROM jsonb_array_elements(v_allocations)
      LOOP
        v_alloc_invoice_id := (v_alloc->>'invoice_id')::uuid;
        v_alloc_amount := (v_alloc->>'amount')::numeric;
        
        -- Insert allocation with correct column name "amount"
        INSERT INTO public.supplier_payment_allocations (
          payment_id,
          invoice_id,
          amount,
          created_at
        ) VALUES (
          v_payment_id,
          v_alloc_invoice_id,
          v_alloc_amount,
          now()
        );
        
        -- FOR UPDATE: Lock invoice row for atomic update
        SELECT 
          COALESCE(total_amount, 0),
          COALESCE(total_returned_amount, 0),
          COALESCE(paid_amount, 0),
          supplier_id
        INTO v_invoice_total_amount, v_invoice_total_returned, v_invoice_paid_amount, v_invoice_supplier_id
        FROM public.invoices
        WHERE id = v_alloc_invoice_id
        FOR UPDATE;
        
        -- Re-validate supplier match (defense in depth)
        IF v_payment_type = 'payment' AND v_supplier_id IS NOT NULL THEN
          IF v_invoice_supplier_id IS DISTINCT FROM v_supplier_id THEN
            RAISE EXCEPTION 'Invoice supplier mismatch detected during update: invoice % belongs to supplier %, payment is for supplier %',
                            v_alloc_invoice_id, COALESCE(v_invoice_supplier_id::text, 'NULL'), v_supplier_id;
          END IF;
        END IF;
        
        -- GAP-02: Compute new values using canonical formula
        v_new_paid := v_invoice_paid_amount + v_alloc_amount;
        v_new_remaining := v_invoice_total_amount 
                         - v_invoice_total_returned 
                         - v_new_paid;
        
        -- ══════════════════════════════════════════════════════════════
        -- HOTFIX: Replace %.2f in RAISE EXCEPTION with to_char()
        -- ══════════════════════════════════════════════════════════════
        IF v_new_remaining < -0.01 THEN
          RAISE EXCEPTION 'Payment would result in negative remaining (%) for invoice %', 
                          to_char(round(v_new_remaining, 2), 'FM9999999990D00'),
                          v_alloc_invoice_id::text;
        END IF;
        
        -- Determine new status
        IF v_new_remaining <= 0.01 THEN
          v_new_status := 'paid';
        ELSE
          v_new_status := 'partial';
        END IF;
        
        -- Update invoice
        UPDATE public.invoices
        SET 
          paid_amount = v_new_paid,
          remaining_amount = v_new_remaining,
          status = v_new_status,
          updated_at = now()
        WHERE id = v_alloc_invoice_id;
        
        -- touchedInvoices: Array append via jsonb_build_array
        v_touched_invoices := v_touched_invoices || jsonb_build_array(
          jsonb_build_object(
            'invoiceId', v_alloc_invoice_id,
            'allocatedAmount', v_alloc_amount,
            'newPaid', v_new_paid,
            'newRemaining', v_new_remaining,
            'newStatus', v_new_status
          )
        );
      END LOOP;
    END IF;
    
    -- Build success result
    v_result := jsonb_build_object(
      'success', true,
      'paymentId', v_payment_id,
      'paymentNumber', v_payment_number,
      'journalEntryId', v_journal_entry_id,
      'journalNumber', v_journal_number,
      'touchedInvoices', v_touched_invoices,
      'meta', jsonb_build_object(
        'workflowType', 'payment_voucher_atomic',
        'clientRequestId', v_client_request_id,
        'payloadHash', v_payload_hash
      )
    );
    
    -- core_workflow_success with 3 args (uuid, uuid, jsonb)
    PERFORM public.core_workflow_success(v_client_request_id, v_payment_id, v_result);
    
    RETURN v_result;
    
  EXCEPTION WHEN OTHERS THEN
    -- Log failure to workflow ledger
    PERFORM public.core_workflow_failed(
      v_client_request_id,
      'EXCEPTION',
      SQLERRM
    );
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'EXCEPTION',
      'error', SQLERRM
    );
  END;
END;
$function$;

-- ══════════════════════════════════════════════════════════════════════════════════
-- PART B: Add FORBIDDEN_FORMAT_PERCENT_DOT rule to governance_static_gate_check
-- ══════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.governance_static_gate_check()
RETURNS TABLE(function_name text, function_signature text, violation_type text, gate_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_func_def text;
  v_func_name text;
  v_func_sig text;
  v_clean_def text;
  rec record;
BEGIN
  -- Target functions that handle accounting
  FOR rec IN 
    SELECT 
      p.proname::text AS fname,
      p.oid::regprocedure::text AS fsig,
      pg_get_functiondef(p.oid) AS fdef
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'complete_purchase_invoice_atomic',
        'complete_pos_credit_note_atomic',
        'complete_pos_sales_return_atomic',
        'complete_sales_return_atomic',
        'complete_erp_credit_note_atomic',
        'create_customer_receipt_atomic',
        'complete_purchase_return_unique_items_atomic',
        'complete_sales_invoice_atomic',
        'complete_purchase_return_general_items_atomic',
        'payment_voucher_atomic',
        'payment_voucher_update_atomic',
        'payment_voucher_void_atomic'
      )
  LOOP
    v_func_name := rec.fname;
    v_func_sig := rec.fsig;
    v_func_def := rec.fdef;
    
    -- Strip single-line comments (-- ...)
    v_clean_def := regexp_replace(v_func_def, '--[^\n]*', '', 'g');
    -- Strip multi-line comments (/* ... */)
    v_clean_def := regexp_replace(v_clean_def, '/\*.*?\*/', '', 'gs');
    
    -- ══════════════════════════════════════════════════════════════
    -- RULE 6: FORBIDDEN_FORMAT_PERCENT_DOT
    -- Detect format() or RAISE EXCEPTION using %.X (C-style specifiers)
    -- PostgreSQL format() only supports %s, %I, %L, %%, not %.2f etc.
    -- ══════════════════════════════════════════════════════════════
    IF v_clean_def ~* 'format\s*\([^)]*%\.' 
       OR v_clean_def ~* 'RAISE\s+EXCEPTION\s+''[^'']*%\.' THEN
      function_name := v_func_name;
      function_signature := v_func_sig;
      violation_type := 'FORBIDDEN_FORMAT_PERCENT_DOT';
      gate_status := 'FAIL';
      RETURN NEXT;
      CONTINUE;
    END IF;
    
    -- RULE 1: If function INSERTs into journal_entries, 
    --         it MUST use generate_journal_entry_number()
    IF v_clean_def ILIKE '%INSERT INTO journal_entries%' 
       OR v_clean_def ILIKE '%INSERT INTO public.journal_entries%' THEN
      
      -- Check if it uses the approved generator
      IF v_clean_def NOT ILIKE '%generate_journal_entry_number()%' THEN
        function_name := v_func_name;
        function_signature := v_func_sig;
        violation_type := 'MISSING_GENERATOR';
        gate_status := 'FAIL';
        RETURN NEXT;
        CONTINUE;
      END IF;
    END IF;
    
    -- RULE 2: Detect inline JE number literals in executable code
    --         Pattern: 'JE-' || ... (string concatenation)
    IF v_clean_def ~ '''JE-''\s*\|\|' THEN
      function_name := v_func_name;
      function_signature := v_func_sig;
      violation_type := 'INLINE_JE_LITERAL';
      gate_status := 'FAIL';
      RETURN NEXT;
      CONTINUE;
    END IF;
    
    -- RULE 3: Detect direct nextval for JE sequences
    --         Pattern: nextval('journal_entry... or nextval('je_...
    IF v_clean_def ~* 'nextval\s*\(\s*''(journal_entry|je_)' THEN
      function_name := v_func_name;
      function_signature := v_func_sig;
      violation_type := 'DIRECT_NEXTVAL_JE';
      gate_status := 'FAIL';
      RETURN NEXT;
      CONTINUE;
    END IF;
    
    -- RULE 4: Detect usage of non-existent column 'total_price'
    --         Should use: cost (jewelry_items), subtotal/total_amount (invoice_lines)
    IF v_clean_def ~* '\.total_price\b' 
       OR v_clean_def ~* '\btotal_price\s*,' 
       OR v_clean_def ~* ',\s*total_price\s*\)' THEN
      function_name := v_func_name;
      function_signature := v_func_sig;
      violation_type := 'FORBIDDEN_COLUMN_TOTAL_PRICE';
      gate_status := 'FAIL';
      RETURN NEXT;
      CONTINUE;
    END IF;
    
    -- RULE 5: Detect usage of non-existent column 'gold_weight'
    --         Should use: g_weight (jewelry_items)
    IF v_clean_def ~* '\.gold_weight\b' 
       OR v_clean_def ~* '\bgold_weight\s*,' 
       OR v_clean_def ~* ',\s*gold_weight\s*\)' THEN
      function_name := v_func_name;
      function_signature := v_func_sig;
      violation_type := 'FORBIDDEN_COLUMN_GOLD_WEIGHT';
      gate_status := 'FAIL';
      RETURN NEXT;
      CONTINUE;
    END IF;
    
  END LOOP;
  
  RETURN;
END;
$function$;

-- ══════════════════════════════════════════════════════════════════════════════════
-- VERIFICATION: Gate check should return 0 rows after this migration
-- ══════════════════════════════════════════════════════════════════════════════════
-- Run after migration: SELECT * FROM governance_static_gate_check();