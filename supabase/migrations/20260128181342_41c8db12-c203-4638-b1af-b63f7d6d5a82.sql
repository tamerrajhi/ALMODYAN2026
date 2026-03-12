-- ============================================================
-- D2-RET-GENERAL-FIX: Fix column mismatch in purchase_return_lines INSERT
-- product_id → item_id, product_code → REMOVED, unit_price → unit_cost,
-- discount_amount → REMOVED, tax_rate → vat_rate, reason → REMOVED
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
  v_dry_run boolean;
  
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
  v_material_id uuid;
  v_product_code text;
  v_line_number int := 0;
  v_invoice_line_id uuid;
  v_description text;
  v_quantity numeric;
  v_unit_price numeric;
  v_discount_amount numeric;
  v_tax_rate numeric;
  v_vat_rate_decimal numeric;
  v_line_net numeric;
  v_line_tax numeric;
  v_line_total numeric;
  v_item_type text;
  
  v_ap_account_id uuid;
  v_inventory_account_id uuid;
  v_vat_account_id uuid;
  v_supplier_account_id uuid;
  
  v_orig_line RECORD;
  v_available_qty numeric;
  v_result jsonb;
  
  v_check_line RECORD;
  v_integrity_errors text[] := ARRAY[]::text[];
  v_lines_inserted int := 0;
  v_movements_inserted int := 0;
  v_stock_updated int := 0;
  v_planned_lines jsonb := '[]'::jsonb;
