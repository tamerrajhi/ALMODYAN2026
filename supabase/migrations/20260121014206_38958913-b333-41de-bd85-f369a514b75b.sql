-- Enhanced complete_purchase_return_general_atomic with:
-- D) SELECT ... FOR UPDATE locking on invoice lines
-- E) Per-line validation: return_qty <= (quantity - returned_qty)
-- F) Idempotency correctness (updates after gate OK)
-- G) Post-check gates for data integrity

CREATE OR REPLACE FUNCTION public.complete_purchase_return_general_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_client_request_id uuid;
  v_gate jsonb;
  v_user_name text;
  v_return_data jsonb;
  v_items jsonb;
  v_journal_data jsonb;
  
  v_return_id uuid := gen_random_uuid();
  v_return_number text;
  v_je_id uuid := gen_random_uuid();
  v_je_number text;
  
  v_supplier_id uuid;
  v_branch_id uuid;
  v_purchase_invoice_id uuid;
  v_return_date date;
  v_reason text;
  v_notes text;
  
  v_subtotal numeric := 0;
  v_tax_amount numeric := 0;
  v_total_amount numeric := 0;
  
  v_item jsonb;
  v_product_id uuid;
  v_product_code text;
  v_line_number int;
  v_invoice_line_id uuid;
  v_description text;
  v_quantity numeric;
  v_unit_price numeric;
  v_discount_amount numeric;
  v_tax_rate numeric;
  v_line_net numeric;
  v_line_tax numeric;
  v_line_total numeric;
  
  v_ap_account_id uuid;
  v_inventory_account_id uuid;
  v_vat_account_id uuid;
  
  v_orig_line RECORD;
  v_available_qty numeric;
  v_result jsonb;
  
  -- For post-check
  v_check_line RECORD;
  v_integrity_errors text[] := ARRAY[]::text[];
