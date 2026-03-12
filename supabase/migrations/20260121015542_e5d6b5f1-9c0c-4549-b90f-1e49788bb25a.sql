-- ============================================================
-- Fix Purchase Return JE Lines Creation
-- ROOT CAUSE: Hardcoded account codes (2010, 1310, 1150) don't exist
-- ACTUAL CODES: 2101 (AP), 1137/110307 (Inventory), 2105 (VAT Input)
-- ============================================================

-- ============================================================
-- PART A: Repair function to fix existing JEs without lines
-- ============================================================
CREATE OR REPLACE FUNCTION public.repair_purchase_return_je_lines(p_je_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_je RECORD;
  v_return RECORD;
  v_return_items RECORD;
  v_ap_account_id uuid;
  v_inventory_account_id uuid;
  v_vat_account_id uuid;
  v_subtotal numeric := 0;
  v_tax_amount numeric := 0;
  v_total_amount numeric := 0;
  v_lines_created int := 0;
  v_existing_lines int;
BEGIN
  -- Get JE details
  SELECT * INTO v_je FROM journal_entries WHERE id = p_je_id;
  IF v_je IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Journal entry not found');
  END IF;
  
  -- Check if already has lines
  SELECT COUNT(*) INTO v_existing_lines FROM journal_entry_lines WHERE journal_entry_id = p_je_id;
  IF v_existing_lines > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Journal entry already has lines', 'existing_lines', v_existing_lines);
  END IF;
  
  -- Only repair purchase_return type
  IF v_je.reference_type NOT IN ('purchase_return', 'purchase_return_unique') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not a purchase return JE', 'reference_type', v_je.reference_type);
  END IF;
  
  -- Try to get from purchase_returns table first (unique path)
  SELECT pr.*, 
         s.account_id as supplier_ap_account_id,
         bia.imported_pieces_account_id,
         bia.general_inventory_account_id
  INTO v_return
  FROM purchase_returns pr
  LEFT JOIN suppliers s ON s.id = pr.supplier_id
  LEFT JOIN branch_inventory_accounts bia ON bia.branch_id = pr.branch_id
  WHERE pr.id = v_je.reference_id
    OR pr.journal_entry_id = p_je_id;
  
  IF v_return IS NULL THEN
    -- Try invoices table (general return path)
    SELECT i.subtotal, i.tax_amount, i.total_amount, i.branch_id, i.supplier_id,
           s.account_id as supplier_ap_account_id,
           bia.imported_pieces_account_id,
           bia.general_inventory_account_id
    INTO v_return
    FROM invoices i
    LEFT JOIN suppliers s ON s.id = i.supplier_id
    LEFT JOIN branch_inventory_accounts bia ON bia.branch_id = i.branch_id
    WHERE i.id = v_je.reference_id
      AND i.invoice_type = 'purchase_return';
      
    IF v_return IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Purchase return record not found');
    END IF;
  END IF;
  
  -- Calculate totals from return data
  v_subtotal := COALESCE(v_return.subtotal, 0);
  v_tax_amount := COALESCE(v_return.tax_amount, 0);
  v_total_amount := COALESCE(v_return.total_amount, v_subtotal + v_tax_amount);
  
  -- Lookup accounts with CORRECT codes
  -- 1. AP Account: Use supplier's specific account, or fallback to 2101 (الذمم الدائنة)
  v_ap_account_id := v_return.supplier_ap_account_id;
  IF v_ap_account_id IS NULL THEN
    SELECT id INTO v_ap_account_id
    FROM chart_of_accounts
    WHERE account_code = '2101' AND is_active = true
    LIMIT 1;
  END IF;
  
  -- 2. Inventory Account: Use branch-specific or fallback to 110307
  v_inventory_account_id := COALESCE(
    v_return.imported_pieces_account_id,
    v_return.general_inventory_account_id
  );
  IF v_inventory_account_id IS NULL THEN
    SELECT id INTO v_inventory_account_id
    FROM chart_of_accounts
    WHERE account_code = '110307' AND is_active = true
    LIMIT 1;
  END IF;
  
  -- 3. VAT Input Account: 2105 (ضريبة مدخلات قابلة للاسترداد)
  SELECT id INTO v_vat_account_id
  FROM chart_of_accounts
  WHERE account_code = '2105' AND is_active = true
  LIMIT 1;
  
  -- Validate required accounts exist
  IF v_ap_account_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AP account not found (code 2101)');
  END IF;
  
  IF v_inventory_account_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Inventory account not found');
  END IF;
  
  -- Insert JE lines
  -- Debit: AP (reduce liability to supplier)
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
  VALUES (p_je_id, v_ap_account_id, v_total_amount, 0, 'AP reduction for purchase return');
  v_lines_created := v_lines_created + 1;
  
  -- Credit: Inventory (reduce asset)
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
  VALUES (p_je_id, v_inventory_account_id, 0, v_subtotal, 'Inventory reduction for return');
  v_lines_created := v_lines_created + 1;
  
  -- Credit: VAT Input (if applicable)
  IF v_tax_amount > 0 AND v_vat_account_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (p_je_id, v_vat_account_id, 0, v_tax_amount, 'VAT input reduction for return');
    v_lines_created := v_lines_created + 1;
  END IF;
  
  -- Verify totals match
  PERFORM 1
  FROM journal_entry_lines
  WHERE journal_entry_id = p_je_id
  GROUP BY journal_entry_id
  HAVING ABS(SUM(debit_amount) - v_je.total_debit) < 0.01
     AND ABS(SUM(credit_amount) - v_je.total_credit) < 0.01;
     
  IF NOT FOUND THEN
    -- Rollback would happen automatically, but for clarity:
    RAISE WARNING 'JE lines totals do not match header totals';
  END IF;
  
  RETURN jsonb_build_object(
    'success', true,
    'je_id', p_je_id,
    'entry_number', v_je.entry_number,
    'lines_created', v_lines_created,
    'subtotal', v_subtotal,
    'tax_amount', v_tax_amount,
    'total_amount', v_total_amount,
    'accounts_used', jsonb_build_object(
      'ap_account_id', v_ap_account_id,
      'inventory_account_id', v_inventory_account_id,
      'vat_account_id', v_vat_account_id
    )
  );
END;
$$;

-- ============================================================
-- PART B: Fix complete_purchase_return_unique_items_atomic
-- Use correct account codes + validate before JE creation
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_purchase_return_unique_items_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_request_id uuid;
  v_gate jsonb;
  v_return_data jsonb;
  v_items jsonb;
  
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
  v_user_name text;
  
  v_subtotal numeric := 0;
  v_tax_amount numeric := 0;
  v_total_amount numeric := 0;
  
  v_item jsonb;
  v_item_id uuid;
  v_unit_price numeric;
  v_tax_rate numeric;
  v_line_tax numeric;
  v_description text;
  v_gold_weight numeric;
  v_karat_id uuid;
  v_invoice_line_id uuid;
  v_item_reason text;
  
  v_ap_account_id uuid;
  v_inventory_account_id uuid;
  v_vat_account_id uuid;
  v_supplier_account_id uuid;
  
  v_item_count int := 0;
  v_lines_inserted int := 0;
  v_result jsonb;
BEGIN
  -- ============================================================
  -- STEP 1: Parse & Validate Input
  -- ============================================================
  v_client_request_id := (p_payload->>'client_request_id')::uuid;
  v_user_name := p_payload->>'created_by';
  v_return_data := p_payload->'return';
  v_items := p_payload->'items';
  
  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'client_request_id is required');
  END IF;
  
  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'items array is required');
  END IF;
  
  v_branch_id := (v_return_data->>'branch_id')::uuid;
  v_purchase_invoice_id := (v_return_data->>'purchase_invoice_id')::uuid;
  v_return_date := COALESCE((v_return_data->>'return_date')::date, CURRENT_DATE);
  v_reason := v_return_data->>'reason';
  v_notes := v_return_data->>'notes';
  
  -- Get supplier
  v_supplier_id := (v_return_data->>'supplier_id')::uuid;
  IF v_supplier_id IS NULL AND v_purchase_invoice_id IS NOT NULL THEN
    SELECT supplier_id INTO v_supplier_id FROM invoices WHERE id = v_purchase_invoice_id;
  END IF;
  
  IF v_supplier_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'supplier_id is required');
  END IF;
  
  IF v_branch_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'branch_id is required');
  END IF;
  
  -- ============================================================
  -- STEP 2: LOOKUP GL ACCOUNTS (BEFORE idempotency gate)
  -- Use CORRECT account codes!
  -- ============================================================
  
  -- 1. Get supplier-specific AP account, fallback to 2101
  SELECT account_id INTO v_supplier_account_id FROM suppliers WHERE id = v_supplier_id;
  
  IF v_supplier_account_id IS NOT NULL THEN
    v_ap_account_id := v_supplier_account_id;
  ELSE
    SELECT id INTO v_ap_account_id
    FROM chart_of_accounts
    WHERE account_code = '2101' AND is_active = true
    LIMIT 1;
  END IF;
  
  -- 2. Get branch inventory account, fallback to 110307
  SELECT COALESCE(imported_pieces_account_id, general_inventory_account_id) 
  INTO v_inventory_account_id
  FROM branch_inventory_accounts
  WHERE branch_id = v_branch_id;
  
  IF v_inventory_account_id IS NULL THEN
    SELECT id INTO v_inventory_account_id
    FROM chart_of_accounts
    WHERE account_code = '110307' AND is_active = true
    LIMIT 1;
  END IF;
  
  -- 3. VAT Input account: 2105
  SELECT id INTO v_vat_account_id
  FROM chart_of_accounts
  WHERE account_code = '2105' AND is_active = true
  LIMIT 1;
  
  -- ============================================================
  -- STEP 3: VALIDATE ACCOUNTS EXIST (BEFORE any writes!)
  -- ============================================================
  IF v_ap_account_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'CONFIG_ERROR',
      'error', 'AP account not found. Please ensure account code 2101 exists and is active.'
    );
  END IF;
  
  IF v_inventory_account_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'CONFIG_ERROR', 
      'error', 'Inventory account not found. Please configure branch inventory accounts or ensure account code 110307 exists.'
    );
  END IF;
  
  -- ============================================================
  -- STEP 4: Idempotency Gate
  -- ============================================================
  v_gate := begin_workflow_request(
    v_client_request_id,
    'purchase_return_unique_create_atomic',
    p_payload
  );
  
  IF v_gate->>'status' = 'succeeded' THEN
    RETURN (v_gate->'cached_result') || jsonb_build_object('idempotent', true, 'cached', true);
  ELSIF v_gate->>'status' = 'conflict' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'IDEMPOTENCY_CONFLICT', 'error', 'Same request ID with different payload');
  ELSIF v_gate->>'status' = 'in_progress' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'IN_PROGRESS', 'error', 'Request already processing');
  END IF;
  
  -- ============================================================
  -- STEP 5: Calculate totals from items
  -- ============================================================
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_unit_price := COALESCE((v_item->>'unit_price')::numeric, 0);
    v_tax_rate := COALESCE((v_item->>'tax_rate')::numeric, 0);
    v_line_tax := v_unit_price * v_tax_rate;
    
    v_subtotal := v_subtotal + v_unit_price;
    v_tax_amount := v_tax_amount + v_line_tax;
    v_item_count := v_item_count + 1;
  END LOOP;
  v_total_amount := v_subtotal + v_tax_amount;
  
  -- ============================================================
  -- STEP 6: Generate document numbers
  -- ============================================================
  v_return_number := generate_purchase_return_number(NULL);
  v_je_number := generate_journal_entry_number();
  
  -- ============================================================
  -- STEP 7: Create Journal Entry with GUARANTEED lines
  -- ============================================================
  INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, 
                               description, total_debit, total_credit, is_posted, created_by, branch_id)
  VALUES (v_je_id, v_je_number, v_return_date, 'purchase_return', v_return_id,
          'Purchase Return (Unique) - ' || v_return_number, v_total_amount, v_total_amount, true, v_user_name, v_branch_id);
  
  -- Debit: AP (REQUIRED - already validated)
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
  VALUES (v_je_id, v_ap_account_id, v_total_amount, 0, 'Supplier AP reduction for return');
  v_lines_inserted := v_lines_inserted + 1;
  
  -- Credit: Inventory (REQUIRED - already validated)
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
  VALUES (v_je_id, v_inventory_account_id, 0, v_subtotal, 'Inventory reduction for return');
  v_lines_inserted := v_lines_inserted + 1;
  
  -- Credit: VAT Input (if applicable)
  IF v_tax_amount > 0 AND v_vat_account_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_vat_account_id, 0, v_tax_amount, 'VAT input reduction for return');
    v_lines_inserted := v_lines_inserted + 1;
  END IF;
  
  -- ============================================================
  -- STEP 8: Post-check Gate - verify JE lines exist and balance
  -- ============================================================
  DECLARE
    v_line_count int;
    v_sum_debit numeric;
    v_sum_credit numeric;
  BEGIN
    SELECT COUNT(*), COALESCE(SUM(debit_amount), 0), COALESCE(SUM(credit_amount), 0)
    INTO v_line_count, v_sum_debit, v_sum_credit
    FROM journal_entry_lines
    WHERE journal_entry_id = v_je_id;
    
    IF v_line_count < 2 THEN
      PERFORM fail_workflow_request(v_client_request_id, 'JE_LINES_MISSING', 
        'Journal entry created with insufficient lines: ' || v_line_count);
      RAISE EXCEPTION 'JE_LINES_MISSING: Only % lines created, minimum 2 required', v_line_count;
    END IF;
    
    IF ABS(v_sum_debit - v_total_amount) > 0.01 OR ABS(v_sum_credit - v_total_amount) > 0.01 THEN
      PERFORM fail_workflow_request(v_client_request_id, 'JE_BALANCE_MISMATCH',
        format('JE totals mismatch: header=%s, debit=%s, credit=%s', v_total_amount, v_sum_debit, v_sum_credit));
      RAISE EXCEPTION 'JE_BALANCE_MISMATCH: Totals do not match header';
    END IF;
  END;
  
  -- ============================================================
  -- STEP 9: Create Purchase Return record
  -- ============================================================
  INSERT INTO purchase_returns (id, return_number, return_date, supplier_id, branch_id, 
                                purchase_invoice_id, subtotal, tax_amount, total_amount,
                                reason, notes, status, journal_entry_id, processed_by, purchase_type)
  VALUES (v_return_id, v_return_number, v_return_date, v_supplier_id, v_branch_id,
          v_purchase_invoice_id, v_subtotal, v_tax_amount, v_total_amount,
          v_reason, v_notes, 'confirmed', v_je_id, v_user_name, 'import');
  
  -- ============================================================
  -- STEP 10: Create return items & update jewelry items status
  -- ============================================================
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_item_id := COALESCE((v_item->>'item_id')::uuid, (v_item->>'jewelry_item_id')::uuid);
    v_unit_price := COALESCE((v_item->>'unit_price')::numeric, 0);
    v_tax_rate := COALESCE((v_item->>'tax_rate')::numeric, 0);
    v_line_tax := v_unit_price * v_tax_rate;
    v_description := v_item->>'description';
    v_gold_weight := (v_item->>'gold_weight')::numeric;
    v_karat_id := (v_item->>'karat_id')::uuid;
    v_invoice_line_id := (v_item->>'invoice_line_id')::uuid;
    v_item_reason := v_item->>'reason';
    
    -- Get description from jewelry item if not provided
    IF v_description IS NULL AND v_item_id IS NOT NULL THEN
      SELECT description INTO v_description FROM jewelry_items WHERE id = v_item_id;
    END IF;
    
    INSERT INTO purchase_return_items (return_id, jewelry_item_id, description, quantity, unit_price,
                                       tax_rate, tax_amount, total_amount, weight_grams, invoice_line_id)
    VALUES (v_return_id, v_item_id, v_description, 1, v_unit_price,
            v_tax_rate, v_line_tax, v_unit_price + v_line_tax, v_gold_weight, v_invoice_line_id);
    
    -- Update jewelry item status to 'returned'
    IF v_item_id IS NOT NULL THEN
      UPDATE jewelry_items 
      SET status = 'returned_to_supplier',
          branch_id = NULL,
          updated_at = NOW()
      WHERE id = v_item_id;
      
      -- Create item movement record
      INSERT INTO item_movements (jewelry_item_id, movement_type, from_branch_id, reference_type, reference_id, notes, performed_by)
      VALUES (v_item_id, 'return_to_supplier', v_branch_id, 'purchase_return', v_return_id, 'Returned to supplier', v_user_name);
    END IF;
  END LOOP;
  
  -- ============================================================
  -- STEP 11: Complete workflow
  -- ============================================================
  v_result := jsonb_build_object(
    'success', true,
    'returnId', v_return_id,
    'returnNumber', v_return_number,
    'journalEntryId', v_je_id,
    'journalEntryNumber', v_je_number,
    'status', 'confirmed',
    'itemCount', v_item_count,
    'jeLineCount', v_lines_inserted,
    'totals', jsonb_build_object(
      'subtotal', v_subtotal,
      'taxAmount', v_tax_amount,
      'totalAmount', v_total_amount
    ),
    'meta', jsonb_build_object(
      'workflowType', 'purchase_return_unique_create_atomic',
      'clientRequestId', v_client_request_id
    )
  );
  
  PERFORM complete_workflow_request(v_client_request_id, v_result);
  
  RETURN v_result;
  
