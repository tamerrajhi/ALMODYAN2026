
-- ============================================================
-- PR-2 CANONICAL PATCH: Fix workflow_type, generators, schema
-- ============================================================

-- ============================================================
-- 1) purchase_return_unique_create_atomic (CANONICAL)
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_purchase_return_unique_items_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
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
    'purchase_return_unique_create_atomic',  -- CORRECT workflow_type
    p_payload
  );
  
  -- Handle status per canonical contract
  IF v_gate->>'status' = 'succeeded' THEN
    -- Return cached result from pos_workflow_requests.result
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
  v_return_number := public.generate_purchase_return_number();
  v_je_number := public.generate_journal_entry_number();
  
  -- ============================================================
  -- STEP 4: Process items and calculate totals
  -- ============================================================
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_jewelry_item_id := (v_item->>'jewelry_item_id')::uuid;
    v_invoice_line_id := (v_item->>'invoice_line_id')::uuid;
    v_description := COALESCE(v_item->>'description', 'مرتجع قطعة');
    v_quantity := COALESCE((v_item->>'quantity')::numeric, 1);
    v_unit_price := COALESCE((v_item->>'unit_price')::numeric, 0);
    v_discount_amount := COALESCE((v_item->>'discount_amount')::numeric, 0);
    v_tax_rate := COALESCE((v_item->>'tax_rate')::numeric, 0);
    
    IF v_jewelry_item_id IS NULL THEN
      PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION', 'jewelry_item_id is required for unique returns');
      RETURN jsonb_build_object(
        'success', false,
        'error_code', 'VALIDATION',
        'error', 'jewelry_item_id is required for each item in unique returns'
      );
    END IF;
    
    -- Calculate line amounts
    v_line_net := (v_quantity * v_unit_price) - v_discount_amount;
    v_line_tax := v_line_net * v_tax_rate;
    v_line_total := v_line_net + v_line_tax;
    
    v_subtotal := v_subtotal + v_line_net;
    v_tax_amount := v_tax_amount + v_line_tax;
    v_total_amount := v_total_amount + v_line_total;
  END LOOP;
  
  -- ============================================================
  -- STEP 5: Get accounting accounts from system_account_mappings
  -- ============================================================
  SELECT id INTO v_ap_account_id
  FROM public.chart_of_accounts
  WHERE account_code = '2101'
  LIMIT 1;
  
  -- Try to get supplier-specific account
  SELECT account_id INTO v_ap_account_id
  FROM public.suppliers
  WHERE id = v_supplier_id AND account_id IS NOT NULL;
  
  IF v_ap_account_id IS NULL THEN
    SELECT account_id INTO v_ap_account_id
    FROM public.system_account_mappings
    WHERE role_key = 'PAYABLES_PARENT'
    LIMIT 1;
  END IF;
  
  SELECT account_id INTO v_inventory_account_id
  FROM public.system_account_mappings
  WHERE role_key = 'INVENTORY_ASSET'
  LIMIT 1;
  
  SELECT account_id INTO v_vat_account_id
  FROM public.system_account_mappings
  WHERE role_key = 'VAT_INPUT'
  LIMIT 1;
  
  -- ============================================================
  -- STEP 6: Insert purchase_returns header
  -- ============================================================
  INSERT INTO public.purchase_returns (
    id,
    return_number,
    supplier_id,
    purchase_invoice_id,
    branch_id,
    return_date,
    subtotal,
    tax_amount,
    total_amount,
    status,
    reason,
    notes,
    processed_by,
    created_at,
    updated_at
  ) VALUES (
    v_return_id,
    v_return_number,
    v_supplier_id,
    v_purchase_invoice_id,
    v_branch_id,
    v_return_date,
    v_subtotal,
    v_tax_amount,
    v_total_amount,
    'posted',
    v_reason,
    v_notes,
    v_user_name,
    now(),
    now()
  );
  
  -- ============================================================
  -- STEP 7: Insert purchase_return_items and update inventory
  -- ============================================================
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_jewelry_item_id := (v_item->>'jewelry_item_id')::uuid;
    v_invoice_line_id := (v_item->>'invoice_line_id')::uuid;
    v_description := COALESCE(v_item->>'description', 'مرتجع قطعة');
    v_quantity := COALESCE((v_item->>'quantity')::numeric, 1);
    v_unit_price := COALESCE((v_item->>'unit_price')::numeric, 0);
    v_discount_amount := COALESCE((v_item->>'discount_amount')::numeric, 0);
    v_tax_rate := COALESCE((v_item->>'tax_rate')::numeric, 0);
    
    v_line_net := (v_quantity * v_unit_price) - v_discount_amount;
    v_line_tax := v_line_net * v_tax_rate;
    v_line_total := v_line_net + v_line_tax;
    
    -- Insert return item
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
      total_amount,
      created_at
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
      v_line_total,
      now()
    );
    
    -- CANONICAL: Update jewelry_items using sale_status (NOT status)
    UPDATE public.jewelry_items
    SET 
      sale_status = 'available',
      sold_at = NULL,
      updated_at = now()
    WHERE id = v_jewelry_item_id;
    
    -- CANONICAL: Insert item_movements with item_id (NOT jewelry_item_id)
    INSERT INTO public.item_movements (
      id,
      item_id,  -- CORRECT: use item_id column
      movement_type,
      reference_type,
      reference_id,
      return_id,
      to_branch_id,
      notes,
      performed_by,
      movement_date
    ) VALUES (
      gen_random_uuid(),
      v_jewelry_item_id,
      'return_to_supplier',
      'purchase_return',
      v_return_id,
      v_return_id,
      v_branch_id,
      'مرتجع مشتريات (Unique): ' || v_return_number,
      v_user_name,
      now()
    );
  END LOOP;
  
  -- ============================================================
  -- STEP 8: Create Journal Entry (CANONICAL columns)
  -- ============================================================
  INSERT INTO public.journal_entries (
    id,
    entry_number,
    entry_date,
    description,
    reference_type,
    reference_id,
    branch_id,
    is_posted,        -- CORRECT: boolean not status
    posted_at,
    posted_by,
    total_debit,
    total_credit,
    created_by,       -- CORRECT: text not uuid
    created_at,
    updated_at,
    is_reversed
  ) VALUES (
    v_je_id,
    v_je_number,
    v_return_date,
    COALESCE(v_journal_data->>'description', 'قيد مرتجع مشتريات: ' || v_return_number),
    'purchase_return',
    v_return_id,
    v_branch_id,
    true,             -- is_posted = true
    now(),
    v_user_name,
    v_total_amount,
    v_total_amount,
    v_user_name,
    now(),
    now(),
    false
  );
  
  -- JE Lines: Debit AP (reduce payable) = total_amount
  INSERT INTO public.journal_entry_lines (
    id,
    journal_entry_id,
    account_id,
    debit_amount,
    credit_amount,
    description,
    created_at
  ) VALUES (
    gen_random_uuid(),
    v_je_id,
    v_ap_account_id,
    v_total_amount,
    0,
    'مدين: ذمم الموردين - مرتجع ' || v_return_number,
    now()
  );
  
  -- JE Lines: Credit Inventory = subtotal
  INSERT INTO public.journal_entry_lines (
    id,
    journal_entry_id,
    account_id,
    debit_amount,
    credit_amount,
    description,
    created_at
  ) VALUES (
    gen_random_uuid(),
    v_je_id,
    v_inventory_account_id,
    0,
    v_subtotal,
    'دائن: المخزون - مرتجع ' || v_return_number,
    now()
  );
  
  -- JE Lines: Credit VAT Input = tax_amount (if > 0)
  IF v_tax_amount > 0 AND v_vat_account_id IS NOT NULL THEN
    INSERT INTO public.journal_entry_lines (
      id,
      journal_entry_id,
      account_id,
      debit_amount,
      credit_amount,
      description,
      created_at
    ) VALUES (
      gen_random_uuid(),
      v_je_id,
      v_vat_account_id,
      0,
      v_tax_amount,
      'دائن: ضريبة المدخلات - مرتجع ' || v_return_number,
      now()
    );
  END IF;
  
  -- ============================================================
  -- STEP 9: Link JE to return
  -- ============================================================
  UPDATE public.purchase_returns
  SET journal_entry_id = v_je_id
  WHERE id = v_return_id;
  
  -- ============================================================
  -- STEP 10: Build result and finalize
  -- ============================================================
  v_result := jsonb_build_object(
    'success', true,
    'returnId', v_return_id,
    'returnNumber', v_return_number,
    'status', 'posted',
    'journalEntryId', v_je_id,
    'journalEntryNumber', v_je_number,
    'totals', jsonb_build_object(
      'subtotal', v_subtotal,
      'tax', v_tax_amount,
      'total', v_total_amount
    ),
    'meta', jsonb_build_object(
      'workflowType', 'purchase_return_unique_create_atomic',
      'clientRequestId', v_client_request_id
    )
  );
  
  PERFORM public.core_workflow_success(v_client_request_id, v_return_id, v_result);
  
  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  PERFORM public.core_workflow_failed(v_client_request_id, 'DB_ERROR', SQLERRM);
  RETURN jsonb_build_object(
    'success', false,
    'error_code', 'DB_ERROR',
    'error', SQLERRM
  );
