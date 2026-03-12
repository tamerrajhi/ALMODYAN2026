
-- =====================================================
-- Fix Purchase Return Atomic RPCs to match actual DB schema
-- =====================================================

-- STEP 1: Fix UNIQUE Items RPC
CREATE OR REPLACE FUNCTION public.complete_purchase_return_unique_items_atomic(p_payload jsonb)
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
  v_jewelry_item_id uuid;
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
  
  v_result jsonb;
BEGIN
  -- ============================================================
  -- STEP 1: Parse & Validate
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
  -- STEP 2: Idempotency Gate (CANONICAL - uuid signature)
  -- ============================================================
  v_gate := public.begin_workflow_request(
    v_client_request_id,
    'purchase_return_unique_create_atomic',
    p_payload
  );
  
  -- Handle status per canonical contract
  IF v_gate->>'status' = 'succeeded' THEN
    RETURN v_gate->'cached_result';
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
  -- status = 'ok' → continue
  
  -- ============================================================
  -- STEP 3: Generate document numbers (CANONICAL generators)
  -- ============================================================
  v_return_number := public.generate_purchase_return_number(NULL);
  v_je_number := public.generate_journal_entry_number();
  
  -- ============================================================
  -- STEP 4: Process items and calculate totals
  -- ============================================================
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_jewelry_item_id := (v_item->>'item_id')::uuid;
    v_invoice_line_id := (v_item->>'invoice_line_id')::uuid;
    v_description := COALESCE(v_item->>'description', 'Return item');
    v_quantity := COALESCE((v_item->>'quantity')::numeric, 1);
    v_unit_price := COALESCE((v_item->>'unit_price')::numeric, 0);
    v_discount_amount := COALESCE((v_item->>'discount_amount')::numeric, 0);
    v_tax_rate := COALESCE((v_item->>'tax_rate')::numeric, 15);
    
    v_line_net := (v_quantity * v_unit_price) - v_discount_amount;
    v_line_tax := v_line_net * (v_tax_rate / 100);
    v_line_total := v_line_net + v_line_tax;
    
    v_subtotal := v_subtotal + v_line_net;
    v_tax_amount := v_tax_amount + v_line_tax;
    v_total_amount := v_total_amount + v_line_total;
  END LOOP;
  
  -- ============================================================
  -- STEP 5: Lookup GL accounts
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
  -- STEP 6: Create Journal Entry
  -- FIX: Remove phantom columns (status, is_auto_generated), use is_posted=true
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
  
  -- Debit: Accounts Payable (reduce liability)
  -- FIX: Remove phantom column line_order
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
  
  -- Credit: Inventory (reduce asset)
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
  
  -- Credit: VAT Input (reduce asset)
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
  -- STEP 7: Create Purchase Return header
  -- ============================================================
  INSERT INTO public.purchase_returns (
    id,
    return_number,
    return_date,
    supplier_id,
    purchase_invoice_id,
    branch_id,
    subtotal,
    tax_amount,
    total_amount,
    reason,
    notes,
    status,
    journal_entry_id,
    processed_by,
    purchase_type
  ) VALUES (
    v_return_id,
    v_return_number,
    v_return_date,
    v_supplier_id,
    v_purchase_invoice_id,
    v_branch_id,
    v_subtotal,
    v_tax_amount,
    v_total_amount,
    v_reason,
    v_notes,
    'confirmed',
    v_je_id,
    v_user_name,
    'local'
  );
  
  -- ============================================================
  -- STEP 8: Create Return Items + Item Movements
  -- FIX: Use return_id instead of purchase_return_id
  -- ============================================================
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_jewelry_item_id := (v_item->>'item_id')::uuid;
    v_invoice_line_id := (v_item->>'invoice_line_id')::uuid;
    v_description := COALESCE(v_item->>'description', 'Return item');
    v_quantity := COALESCE((v_item->>'quantity')::numeric, 1);
    v_unit_price := COALESCE((v_item->>'unit_price')::numeric, 0);
    v_discount_amount := COALESCE((v_item->>'discount_amount')::numeric, 0);
    v_tax_rate := COALESCE((v_item->>'tax_rate')::numeric, 15);
    
    v_line_net := (v_quantity * v_unit_price) - v_discount_amount;
    v_line_tax := v_line_net * (v_tax_rate / 100);
    v_line_total := v_line_net + v_line_tax;
    
    -- Insert return item - FIX: use return_id column
    INSERT INTO public.purchase_return_items (
      id,
      return_id,
      jewelry_item_id,
      invoice_line_id,
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
      v_jewelry_item_id,
      v_invoice_line_id,
      v_description,
      v_quantity,
      v_unit_price,
      v_discount_amount,
      v_tax_rate,
      v_line_tax,
      v_line_total
    );
    
    -- Create item movement for the jewelry item
    IF v_jewelry_item_id IS NOT NULL THEN
      INSERT INTO public.item_movements (
        id,
        item_id,
        movement_type,
        reference_type,
        reference_id,
        from_branch_id,
        quantity,
        notes,
        performed_by
      ) VALUES (
        gen_random_uuid(),
        v_jewelry_item_id,
        'purchase_return',
        'purchase_return',
        v_return_id,
        v_branch_id,
        v_quantity,
        'Returned to supplier: ' || v_return_number,
        v_user_name
      );
      
      -- Update jewelry item status
      UPDATE public.jewelry_items
      SET 
        status = 'returned_to_supplier',
        branch_id = NULL,
        updated_at = NOW()
      WHERE id = v_jewelry_item_id;
    END IF;
  END LOOP;
  
  -- ============================================================
  -- STEP 9: Mark workflow complete
  -- ============================================================
  v_result := jsonb_build_object(
    'success', true,
    'return_id', v_return_id,
    'return_number', v_return_number,
    'journal_entry_id', v_je_id,
    'journal_entry_number', v_je_number,
    'total_amount', v_total_amount
  );
  
  PERFORM public.complete_workflow_request(v_client_request_id, v_result);
  
  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  PERFORM public.fail_workflow_request(v_client_request_id, SQLSTATE, SQLERRM);
  RAISE;
