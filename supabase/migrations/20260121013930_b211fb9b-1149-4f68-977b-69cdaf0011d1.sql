-- Fix complete_purchase_return_general_atomic to:
-- 1. Accept both 'item_id' and 'product_id' from payload
-- 2. Accept 'qty' or 'quantity' from payload
-- 3. Pass product_code and line_number to INSERT (for trigger validation)

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
  -- STEP 2: Idempotency Gate
  -- ============================================================
  v_gate := public.begin_workflow_request(
    v_client_request_id,
    'purchase_return_general_create_atomic',
    p_payload
  );
  
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
  
  -- ============================================================
  -- STEP 3: Generate document numbers
  -- ============================================================
  v_return_number := public.generate_purchase_return_number(NULL);
  v_je_number := public.generate_journal_entry_number();
  
  -- ============================================================
  -- STEP 4: Process items and calculate totals
  -- Also lookup original line data for proper trigger validation
  -- ============================================================
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_invoice_line_id := (v_item->>'invoice_line_id')::uuid;
    
    -- Accept both 'product_id' and 'item_id' for compatibility
    v_product_id := COALESCE(
      (v_item->>'product_id')::uuid,
      (v_item->>'item_id')::uuid
    );
    
    -- Accept 'item_code' as product_code
    v_product_code := COALESCE(v_item->>'product_code', v_item->>'item_code');
    
    -- Accept both 'quantity' and 'qty'
    v_quantity := COALESCE(
      (v_item->>'quantity')::numeric,
      (v_item->>'qty')::numeric,
      1
    );
    
    v_description := COALESCE(v_item->>'description', 'Return item');
    v_unit_price := COALESCE((v_item->>'unit_price')::numeric, 0);
    v_discount_amount := COALESCE((v_item->>'discount_amount')::numeric, 0);
    v_tax_rate := COALESCE((v_item->>'tax_rate')::numeric, 15);
    
    -- If invoice_line_id provided, lookup original line for missing data
    IF v_invoice_line_id IS NOT NULL THEN
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
      
      -- Fill missing values from original line
      IF v_orig_line IS NOT NULL THEN
        v_product_id := COALESCE(v_product_id, v_orig_line.product_id);
        v_product_code := COALESCE(v_product_code, v_orig_line.product_code);
        v_line_number := v_orig_line.line_number;
        v_unit_price := COALESCE(NULLIF(v_unit_price, 0), v_orig_line.unit_price);
        v_tax_rate := COALESCE(v_tax_rate, v_orig_line.tax_rate, 15);
        v_description := COALESCE(NULLIF(v_description, 'Return item'), v_orig_line.description, 'Return item');
      END IF;
    END IF;
    
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
  -- STEP 7: Create Purchase Return record
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
  -- STEP 8: Create Return Line Items WITH product_code and line_number
  -- This enables trigger validation to work correctly
  -- ============================================================
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_invoice_line_id := (v_item->>'invoice_line_id')::uuid;
    
    -- Accept both 'product_id' and 'item_id'
    v_product_id := COALESCE(
      (v_item->>'product_id')::uuid,
      (v_item->>'item_id')::uuid
    );
    v_product_code := COALESCE(v_item->>'product_code', v_item->>'item_code');
    v_line_number := NULL;
    
    -- Accept both 'quantity' and 'qty'
    v_quantity := COALESCE(
      (v_item->>'quantity')::numeric,
      (v_item->>'qty')::numeric,
      1
    );
    
    v_description := COALESCE(v_item->>'description', 'Return item');
    v_unit_price := COALESCE((v_item->>'unit_price')::numeric, 0);
    v_discount_amount := COALESCE((v_item->>'discount_amount')::numeric, 0);
    v_tax_rate := COALESCE((v_item->>'tax_rate')::numeric, 15);
    
    -- Lookup original line for missing data
    IF v_invoice_line_id IS NOT NULL THEN
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
      
      IF v_orig_line IS NOT NULL THEN
        v_product_id := COALESCE(v_product_id, v_orig_line.product_id);
        v_product_code := COALESCE(v_product_code, v_orig_line.product_code);
        v_line_number := v_orig_line.line_number;
        v_unit_price := COALESCE(NULLIF(v_unit_price, 0), v_orig_line.unit_price);
        v_tax_rate := COALESCE(v_tax_rate, v_orig_line.tax_rate, 15);
        v_description := COALESCE(NULLIF(v_description, 'Return item'), v_orig_line.description, 'Return item');
      END IF;
    END IF;
    
    v_line_net := (v_quantity * v_unit_price) - v_discount_amount;
    v_line_tax := v_line_net * (v_tax_rate / 100);
    v_line_total := v_line_net + v_line_tax;
    
    -- Insert with product_code and line_number for trigger validation
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
    
    -- Update returned_qty on original invoice line
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