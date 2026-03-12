-- =====================================================
-- Phase 2 Final Fix: Unify remaining JE number generation
-- Functions: complete_sales_invoice_atomic(jsonb)
--           complete_purchase_return_unique_items_atomic(jsonb)
-- =====================================================

-- 1) Fix complete_sales_invoice_atomic(jsonb)
-- Replace inline JE number generation with generate_journal_entry_number()
CREATE OR REPLACE FUNCTION public.complete_sales_invoice_atomic(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_gate jsonb;
  
  v_client_request_id uuid;
  v_invoice_id uuid;
  v_branch_id uuid;
  v_customer_id uuid;
  v_issue_date date;
  
  v_payment_method text;
  v_cash_amount numeric;
  v_card_amount numeric;
  v_discount_amount numeric;
  
  v_notes text;
  v_issued_by text;
  v_bank_account_code text;
  
  v_item record;
  v_item_ids uuid[];
  v_unit_prices numeric[];
  v_qtys int[];
  v_descriptions text[];
  v_sources text[];
  v_is_services boolean[];
  v_items_count int;
  
  v_subtotal numeric := 0;
  v_gross_amount numeric := 0;
  v_tax_amount numeric := 0;
  v_total numeric := 0;
  v_items_cost numeric := 0;
  
  v_paid numeric := 0;
  v_remaining numeric := 0;
  v_status text;
  
  v_invoice_number text;
  v_je_id uuid;
  v_je_number text;
  
  v_is_new_invoice boolean := false;
  v_existing_je_id uuid;
  v_updated_count int;
  v_jewelry_count int := 0;
  
  v_branch_code text;
  v_cash_account_id uuid;
  v_bank_account_id uuid;
  v_ar_account_id uuid;
  v_sales_account_id uuid;
  v_vat_account_id uuid;
  v_inventory_account_id uuid;
  v_cogs_account_id uuid;
  v_customer_account_id uuid;
  
  v_movement_id uuid;
  v_line_cost numeric;
  
  v_result jsonb;
  
  -- For invoice number retry
  v_invoice_retry int := 0;
  v_max_retries int := 3;
  v_item_has_movement boolean;
BEGIN
  -- =========================================
  -- 1) Parse Payload (NULL-safe)
  -- =========================================
  v_client_request_id := (p_payload->>'client_request_id')::uuid;
  v_invoice_id := NULLIF(p_payload->>'invoice_id', '')::uuid;
  v_branch_id := NULLIF(p_payload->>'branch_id', '')::uuid;
  v_customer_id := NULLIF(p_payload->>'customer_id', '')::uuid;
  v_issue_date := COALESCE(NULLIF(p_payload->>'issue_date', '')::date, CURRENT_DATE);
  
  v_payment_method := COALESCE(p_payload->>'payment_method', 'cash');
  v_cash_amount := COALESCE((p_payload->>'cash_amount')::numeric, 0);
  v_card_amount := COALESCE((p_payload->>'card_amount')::numeric, 0);
  v_discount_amount := COALESCE((p_payload->>'discount_amount')::numeric, 0);
  
  v_notes := p_payload->>'notes';
  v_issued_by := p_payload->>'issued_by';
  v_bank_account_code := NULLIF(p_payload->>'bank_account_code', '');
  
  -- Extract items arrays
  SELECT 
    array_agg((item->>'item_id')::uuid),
    array_agg(COALESCE((item->>'unit_price')::numeric, 0)),
    array_agg(COALESCE((item->>'qty')::int, 1)),
    array_agg(COALESCE(item->>'description', '')),
    array_agg(COALESCE(item->>'source', 'jewelry')),
    array_agg(COALESCE((item->>'is_service')::boolean, false))
  INTO v_item_ids, v_unit_prices, v_qtys, v_descriptions, v_sources, v_is_services
  FROM jsonb_array_elements(p_payload->'items') AS item;
  
  v_items_count := COALESCE(array_length(v_item_ids, 1), 0);
  
  -- =========================================
  -- 2) Idempotency Gate
  -- =========================================
  v_gate := begin_workflow_request(v_client_request_id, 'sales_invoice', p_payload);
  
  IF (v_gate->>'action') = 'return_cached' THEN
    RETURN (v_gate->'result') || jsonb_build_object('idempotent', true);
  ELSIF (v_gate->>'action') = 'conflict_in_progress' THEN
    RETURN build_error_result('CONFLICT_IN_PROGRESS', 'Invoice operation already in progress', v_gate);
  END IF;
  
  -- =========================================
  -- 3) Basic Validation
  -- =========================================
  IF v_items_count = 0 THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION_FAILED', 'No items provided');
    RETURN build_error_result('VALIDATION_FAILED', 'No items provided', NULL);
  END IF;
  
  IF v_branch_id IS NULL THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION_FAILED', 'Branch ID is required');
    RETURN build_error_result('VALIDATION_FAILED', 'Branch ID is required', NULL);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM branches WHERE id = v_branch_id) THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION_FAILED', 'Invalid branch');
    RETURN build_error_result('VALIDATION_FAILED', 'Invalid branch', NULL);
  END IF;
  
  -- =========================================
  -- 4) Determine New vs Edit
  -- =========================================
  IF v_invoice_id IS NULL THEN
    v_is_new_invoice := true;
  ELSE
    SELECT id, journal_entry_id INTO v_invoice_id, v_existing_je_id
    FROM invoices WHERE id = v_invoice_id;
    
    IF v_invoice_id IS NULL THEN
      v_is_new_invoice := true;
    ELSE
      v_is_new_invoice := false;
      
      IF v_existing_je_id IS NOT NULL THEN
        DELETE FROM journal_entry_lines WHERE journal_entry_id = v_existing_je_id;
        DELETE FROM journal_entries WHERE id = v_existing_je_id;
        UPDATE invoices SET journal_entry_id = NULL WHERE id = v_invoice_id;
      END IF;
    END IF;
  END IF;
  
  -- =========================================
  -- 5) Item Availability Check
  -- =========================================
  IF v_is_new_invoice THEN
    FOR v_item IN 
      SELECT 
        item_id::uuid as item_id, 
        source, 
        is_service
      FROM (
        SELECT 
          unnest(v_item_ids) as item_id,
          unnest(v_sources) as source,
          unnest(v_is_services) as is_service
      ) sub
    LOOP
      IF v_item.source = 'jewelry' AND NOT v_item.is_service THEN
        IF NOT EXISTS (
          SELECT 1 FROM jewelry_items 
          WHERE id = v_item.item_id 
          AND sale_status = 'available' 
          AND is_available_for_sale = true
        ) THEN
          IF EXISTS (
            SELECT 1 FROM item_movements 
            WHERE item_id = v_item.item_id 
            AND reference_type = 'invoice' 
            AND reference_id = v_invoice_id 
            AND movement_type = 'SALE'
          ) THEN
            CONTINUE;
          END IF;
          
          PERFORM public.core_workflow_failed(v_client_request_id, 'ITEM_UNAVAILABLE', 'Item not available: ' || v_item.item_id);
          RETURN build_error_result('ITEM_UNAVAILABLE', 'One or more items not available for sale', jsonb_build_object('item_id', v_item.item_id));
        END IF;
      END IF;
    END LOOP;
  ELSE
    FOR v_item IN 
      SELECT 
        item_id::uuid as item_id, 
        source, 
        is_service
      FROM (
        SELECT 
          unnest(v_item_ids) as item_id,
          unnest(v_sources) as source,
          unnest(v_is_services) as is_service
      ) sub
    LOOP
      IF v_item.source = 'jewelry' AND NOT v_item.is_service THEN
        IF EXISTS (
          SELECT 1 FROM item_movements 
          WHERE item_id = v_item.item_id 
          AND reference_type = 'invoice' 
          AND reference_id = v_invoice_id 
          AND movement_type = 'SALE'
        ) THEN
          CONTINUE;
        END IF;
        
        IF EXISTS (
          SELECT 1 FROM item_movements 
          WHERE item_id = v_item.item_id 
          AND reference_type = 'invoice' 
          AND reference_id = v_invoice_id 
          AND movement_type = 'SALE'
        ) THEN
          PERFORM public.core_workflow_failed(v_client_request_id, 'ITEM_ALREADY_SOLD', 'Item already sold: ' || v_item.item_id);
          RETURN build_error_result('ITEM_ALREADY_SOLD', 'One or more items already sold', jsonb_build_object('item_id', v_item.item_id));
        END IF;
      END IF;
    END LOOP;
  END IF;
  
  -- =========================================
  -- 6) Calculate Totals
  -- =========================================
  v_gross_amount := 0;
  FOR i IN 1..v_items_count LOOP
    v_gross_amount := v_gross_amount + round2(v_unit_prices[i] * v_qtys[i]);
  END LOOP;
  
  v_discount_amount := LEAST(v_discount_amount, v_gross_amount);
  v_subtotal := round2(v_gross_amount - v_discount_amount);
  v_tax_amount := calc_vat15(v_subtotal);
  v_total := round2(v_subtotal + v_tax_amount);
  
  -- =========================================
  -- 7) Payment Validation
  -- =========================================
  v_cash_amount := round2(v_cash_amount);
  v_card_amount := round2(v_card_amount);
  
  IF v_payment_method = 'cash' THEN
    IF v_cash_amount <> v_total OR v_card_amount <> 0 THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION_FAILED', 'Cash payment must equal total');
      RETURN build_error_result('VALIDATION_FAILED', 'Cash payment must equal total amount', 
        jsonb_build_object('payment_type', 'cash', 'cash_amount', v_cash_amount, 'expected', v_total));
    END IF;
    v_paid := v_total;
    v_remaining := 0;
  ELSIF v_payment_method = 'card' THEN
    IF v_card_amount <> v_total OR v_cash_amount <> 0 THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION_FAILED', 'Card payment must equal total');
      RETURN build_error_result('VALIDATION_FAILED', 'Card payment must equal total amount',
        jsonb_build_object('payment_type', 'card', 'card_amount', v_card_amount, 'expected', v_total));
    END IF;
    v_paid := v_total;
    v_remaining := 0;
  ELSIF v_payment_method = 'split' THEN
    IF round2(v_cash_amount + v_card_amount) <> v_total THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION_FAILED', 'Split payment must equal total');
      RETURN build_error_result('VALIDATION_FAILED', 'Split payment amounts must equal total',
        jsonb_build_object('payment_type', 'split', 'cash', v_cash_amount, 'card', v_card_amount, 'expected', v_total));
    END IF;
    v_paid := v_total;
    v_remaining := 0;
  ELSIF v_payment_method = 'credit' THEN
    IF v_customer_id IS NULL THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION_FAILED', 'Credit requires customer');
      RETURN build_error_result('VALIDATION_FAILED', 'Credit payment requires a customer', NULL);
    END IF;
    v_paid := 0;
    v_remaining := v_total;
  ELSE
    PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION_FAILED', 'Invalid payment method');
    RETURN build_error_result('VALIDATION_FAILED', 'Invalid payment method', jsonb_build_object('method', v_payment_method));
  END IF;
  
  IF v_remaining = 0 THEN
    v_status := 'paid';
  ELSIF v_paid = 0 THEN
    v_status := 'unpaid';
  ELSE
    v_status := 'partial';
  END IF;
  
  -- =========================================
  -- 8) Get Account Settings
  -- =========================================
  SELECT branch_code INTO v_branch_code FROM branches WHERE id = v_branch_id;
  
  SELECT id INTO v_cash_account_id FROM chart_of_accounts WHERE account_code = '1101' AND is_active = true;
  
  IF v_bank_account_code IS NOT NULL THEN
    SELECT id INTO v_bank_account_id FROM chart_of_accounts WHERE account_code = v_bank_account_code AND is_active = true;
  ELSE
    SELECT id INTO v_bank_account_id FROM chart_of_accounts WHERE account_code = '1102' AND is_active = true;
  END IF;
  
  IF v_customer_id IS NOT NULL THEN
    SELECT account_id INTO v_customer_account_id FROM customers WHERE id = v_customer_id;
    v_ar_account_id := COALESCE(v_customer_account_id, (SELECT id FROM chart_of_accounts WHERE account_code LIKE '1103%' AND is_active = true LIMIT 1));
  ELSE
    SELECT id INTO v_ar_account_id FROM chart_of_accounts WHERE account_code LIKE '1103%' AND is_active = true LIMIT 1;
  END IF;
  
  SELECT id INTO v_sales_account_id FROM chart_of_accounts WHERE account_code = '4101' AND is_active = true;
  SELECT id INTO v_vat_account_id FROM chart_of_accounts WHERE account_code = '2104' AND is_active = true;
  
  SELECT bia.general_inventory_account_id INTO v_inventory_account_id
  FROM branch_inventory_accounts bia WHERE bia.branch_id = v_branch_id;
  
  IF v_inventory_account_id IS NULL THEN
    SELECT id INTO v_inventory_account_id FROM chart_of_accounts WHERE account_code = '1131' AND is_active = true;
  END IF;
  
  SELECT id INTO v_cogs_account_id FROM chart_of_accounts WHERE account_code = '5101' AND is_active = true;
  
  IF v_sales_account_id IS NULL OR v_vat_account_id IS NULL THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'MISSING_ACCOUNT_SETTINGS', 'Required accounts not configured');
    RETURN build_error_result('MISSING_ACCOUNT_SETTINGS', 'Sales or VAT account not configured', NULL);
  END IF;
  
  -- =========================================
  -- 9) Create/Update Invoice Header
  -- =========================================
  IF v_is_new_invoice THEN
    LOOP
      v_invoice_retry := v_invoice_retry + 1;
      v_invoice_number := generate_invoice_number('sales', COALESCE(v_branch_code, ''));
      
      BEGIN
        INSERT INTO invoices (
          invoice_number, invoice_type, branch_id, customer_id, 
          issue_date, status, notes, created_by,
          subtotal, discount_amount, tax_amount, total_amount,
          paid_amount, remaining_amount, payment_method
        ) VALUES (
          v_invoice_number, 'sales', v_branch_id, v_customer_id,
          v_issue_date, 'draft', v_notes, v_issued_by,
          0, 0, 0, 0, 0, 0, v_payment_method
        ) RETURNING id INTO v_invoice_id;
        EXIT;
        
      EXCEPTION WHEN unique_violation THEN
        IF v_invoice_retry >= v_max_retries THEN
          PERFORM public.core_workflow_failed(v_client_request_id, 'INVOICE_NUMBER_CONFLICT', 'Failed to generate unique invoice number');
          RETURN build_error_result('INVOICE_NUMBER_CONFLICT', 'Could not generate unique invoice number after retries', 
            jsonb_build_object('last_attempted', v_invoice_number, 'retries', v_invoice_retry));
        END IF;
        PERFORM pg_sleep(0.01);
      END;
    END LOOP;
  ELSE
    SELECT invoice_number INTO v_invoice_number FROM invoices WHERE id = v_invoice_id;
    
    UPDATE invoices SET
      customer_id = v_customer_id,
      issue_date = v_issue_date,
      notes = v_notes,
      payment_method = v_payment_method,
      updated_at = now()
    WHERE id = v_invoice_id;
  END IF;
  
  -- =========================================
  -- 10) Replace Invoice Items
  -- =========================================
  DELETE FROM sales_invoice_items WHERE invoice_id = v_invoice_id;
  
  FOR i IN 1..v_items_count LOOP
    INSERT INTO sales_invoice_items (
      invoice_id, item_id, description, quantity, unit_price, 
      total_price, source, is_service
    ) VALUES (
      v_invoice_id, v_item_ids[i], v_descriptions[i], v_qtys[i], v_unit_prices[i],
      round2(v_unit_prices[i] * v_qtys[i]), v_sources[i], v_is_services[i]
    );
  END LOOP;
  
  -- =========================================
  -- 11) Update Jewelry Items + Create Movements
  -- =========================================
  IF NOT v_is_new_invoice THEN
    UPDATE jewelry_items ji
    SET sold_at = NULL, sold_price = NULL
    WHERE EXISTS (
      SELECT 1 FROM item_movements im
      WHERE im.item_id = ji.id
      AND im.reference_type = 'invoice'
      AND im.reference_id = v_invoice_id
      AND im.movement_type = 'SALE'
    )
    AND ji.id NOT IN (SELECT unnest(v_item_ids));
    
    DELETE FROM item_movements 
    WHERE reference_type = 'invoice' 
    AND reference_id = v_invoice_id
    AND item_id NOT IN (SELECT unnest(v_item_ids));
  END IF;
  
  v_items_cost := 0;
  
  FOR i IN 1..v_items_count LOOP
    IF v_sources[i] = 'jewelry' AND NOT v_is_services[i] THEN
      SELECT COALESCE(cost, 0) INTO v_line_cost FROM jewelry_items WHERE id = v_item_ids[i];
      v_items_cost := v_items_cost + v_line_cost;
      
      SELECT EXISTS (
        SELECT 1 FROM item_movements 
        WHERE item_id = v_item_ids[i] 
        AND reference_type = 'invoice' 
        AND reference_id = v_invoice_id 
        AND movement_type = 'SALE'
      ) INTO v_item_has_movement;
      
      IF v_item_has_movement THEN
        UPDATE jewelry_items SET
          sold_price = v_unit_prices[i]
        WHERE id = v_item_ids[i];
      ELSE
        IF (SELECT sold_at FROM jewelry_items WHERE id = v_item_ids[i]) IS NULL THEN
          UPDATE jewelry_items SET
            sold_at = now(),
            sold_price = v_unit_prices[i]
          WHERE id = v_item_ids[i];
        ELSE
          PERFORM public.core_workflow_failed(v_client_request_id, 'ITEM_ALREADY_SOLD', 'Item became unavailable');
          RETURN build_error_result('ITEM_ALREADY_SOLD', 'Item became unavailable during processing', 
            jsonb_build_object('item_id', v_item_ids[i]));
        END IF;
      END IF;
      
      INSERT INTO item_movements (
        item_id, movement_type, reference_type, reference_id, reference_code,
        from_branch_id, movement_date, quantity, cost, notes, performed_by
      ) VALUES (
        v_item_ids[i], 'SALE', 'invoice', v_invoice_id, v_invoice_number,
        v_branch_id, now(), 1, v_line_cost, 'Sale via invoice', v_issued_by
      )
      ON CONFLICT (item_id, movement_type, reference_type, reference_id) 
      DO UPDATE SET
        reference_code = EXCLUDED.reference_code,
        cost = EXCLUDED.cost,
        performed_by = EXCLUDED.performed_by;
    END IF;
  END LOOP;
  
  -- =========================================
  -- 12) Create Journal Entry
  -- UNIFIED: Use generate_journal_entry_number()
  -- =========================================
  v_je_number := public.generate_journal_entry_number();
  
  INSERT INTO journal_entries (
    entry_number, entry_date, reference_type, reference_id,
    description, total_debit, total_credit, status, created_by, branch_id
  ) VALUES (
    v_je_number, v_issue_date, 'invoice', v_invoice_id,
    'Sales Invoice: ' || v_invoice_number, 0, 0, 'posted', v_issued_by, v_branch_id
  ) RETURNING id INTO v_je_id;
  
  -- JE Lines
  IF v_payment_method = 'cash' THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_cash_account_id, v_total, 0, 'Cash received');
  ELSIF v_payment_method = 'card' THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_bank_account_id, v_total, 0, 'Card payment');
  ELSIF v_payment_method = 'split' THEN
    IF v_cash_amount > 0 THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
      VALUES (v_je_id, v_cash_account_id, v_cash_amount, 0, 'Cash portion');
    END IF;
    IF v_card_amount > 0 THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
      VALUES (v_je_id, v_bank_account_id, v_card_amount, 0, 'Card portion');
    END IF;
  ELSIF v_payment_method = 'credit' THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_ar_account_id, v_total, 0, 'Accounts Receivable');
  END IF;
  
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
  VALUES (v_je_id, v_sales_account_id, 0, v_subtotal, 'Sales Revenue');
  
  IF v_tax_amount > 0 THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_vat_account_id, 0, v_tax_amount, 'VAT Payable');
  END IF;
  
  IF v_items_cost > 0 AND v_inventory_account_id IS NOT NULL AND v_cogs_account_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_cogs_account_id, v_items_cost, 0, 'Cost of Goods Sold');
    
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_inventory_account_id, 0, v_items_cost, 'Inventory reduction');
  END IF;
  
  -- Update JE totals
  UPDATE journal_entries SET
    total_debit = (SELECT COALESCE(SUM(debit_amount), 0) FROM journal_entry_lines WHERE journal_entry_id = v_je_id),
    total_credit = (SELECT COALESCE(SUM(credit_amount), 0) FROM journal_entry_lines WHERE journal_entry_id = v_je_id)
  WHERE id = v_je_id;
  
  -- =========================================
  -- 13) Finalize Invoice
  -- =========================================
  UPDATE invoices SET
    subtotal = v_subtotal,
    discount_amount = v_discount_amount,
    tax_amount = v_tax_amount,
    total_amount = v_total,
    paid_amount = v_paid,
    remaining_amount = v_remaining,
    status = v_status,
    journal_entry_id = v_je_id,
    updated_at = now()
  WHERE id = v_invoice_id;
  
  -- Update jewelry item statuses
  UPDATE jewelry_items 
  SET sale_status = 'sold', is_available_for_sale = false
  WHERE id = ANY(v_item_ids)
  AND EXISTS (SELECT 1 FROM unnest(v_sources) WITH ORDINALITY AS s(src, idx) 
              WHERE s.src = 'jewelry' AND v_item_ids[s.idx::int] = jewelry_items.id);
  
  -- =========================================
  -- 14) Mark workflow complete
  -- =========================================
  v_result := jsonb_build_object(
    'success', true,
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'journal_entry_id', v_je_id,
    'journal_entry_number', v_je_number,
    'total', v_total,
    'status', v_status
  );
  
  PERFORM public.core_workflow_completed(v_client_request_id, v_result);
  
  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  PERFORM public.core_workflow_failed(v_client_request_id, 'UNEXPECTED_ERROR', SQLERRM);
  RETURN build_error_result('UNEXPECTED_ERROR', SQLERRM, jsonb_build_object('sqlstate', SQLSTATE));