END;
$function$;

-- STEP 2: Fix GENERAL RPC
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
  
  v_result jsonb;
BEGIN
  -- ============================================================
  -- STEP 1: Parse & Validate
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
  -- STEP 2: Idempotency Gate (CANONICAL - uuid signature)
  -- ============================================================
  v_gate := public.begin_workflow_request(
    v_client_request_id,
    'purchase_return_general_create_atomic',
    p_payload
  );
  
  -- Handle status per canonical contract
  IF v_gate->>'status' = 'succeeded' THEN
    RETURN v_gate->'cached_result';
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
  -- status = 'ok' → continue
  
  -- ============================================================
  -- STEP 3: Generate document numbers (CANONICAL generators)
  -- ============================================================
  v_return_number := public.generate_purchase_return_number(NULL);
  v_je_number := public.generate_journal_entry_number();
  
  -- ============================================================
  -- STEP 4: Process items and calculate totals
  -- ============================================================
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_invoice_line_id := (v_item->>'invoice_line_id')::uuid;
    v_description := COALESCE(v_item->>'description', 'Return item');
    v_quantity := COALESCE((v_item->>'quantity')::numeric, 1);
    v_unit_price := COALESCE((v_item->>'unit_price')::numeric, 0);
    v_discount_amount := COALESCE((v_item->>'discount_amount')::numeric, 0);
    v_tax_rate := COALESCE((v_item->>'tax_rate')::numeric, 15);
    
    v_line_net := (v_quantity * v_unit_price) - v_discount_amount;
    v_line_tax := v_line_net * (v_tax_rate / 100);
    v_line_total := v_line_net + v_line_tax;
    
    v_subtotal := v_subtotal + v_line_net;
    v_tax_amount := v_tax_amount + v_line_tax;
    v_total_amount := v_total_amount + v_line_total;
  END LOOP;
  
  -- ============================================================
  -- STEP 5: Lookup GL accounts
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
  -- STEP 6: Create Journal Entry
  -- FIX: Remove phantom columns (status, is_auto_generated), use is_posted=true
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
  
  -- Debit: Accounts Payable (reduce liability)
  -- FIX: Remove phantom column line_order
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
  
  -- Credit: Inventory (reduce asset)
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
  
  -- Credit: VAT Input (reduce asset)
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
  -- STEP 7: Create Purchase Return record (in invoices table for general returns)
  -- FIX: Use linked_invoice_id instead of related_invoice_id
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
  -- STEP 8: Create Return Line Items
  -- FIX: Use total_amount instead of line_total
  -- ============================================================
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_invoice_line_id := (v_item->>'invoice_line_id')::uuid;
    v_description := COALESCE(v_item->>'description', 'Return item');
    v_quantity := COALESCE((v_item->>'quantity')::numeric, 1);
    v_unit_price := COALESCE((v_item->>'unit_price')::numeric, 0);
    v_discount_amount := COALESCE((v_item->>'discount_amount')::numeric, 0);
    v_tax_rate := COALESCE((v_item->>'tax_rate')::numeric, 15);
    
    v_line_net := (v_quantity * v_unit_price) - v_discount_amount;
    v_line_tax := v_line_net * (v_tax_rate / 100);
    v_line_total := v_line_net + v_line_tax;
    
    -- Insert invoice line for the return - FIX: use total_amount
    INSERT INTO public.purchase_invoice_lines (
      id,
      invoice_id,
      product_id,
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
      v_description,
      v_quantity,
      v_unit_price,
      v_discount_amount,
      v_tax_rate,
      v_line_tax,
      v_line_total
    );
    
    -- Update returned_qty on original invoice line if linked
    IF v_invoice_line_id IS NOT NULL THEN
      UPDATE public.purchase_invoice_lines
      SET returned_qty = COALESCE(returned_qty, 0) + v_quantity
      WHERE id = v_invoice_line_id;
    END IF;
  END LOOP;
  
  -- ============================================================
  -- STEP 9: Mark workflow complete
  -- ============================================================
  v_result := jsonb_build_object(
    'success', true,
    'return_id', v_return_id,
    'return_number', v_return_number,
    'journal_entry_id', v_je_id,
    'journal_entry_number', v_je_number,
    'total_amount', v_total_amount
  );
  
  PERFORM public.complete_workflow_request(v_client_request_id, v_result);
  
  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  PERFORM public.fail_workflow_request(v_client_request_id, SQLSTATE, SQLERRM);
  RAISE;
END;
$function$;

-- STEP 3: Grant execute permissions
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_unique_items_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_general_atomic(jsonb) TO authenticated;
