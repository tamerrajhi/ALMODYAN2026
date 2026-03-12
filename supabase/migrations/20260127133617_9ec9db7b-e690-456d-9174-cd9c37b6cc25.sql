-- =============================================================
-- P-PURCH-D2-2: Post-Cutover Hardening
-- A) Fix dry_run to work without locks
-- B) Decommission legacy trigger for general returns
-- =============================================================

-- =============================================================
-- PART A: Modify legacy trigger function to NO-OP for general returns
-- (Keep it working for import track which may still use mirror pattern)
-- =============================================================
CREATE OR REPLACE FUNCTION public.update_invoice_after_purchase_return()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    linked_inv_id UUID;
    invoice_type_val TEXT;
    purchase_type_val TEXT;
    total_returns NUMERIC;
    original_total NUMERIC;
    paid_amt NUMERIC;
BEGIN
    -- Get the invoice details including purchase_type
    SELECT invoice_type, linked_invoice_id, purchase_type 
    INTO invoice_type_val, linked_inv_id, purchase_type_val
    FROM invoices 
    WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
    
    -- Only process for purchase returns with linked invoice
    IF invoice_type_val != 'purchase_return' OR linked_inv_id IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    
    -- ========================================================
    -- CRITICAL: NO-OP for general returns (now handled by canonical triggers)
    -- trg_sync_returned_qty_canonical on purchase_return_lines handles qty sync
    -- trg_sync_invoice_totals_canonical on purchase_returns handles totals sync
    -- ========================================================
    IF purchase_type_val = 'general' THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    
    -- Continue legacy logic ONLY for import track (if applicable)
    -- Calculate total returns for the original invoice
    SELECT COALESCE(SUM(i.total_amount), 0) INTO total_returns
    FROM invoices i
    WHERE i.linked_invoice_id = linked_inv_id 
    AND i.invoice_type = 'purchase_return'
    AND i.status != 'cancelled';
    
    -- Get original invoice details
    SELECT total_amount, COALESCE(paid_amount, 0) 
    INTO original_total, paid_amt
    FROM invoices 
    WHERE id = linked_inv_id;
    
    -- Update original invoice
    UPDATE invoices 
    SET 
        total_returned_amount = total_returns,
        remaining_amount = original_total - paid_amt - total_returns,
        updated_at = now()
    WHERE id = linked_inv_id;
    
    -- Update returned_qty in original invoice lines (import track only)
    UPDATE purchase_invoice_lines pil
    SET returned_qty = (
        SELECT COALESCE(SUM(rl.quantity), 0)
        FROM purchase_invoice_lines rl
        JOIN invoices ri ON ri.id = rl.invoice_id
        WHERE ri.linked_invoice_id = linked_inv_id
        AND ri.invoice_type = 'purchase_return'
        AND ri.status != 'cancelled'
        AND (
            (pil.product_id IS NOT NULL AND rl.product_id = pil.product_id)
            OR (pil.product_id IS NULL AND pil.product_code IS NOT NULL AND rl.product_code = pil.product_code)
            OR (pil.product_id IS NULL AND pil.product_code IS NULL AND rl.line_number = pil.line_number)
        )
    )
    WHERE pil.invoice_id = linked_inv_id;
    
    RETURN COALESCE(NEW, OLD);
END;
$function$;