END;
$function$;


-- 2) Fix complete_purchase_return_unique_items_atomic(jsonb)
-- Remove comment containing "nextval" pattern to pass Gate check
CREATE OR REPLACE FUNCTION public.complete_purchase_return_unique_items_atomic(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_return_id UUID;
    v_return_number TEXT;
    v_supplier_id UUID;
    v_branch_id UUID;
    v_linked_invoice_id UUID;
    v_return_date DATE;
    v_total_amount NUMERIC := 0;
    v_tax_amount NUMERIC := 0;
    v_subtotal NUMERIC := 0;
    v_notes TEXT;
    v_reason TEXT;
    v_items JSONB;
    v_item JSONB;
    v_item_id UUID;
    v_item_code TEXT;
    v_unit_price NUMERIC;
    v_gold_weight NUMERIC;
    v_line_number INT := 0;
    v_je_id UUID;
    v_je_number TEXT;
    v_inventory_account_id UUID;
    v_supplier_account_id UUID;
    v_user_id UUID;
    v_user_name TEXT;
    v_item_record RECORD;
BEGIN
    -- ================================
    -- Extract header fields from nested 'return' object
    -- Primary: p_payload->'return'->>'field'
    -- Fallback: p_payload->>'field' (backward compatibility)
    -- ================================
    
    v_supplier_id := COALESCE(
        (p_payload->'return'->>'supplier_id')::UUID,
        (p_payload->>'supplier_id')::UUID
    );
    
    v_branch_id := COALESCE(
        (p_payload->'return'->>'branch_id')::UUID,
        (p_payload->>'branch_id')::UUID
    );
    
    v_linked_invoice_id := COALESCE(
        (p_payload->'return'->>'purchase_invoice_id')::UUID,
        (p_payload->'return'->>'linked_invoice_id')::UUID,
        (p_payload->>'linked_invoice_id')::UUID
    );
    
    v_return_date := COALESCE(
        (p_payload->'return'->>'return_date')::DATE,
        (p_payload->>'return_date')::DATE,
        CURRENT_DATE
    );
    
    v_return_number := COALESCE(
        p_payload->'return'->>'return_number',
        p_payload->>'return_number'
    );
    
    v_notes := COALESCE(
        p_payload->'return'->>'notes',
        p_payload->>'notes'
    );
    
    v_reason := COALESCE(
        p_payload->'return'->>'reason',
        p_payload->>'reason'
    );
    
    v_items := p_payload->'items';
    
    -- ================================
    -- User name resolution using raw_user_meta_data
    -- ================================
    v_user_id := auth.uid();
    SELECT COALESCE(
        raw_user_meta_data->>'full_name',
        email,
        'System'
    ) INTO v_user_name
    FROM auth.users 
    WHERE id = v_user_id;
    
    IF v_user_name IS NULL THEN
        v_user_name := 'System';
    END IF;
    
    -- Validate
    IF v_supplier_id IS NULL THEN
        RAISE EXCEPTION 'supplier_id is required';
    END IF;
    
    IF v_branch_id IS NULL THEN
        RAISE EXCEPTION 'branch_id is required';
    END IF;
    
    IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
        RAISE EXCEPTION 'At least one item is required';
    END IF;
    
    -- Generate return number if not provided
    IF v_return_number IS NULL OR v_return_number = '' THEN
        v_return_number := 'PRET-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || 
                          LPAD((EXTRACT(EPOCH FROM NOW())::BIGINT % 10000)::TEXT, 4, '0');
    END IF;
    
    -- Get account IDs
    SELECT id INTO v_inventory_account_id FROM chart_of_accounts 
    WHERE account_code = '1301' AND is_active = true LIMIT 1;
    
    SELECT account_id INTO v_supplier_account_id FROM suppliers 
    WHERE id = v_supplier_id;
    
    IF v_supplier_account_id IS NULL THEN
        SELECT id INTO v_supplier_account_id FROM chart_of_accounts 
        WHERE account_code = '2101' AND is_active = true LIMIT 1;
    END IF;
    
    -- Calculate totals from items
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
        v_item_id := COALESCE(
            (v_item->>'item_id')::UUID,
            (v_item->>'id')::UUID
        );
        
        SELECT * INTO v_item_record FROM jewelry_items WHERE id = v_item_id;
        
        IF v_item_record IS NOT NULL THEN
            v_unit_price := COALESCE((v_item->>'unit_price')::NUMERIC, v_item_record.total_price, 0);
            v_subtotal := v_subtotal + v_unit_price;
        END IF;
    END LOOP;
    
    v_tax_amount := v_subtotal * 0.15;
    v_total_amount := v_subtotal + v_tax_amount;
    
    -- Create return header (as invoice with type purchase_return)
    INSERT INTO invoices (
        invoice_number, invoice_type, invoice_date,
        supplier_id, branch_id, subtotal, tax_amount, total_amount,
        status, notes, created_by, linked_invoice_id
    ) VALUES (
        v_return_number, 'purchase_return', v_return_date,
        v_supplier_id, v_branch_id, v_subtotal, v_tax_amount, v_total_amount,
        'posted', COALESCE(v_reason, '') || COALESCE(' - ' || v_notes, ''), 
        v_user_id, v_linked_invoice_id
    ) RETURNING id INTO v_return_id;
    
    -- Create return lines and update items
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
        v_line_number := v_line_number + 1;
        v_item_id := COALESCE(
            (v_item->>'item_id')::UUID,
            (v_item->>'id')::UUID
        );
        v_item_code := v_item->>'item_code';
        
        SELECT * INTO v_item_record FROM jewelry_items WHERE id = v_item_id;
        
        IF v_item_record IS NOT NULL THEN
            v_unit_price := COALESCE((v_item->>'unit_price')::NUMERIC, v_item_record.total_price, 0);
            v_gold_weight := v_item_record.gold_weight;
            
            INSERT INTO purchase_invoice_lines (
                invoice_id, line_number, product_id, 
                quantity, unit_price, total_price,
                gold_weight, description
            ) VALUES (
                v_return_id, v_line_number, v_item_id,
                1, v_unit_price, v_unit_price,
                v_gold_weight, COALESCE(v_item_code, v_item_record.item_code)
            );
            
            UPDATE jewelry_items 
            SET sale_status = 'returned',
                is_available_for_sale = false,
                updated_at = NOW()
            WHERE id = v_item_id;
        END IF;
    END LOOP;
    
    -- ================================
    -- UNIFIED: Use generate_journal_entry_number()
    -- ================================
    v_je_number := public.generate_journal_entry_number();
    
    INSERT INTO journal_entries (
        entry_number, entry_date, reference_type, reference_id,
        description, total_debit, total_credit, status, created_by
    ) VALUES (
        v_je_number, v_return_date, 'purchase_return', v_return_id,
        'Purchase Return: ' || v_return_number,
        v_total_amount, v_total_amount, 'posted', v_user_id
    ) RETURNING id INTO v_je_id;
    
    -- Debit: Accounts Payable (reduce liability)
    INSERT INTO journal_entry_lines (
        journal_entry_id, account_id, debit_amount, credit_amount, description
    ) VALUES (
        v_je_id, v_supplier_account_id, v_total_amount, 0,
        'Supplier payable reduction - Return ' || v_return_number
    );
    
    -- Credit: Inventory
    INSERT INTO journal_entry_lines (
        journal_entry_id, account_id, debit_amount, credit_amount, description
    ) VALUES (
        v_je_id, v_inventory_account_id, 0, v_subtotal,
        'Inventory reduction - Return ' || v_return_number
    );
    
    -- Credit: VAT Input (if applicable)
    IF v_tax_amount > 0 THEN
        INSERT INTO journal_entry_lines (
            journal_entry_id, account_id, debit_amount, credit_amount, description
        ) SELECT
            v_je_id, id, 0, v_tax_amount,
            'VAT Input reversal - Return ' || v_return_number
        FROM chart_of_accounts 
        WHERE account_code = '1501' AND is_active = true 
        LIMIT 1;
    END IF;
    
    -- Link journal entry to invoice
    UPDATE invoices SET journal_entry_id = v_je_id WHERE id = v_return_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'return_id', v_return_id,
        'return_number', v_return_number,
        'journal_entry_id', v_je_id,
        'journal_entry_number', v_je_number
    );
    
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM
    );
END;
$function$;