BEGIN
  -- ============================================================
  -- STEP 1: Parse & Validate Input
  -- ============================================================
  v_client_request_id := (p_payload->>'client_request_id')::uuid;
  v_user_name := p_payload->>'created_by';
  v_return_data := p_payload->'return';
  v_items := p_payload->'items';
  v_journal_data := COALESCE(p_payload->'journal', '{}'::jsonb);
  v_dry_run := COALESCE((p_payload->>'dry_run')::boolean, false);
  
  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'client_request_id is required');
  END IF;
  
  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'items array is required');
  END IF;
  
  v_branch_id := (v_return_data->>'branch_id')::uuid;
  IF v_branch_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'branch_id is required');
  END IF;
  
  v_purchase_invoice_id := (v_return_data->>'purchase_invoice_id')::uuid;
  v_return_date := COALESCE((v_return_data->>'return_date')::date, CURRENT_DATE);
  v_reason := v_return_data->>'reason';
  v_notes := v_return_data->>'notes';
  
  v_supplier_id := (v_return_data->>'supplier_id')::uuid;
  IF v_supplier_id IS NULL AND v_purchase_invoice_id IS NOT NULL THEN
    SELECT supplier_id INTO v_supplier_id FROM public.invoices WHERE id = v_purchase_invoice_id;
  END IF;
  
  IF v_supplier_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'supplier_id is required');
  END IF;
  
  -- ============================================================
  -- STEP 1B: Guard - Reject jewelry_item_id
  -- ============================================================
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    IF v_item->>'jewelry_item_id' IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'WRONG_FLOW', 
        'error', 'jewelry_item_id detected - use Unique Return flow instead');
    END IF;
  END LOOP;
  
  -- ============================================================
  -- STEP 2: Lookup GL Accounts
  -- ============================================================
  SELECT account_id INTO v_supplier_account_id FROM public.suppliers WHERE id = v_supplier_id;
  
  IF v_supplier_account_id IS NOT NULL THEN
    v_ap_account_id := v_supplier_account_id;
  ELSE
    SELECT id INTO v_ap_account_id FROM public.chart_of_accounts WHERE account_code = '2101' AND is_active = true LIMIT 1;
  END IF;
  
  SELECT COALESCE(imported_pieces_account_id, general_inventory_account_id) INTO v_inventory_account_id
  FROM public.branch_inventory_accounts WHERE branch_id = v_branch_id;
  
  IF v_inventory_account_id IS NULL THEN
    SELECT id INTO v_inventory_account_id FROM public.chart_of_accounts WHERE account_code = '1301' AND is_active = true LIMIT 1;
  END IF;
  
  SELECT id INTO v_vat_account_id FROM public.chart_of_accounts WHERE account_code = '2103' AND is_active = true LIMIT 1;
  
  IF v_ap_account_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'CONFIG', 'error', 'AP account not configured');
  END IF;
  IF v_inventory_account_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'CONFIG', 'error', 'Inventory account not configured for branch');
  END IF;
  
  -- ============================================================
  -- STEP 3: Idempotency Gate
  -- ============================================================
  IF NOT v_dry_run THEN
    v_gate := public.begin_workflow_request(v_client_request_id, 'purchase_return_general');
    IF NOT (v_gate->>'is_new')::boolean THEN
      RETURN v_gate->'existing_result';
    END IF;
  END IF;
  
  -- ============================================================
  -- STEP 4: Validate items & lock invoice lines
  -- ============================================================
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_invoice_line_id := (v_item->>'invoice_line_id')::uuid;
    IF v_invoice_line_id IS NULL THEN
      IF NOT v_dry_run THEN
        PERFORM public.fail_workflow_request(v_client_request_id, 'VALIDATION', 'Missing invoice_line_id');
      END IF;
      RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'Each item must have invoice_line_id');
    END IF;
    
    IF v_dry_run THEN
      SELECT pil.id, pil.quantity, pil.returned_qty, pil.unit_price, pil.tax_rate, pil.product_id, pil.description, pil.item_type
      INTO v_orig_line
      FROM public.purchase_invoice_lines pil
      WHERE pil.id = v_invoice_line_id;
    ELSE
      SELECT pil.id, pil.quantity, pil.returned_qty, pil.unit_price, pil.tax_rate, pil.product_id, pil.description, pil.item_type
      INTO v_orig_line
      FROM public.purchase_invoice_lines pil
      WHERE pil.id = v_invoice_line_id
      FOR UPDATE NOWAIT;
    END IF;
    
    IF v_orig_line IS NULL THEN
      IF NOT v_dry_run THEN
        PERFORM public.fail_workflow_request(v_client_request_id, 'NOT_FOUND', 'Invoice line not found');
      END IF;
      RETURN jsonb_build_object('success', false, 'error_code', 'NOT_FOUND', 'error', 'Invoice line not found: ' || v_invoice_line_id::text);
    END IF;
    
    v_quantity := COALESCE((v_item->>'quantity')::numeric, (v_item->>'qty')::numeric, 1);
    v_available_qty := v_orig_line.quantity - v_orig_line.returned_qty;
    
    IF v_quantity > v_available_qty THEN
      IF NOT v_dry_run THEN
        PERFORM public.fail_workflow_request(v_client_request_id, 'QUANTITY_EXCEEDED', 
          format('Cannot return %s, only %s available', v_quantity, v_available_qty));
      END IF;
      RETURN jsonb_build_object('success', false, 'error_code', 'QUANTITY_EXCEEDED',
        'error', format('Cannot return quantity (%s) greater than available (%s)', v_quantity, v_available_qty),
        'line_id', v_invoice_line_id, 'requested_qty', v_quantity, 'available_qty', v_available_qty);
    END IF;
  END LOOP;
  
  -- ============================================================
  -- STEP 6: Generate document numbers & calculate totals
  -- ============================================================
  IF v_dry_run THEN
    v_return_number := 'DRY-RUN-' || to_char(now(), 'YYYYMMDD-HH24MISS');
    v_je_number := 'DRY-RUN-JE-' || to_char(now(), 'YYYYMMDD-HH24MISS');
  ELSE
    v_return_number := public.generate_purchase_return_number(NULL);
    v_je_number := public.generate_journal_entry_number();
  END IF;
  
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_invoice_line_id := (v_item->>'invoice_line_id')::uuid;
    
    SELECT pil.product_id, pil.product_code, pil.line_number, pil.unit_price, pil.tax_rate, pil.description, pil.item_type
    INTO v_orig_line
    FROM public.purchase_invoice_lines pil
    WHERE pil.id = v_invoice_line_id;
    
    v_quantity := COALESCE((v_item->>'quantity')::numeric, (v_item->>'qty')::numeric, 1);
    v_unit_price := COALESCE((v_item->>'unit_price')::numeric, v_orig_line.unit_price, 0);
    v_discount_amount := COALESCE((v_item->>'discount_amount')::numeric, 0);
    v_tax_rate := COALESCE((v_item->>'tax_rate')::numeric, v_orig_line.tax_rate, 15);
    
    IF v_tax_rate > 1 THEN 
      v_vat_rate_decimal := v_tax_rate / 100; 
    ELSE 
      v_vat_rate_decimal := v_tax_rate;
    END IF;
    
    v_line_net := (v_quantity * v_unit_price) - v_discount_amount;
    v_line_tax := v_line_net * v_vat_rate_decimal;
    v_line_total := v_line_net + v_line_tax;
    
    v_subtotal := v_subtotal + v_line_net;
    v_tax_amount := v_tax_amount + v_line_tax;
    v_total_amount := v_total_amount + v_line_total;
    
    v_line_number := v_line_number + 1;
    v_planned_lines := v_planned_lines || jsonb_build_object(
      'line_number', v_line_number,
      'invoice_line_id', v_invoice_line_id,
      'quantity', v_quantity,
      'unit_price', v_unit_price,
      'vat_rate', v_vat_rate_decimal,
      'line_tax', v_line_tax,
      'line_total', v_line_total
    );
  END LOOP;
  
  -- ============================================================
  -- DRY RUN: Return planned data without writes
  -- ============================================================
  IF v_dry_run THEN
    RETURN jsonb_build_object(
      'success', true,
      'dry_run', true,
      'planned_return_number', v_return_number,
      'planned_je_number', v_je_number,
      'totals', jsonb_build_object(
        'subtotal', v_subtotal,
        'tax_amount', v_tax_amount,
        'total_amount', v_total_amount
      ),
      'planned_lines_count', jsonb_array_length(v_planned_lines),
      'planned_lines', v_planned_lines,
      'planned_je_lines', 2 + CASE WHEN v_tax_amount > 0 AND v_vat_account_id IS NOT NULL THEN 1 ELSE 0 END
    );
  END IF;
  
  -- ============================================================
  -- STEP 7: Create Journal Entry with lines
  -- ============================================================
  INSERT INTO public.journal_entries (id, entry_number, entry_date, reference_type, reference_id,
    description, total_debit, total_credit, branch_id, is_posted, created_by)
  VALUES (v_je_id, v_je_number, v_return_date, 'purchase_return', v_return_id,
    'مرتجع مشتريات عام - ' || v_return_number, v_total_amount, v_total_amount, v_branch_id, true, v_user_name);
  
  -- DR: Accounts Payable (reduce liability)
  INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
  VALUES (v_je_id, v_ap_account_id, v_total_amount, 0, 'مرتجع مشتريات - الموردين');
  
  -- CR: Inventory (reduce asset)
  INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
  VALUES (v_je_id, v_inventory_account_id, 0, v_subtotal, 'مرتجع مشتريات - المخزون');
  
  -- CR: VAT Payable (if applicable)
  IF v_tax_amount > 0 AND v_vat_account_id IS NOT NULL THEN
    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_vat_account_id, 0, v_tax_amount, 'مرتجع مشتريات - ضريبة القيمة المضافة');
  END IF;
  
  -- ============================================================
  -- STEP 8: Integrity Check - Verify JE balance
  -- ============================================================
  DECLARE
    v_sum_debit numeric;
    v_sum_credit numeric;
  BEGIN
    SELECT COALESCE(SUM(debit_amount), 0), COALESCE(SUM(credit_amount), 0)
    INTO v_sum_debit, v_sum_credit
    FROM public.journal_entry_lines
    WHERE journal_entry_id = v_je_id;
    
    IF ABS(v_sum_debit - v_sum_credit) > 0.01 THEN
      v_integrity_errors := array_append(v_integrity_errors,
        format('JE unbalanced: debit=%s, credit=%s', v_sum_debit, v_sum_credit));
    END IF;
    
    IF ABS(v_sum_debit - v_total_amount) > 0.01 THEN
      v_integrity_errors := array_append(v_integrity_errors,
        format('JE total mismatch: expected=%s, actual=%s', v_total_amount, v_sum_debit));
    END IF;
  END;
  
  IF array_length(v_integrity_errors, 1) > 0 THEN
    PERFORM public.fail_workflow_request(v_client_request_id, 'INTEGRITY_ERROR', array_to_string(v_integrity_errors, '; '));
    RAISE EXCEPTION 'Integrity check failed: %', array_to_string(v_integrity_errors, '; ');
  END IF;
  
  -- ============================================================
  -- STEP 9: Create canonical purchase_returns header
  -- FIX: changed created_by → processed_by (column name mismatch)
  -- ============================================================
  INSERT INTO public.purchase_returns (
    id, return_number, purchase_invoice_id, supplier_id, branch_id,
    return_date, reason, notes, subtotal, tax_amount, total_amount,
    journal_entry_id, status, purchase_type, processed_by
  ) VALUES (
    v_return_id, v_return_number, v_purchase_invoice_id, v_supplier_id, v_branch_id,
    v_return_date, v_reason, v_notes, v_subtotal, v_tax_amount, v_total_amount,
    v_je_id, 'confirmed', 'general', v_user_name
  );
  
  -- ============================================================
  -- STEP 10: Create canonical purchase_return_lines
  -- D2-RET-GENERAL-FIX: align with public.purchase_return_lines schema
  -- product_id → item_id, unit_price → unit_cost, tax_rate → vat_rate
  -- Removed: product_code, discount_amount, reason (columns don't exist)
  -- ============================================================
  v_line_number := 0;
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_invoice_line_id := (v_item->>'invoice_line_id')::uuid;
    
    SELECT pil.product_id, pil.product_code, pil.line_number, pil.unit_price, pil.tax_rate, pil.description, pil.item_type
    INTO v_orig_line
    FROM public.purchase_invoice_lines pil
    WHERE pil.id = v_invoice_line_id;
    
    v_quantity := COALESCE((v_item->>'quantity')::numeric, (v_item->>'qty')::numeric, 1);
    v_unit_price := COALESCE((v_item->>'unit_price')::numeric, v_orig_line.unit_price, 0);
    v_discount_amount := COALESCE((v_item->>'discount_amount')::numeric, 0);
    v_tax_rate := COALESCE((v_item->>'tax_rate')::numeric, v_orig_line.tax_rate, 15);
    
    IF v_tax_rate > 1 THEN 
      v_vat_rate_decimal := v_tax_rate / 100; 
    ELSE 
      v_vat_rate_decimal := v_tax_rate;
    END IF;
    
    v_line_net := (v_quantity * v_unit_price) - v_discount_amount;
    v_line_tax := v_line_net * v_vat_rate_decimal;
    v_line_total := v_line_net + v_line_tax;
    
    v_line_number := v_line_number + 1;
    v_product_id := v_orig_line.product_id;
    v_product_code := v_orig_line.product_code;
    v_description := COALESCE(v_item->>'description', v_orig_line.description);
    v_item_type := COALESCE(v_item->>'item_type', v_orig_line.item_type, 'product');
    
    -- D2-RET-GENERAL-FIX: Fixed column mapping
    INSERT INTO public.purchase_return_lines (
      return_id,
      invoice_line_id,
      line_number,
      item_id,
      description,
      item_type,
      quantity,
      unit_cost,
      vat_rate,
      tax_amount,
      line_total
    ) VALUES (
      v_return_id,
      v_invoice_line_id,
      v_line_number,
      v_product_id,         -- product_id → item_id (same UUID)
      v_description,
      v_item_type,
      v_quantity,
      v_unit_price,         -- unit_price → unit_cost
      v_vat_rate_decimal,   -- tax_rate → vat_rate
      v_line_tax,           -- tax_amount stays
      v_line_total
    );
    v_lines_inserted := v_lines_inserted + 1;
  END LOOP;
  
  -- ============================================================
  -- STEP 11: Complete workflow & return success
  -- ============================================================
  v_result := jsonb_build_object(
    'success', true,
    'returnId', v_return_id,
    'returnNumber', v_return_number,
    'journalEntryId', v_je_id,
    'journalEntryNumber', v_je_number,
    'status', 'confirmed',
    'totals', jsonb_build_object(
      'subtotal', v_subtotal,
      'tax_amount', v_tax_amount,
      'total_amount', v_total_amount
    ),
    'lines_inserted', v_lines_inserted
  );
  
  PERFORM public.succeed_workflow_request(v_client_request_id, v_result);
  
  RETURN v_result;
  
EXCEPTION WHEN OTHERS THEN
  IF NOT v_dry_run AND v_client_request_id IS NOT NULL THEN
    PERFORM public.fail_workflow_request(v_client_request_id, 'EXCEPTION', SQLERRM);
  END IF;
  RAISE;
END;
$function$;

-- Grant proper permissions
REVOKE ALL ON FUNCTION public.complete_purchase_return_general_atomic(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_purchase_return_general_atomic(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_general_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_general_atomic(jsonb) TO service_role;