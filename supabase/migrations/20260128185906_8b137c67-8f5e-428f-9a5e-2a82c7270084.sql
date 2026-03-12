-- D2-5.5: Fix status constraint violation in complete_purchase_return_unique_items_atomic
-- Change 'completed' to 'posted' to match purchase_returns_status_chk constraint

CREATE OR REPLACE FUNCTION public.complete_purchase_return_unique_items_atomic(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- Request tracking
  v_client_request_id text;
  v_created_by        text;
  v_workflow_type     text := 'purchase_return_unique_create_atomic';
  v_payload_hash      text;
  v_begin_result      jsonb;
  
  -- Return header fields
  v_branch_id           uuid;
  v_supplier_id         uuid;
  v_purchase_invoice_id uuid;
  v_return_date         date;
  v_return_reason       text;
  v_notes               text;
  
  -- Generated values
  v_return_id           uuid;
  v_return_number       text;
  v_journal_entry_id    uuid;
  v_journal_entry_number text;
  
  -- Accumulators
  v_subtotal            numeric := 0;
  v_tax_amount          numeric := 0;
  v_total_amount        numeric := 0;
  v_item_count          int := 0;
  
  -- Loop variables
  v_item                jsonb;
  v_item_id             uuid;
  v_item_code           text;
  v_description         text;
  v_unit_price          numeric;
  v_tax_rate            numeric;
  v_gold_weight         numeric;
  v_karat_id            uuid;
  v_invoice_line_id     uuid;
  v_reason              text;
  v_line_subtotal       numeric;
  v_line_tax            numeric;
  v_line_total          numeric;
  
  -- Account IDs for JE
  v_inventory_account_id    uuid;
  v_ap_account_id           uuid;
  v_tax_account_id          uuid;
  
  -- Existing item check
  v_existing_branch_id      uuid;
  v_existing_sale_status    text;
BEGIN
  -- ═══════════════════════════════════════════════════════════════
  -- STEP 1: Extract and validate request parameters
  -- ═══════════════════════════════════════════════════════════════
  v_client_request_id := p_payload->>'client_request_id';
  v_created_by := COALESCE(p_payload->>'created_by', 'system');
  
  IF v_client_request_id IS NULL OR v_client_request_id = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'MISSING_CLIENT_REQUEST_ID',
      'error', 'client_request_id is required'
    );
  END IF;
  
  -- Calculate payload hash for idempotency
  v_payload_hash := md5(p_payload::text);
  
  -- ═══════════════════════════════════════════════════════════════
  -- STEP 2: Begin workflow request (idempotency check)
  -- ═══════════════════════════════════════════════════════════════
  v_begin_result := pos_begin_request(v_client_request_id, v_workflow_type, v_payload_hash);
  
  -- Check if this is a cached/duplicate request
  IF (v_begin_result->>'status') = 'succeeded' THEN
    RETURN jsonb_build_object(
      'success', true,
      'cached', true,
      'idempotent', true,
      'returnId', v_begin_result->'result'->>'return_id',
      'returnNumber', v_begin_result->'result'->>'return_number',
      'journalEntryId', v_begin_result->'result'->>'journal_entry_id',
      'journalEntryNumber', v_begin_result->'result'->>'journal_entry_number',
      'status', v_begin_result->'result'->>'status',
      'itemCount', (v_begin_result->'result'->>'item_count')::int,
      'totals', jsonb_build_object(
        'subtotal', (v_begin_result->'result'->>'subtotal')::numeric,
        'taxAmount', (v_begin_result->'result'->>'tax_amount')::numeric,
        'totalAmount', (v_begin_result->'result'->>'total_amount')::numeric
      )
    );
  ELSIF (v_begin_result->>'status') = 'failed' THEN
    RETURN jsonb_build_object(
      'success', false,
      'cached', true,
      'error_code', v_begin_result->>'error_code',
      'error', v_begin_result->>'error_message'
    );
  ELSIF (v_begin_result->>'status') = 'processing' THEN
    -- Normal start - continue processing
    NULL;
  END IF;
  
  -- ═══════════════════════════════════════════════════════════════
  -- STEP 3: Extract return header from payload
  -- ═══════════════════════════════════════════════════════════════
  v_branch_id := NULLIF(p_payload->'return'->>'branch_id', '')::uuid;
  v_supplier_id := NULLIF(p_payload->'return'->>'supplier_id', '')::uuid;
  v_purchase_invoice_id := NULLIF(p_payload->'return'->>'purchase_invoice_id', '')::uuid;
  v_return_date := COALESCE((p_payload->'return'->>'return_date')::date, CURRENT_DATE);
  v_return_reason := p_payload->'return'->>'reason';
  v_notes := p_payload->'return'->>'notes';
  
  -- Validate required fields
  IF v_branch_id IS NULL THEN
    PERFORM pos_fail_request(v_client_request_id, v_workflow_type, 'MISSING_BRANCH_ID', 'branch_id is required');
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_BRANCH_ID', 'error', 'branch_id is required');
  END IF;
  
  IF v_purchase_invoice_id IS NULL THEN
    PERFORM pos_fail_request(v_client_request_id, v_workflow_type, 'MISSING_INVOICE_ID', 'purchase_invoice_id is required');
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_INVOICE_ID', 'error', 'purchase_invoice_id is required');
  END IF;
  
  -- Get supplier from invoice if not provided
  IF v_supplier_id IS NULL THEN
    SELECT supplier_id INTO v_supplier_id
    FROM invoices
    WHERE id = v_purchase_invoice_id;
  END IF;
  
  -- ═══════════════════════════════════════════════════════════════
  -- STEP 4: Generate return number
  -- ═══════════════════════════════════════════════════════════════
  v_return_number := generate_purchase_return_number(v_branch_id);
  
  -- ═══════════════════════════════════════════════════════════════
  -- STEP 5: Create purchase return header
  -- ═══════════════════════════════════════════════════════════════
  INSERT INTO public.purchase_returns (
    return_number,
    branch_id,
    supplier_id,
    purchase_invoice_id,
    return_date,
    status,
    return_reason,
    notes,
    processed_by,
    subtotal,
    tax_amount,
    total_amount
  ) VALUES (
    v_return_number,
    v_branch_id,
    v_supplier_id,
    v_purchase_invoice_id,
    v_return_date::date,
    'posted',  -- D2-5.5: Changed from 'completed' to match constraint
    v_return_reason,
    v_notes,
    v_created_by,
    0, 0, 0  -- Will update after processing items
  )
  RETURNING id INTO v_return_id;
  
  -- ═══════════════════════════════════════════════════════════════
  -- STEP 6: Process each item
  -- ═══════════════════════════════════════════════════════════════
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items')
  LOOP
    v_item_id := NULLIF(v_item->>'item_id', '')::uuid;
    v_item_code := v_item->>'item_code';
    v_description := v_item->>'description';
    v_unit_price := COALESCE((v_item->>'unit_price')::numeric, 0);
    v_tax_rate := COALESCE((v_item->>'tax_rate')::numeric, 0);
    v_gold_weight := (v_item->>'gold_weight')::numeric;
    v_karat_id := NULLIF(v_item->>'karat_id', '')::uuid;
    v_invoice_line_id := NULLIF(v_item->>'invoice_line_id', '')::uuid;
    v_reason := v_item->>'reason';
    
    IF v_item_id IS NULL THEN
      PERFORM pos_fail_request(v_client_request_id, v_workflow_type, 'MISSING_ITEM_ID', 'item_id is required for each item');
      RAISE EXCEPTION 'MISSING_ITEM_ID: item_id is required for each item';
    END IF;
    
    -- Validate item exists and is available
    SELECT branch_id, sale_status INTO v_existing_branch_id, v_existing_sale_status
    FROM jewelry_items
    WHERE id = v_item_id;
    
    IF NOT FOUND THEN
      PERFORM pos_fail_request(v_client_request_id, v_workflow_type, 'ITEM_NOT_FOUND', format('Item %s not found', v_item_id));
      RAISE EXCEPTION 'ITEM_NOT_FOUND: Item % not found', v_item_id;
    END IF;
    
    IF v_existing_sale_status = 'sold' THEN
      PERFORM pos_fail_request(v_client_request_id, v_workflow_type, 'ITEM_ALREADY_SOLD', format('Item %s is already sold', v_item_id));
      RAISE EXCEPTION 'ITEM_ALREADY_SOLD: Item % is already sold', v_item_id;
    END IF;
    
    -- Calculate line amounts
    v_line_subtotal := v_unit_price;
    v_line_tax := ROUND(v_line_subtotal * v_tax_rate, 2);
    v_line_total := v_line_subtotal + v_line_tax;
    
    -- Accumulate totals
    v_subtotal := v_subtotal + v_line_subtotal;
    v_tax_amount := v_tax_amount + v_line_tax;
    v_total_amount := v_total_amount + v_line_total;
    v_item_count := v_item_count + 1;
    
    -- Insert return item
    INSERT INTO public.purchase_return_items (
      purchase_return_id,
      jewelry_item_id,
      item_code,
      description,
      unit_price,
      tax_rate,
      tax_amount,
      total_amount,
      gold_weight,
      karat_id,
      invoice_line_id,
      reason
    ) VALUES (
      v_return_id,
      v_item_id,
      COALESCE(v_item_code, (SELECT item_code FROM jewelry_items WHERE id = v_item_id)),
      COALESCE(v_description, (SELECT description FROM jewelry_items WHERE id = v_item_id)),
      v_unit_price,
      v_tax_rate,
      v_line_tax,
      v_line_total,
      COALESCE(v_gold_weight, (SELECT g_weight FROM jewelry_items WHERE id = v_item_id)),
      v_karat_id,
      v_invoice_line_id,
      v_reason
    );
    
    -- Update jewelry item status - remove from branch (return to supplier)
    UPDATE jewelry_items
    SET 
      branch_id = NULL,
      sale_status = 'returned',
      updated_at = now()
    WHERE id = v_item_id;
    
    -- Create item movement record
    INSERT INTO item_movements (
      jewelry_item_id,
      movement_type,
      from_branch_id,
      to_branch_id,
      purchase_return_id,
      notes,
      created_by
    ) VALUES (
      v_item_id,
      'purchase_return',
      v_existing_branch_id,
      NULL,
      v_return_id,
      format('Purchase return %s', v_return_number),
      v_created_by
    );
  END LOOP;
  
  -- ═══════════════════════════════════════════════════════════════
  -- STEP 7: Update return totals
  -- ═══════════════════════════════════════════════════════════════
  UPDATE purchase_returns
  SET 
    subtotal = v_subtotal,
    tax_amount = v_tax_amount,
    total_amount = v_total_amount
  WHERE id = v_return_id;
  
  -- ═══════════════════════════════════════════════════════════════
  -- STEP 8: Create Journal Entry
  -- ═══════════════════════════════════════════════════════════════
  -- Get account IDs
  SELECT account_id INTO v_inventory_account_id
  FROM branch_accounting_config
  WHERE branch_id = v_branch_id AND config_key = 'imported_pieces_account'
  LIMIT 1;
  
  IF v_inventory_account_id IS NULL THEN
    SELECT id INTO v_inventory_account_id
    FROM chart_of_accounts
    WHERE account_code = '1150'
    LIMIT 1;
  END IF;
  
  SELECT account_id INTO v_ap_account_id
  FROM branch_accounting_config
  WHERE branch_id = v_branch_id AND config_key = 'accounts_payable'
  LIMIT 1;
  
  IF v_ap_account_id IS NULL THEN
    SELECT id INTO v_ap_account_id
    FROM chart_of_accounts
    WHERE account_code = '2100'
    LIMIT 1;
  END IF;
  
  SELECT id INTO v_tax_account_id
  FROM chart_of_accounts
  WHERE account_code = '2110'
  LIMIT 1;
  
  -- Generate JE number
  v_journal_entry_number := generate_journal_entry_number();
  
  -- Create journal entry
  INSERT INTO journal_entries (
    entry_number,
    entry_date,
    description,
    reference_type,
    reference_id,
    branch_id,
    is_posted,
    created_by
  ) VALUES (
    v_journal_entry_number,
    v_return_date,
    format('مرتجع مشتريات فريد رقم %s', v_return_number),
    'purchase_return',
    v_return_id,
    v_branch_id,
    true,
    v_created_by
  )
  RETURNING id INTO v_journal_entry_id;
  
  -- Debit: AP (reduce liability)
  INSERT INTO journal_entry_lines (
    journal_entry_id,
    account_id,
    debit_amount,
    credit_amount,
    description
  ) VALUES (
    v_journal_entry_id,
    v_ap_account_id,
    v_total_amount,
    0,
    format('مرتجع مشتريات - %s', v_return_number)
  );
  
  -- Credit: Inventory (reduce asset)
  INSERT INTO journal_entry_lines (
    journal_entry_id,
    account_id,
    debit_amount,
    credit_amount,
    description
  ) VALUES (
    v_journal_entry_id,
    v_inventory_account_id,
    0,
    v_subtotal,
    format('تخفيض المخزون - %s', v_return_number)
  );
  
  -- Credit: Tax (if applicable)
  IF v_tax_amount > 0 AND v_tax_account_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (
      journal_entry_id,
      account_id,
      debit_amount,
      credit_amount,
      description
    ) VALUES (
      v_journal_entry_id,
      v_tax_account_id,
      0,
      v_tax_amount,
      format('ضريبة مرتجع - %s', v_return_number)
    );
  END IF;
  
  -- Link JE to return
  UPDATE purchase_returns
  SET journal_entry_id = v_journal_entry_id
  WHERE id = v_return_id;
  
  -- ═══════════════════════════════════════════════════════════════
  -- STEP 9: Mark workflow as succeeded
  -- ═══════════════════════════════════════════════════════════════
  PERFORM pos_succeed_request(
    v_client_request_id,
    v_workflow_type,
    jsonb_build_object(
      'return_id', v_return_id,
      'return_number', v_return_number,
      'journal_entry_id', v_journal_entry_id,
      'journal_entry_number', v_journal_entry_number,
      'status', 'posted',
      'item_count', v_item_count,
      'subtotal', v_subtotal,
      'tax_amount', v_tax_amount,
      'total_amount', v_total_amount
    )
  );
  
  -- Return success
  RETURN jsonb_build_object(
    'success', true,
    'returnId', v_return_id,
    'returnNumber', v_return_number,
    'journalEntryId', v_journal_entry_id,
    'journalEntryNumber', v_journal_entry_number,
    'status', 'posted',
    'itemCount', v_item_count,
    'totals', jsonb_build_object(
      'subtotal', v_subtotal,
      'taxAmount', v_tax_amount,
      'totalAmount', v_total_amount
    )
  );
  
EXCEPTION
  WHEN OTHERS THEN
    -- Mark as failed if not already
    BEGIN
      PERFORM pos_fail_request(v_client_request_id, v_workflow_type, 'UNEXPECTED_ERROR', SQLERRM);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'UNEXPECTED_ERROR',
      'error', SQLERRM
    );
END;
$function$;

COMMENT ON FUNCTION public.complete_purchase_return_unique_items_atomic(jsonb) IS 
  'D2-5.5: Status vocabulary aligned with purchase_returns_status_chk (completed → posted). Creates atomic unique purchase return with JE.';