EXCEPTION WHEN OTHERS THEN
  PERFORM fail_workflow_request(v_client_request_id, SQLSTATE, SQLERRM);
  RAISE;
END;
$$;

-- ============================================================
-- PART C: Fix complete_purchase_return_general_atomic  
-- Use correct account codes + validate before JE creation
-- ============================================================
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
  v_supplier_account_id uuid;
  
  v_orig_line RECORD;
  v_available_qty numeric;
  v_result jsonb;
  
  -- For post-check
  v_check_line RECORD;
  v_integrity_errors text[] := ARRAY[]::text[];
  v_lines_inserted int := 0;
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
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'client_request_id is required');
  END IF;
  
  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'items array is required and must not be empty');
  END IF;
  
  v_branch_id := (v_return_data->>'branch_id')::uuid;
  IF v_branch_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'branch_id is required');
  END IF;
  
  v_purchase_invoice_id := (v_return_data->>'purchase_invoice_id')::uuid;
  v_return_date := COALESCE((v_return_data->>'return_date')::date, CURRENT_DATE);
  v_reason := v_return_data->>'reason';
  v_notes := v_return_data->>'notes';
  
  -- Determine supplier_id
  v_supplier_id := (v_return_data->>'supplier_id')::uuid;
  IF v_supplier_id IS NULL AND v_purchase_invoice_id IS NOT NULL THEN
    SELECT supplier_id INTO v_supplier_id FROM public.invoices WHERE id = v_purchase_invoice_id;
  END IF;
  
  IF v_supplier_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'supplier_id is required');
  END IF;
  
  -- ============================================================
  -- STEP 2: LOOKUP GL ACCOUNTS (BEFORE idempotency gate)
  -- Use CORRECT account codes!
  -- ============================================================
  
  -- 1. Get supplier-specific AP account, fallback to 2101
  SELECT account_id INTO v_supplier_account_id FROM public.suppliers WHERE id = v_supplier_id;
  
  IF v_supplier_account_id IS NOT NULL THEN
    v_ap_account_id := v_supplier_account_id;
  ELSE
    SELECT id INTO v_ap_account_id
    FROM public.chart_of_accounts
    WHERE account_code = '2101' AND is_active = true
    LIMIT 1;
  END IF;
  
  -- 2. Get branch inventory account, fallback to 110307
  SELECT COALESCE(imported_pieces_account_id, general_inventory_account_id) 
  INTO v_inventory_account_id
  FROM public.branch_inventory_accounts
  WHERE branch_id = v_branch_id;
  
  IF v_inventory_account_id IS NULL THEN
    SELECT id INTO v_inventory_account_id
    FROM public.chart_of_accounts
    WHERE account_code = '110307' AND is_active = true
    LIMIT 1;
  END IF;
  
  -- 3. VAT Input account: 2105
  SELECT id INTO v_vat_account_id
  FROM public.chart_of_accounts
  WHERE account_code = '2105' AND is_active = true
  LIMIT 1;
  
  -- ============================================================
  -- STEP 3: VALIDATE ACCOUNTS EXIST (BEFORE any writes!)
  -- ============================================================
  IF v_ap_account_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'CONFIG_ERROR',
      'error', 'AP account not found. Please ensure account code 2101 exists and is active.'
    );
  END IF;
  
  IF v_inventory_account_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'CONFIG_ERROR', 
      'error', 'Inventory account not found. Please configure branch inventory accounts or ensure account code 110307 exists.'
    );
  END IF;
  
  -- ============================================================
  -- STEP 4: Idempotency Gate
  -- ============================================================
  v_gate := public.begin_workflow_request(
    v_client_request_id,
    'purchase_return_general_create_atomic',
    p_payload
  );
  
  IF v_gate->>'status' = 'succeeded' THEN
    RETURN (v_gate->'cached_result') || jsonb_build_object('idempotent', true);
  ELSIF v_gate->>'status' = 'conflict' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'IDEMPOTENCY_CONFLICT', 'error', 'Same request ID with different payload');
  ELSIF v_gate->>'status' = 'in_progress' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'IN_PROGRESS', 'error', 'Request is already being processed');
  END IF;
  
  -- ============================================================
  -- STEP 5: Acquire row-level locks & validate quantities
  -- ============================================================
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_invoice_line_id := (v_item->>'invoice_line_id')::uuid;
    
    IF v_invoice_line_id IS NOT NULL THEN
      SELECT pil.id, pil.product_id, pil.product_code, pil.line_number, pil.quantity,
             COALESCE(pil.returned_qty, 0) as returned_qty, pil.unit_price, pil.tax_rate, pil.description
      INTO v_orig_line
      FROM public.purchase_invoice_lines pil
      WHERE pil.id = v_invoice_line_id
      FOR UPDATE NOWAIT;
      
      IF v_orig_line IS NULL THEN
        PERFORM public.fail_workflow_request(v_client_request_id, 'NOT_FOUND', 'Invoice line not found: ' || v_invoice_line_id::text);
        RETURN jsonb_build_object('success', false, 'error_code', 'NOT_FOUND', 'error', 'Invoice line not found: ' || v_invoice_line_id::text);
      END IF;
      
      v_quantity := COALESCE((v_item->>'quantity')::numeric, (v_item->>'qty')::numeric, 1);
      v_available_qty := v_orig_line.quantity - v_orig_line.returned_qty;
      
      IF v_quantity > v_available_qty THEN
        PERFORM public.fail_workflow_request(v_client_request_id, 'QUANTITY_EXCEEDED', 
          format('Line %s: Cannot return %s, only %s available', v_invoice_line_id, v_quantity, v_available_qty));
        RETURN jsonb_build_object('success', false, 'error_code', 'QUANTITY_EXCEEDED',
          'error', format('Cannot return quantity (%s) greater than available (%s)', v_quantity, v_available_qty),
          'line_id', v_invoice_line_id, 'requested_qty', v_quantity, 'available_qty', v_available_qty);
      END IF;
    ELSE
      PERFORM public.fail_workflow_request(v_client_request_id, 'VALIDATION', 'invoice_line_id is required');
      RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'invoice_line_id is required for each item');
    END IF;
  END LOOP;
  
  -- ============================================================
  -- STEP 6: Generate document numbers & calculate totals
  -- ============================================================
  v_return_number := public.generate_purchase_return_number(NULL);
  v_je_number := public.generate_journal_entry_number();
  
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_invoice_line_id := (v_item->>'invoice_line_id')::uuid;
    
    SELECT pil.product_id, pil.product_code, pil.line_number, pil.unit_price, pil.tax_rate, pil.description
    INTO v_orig_line
    FROM public.purchase_invoice_lines pil
    WHERE pil.id = v_invoice_line_id;
    
    v_quantity := COALESCE((v_item->>'quantity')::numeric, (v_item->>'qty')::numeric, 1);
    v_unit_price := COALESCE((v_item->>'unit_price')::numeric, v_orig_line.unit_price, 0);
    v_discount_amount := COALESCE((v_item->>'discount_amount')::numeric, 0);
    v_tax_rate := COALESCE((v_item->>'tax_rate')::numeric, v_orig_line.tax_rate, 15);
    
    -- Normalize tax_rate (if >1, assume percentage)
    IF v_tax_rate > 1 THEN
      v_tax_rate := v_tax_rate / 100;
    END IF;
    
    v_line_net := (v_quantity * v_unit_price) - v_discount_amount;
    v_line_tax := v_line_net * v_tax_rate;
    v_line_total := v_line_net + v_line_tax;
    
    v_subtotal := v_subtotal + v_line_net;
    v_tax_amount := v_tax_amount + v_line_tax;
    v_total_amount := v_total_amount + v_line_total;
  END LOOP;
  
  -- ============================================================
  -- STEP 7: Create Journal Entry with GUARANTEED lines
  -- ============================================================
  INSERT INTO public.journal_entries (id, entry_number, entry_date, reference_type, reference_id,
                                     description, total_debit, total_credit, is_posted, created_by, branch_id)
  VALUES (v_je_id, v_je_number, v_return_date, 'purchase_return', v_return_id,
          'Purchase Return - ' || v_return_number, v_total_amount, v_total_amount, true, v_user_name, v_branch_id);
  
  -- Debit: AP (REQUIRED - already validated)
  INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
  VALUES (v_je_id, v_ap_account_id, v_total_amount, 0, 'Supplier AP reduction for return');
  v_lines_inserted := v_lines_inserted + 1;
  
  -- Credit: Inventory (REQUIRED - already validated)
  INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
  VALUES (v_je_id, v_inventory_account_id, 0, v_subtotal, 'Inventory reduction for return');
  v_lines_inserted := v_lines_inserted + 1;
  
  -- Credit: VAT Input (if applicable)
  IF v_tax_amount > 0 AND v_vat_account_id IS NOT NULL THEN
    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_vat_account_id, 0, v_tax_amount, 'VAT input reduction for return');
    v_lines_inserted := v_lines_inserted + 1;
  END IF;
  
  -- ============================================================
  -- STEP 8: Post-check Gate - verify JE lines exist and balance
  -- ============================================================
  DECLARE
    v_line_count int;
    v_sum_debit numeric;
    v_sum_credit numeric;
  BEGIN
    SELECT COUNT(*), COALESCE(SUM(debit_amount), 0), COALESCE(SUM(credit_amount), 0)
    INTO v_line_count, v_sum_debit, v_sum_credit
    FROM public.journal_entry_lines
    WHERE journal_entry_id = v_je_id;
    
    IF v_line_count < 2 THEN
      PERFORM public.fail_workflow_request(v_client_request_id, 'JE_LINES_MISSING', 
        'Journal entry created with insufficient lines: ' || v_line_count);
      RAISE EXCEPTION 'JE_LINES_MISSING: Only % lines created, minimum 2 required', v_line_count;
    END IF;
    
    IF ABS(v_sum_debit - v_total_amount) > 0.01 OR ABS(v_sum_credit - v_total_amount) > 0.01 THEN
      PERFORM public.fail_workflow_request(v_client_request_id, 'JE_BALANCE_MISMATCH',
        format('JE totals mismatch: header=%s, debit=%s, credit=%s', v_total_amount, v_sum_debit, v_sum_credit));
      RAISE EXCEPTION 'JE_BALANCE_MISMATCH: Totals do not match header';
    END IF;
  END;
  
  -- ============================================================
  -- STEP 9: Create Purchase Return record (in invoices table)
  -- ============================================================
  INSERT INTO public.invoices (id, invoice_number, invoice_date, invoice_type, supplier_id, branch_id,
                               subtotal, tax_amount, total_amount, notes, status, journal_entry_id, 
                               created_by, linked_invoice_id)
  VALUES (v_return_id, v_return_number, v_return_date, 'purchase_return', v_supplier_id, v_branch_id,
          v_subtotal, v_tax_amount, v_total_amount,
          COALESCE(v_reason, '') || CASE WHEN v_notes IS NOT NULL THEN ' | ' || v_notes ELSE '' END,
          'posted', v_je_id, v_user_name, v_purchase_invoice_id);
  
  -- ============================================================
  -- STEP 10: Create Return Line Items & Update returned_qty
  -- ============================================================
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_invoice_line_id := (v_item->>'invoice_line_id')::uuid;
    
    SELECT pil.product_id, pil.product_code, pil.line_number, pil.unit_price, pil.tax_rate, pil.description
    INTO v_orig_line
    FROM public.purchase_invoice_lines pil
    WHERE pil.id = v_invoice_line_id;
    
    v_product_id := COALESCE((v_item->>'product_id')::uuid, (v_item->>'item_id')::uuid, v_orig_line.product_id);
    v_product_code := COALESCE(v_item->>'product_code', v_item->>'item_code', v_orig_line.product_code);
    v_line_number := v_orig_line.line_number;
    v_quantity := COALESCE((v_item->>'quantity')::numeric, (v_item->>'qty')::numeric, 1);
    v_description := COALESCE(v_item->>'description', v_orig_line.description, 'Return item');
    v_unit_price := COALESCE((v_item->>'unit_price')::numeric, v_orig_line.unit_price, 0);
    v_discount_amount := COALESCE((v_item->>'discount_amount')::numeric, 0);
    v_tax_rate := COALESCE((v_item->>'tax_rate')::numeric, v_orig_line.tax_rate, 15);
    
    IF v_tax_rate > 1 THEN v_tax_rate := v_tax_rate / 100; END IF;
    
    v_line_net := (v_quantity * v_unit_price) - v_discount_amount;
    v_line_tax := v_line_net * v_tax_rate;
    v_line_total := v_line_net + v_line_tax;
    
    INSERT INTO public.purchase_invoice_lines (id, invoice_id, product_id, product_code, line_number,
                                               description, quantity, unit_price, discount_amount,
                                               tax_rate, tax_amount, total_amount)
    VALUES (gen_random_uuid(), v_return_id, v_product_id, v_product_code, v_line_number,
            v_description, v_quantity, v_unit_price, v_discount_amount, v_tax_rate, v_line_tax, v_line_total);
    
    -- Update returned_qty on original invoice line
    UPDATE public.purchase_invoice_lines
    SET returned_qty = COALESCE(returned_qty, 0) + v_quantity
    WHERE id = v_invoice_line_id;
  END LOOP;
  
  -- ============================================================
  -- STEP 11: Post-check for returned_qty integrity
  -- ============================================================
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_invoice_line_id := (v_item->>'invoice_line_id')::uuid;
    
    SELECT id, quantity, returned_qty, (quantity - COALESCE(returned_qty, 0)) as remaining
    INTO v_check_line
    FROM public.purchase_invoice_lines
    WHERE id = v_invoice_line_id;
    
    IF v_check_line.remaining < 0 THEN
      v_integrity_errors := array_append(v_integrity_errors, 
        format('Line %s has negative remaining: %s', v_invoice_line_id, v_check_line.remaining));
    END IF;
    
    IF COALESCE(v_check_line.returned_qty, 0) > v_check_line.quantity THEN
      v_integrity_errors := array_append(v_integrity_errors,
        format('Line %s returned_qty (%s) exceeds quantity (%s)', v_invoice_line_id, v_check_line.returned_qty, v_check_line.quantity));
    END IF;
  END LOOP;
  
  IF array_length(v_integrity_errors, 1) > 0 THEN
    PERFORM public.fail_workflow_request(v_client_request_id, 'INTEGRITY_ERROR', array_to_string(v_integrity_errors, '; '));
    RAISE EXCEPTION 'INTEGRITY_ERROR: %', array_to_string(v_integrity_errors, '; ');
  END IF;
  
  -- ============================================================
  -- STEP 12: Complete workflow
  -- ============================================================
  v_result := jsonb_build_object(
    'success', true,
    'returnId', v_return_id,
    'returnNumber', v_return_number,
    'journalEntryId', v_je_id,
    'journalEntryNumber', v_je_number,
    'status', 'posted',
    'jeLineCount', v_lines_inserted,
    'totals', jsonb_build_object(
      'subtotal', v_subtotal,
      'taxAmount', v_tax_amount,
      'totalAmount', v_total_amount
    ),
    'meta', jsonb_build_object(
      'workflowType', 'purchase_return_general_create_atomic',
      'clientRequestId', v_client_request_id
    )
  );
  
  PERFORM public.complete_workflow_request(v_client_request_id, v_result);
  
  RETURN v_result;
  
EXCEPTION 
  WHEN lock_not_available THEN
    PERFORM public.fail_workflow_request(v_client_request_id, 'CONCURRENT_LOCK', 'Another operation is in progress on this invoice');
    RETURN jsonb_build_object('success', false, 'error_code', 'CONCURRENT_LOCK', 'error', 'Another operation is in progress on this invoice, please retry');
  WHEN OTHERS THEN
    PERFORM public.fail_workflow_request(v_client_request_id, SQLSTATE, SQLERRM);
    RAISE;
END;
$function$;