BEGIN
  -- ============================================================
  -- STEP 1: Parse & Validate Input
  -- ============================================================
  v_client_request_id := (p_payload->>'client_request_id')::uuid;
  v_user_name := p_payload->>'created_by';
  v_return_data := p_payload->'return';
  v_items := p_payload->'items';
  v_journal_data := COALESCE(p_payload->'journal', '{}'::jsonb);
  
  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'client_request_id is required'
    );
  END IF;
  
  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'items array is required and must not be empty'
    );
  END IF;
  
  v_branch_id := (v_return_data->>'branch_id')::uuid;
  IF v_branch_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'branch_id is required'
    );
  END IF;
  
  v_purchase_invoice_id := (v_return_data->>'purchase_invoice_id')::uuid;
  v_return_date := COALESCE((v_return_data->>'return_date')::date, CURRENT_DATE);
  v_reason := v_return_data->>'reason';
  v_notes := v_return_data->>'notes';
  
  -- Determine supplier_id
  v_supplier_id := (v_return_data->>'supplier_id')::uuid;
  IF v_supplier_id IS NULL AND v_purchase_invoice_id IS NOT NULL THEN
    SELECT supplier_id INTO v_supplier_id
    FROM public.invoices
    WHERE id = v_purchase_invoice_id;
  END IF;
  
  IF v_supplier_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'VALIDATION',
      'error', 'supplier_id is required (directly or via purchase_invoice_id)'
    );
  END IF;
  
  -- ============================================================
  -- STEP 2: Idempotency Gate (BEFORE any writes)
  -- ============================================================
  v_gate := public.begin_workflow_request(
    v_client_request_id,
    'purchase_return_general_create_atomic',
    p_payload
  );
  
  IF v_gate->>'status' = 'succeeded' THEN
    RETURN (v_gate->'cached_result') || jsonb_build_object('idempotent', true);
  ELSIF v_gate->>'status' = 'conflict' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'IDEMPOTENCY_CONFLICT',
      'error', 'Same request ID with different payload'
    );
  ELSIF v_gate->>'status' = 'in_progress' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'IN_PROGRESS',
      'error', 'Request is already being processed'
    );
  END IF;
  -- status = 'ok' or 'retry' → proceed
  
  -- ============================================================
  -- STEP 3: D) Acquire row-level locks on invoice lines (FOR UPDATE)
  -- This prevents concurrent returns from corrupting returned_qty
  -- ============================================================
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_invoice_line_id := (v_item->>'invoice_line_id')::uuid;
    
    IF v_invoice_line_id IS NOT NULL THEN
      -- Lock the row to prevent concurrent modifications
      SELECT 
        pil.id,
        pil.product_id,
        pil.product_code,
        pil.line_number,
        pil.quantity,
        COALESCE(pil.returned_qty, 0) as returned_qty,
        pil.unit_price,
        pil.tax_rate,
        pil.description
      INTO v_orig_line
      FROM public.purchase_invoice_lines pil
      WHERE pil.id = v_invoice_line_id
      FOR UPDATE NOWAIT;  -- Fail immediately if locked by another transaction
      
      IF v_orig_line IS NULL THEN
        PERFORM public.fail_workflow_request(v_client_request_id, 'NOT_FOUND', 
          'Invoice line not found: ' || v_invoice_line_id::text);
        RETURN jsonb_build_object(
          'success', false,
          'error_code', 'NOT_FOUND',
          'error', 'Invoice line not found: ' || v_invoice_line_id::text
        );
      END IF;
      
      -- E) Per-line validation: return_qty <= (quantity - returned_qty)
      v_quantity := COALESCE(
        (v_item->>'quantity')::numeric,
        (v_item->>'qty')::numeric,
        1
      );
      v_available_qty := v_orig_line.quantity - v_orig_line.returned_qty;
      
      IF v_quantity > v_available_qty THEN
        PERFORM public.fail_workflow_request(v_client_request_id, 'QUANTITY_EXCEEDED', 
          format('Line %s: Cannot return %s, only %s available', 
            v_invoice_line_id, v_quantity, v_available_qty));
        RETURN jsonb_build_object(
          'success', false,
          'error_code', 'QUANTITY_EXCEEDED',
          'error', format('Cannot return quantity (%s) greater than available (%s) for line %s', 
            v_quantity, v_available_qty, COALESCE(v_orig_line.product_code, v_invoice_line_id::text)),
          'line_id', v_invoice_line_id,
          'requested_qty', v_quantity,
          'available_qty', v_available_qty
        );
      END IF;
    ELSE
      -- invoice_line_id is mandatory for proper validation
      PERFORM public.fail_workflow_request(v_client_request_id, 'VALIDATION', 
        'invoice_line_id is required for each item');
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'VALIDATION',
        'error', 'invoice_line_id is required for each item to ensure proper quantity tracking'
      );
    END IF;
  END LOOP;
  
  -- ============================================================
  -- STEP 4: Generate document numbers (AFTER gate OK)
  -- ============================================================
  v_return_number := public.generate_purchase_return_number(NULL);
  v_je_number := public.generate_journal_entry_number();
  
  -- ============================================================
  -- STEP 5: Calculate totals (using locked data)
  -- ============================================================
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_invoice_line_id := (v_item->>'invoice_line_id')::uuid;
    
    -- Re-read from locked row (already locked above)
    SELECT 
      pil.product_id,
      pil.product_code,
      pil.line_number,
      pil.unit_price,
      pil.tax_rate,
      pil.description
    INTO v_orig_line
    FROM public.purchase_invoice_lines pil
    WHERE pil.id = v_invoice_line_id;
    
    v_product_id := COALESCE(
      (v_item->>'product_id')::uuid,
      (v_item->>'item_id')::uuid,
      v_orig_line.product_id
    );
    v_product_code := COALESCE(v_item->>'product_code', v_item->>'item_code', v_orig_line.product_code);
    v_line_number := v_orig_line.line_number;
    
    v_quantity := COALESCE(
      (v_item->>'quantity')::numeric,
      (v_item->>'qty')::numeric,
      1
    );
    
    v_description := COALESCE(v_item->>'description', v_orig_line.description, 'Return item');
    v_unit_price := COALESCE((v_item->>'unit_price')::numeric, v_orig_line.unit_price, 0);
    v_discount_amount := COALESCE((v_item->>'discount_amount')::numeric, 0);
    v_tax_rate := COALESCE((v_item->>'tax_rate')::numeric, v_orig_line.tax_rate, 15);
    
    v_line_net := (v_quantity * v_unit_price) - v_discount_amount;
    v_line_tax := v_line_net * (v_tax_rate / 100);
    v_line_total := v_line_net + v_line_tax;
    
    v_subtotal := v_subtotal + v_line_net;
    v_tax_amount := v_tax_amount + v_line_tax;
    v_total_amount := v_total_amount + v_line_total;
  END LOOP;
  
  -- ============================================================
  -- STEP 6: Lookup GL accounts
  -- ============================================================
  SELECT id INTO v_ap_account_id
  FROM public.chart_of_accounts
  WHERE account_code = '2010' AND is_active = true
  LIMIT 1;
  
  SELECT id INTO v_inventory_account_id
  FROM public.chart_of_accounts
  WHERE account_code = '1310' AND is_active = true
  LIMIT 1;
  
  SELECT id INTO v_vat_account_id
  FROM public.chart_of_accounts
  WHERE account_code = '1150' AND is_active = true
  LIMIT 1;
  
  -- ============================================================
  -- STEP 7: Create Journal Entry
  -- ============================================================
  INSERT INTO public.journal_entries (
    id,
    entry_number,
    entry_date,
    reference_type,
    reference_id,
    description,
    total_debit,
    total_credit,
    is_posted,
    created_by,
    branch_id
  ) VALUES (
    v_je_id,
    v_je_number,
    v_return_date,
    'purchase_return',
    v_return_id,
    'Purchase Return - ' || v_return_number,
    v_total_amount,
    v_total_amount,
    true,
    v_user_name,
    v_branch_id
  );
  
  -- Debit: Accounts Payable
  IF v_ap_account_id IS NOT NULL THEN
    INSERT INTO public.journal_entry_lines (
      journal_entry_id,
      account_id,
      debit_amount,
      credit_amount,
      description
    ) VALUES (
      v_je_id,
      v_ap_account_id,
      v_total_amount,
      0,
      'Supplier AP reduction for return'
    );
  END IF;
  
  -- Credit: Inventory
  IF v_inventory_account_id IS NOT NULL THEN
    INSERT INTO public.journal_entry_lines (
      journal_entry_id,
      account_id,
      debit_amount,
      credit_amount,
      description
    ) VALUES (
      v_je_id,
      v_inventory_account_id,
      0,
      v_subtotal,
      'Inventory reduction for return'
    );
  END IF;
  
  -- Credit: VAT Input
  IF v_vat_account_id IS NOT NULL AND v_tax_amount > 0 THEN
    INSERT INTO public.journal_entry_lines (
      journal_entry_id,
      account_id,
      debit_amount,
      credit_amount,
      description
    ) VALUES (
      v_je_id,
      v_vat_account_id,
      0,
      v_tax_amount,
      'VAT input reduction for return'
    );
  END IF;
  
  -- ============================================================
  -- STEP 8: Create Purchase Return record
  -- ============================================================
  INSERT INTO public.invoices (
    id,
    invoice_number,
    invoice_date,
    invoice_type,
    supplier_id,
    branch_id,
    subtotal,
    tax_amount,
    total_amount,
    notes,
    status,
    journal_entry_id,
    created_by,
    linked_invoice_id
  ) VALUES (
    v_return_id,
    v_return_number,
    v_return_date,
    'purchase_return',
    v_supplier_id,
    v_branch_id,
    v_subtotal,
    v_tax_amount,
    v_total_amount,
    COALESCE(v_reason, '') || CASE WHEN v_notes IS NOT NULL THEN ' | ' || v_notes ELSE '' END,
    'posted',
    v_je_id,
    v_user_name,
    v_purchase_invoice_id
  );
  
  -- ============================================================
  -- STEP 9: Create Return Line Items & Update returned_qty
  -- (All updates happen AFTER idempotency gate OK)
  -- ============================================================
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_invoice_line_id := (v_item->>'invoice_line_id')::uuid;
    
    -- Get original line data (already locked)
    SELECT 
      pil.product_id,
      pil.product_code,
      pil.line_number,
      pil.unit_price,
      pil.tax_rate,
      pil.description
    INTO v_orig_line
    FROM public.purchase_invoice_lines pil
    WHERE pil.id = v_invoice_line_id;
    
    v_product_id := COALESCE(
      (v_item->>'product_id')::uuid,
      (v_item->>'item_id')::uuid,
      v_orig_line.product_id
    );
    v_product_code := COALESCE(v_item->>'product_code', v_item->>'item_code', v_orig_line.product_code);
    v_line_number := v_orig_line.line_number;
    
    v_quantity := COALESCE(
      (v_item->>'quantity')::numeric,
      (v_item->>'qty')::numeric,
      1
    );
    
    v_description := COALESCE(v_item->>'description', v_orig_line.description, 'Return item');
    v_unit_price := COALESCE((v_item->>'unit_price')::numeric, v_orig_line.unit_price, 0);
    v_discount_amount := COALESCE((v_item->>'discount_amount')::numeric, 0);
    v_tax_rate := COALESCE((v_item->>'tax_rate')::numeric, v_orig_line.tax_rate, 15);
    
    v_line_net := (v_quantity * v_unit_price) - v_discount_amount;
    v_line_tax := v_line_net * (v_tax_rate / 100);
    v_line_total := v_line_net + v_line_tax;
    
    -- Insert return line with product_code and line_number
    INSERT INTO public.purchase_invoice_lines (
      id,
      invoice_id,
      product_id,
      product_code,
      line_number,
      description,
      quantity,
      unit_price,
      discount_amount,
      tax_rate,
      tax_amount,
      total_amount
    ) VALUES (
      gen_random_uuid(),
      v_return_id,
      v_product_id,
      v_product_code,
      v_line_number,
      v_description,
      v_quantity,
      v_unit_price,
      v_discount_amount,
      v_tax_rate,
      v_line_tax,
      v_line_total
    );
    
    -- Update returned_qty on original invoice line (AFTER gate OK)
    UPDATE public.purchase_invoice_lines
    SET returned_qty = COALESCE(returned_qty, 0) + v_quantity
    WHERE id = v_invoice_line_id;
  END LOOP;
  
  -- ============================================================
  -- STEP 10: G) Post-check Gate - Verify data integrity
  -- ============================================================
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_invoice_line_id := (v_item->>'invoice_line_id')::uuid;
    
    SELECT 
      id,
      quantity,
      COALESCE(returned_qty, 0) as returned_qty
    INTO v_check_line
    FROM public.purchase_invoice_lines
    WHERE id = v_invoice_line_id;
    
    -- Check: returned_qty <= quantity
    IF v_check_line.returned_qty > v_check_line.quantity THEN
      v_integrity_errors := array_append(v_integrity_errors, 
        format('Line %s: returned_qty (%s) > quantity (%s)', 
          v_invoice_line_id, v_check_line.returned_qty, v_check_line.quantity));
    END IF;
    
    -- Check: remaining_qty >= 0 (implicit: quantity - returned_qty >= 0)
    IF v_check_line.quantity - v_check_line.returned_qty < 0 THEN
      v_integrity_errors := array_append(v_integrity_errors, 
        format('Line %s: remaining_qty is negative', v_invoice_line_id));
    END IF;
  END LOOP;
  
  -- If integrity errors found, rollback via exception
  IF array_length(v_integrity_errors, 1) > 0 THEN
    PERFORM public.fail_workflow_request(v_client_request_id, 'INTEGRITY_ERROR', 
      array_to_string(v_integrity_errors, '; '));
    RAISE EXCEPTION 'Post-check integrity errors: %', array_to_string(v_integrity_errors, '; ');
  END IF;
  
  -- ============================================================
  -- STEP 11: Mark workflow complete
  -- ============================================================
  v_result := jsonb_build_object(
    'success', true,
    'return_id', v_return_id,
    'return_number', v_return_number,
    'journal_entry_id', v_je_id,
    'journal_entry_number', v_je_number,
    'total_amount', v_total_amount,
    'items_count', jsonb_array_length(v_items)
  );
  
  PERFORM public.complete_workflow_request(v_client_request_id, v_result);
  
  RETURN v_result;

EXCEPTION 
  WHEN lock_not_available THEN
    -- FOR UPDATE NOWAIT failed - another transaction is processing these lines
    PERFORM public.fail_workflow_request(v_client_request_id, 'CONCURRENT_LOCK', 
      'Another transaction is currently processing these invoice lines');
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'CONCURRENT_LOCK',
      'error', 'Another transaction is currently processing these invoice lines. Please try again.'
    );
  WHEN OTHERS THEN
    PERFORM public.fail_workflow_request(v_client_request_id, SQLSTATE, SQLERRM);
    RAISE;
END;
$function$;