-- =============================================================
-- PART B: Fix RPC - dry_run mode must NOT use FOR UPDATE NOWAIT
-- =============================================================
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
    SELECT id INTO v_inventory_account_id FROM public.chart_of_accounts WHERE account_code = '110307' AND is_active = true LIMIT 1;
  END IF;
  
  SELECT id INTO v_vat_account_id FROM public.chart_of_accounts WHERE account_code = '2105' AND is_active = true LIMIT 1;
  
  -- ============================================================
  -- STEP 3: Validate accounts exist
  -- ============================================================
  IF v_ap_account_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'CONFIG_ERROR', 'error', 'AP account not found (2101)');
  END IF;
  
  IF v_inventory_account_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'CONFIG_ERROR', 'error', 'Inventory account not found');
  END IF;
  
  -- ============================================================
  -- STEP 4: Idempotency Gate (skip for dry_run)
  -- ============================================================
  IF NOT v_dry_run THEN
    v_gate := public.begin_workflow_request(v_client_request_id, 'purchase_return_general_create_atomic', p_payload);
    
    IF v_gate->>'status' = 'succeeded' THEN
      RETURN (v_gate->'cached_result') || jsonb_build_object('idempotent', true);
    ELSIF v_gate->>'status' = 'conflict' THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'IDEMPOTENCY_CONFLICT', 'error', 'Same request ID with different payload');
    ELSIF v_gate->>'status' = 'in_progress' THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'IN_PROGRESS', 'error', 'Request already processing');
    END IF;
  END IF;
  
  -- ============================================================
  -- STEP 5: Lock invoice lines & validate quantities
  -- ============================================================
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_invoice_line_id := (v_item->>'invoice_line_id')::uuid;
    
    IF v_invoice_line_id IS NOT NULL THEN
      -- ========================================================
      -- CRITICAL FIX: dry_run uses SELECT without locks
      -- ========================================================
      IF v_dry_run THEN
        -- READ-ONLY: No locks for dry run
        SELECT pil.id, pil.product_id, pil.product_code, pil.line_number, pil.quantity,
               COALESCE(pil.returned_qty, 0) as returned_qty, pil.unit_price, pil.tax_rate, pil.description, pil.item_type
        INTO v_orig_line
        FROM public.purchase_invoice_lines pil
        WHERE pil.id = v_invoice_line_id;
      ELSE
        -- REAL WRITE: Lock row for update
        SELECT pil.id, pil.product_id, pil.product_code, pil.line_number, pil.quantity,
               COALESCE(pil.returned_qty, 0) as returned_qty, pil.unit_price, pil.tax_rate, pil.description, pil.item_type
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
    ELSE
      IF NOT v_dry_run THEN
        PERFORM public.fail_workflow_request(v_client_request_id, 'VALIDATION', 'invoice_line_id is required');
      END IF;
      RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'invoice_line_id is required for each item');
    END IF;
  END LOOP;
  
  -- ============================================================
  -- STEP 6: Generate document numbers & calculate totals
  -- ============================================================
  -- For dry_run, use placeholder numbers to avoid consuming sequences
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
    
    -- Convert to decimal for calculation
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
                                     description, total_debit, total_credit, is_posted, created_by, branch_id)
  VALUES (v_je_id, v_je_number, v_return_date, 'purchase_return', v_return_id,
          'Purchase Return - ' || v_return_number, v_total_amount, v_total_amount, true, v_user_name, v_branch_id);
  
  INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
  VALUES (v_je_id, v_ap_account_id, v_total_amount, 0, 'Supplier AP reduction');
  v_lines_inserted := v_lines_inserted + 1;
  
  INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
  VALUES (v_je_id, v_inventory_account_id, 0, v_subtotal, 'Inventory reduction');
  v_lines_inserted := v_lines_inserted + 1;
  
  IF v_tax_amount > 0 AND v_vat_account_id IS NOT NULL THEN
    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_vat_account_id, 0, v_tax_amount, 'VAT input reduction');
    v_lines_inserted := v_lines_inserted + 1;
  END IF;
  
  -- ============================================================
  -- STEP 8: Post-check JE lines
  -- ============================================================
  DECLARE
    v_line_count int;
    v_sum_debit numeric;
    v_sum_credit numeric;
  BEGIN
    SELECT COUNT(*), COALESCE(SUM(debit_amount), 0), COALESCE(SUM(credit_amount), 0)
    INTO v_line_count, v_sum_debit, v_sum_credit
    FROM public.journal_entry_lines WHERE journal_entry_id = v_je_id;
    
    IF v_line_count = 0 THEN
      v_integrity_errors := array_append(v_integrity_errors, 'JE has zero lines');
    END IF;
    
    IF ABS(v_sum_debit - v_sum_credit) > 0.01 THEN
      v_integrity_errors := array_append(v_integrity_errors, 
        format('JE unbalanced: debit=%s credit=%s', v_sum_debit, v_sum_credit));
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
  -- ============================================================
  INSERT INTO public.purchase_returns (
    id, return_number, purchase_invoice_id, supplier_id, branch_id,
    return_date, reason, notes, subtotal, tax_amount, total_amount,
    journal_entry_id, status, purchase_type, created_by
  ) VALUES (
    v_return_id, v_return_number, v_purchase_invoice_id, v_supplier_id, v_branch_id,
    v_return_date, v_reason, v_notes, v_subtotal, v_tax_amount, v_total_amount,
    v_je_id, 'confirmed', 'general', v_user_name
  );
  
  -- ============================================================
  -- STEP 10: Create canonical purchase_return_lines
  -- ============================================================
  v_line_number := 0;
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_invoice_line_id := (v_item->>'invoice_line_id')::uuid;
    
    SELECT pil.product_id, pil.product_code, pil.unit_price, pil.tax_rate, pil.description, pil.item_type,
           pil.raw_material_id
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
    v_material_id := v_orig_line.raw_material_id;
    v_item_type := COALESCE(v_orig_line.item_type, 'product');
    
    INSERT INTO public.purchase_return_lines (
      return_id, invoice_id, invoice_line_id, item_id, quantity, 
      unit_cost, vat_rate, tax_amount, line_total, item_type
    ) VALUES (
      v_return_id, v_purchase_invoice_id, v_invoice_line_id, COALESCE(v_product_id, v_material_id),
      v_quantity, v_unit_price, v_vat_rate_decimal, v_line_tax, v_line_total, v_item_type
    );
    v_lines_inserted := v_lines_inserted + 1;
    
    -- ============================================================
    -- STEP 11: Create raw_material_movements (if raw_material)
    -- ============================================================
    IF v_material_id IS NOT NULL THEN
      INSERT INTO public.raw_material_movements (
        raw_material_id, branch_id, movement_type, quantity, unit_cost, total_value,
        reference_type, reference_id, notes, created_by
      ) VALUES (
        v_material_id, v_branch_id, 'return_out', -v_quantity, v_unit_price, -(v_quantity * v_unit_price),
        'purchase_return', v_return_id, 'Purchase Return - ' || v_return_number, v_user_name
      );
      v_movements_inserted := v_movements_inserted + 1;
      
      -- Update raw_materials_stock
      UPDATE public.raw_materials_stock
      SET quantity_on_hand = quantity_on_hand - v_quantity,
          updated_at = now()
      WHERE raw_material_id = v_material_id AND branch_id = v_branch_id;
      
      IF FOUND THEN v_stock_updated := v_stock_updated + 1; END IF;
    END IF;
  END LOOP;
  
  -- ============================================================
  -- STEP 12: Success - mark workflow complete
  -- ============================================================
  v_result := jsonb_build_object(
    'success', true,
    'return_id', v_return_id,
    'return_number', v_return_number,
    'journal_entry_id', v_je_id,
    'journal_entry_number', v_je_number,
    'totals', jsonb_build_object(
      'subtotal', v_subtotal,
      'tax_amount', v_tax_amount,
      'total_amount', v_total_amount
    ),
    'lines_inserted', v_lines_inserted,
    'movements_inserted', v_movements_inserted,
    'stock_updated', v_stock_updated
  );
  
  PERFORM public.succeed_workflow_request(v_client_request_id, v_result);
  
  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  IF NOT v_dry_run THEN
    PERFORM public.fail_workflow_request(v_client_request_id, 'EXCEPTION', SQLERRM);
  END IF;
  RAISE;
END;
$function$;