END;
$$;

-- ============================================================
-- 2) purchase_return_general_create_atomic (CANONICAL)
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_purchase_return_general_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
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
    'purchase_return_general_create_atomic',  -- CORRECT workflow_type
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
  v_return_number := public.generate_purchase_return_number();
  v_je_number := public.generate_journal_entry_number();
  
  -- ============================================================
  -- STEP 4: Process items and calculate totals
  -- ============================================================
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_invoice_line_id := (v_item->>'invoice_line_id')::uuid;
    v_description := COALESCE(v_item->>'description', 'مرتجع عام');
    v_quantity := COALESCE((v_item->>'quantity')::numeric, 1);
    v_unit_price := COALESCE((v_item->>'unit_price')::numeric, 0);
    v_discount_amount := COALESCE((v_item->>'discount_amount')::numeric, 0);
    v_tax_rate := COALESCE((v_item->>'tax_rate')::numeric, 0);
    
    -- Calculate line amounts
    v_line_net := (v_quantity * v_unit_price) - v_discount_amount;
    v_line_tax := v_line_net * v_tax_rate;
    v_line_total := v_line_net + v_line_tax;
    
    v_subtotal := v_subtotal + v_line_net;
    v_tax_amount := v_tax_amount + v_line_tax;
    v_total_amount := v_total_amount + v_line_total;
  END LOOP;
  
  -- ============================================================
  -- STEP 5: Get accounting accounts from system_account_mappings
  -- ============================================================
  SELECT id INTO v_ap_account_id
  FROM public.chart_of_accounts
  WHERE account_code = '2101'
  LIMIT 1;
  
  -- Try to get supplier-specific account
  SELECT account_id INTO v_ap_account_id
  FROM public.suppliers
  WHERE id = v_supplier_id AND account_id IS NOT NULL;
  
  IF v_ap_account_id IS NULL THEN
    SELECT account_id INTO v_ap_account_id
    FROM public.system_account_mappings
    WHERE role_key = 'PAYABLES_PARENT'
    LIMIT 1;
  END IF;
  
  SELECT account_id INTO v_inventory_account_id
  FROM public.system_account_mappings
  WHERE role_key = 'INVENTORY_ASSET'
  LIMIT 1;
  
  SELECT account_id INTO v_vat_account_id
  FROM public.system_account_mappings
  WHERE role_key = 'VAT_INPUT'
  LIMIT 1;
  
  -- ============================================================
  -- STEP 6: Insert purchase_returns header
  -- ============================================================
  INSERT INTO public.purchase_returns (
    id,
    return_number,
    supplier_id,
    purchase_invoice_id,
    branch_id,
    return_date,
    subtotal,
    tax_amount,
    total_amount,
    status,
    reason,
    notes,
    processed_by,
    created_at,
    updated_at
  ) VALUES (
    v_return_id,
    v_return_number,
    v_supplier_id,
    v_purchase_invoice_id,
    v_branch_id,
    v_return_date,
    v_subtotal,
    v_tax_amount,
    v_total_amount,
    'posted',
    v_reason,
    v_notes,
    v_user_name,
    now(),
    now()
  );
  
  -- ============================================================
  -- STEP 7: Insert purchase_return_items (no inventory for general)
  -- ============================================================
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_invoice_line_id := (v_item->>'invoice_line_id')::uuid;
    v_description := COALESCE(v_item->>'description', 'مرتجع عام');
    v_quantity := COALESCE((v_item->>'quantity')::numeric, 1);
    v_unit_price := COALESCE((v_item->>'unit_price')::numeric, 0);
    v_discount_amount := COALESCE((v_item->>'discount_amount')::numeric, 0);
    v_tax_rate := COALESCE((v_item->>'tax_rate')::numeric, 0);
    
    v_line_net := (v_quantity * v_unit_price) - v_discount_amount;
    v_line_tax := v_line_net * v_tax_rate;
    v_line_total := v_line_net + v_line_tax;
    
    -- Insert return item (no jewelry_item_id for general returns)
    INSERT INTO public.purchase_return_items (
      id,
      return_id,
      product_id,
      invoice_line_id,
      description,
      quantity,
      unit_price,
      discount_amount,
      tax_rate,
      tax_amount,
      total_amount,
      created_at
    ) VALUES (
      gen_random_uuid(),
      v_return_id,
      v_product_id,
      v_invoice_line_id,
      v_description,
      v_quantity,
      v_unit_price,
      v_discount_amount,
      v_tax_rate,
      v_line_tax,
      v_line_total,
      now()
    );
  END LOOP;
  
  -- ============================================================
  -- STEP 8: Create Journal Entry (CANONICAL columns)
  -- ============================================================
  INSERT INTO public.journal_entries (
    id,
    entry_number,
    entry_date,
    description,
    reference_type,
    reference_id,
    branch_id,
    is_posted,
    posted_at,
    posted_by,
    total_debit,
    total_credit,
    created_by,
    created_at,
    updated_at,
    is_reversed
  ) VALUES (
    v_je_id,
    v_je_number,
    v_return_date,
    COALESCE(v_journal_data->>'description', 'قيد مرتجع مشتريات عام: ' || v_return_number),
    'purchase_return',
    v_return_id,
    v_branch_id,
    true,
    now(),
    v_user_name,
    v_total_amount,
    v_total_amount,
    v_user_name,
    now(),
    now(),
    false
  );
  
  -- JE Lines: Debit AP (reduce payable) = total_amount
  INSERT INTO public.journal_entry_lines (
    id,
    journal_entry_id,
    account_id,
    debit_amount,
    credit_amount,
    description,
    created_at
  ) VALUES (
    gen_random_uuid(),
    v_je_id,
    v_ap_account_id,
    v_total_amount,
    0,
    'مدين: ذمم الموردين - مرتجع عام ' || v_return_number,
    now()
  );
  
  -- JE Lines: Credit Inventory = subtotal
  INSERT INTO public.journal_entry_lines (
    id,
    journal_entry_id,
    account_id,
    debit_amount,
    credit_amount,
    description,
    created_at
  ) VALUES (
    gen_random_uuid(),
    v_je_id,
    v_inventory_account_id,
    0,
    v_subtotal,
    'دائن: المخزون - مرتجع عام ' || v_return_number,
    now()
  );
  
  -- JE Lines: Credit VAT Input = tax_amount (if > 0)
  IF v_tax_amount > 0 AND v_vat_account_id IS NOT NULL THEN
    INSERT INTO public.journal_entry_lines (
      id,
      journal_entry_id,
      account_id,
      debit_amount,
      credit_amount,
      description,
      created_at
    ) VALUES (
      gen_random_uuid(),
      v_je_id,
      v_vat_account_id,
      0,
      v_tax_amount,
      'دائن: ضريبة المدخلات - مرتجع عام ' || v_return_number,
      now()
    );
  END IF;
  
  -- ============================================================
  -- STEP 9: Link JE to return
  -- ============================================================
  UPDATE public.purchase_returns
  SET journal_entry_id = v_je_id
  WHERE id = v_return_id;
  
  -- ============================================================
  -- STEP 10: Build result and finalize
  -- ============================================================
  v_result := jsonb_build_object(
    'success', true,
    'returnId', v_return_id,
    'returnNumber', v_return_number,
    'status', 'posted',
    'journalEntryId', v_je_id,
    'journalEntryNumber', v_je_number,
    'inventoryApplied', false,
    'totals', jsonb_build_object(
      'subtotal', v_subtotal,
      'tax', v_tax_amount,
      'total', v_total_amount
    ),
    'meta', jsonb_build_object(
      'workflowType', 'purchase_return_general_create_atomic',
      'clientRequestId', v_client_request_id
    )
  );
  
  PERFORM public.core_workflow_success(v_client_request_id, v_return_id, v_result);
  
  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  PERFORM public.core_workflow_failed(v_client_request_id, 'DB_ERROR', SQLERRM);
  RETURN jsonb_build_object(
    'success', false,
    'error_code', 'DB_ERROR',
    'error', SQLERRM
  );
END;
$$;

-- ============================================================
-- 3) Grants (authenticated only)
-- ============================================================
REVOKE ALL ON FUNCTION public.complete_purchase_return_unique_items_atomic(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_unique_items_atomic(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.complete_purchase_return_general_atomic(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_general_atomic(jsonb) TO authenticated;

-- ============================================================
-- 4) Verify workflow_types exist and are enabled
-- ============================================================
INSERT INTO public.workflow_types (code, description, is_enabled)
VALUES 
  ('purchase_return_unique_create_atomic', 'Atomic create unique/jewelry purchase return', true),
  ('purchase_return_general_create_atomic', 'Atomic create general/qty purchase return', true)
ON CONFLICT (code) DO UPDATE SET is_enabled = true;
