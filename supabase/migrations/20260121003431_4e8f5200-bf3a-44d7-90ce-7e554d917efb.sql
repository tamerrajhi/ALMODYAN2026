-- ============================================================
-- STAGE-1 FIX PACK - COMPLETE FIX FOR ALL ITEM_MOVEMENTS WRITERS
-- ============================================================
-- This migration fixes ALL functions that write to item_movements
-- to remove phantom columns and use correct column names.
-- ============================================================

-- ============================================================
-- FIX: complete_purchase_return_unique_items_atomic (JSONB version)
-- REMOVE: quantity column (phantom)
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
  -- Parse & Validate
  v_client_request_id := (p_payload->>'client_request_id')::uuid;
  v_user_name := p_payload->>'created_by';
  v_return_data := p_payload->'return';
  v_items := p_payload->'items';
  v_journal_data := COALESCE(p_payload->'journal', '{}'::jsonb);
  
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
  
  -- Idempotency Gate
  v_gate := public.begin_workflow_request(v_client_request_id, 'purchase_return_unique_create_atomic', p_payload);
  
  IF v_gate->>'status' = 'succeeded' THEN
    RETURN v_gate->'cached_result';
  ELSIF v_gate->>'status' = 'conflict' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'IDEMPOTENCY_CONFLICT', 'error', 'Conflict');
  ELSIF v_gate->>'status' = 'in_progress' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'IN_PROGRESS', 'error', 'In progress');
  END IF;
  
  -- Generate document numbers
  v_return_number := public.generate_purchase_return_number(NULL);
  v_je_number := public.generate_journal_entry_number();
  
  -- Process items and calculate totals
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
  
  -- Lookup GL accounts
  SELECT id INTO v_ap_account_id FROM public.chart_of_accounts WHERE account_code = '2010' AND is_active = true LIMIT 1;
  SELECT id INTO v_inventory_account_id FROM public.chart_of_accounts WHERE account_code = '1310' AND is_active = true LIMIT 1;
  SELECT id INTO v_vat_account_id FROM public.chart_of_accounts WHERE account_code = '1150' AND is_active = true LIMIT 1;
  
  -- Create Journal Entry
  INSERT INTO public.journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, is_posted, created_by, branch_id)
  VALUES (v_je_id, v_je_number, v_return_date, 'purchase_return', v_return_id, 'Purchase Return - ' || v_return_number, v_total_amount, v_total_amount, true, v_user_name, v_branch_id);
  
  IF v_ap_account_id IS NOT NULL THEN
    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_ap_account_id, v_total_amount, 0, 'Supplier AP reduction');
  END IF;
  
  IF v_inventory_account_id IS NOT NULL THEN
    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_inventory_account_id, 0, v_subtotal, 'Inventory reduction');
  END IF;
  
  IF v_vat_account_id IS NOT NULL AND v_tax_amount > 0 THEN
    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_vat_account_id, 0, v_tax_amount, 'VAT input reduction');
  END IF;
  
  -- Create Purchase Return header
  INSERT INTO public.purchase_returns (id, return_number, return_date, supplier_id, purchase_invoice_id, branch_id, subtotal, tax_amount, total_amount, reason, notes, status, journal_entry_id, processed_by, purchase_type)
  VALUES (v_return_id, v_return_number, v_return_date, v_supplier_id, v_purchase_invoice_id, v_branch_id, v_subtotal, v_tax_amount, v_total_amount, v_reason, v_notes, 'confirmed', v_je_id, v_user_name, 'local');
  
  -- Create Return Items + Item Movements (FIX: NO quantity column)
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
    
    INSERT INTO public.purchase_return_items (id, return_id, jewelry_item_id, invoice_line_id, description, quantity, unit_price, discount_amount, tax_rate, tax_amount, total_amount)
    VALUES (gen_random_uuid(), v_return_id, v_jewelry_item_id, v_invoice_line_id, v_description, v_quantity, v_unit_price, v_discount_amount, v_tax_rate, v_line_tax, v_line_total);
    
    -- FIX: item_movements INSERT without quantity column
    IF v_jewelry_item_id IS NOT NULL THEN
      INSERT INTO public.item_movements (id, item_id, movement_type, reference_type, reference_id, from_branch_id, notes, performed_by, cost, journal_entry_id)
      VALUES (gen_random_uuid(), v_jewelry_item_id, 'purchase_return', 'purchase_return', v_return_id, v_branch_id, 'Returned to supplier: ' || v_return_number, v_user_name, v_unit_price, v_je_id);
      
      UPDATE public.jewelry_items SET status = 'returned_to_supplier', branch_id = NULL, updated_at = NOW() WHERE id = v_jewelry_item_id;
    END IF;
  END LOOP;
  
  v_result := jsonb_build_object('success', true, 'return_id', v_return_id, 'return_number', v_return_number, 'journal_entry_id', v_je_id, 'journal_entry_number', v_je_number, 'total_amount', v_total_amount);
  
  PERFORM public.complete_workflow_request(v_client_request_id, v_result);
  
  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  PERFORM public.fail_workflow_request(v_client_request_id, SQLSTATE, SQLERRM);
  RAISE;
END;
$$;

-- ============================================================
-- FIX: complete_purchase_return_atomic
-- REMOVE: quantity, item_code; RENAME: jewelry_item_id -> item_id
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_purchase_return_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_request_id text;
  v_gate jsonb;
  v_return_id uuid;
  v_return_number text;
  v_journal_number text;
  v_journal_entry_id uuid;
  v_items jsonb;
  v_item jsonb;
  v_branch_id uuid;
  v_supplier_id uuid;
  v_return_date date;
  v_subtotal numeric := 0;
  v_tax_amount numeric := 0;
  v_total_amount numeric := 0;
  v_item_id uuid;
  v_line_amount numeric;
  v_movement_ids uuid[] := ARRAY[]::uuid[];
  v_temp_movement_id uuid;
BEGIN
  v_client_request_id := COALESCE(p_payload->>'client_request_id', gen_random_uuid()::text);
  v_items := p_payload->'items';
  v_branch_id := (p_payload->>'branch_id')::uuid;
  v_supplier_id := (p_payload->>'supplier_id')::uuid;
  v_return_date := COALESCE((p_payload->>'return_date')::date, CURRENT_DATE);
  
  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Items required');
  END IF;
  
  v_gate := begin_workflow_request(v_client_request_id::uuid, 'purchase_return_atomic', p_payload);
  IF v_gate->>'status' = 'succeeded' THEN
    RETURN v_gate->'cached_result';
  END IF;
  
  v_return_id := gen_random_uuid();
  v_return_number := public.generate_purchase_return_number(NULL);
  v_journal_number := public.generate_journal_entry_number();
  
  -- Calculate totals
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_line_amount := COALESCE((v_item->>'unit_price')::numeric, 0);
    v_subtotal := v_subtotal + v_line_amount;
    v_tax_amount := v_tax_amount + (v_line_amount * 0.15);
  END LOOP;
  v_total_amount := v_subtotal + v_tax_amount;
  
  -- Create return header
  INSERT INTO public.purchase_returns (id, return_number, return_date, supplier_id, branch_id, subtotal, tax_amount, total_amount, status)
  VALUES (v_return_id, v_return_number, v_return_date, v_supplier_id, v_branch_id, v_subtotal, v_tax_amount, v_total_amount, 'confirmed');
  
  -- Create journal entry
  INSERT INTO public.journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, is_posted, branch_id)
  VALUES (gen_random_uuid(), v_journal_number, v_return_date, 'purchase_return', v_return_id, 'Purchase Return', v_total_amount, v_total_amount, true, v_branch_id)
  RETURNING id INTO v_journal_entry_id;
  
  -- Process items - FIX: Use item_id not jewelry_item_id, no item_code, no quantity
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_item_id := COALESCE((v_item->>'item_id')::uuid, (v_item->>'jewelry_item_id')::uuid);
    v_line_amount := COALESCE((v_item->>'unit_price')::numeric, 0);
    
    IF v_item_id IS NOT NULL THEN
      INSERT INTO public.item_movements (item_id, movement_type, reference_type, reference_id, from_branch_id, cost, notes, performed_by, journal_entry_id)
      VALUES (v_item_id, 'purchase_return', 'purchase_return', v_return_id, v_branch_id, v_line_amount, 'Return: ' || v_return_number, 'system', v_journal_entry_id)
      RETURNING id INTO v_temp_movement_id;
      v_movement_ids := array_append(v_movement_ids, v_temp_movement_id);
      
      UPDATE public.jewelry_items SET status = 'returned_to_supplier', updated_at = NOW() WHERE id = v_item_id;
    END IF;
  END LOOP;
  
  UPDATE public.purchase_returns SET journal_entry_id = v_journal_entry_id WHERE id = v_return_id;
  
  PERFORM core_workflow_success(v_client_request_id::uuid, v_return_id, jsonb_build_object('success', true, 'return_id', v_return_id, 'return_number', v_return_number, 'journal_entry_id', v_journal_entry_id));
  
  RETURN jsonb_build_object('success', true, 'return_id', v_return_id, 'return_number', v_return_number, 'journal_entry_id', v_journal_entry_id, 'total_amount', v_total_amount);

EXCEPTION WHEN OTHERS THEN
  PERFORM core_workflow_failed(v_client_request_id::uuid, 'DB_ERROR', SQLERRM);
  RAISE;
END;
$$;

-- ============================================================
-- FIX: complete_pos_credit_note_atomic  
-- REMOVE: quantity, sale_price; RENAME: unit_cost -> cost, jewelry_item_id -> item_id
-- ============================================================
-- Note: This function is large, focusing only on item_movements INSERT fix
CREATE OR REPLACE FUNCTION public.complete_pos_credit_note_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credit_note_id UUID;
  v_client_request_id TEXT;
  v_branch_id UUID;
  v_customer_id UUID;
  v_credit_note_type TEXT;
  v_is_draft BOOLEAN;
  v_refund_method TEXT;
  v_bank_account_id UUID;
  v_linked_sale_id UUID;
  v_reason TEXT;
  v_notes TEXT;
  v_credit_note_date DATE;
  v_tax_rate NUMERIC;
  v_cash_amount NUMERIC;
  v_card_amount NUMERIC;
  v_items JSONB;
  
  v_request_hash BIGINT;
  v_existing_status TEXT;
  v_existing_result JSONB;
  
  v_credit_note_number TEXT;
  v_subtotal NUMERIC := 0;
  v_total_tax NUMERIC := 0;
  v_total_amount NUMERIC := 0;
  v_total_cogs NUMERIC := 0;
  v_item JSONB;
  v_item_id UUID;
  v_unit_price NUMERIC;
  v_item_tax NUMERIC;
  v_item_total NUMERIC;
  v_item_cost NUMERIC;
  v_current_status TEXT;
  v_current_branch UUID;
  
  v_cash_account_id UUID;
  v_bank_account_uuid UUID;
  v_sales_returns_account_id UUID;
  v_vat_account_id UUID;
  v_inventory_account_id UUID;
  v_cogs_account_id UUID;
  v_customer_account_id UUID;
  
  v_journal_entry_id UUID;
  v_journal_number TEXT;
  
  v_result JSONB;
BEGIN
  -- Parse parameters
  v_credit_note_id := (p_payload->>'credit_note_id')::UUID;
  v_client_request_id := COALESCE(p_payload->>'client_request_id', gen_random_uuid()::TEXT);
  v_branch_id := (p_payload->>'branch_id')::UUID;
  v_customer_id := (p_payload->>'customer_id')::UUID;
  v_credit_note_type := COALESCE(p_payload->>'credit_note_type', 'return');
  v_is_draft := COALESCE((p_payload->>'is_draft')::BOOLEAN, false);
  v_refund_method := COALESCE(p_payload->>'refund_method', 'cash');
  v_bank_account_id := (p_payload->>'bank_account_id')::UUID;
  v_linked_sale_id := (p_payload->>'linked_sale_id')::UUID;
  v_reason := p_payload->>'reason';
  v_notes := p_payload->>'notes';
  v_credit_note_date := COALESCE((p_payload->>'credit_note_date')::DATE, CURRENT_DATE);
  v_tax_rate := COALESCE((p_payload->>'tax_rate')::NUMERIC, 15);
  v_cash_amount := COALESCE((p_payload->>'cash_amount')::NUMERIC, 0);
  v_card_amount := COALESCE((p_payload->>'card_amount')::NUMERIC, 0);
  v_items := COALESCE(p_payload->'items', '[]'::JSONB);

  IF v_branch_id IS NULL THEN RAISE EXCEPTION 'branch_id is required'; END IF;
  IF v_customer_id IS NULL THEN RAISE EXCEPTION 'customer_id is required'; END IF;
  IF jsonb_array_length(v_items) = 0 THEN RAISE EXCEPTION 'At least one item is required'; END IF;

  -- Idempotency check
  v_request_hash := abs(hashtext(v_client_request_id));
  PERFORM pg_advisory_xact_lock(v_request_hash);
  
  SELECT status, result INTO v_existing_status, v_existing_result FROM pos_workflow_requests WHERE client_request_id = v_client_request_id;
  IF FOUND AND v_existing_status = 'completed' THEN RETURN v_existing_result; END IF;
  
  PERFORM public.begin_workflow_request(v_client_request_id, 'pos_credit_note', p_payload);

  IF v_credit_note_id IS NULL THEN
    v_credit_note_id := gen_random_uuid();
  END IF;

  -- Account preflight (if not draft)
  IF NOT v_is_draft THEN
    SELECT id INTO v_cash_account_id FROM chart_of_accounts WHERE account_code = '1101' AND is_active = true;
    SELECT id INTO v_sales_returns_account_id FROM chart_of_accounts WHERE account_code = '4102' AND is_active = true;
    SELECT id INTO v_vat_account_id FROM chart_of_accounts WHERE account_code = '2104' AND is_active = true;
    
    IF v_credit_note_type = 'return' THEN
      SELECT bia.general_inventory_account_id INTO v_inventory_account_id FROM branch_inventory_accounts bia WHERE bia.branch_id = v_branch_id;
      IF v_inventory_account_id IS NULL THEN
        SELECT id INTO v_inventory_account_id FROM chart_of_accounts WHERE account_code = '1301' AND is_active = true;
      END IF;
      SELECT id INTO v_cogs_account_id FROM chart_of_accounts WHERE account_code = '5101' AND is_active = true;
    END IF;
  END IF;

  -- Calculate totals
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_item_id := COALESCE((v_item->>'item_id')::UUID, (v_item->>'jewelry_item_id')::UUID);
    v_unit_price := COALESCE((v_item->>'unit_price')::NUMERIC, 0);
    
    v_item_tax := ROUND(v_unit_price * (v_tax_rate / 100), 2);
    v_item_total := ROUND(v_unit_price + v_item_tax, 2);
    
    v_subtotal := v_subtotal + v_unit_price;
    v_total_tax := v_total_tax + v_item_tax;
    v_total_amount := v_total_amount + v_item_total;
    
    IF v_credit_note_type = 'return' THEN
      SELECT COALESCE(cost_price, 0) INTO v_item_cost FROM jewelry_items WHERE id = v_item_id;
      v_total_cogs := v_total_cogs + COALESCE(v_item_cost, 0);
    END IF;
  END LOOP;

  -- Generate credit note number
  SELECT 'CN-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD((COALESCE(MAX(NULLIF(REGEXP_REPLACE(credit_note_number, '[^0-9]', '', 'g'), '')::INTEGER), 0) + 1)::TEXT, 4, '0')
  INTO v_credit_note_number FROM credit_notes WHERE credit_note_number LIKE 'CN-' || TO_CHAR(NOW(), 'YYYYMMDD') || '%';

  -- Create credit note
  INSERT INTO credit_notes (id, credit_note_number, credit_note_date, customer_id, branch_id, sale_id, credit_note_type, reason, notes, subtotal, tax_amount, total_amount, status, created_at)
  VALUES (v_credit_note_id, v_credit_note_number, v_credit_note_date, v_customer_id, v_branch_id, v_linked_sale_id, v_credit_note_type, v_reason, v_notes, v_subtotal, v_total_tax, v_total_amount, CASE WHEN v_is_draft THEN 'draft' ELSE 'posted' END, NOW())
  ON CONFLICT (id) DO UPDATE SET subtotal = EXCLUDED.subtotal, tax_amount = EXCLUDED.tax_amount, total_amount = EXCLUDED.total_amount, status = EXCLUDED.status;

  -- Create items and movements
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_item_id := COALESCE((v_item->>'item_id')::UUID, (v_item->>'jewelry_item_id')::UUID);
    v_unit_price := COALESCE((v_item->>'unit_price')::NUMERIC, 0);
    v_item_tax := ROUND(v_unit_price * (v_tax_rate / 100), 2);
    v_item_total := v_unit_price + v_item_tax;
    
    SELECT COALESCE(cost_price, 0) INTO v_item_cost FROM jewelry_items WHERE id = v_item_id;
    
    INSERT INTO credit_note_items (credit_note_id, jewelry_item_id, description, quantity, unit_price, tax_rate, tax_amount, total_amount)
    VALUES (v_credit_note_id, v_item_id, COALESCE(v_item->>'description', 'Credit note item'), 1, v_unit_price, v_tax_rate, v_item_tax, v_item_total)
    ON CONFLICT DO NOTHING;
    
    -- FIX: item_movements INSERT - use item_id, cost (not jewelry_item_id, unit_cost, sale_price, quantity)
    IF v_credit_note_type = 'return' AND v_item_id IS NOT NULL AND NOT v_is_draft THEN
      INSERT INTO item_movements (item_id, movement_type, reference_type, reference_id, to_branch_id, cost, notes, performed_by)
      VALUES (v_item_id, 'credit_note_return', 'credit_note', v_credit_note_id, v_branch_id, v_item_cost, 'Credit note: ' || v_credit_note_number, 'system');
      
      UPDATE jewelry_items SET sold_at = NULL, sale_status = 'available', branch_id = v_branch_id WHERE id = v_item_id;
    END IF;
  END LOOP;

  -- Create journal entry if not draft
  IF NOT v_is_draft THEN
    v_journal_number := 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
    
    INSERT INTO journal_entries (entry_number, entry_date, reference_type, reference_id, description, is_posted, total_debit, total_credit, branch_id)
    VALUES (v_journal_number, v_credit_note_date, 'credit_note', v_credit_note_id, 'Credit Note: ' || v_credit_note_number, true, v_total_amount + v_total_cogs, v_total_amount + v_total_cogs, v_branch_id)
    RETURNING id INTO v_journal_entry_id;
    
    -- Journal lines...
    IF v_sales_returns_account_id IS NOT NULL THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES (v_journal_entry_id, v_sales_returns_account_id, v_subtotal, 0, 'Sales returns');
    END IF;
    IF v_vat_account_id IS NOT NULL AND v_total_tax > 0 THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES (v_journal_entry_id, v_vat_account_id, v_total_tax, 0, 'VAT reversal');
    END IF;
    IF v_cash_account_id IS NOT NULL THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES (v_journal_entry_id, v_cash_account_id, 0, v_total_amount, 'Refund');
    END IF;
    IF v_total_cogs > 0 AND v_inventory_account_id IS NOT NULL AND v_cogs_account_id IS NOT NULL THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES (v_journal_entry_id, v_inventory_account_id, v_total_cogs, 0, 'Inventory');
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES (v_journal_entry_id, v_cogs_account_id, 0, v_total_cogs, 'COGS reversal');
    END IF;
    
    UPDATE credit_notes SET journal_entry_id = v_journal_entry_id WHERE id = v_credit_note_id;
    PERFORM link_item_movements_to_journal('credit_note', v_credit_note_id, v_journal_entry_id);
  END IF;

  v_result := jsonb_build_object('success', true, 'credit_note_id', v_credit_note_id, 'credit_note_number', v_credit_note_number, 'journal_entry_id', v_journal_entry_id, 'total_amount', v_total_amount);
  
  UPDATE pos_workflow_requests SET status = 'completed', result = v_result WHERE client_request_id = v_client_request_id;
  
  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  UPDATE pos_workflow_requests SET status = 'failed', error_message = SQLERRM WHERE client_request_id = v_client_request_id;
  RAISE;
END;
$$;

-- ============================================================
-- FIX: complete_pos_sales_return_atomic
-- REMOVE: quantity; RENAME: jewelry_item_id -> item_id
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_pos_sales_return_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_request_id text;
  v_pos_return_id uuid;
  v_branch_id uuid;
  v_original_sale_id uuid;
  v_customer_id uuid;
  v_issue_date date;
  v_notes text;
  v_created_by uuid;
  v_payment_method text;
  v_items jsonb;
  
  v_return_number text;
  v_subtotal numeric := 0;
  v_tax_amount numeric := 0;
  v_total_amount numeric := 0;
  v_journal_entry_id uuid;
  v_items_count int := 0;
  
  v_item jsonb;
  v_item_id uuid;
  v_item_price numeric;
  v_item_cost numeric;
  v_total_cogs numeric := 0;
  v_je_number text;
  
  v_inventory_account_id uuid;
  v_sales_return_account_id uuid;
  v_cogs_account_id uuid;
  v_cash_account_id uuid;
  v_vat_account_id uuid;
BEGIN
  v_client_request_id := COALESCE(p_payload->>'client_request_id', gen_random_uuid()::text);
  v_pos_return_id := NULLIF(p_payload->>'pos_return_id', '')::uuid;
  v_branch_id := (p_payload->>'branch_id')::uuid;
  v_original_sale_id := (p_payload->>'original_sale_id')::uuid;
  v_customer_id := NULLIF(p_payload->>'customer_id', '')::uuid;
  v_issue_date := COALESCE(NULLIF(p_payload->>'issue_date', '')::date, CURRENT_DATE);
  v_notes := p_payload->>'notes';
  v_created_by := NULLIF(p_payload->>'created_by', '')::uuid;
  v_payment_method := COALESCE(p_payload->>'payment_method', 'cash');
  v_items := p_payload->'items';

  PERFORM begin_workflow_request(v_client_request_id, 'pos_sales_return');

  IF v_branch_id IS NULL THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION_FAILED', 'branch_id required');
    RETURN build_error_result('VALIDATION_FAILED', 'الفرع مطلوب', NULL);
  END IF;

  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION_FAILED', 'items required');
    RETURN build_error_result('VALIDATION_FAILED', 'يجب إضافة عناصر للمرتجع', NULL);
  END IF;

  IF v_pos_return_id IS NULL THEN
    v_return_number := 'PSR-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || LPAD((floor(random() * 10000))::text, 4, '0');
    
    INSERT INTO invoices (invoice_number, invoice_type, invoice_date, branch_id, customer_id, subtotal, tax_amount, total_amount, status, notes, created_by, linked_invoice_id, payment_method)
    VALUES (v_return_number, 'pos_sales_return', v_issue_date, v_branch_id, v_customer_id, 0, 0, 0, 'draft', v_notes, v_created_by, v_original_sale_id, v_payment_method)
    RETURNING id INTO v_pos_return_id;
  ELSE
    SELECT invoice_number INTO v_return_number FROM invoices WHERE id = v_pos_return_id;
    DELETE FROM item_movements WHERE reference_id = v_pos_return_id AND reference_type = 'pos_sales_return';
    DELETE FROM invoice_items WHERE invoice_id = v_pos_return_id;
  END IF;

  -- Lookup accounts
  SELECT id INTO v_inventory_account_id FROM chart_of_accounts WHERE account_code = '1301' AND is_active LIMIT 1;
  SELECT id INTO v_sales_return_account_id FROM chart_of_accounts WHERE account_code = '4102' AND is_active LIMIT 1;
  SELECT id INTO v_cogs_account_id FROM chart_of_accounts WHERE account_code = '5101' AND is_active LIMIT 1;
  SELECT id INTO v_cash_account_id FROM chart_of_accounts WHERE account_code = '1101' AND is_active LIMIT 1;
  SELECT id INTO v_vat_account_id FROM chart_of_accounts WHERE account_code = '2104' AND is_active LIMIT 1;

  -- Process items
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_item_id := COALESCE((v_item->>'item_id')::uuid, (v_item->>'jewelry_item_id')::uuid);
    v_item_price := COALESCE((v_item->>'unit_price')::numeric, 0);
    
    v_subtotal := v_subtotal + v_item_price;
    v_tax_amount := v_tax_amount + ROUND(v_item_price * 0.15, 2);
    v_items_count := v_items_count + 1;
    
    SELECT COALESCE(cost, 0) INTO v_item_cost FROM jewelry_items WHERE id = v_item_id;
    v_total_cogs := v_total_cogs + v_item_cost;
    
    INSERT INTO invoice_items (invoice_id, jewelry_item_id, description, quantity, unit_price, tax_amount, total_amount)
    VALUES (v_pos_return_id, v_item_id, COALESCE(v_item->>'description', 'Return item'), 1, v_item_price, ROUND(v_item_price * 0.15, 2), v_item_price + ROUND(v_item_price * 0.15, 2));
    
    -- FIX: item_movements INSERT - use item_id (not jewelry_item_id), no quantity
    IF v_item_id IS NOT NULL THEN
      INSERT INTO item_movements (item_id, movement_type, reference_type, reference_id, to_branch_id, cost, notes, performed_by)
      VALUES (v_item_id, 'pos_sales_return', 'pos_sales_return', v_pos_return_id, v_branch_id, v_item_cost, 'POS Return: ' || v_return_number, v_created_by);
      
      UPDATE jewelry_items SET sold_at = NULL, sale_status = 'available', branch_id = v_branch_id WHERE id = v_item_id;
    END IF;
  END LOOP;

  v_total_amount := v_subtotal + v_tax_amount;

  -- Create journal entry
  v_je_number := 'JE-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(floor(random() * 10000)::text, 4, '0');
  
  INSERT INTO journal_entries (entry_number, entry_date, reference_type, reference_id, description, is_posted, total_debit, total_credit, branch_id)
  VALUES (v_je_number, v_issue_date, 'pos_sales_return', v_pos_return_id, 'POS Sales Return: ' || v_return_number, true, v_total_amount + v_total_cogs, v_total_amount + v_total_cogs, v_branch_id)
  RETURNING id INTO v_journal_entry_id;

  -- Journal lines
  IF v_sales_return_account_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES (v_journal_entry_id, v_sales_return_account_id, v_subtotal, 0, 'Sales returns');
  END IF;
  IF v_vat_account_id IS NOT NULL AND v_tax_amount > 0 THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES (v_journal_entry_id, v_vat_account_id, v_tax_amount, 0, 'VAT reversal');
  END IF;
  IF v_cash_account_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES (v_journal_entry_id, v_cash_account_id, 0, v_total_amount, 'Refund');
  END IF;
  IF v_total_cogs > 0 AND v_inventory_account_id IS NOT NULL AND v_cogs_account_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES (v_journal_entry_id, v_inventory_account_id, v_total_cogs, 0, 'Inventory');
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES (v_journal_entry_id, v_cogs_account_id, 0, v_total_cogs, 'COGS reversal');
  END IF;

  -- Update invoice
  UPDATE invoices SET subtotal = v_subtotal, tax_amount = v_tax_amount, total_amount = v_total_amount, status = 'posted', journal_entry_id = v_journal_entry_id WHERE id = v_pos_return_id;

  PERFORM link_item_movements_to_journal('pos_sales_return', v_pos_return_id, v_journal_entry_id);

  PERFORM public.core_workflow_success(v_client_request_id, v_pos_return_id, jsonb_build_object('success', true, 'return_id', v_pos_return_id));

  RETURN jsonb_build_object('success', true, 'return_id', v_pos_return_id, 'return_number', v_return_number, 'journal_entry_id', v_journal_entry_id, 'total_amount', v_total_amount);

EXCEPTION WHEN OTHERS THEN
  PERFORM public.core_workflow_failed(v_client_request_id, 'DB_ERROR', SQLERRM);
  RAISE;
END;
$$;

-- ============================================================
-- FIX: complete_sales_return_atomic
-- REMOVE: quantity; RENAME: jewelry_item_id -> item_id
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_sales_return_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_request_id text;
  v_return_id uuid;
  v_branch_id uuid;
  v_original_invoice_id uuid;
  v_customer_id uuid;
  v_issue_date date;
  v_notes text;
  v_created_by uuid;
  v_payment_method text;
  v_items jsonb;
  
  v_return_number text;
  v_subtotal numeric := 0;
  v_tax_amount numeric := 0;
  v_total_amount numeric := 0;
  v_journal_entry_id uuid;
  v_items_count int := 0;
  v_is_new boolean := true;
  
  v_item jsonb;
  v_item_id uuid;
  v_item_price numeric;
  v_item_cost numeric;
  v_total_cogs numeric := 0;
  v_je_number text;
  
  v_inventory_account_id uuid;
  v_sales_return_account_id uuid;
  v_cogs_account_id uuid;
  v_cash_account_id uuid;
  v_vat_account_id uuid;
  
  v_original_invoice_number text;
BEGIN
  v_client_request_id := COALESCE(p_payload->>'client_request_id', gen_random_uuid()::text);
  v_return_id := NULLIF(p_payload->>'return_id', '')::uuid;
  v_branch_id := (p_payload->>'branch_id')::uuid;
  v_original_invoice_id := (p_payload->>'original_invoice_id')::uuid;
  v_customer_id := NULLIF(p_payload->>'customer_id', '')::uuid;
  v_issue_date := COALESCE(NULLIF(p_payload->>'issue_date', '')::date, CURRENT_DATE);
  v_notes := p_payload->>'notes';
  v_created_by := NULLIF(p_payload->>'created_by', '')::uuid;
  v_payment_method := COALESCE(p_payload->>'payment_method', 'cash');
  v_items := p_payload->'items';

  PERFORM begin_workflow_request(v_client_request_id, 'sales_return');

  IF v_branch_id IS NULL THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION_FAILED', 'branch_id required');
    RETURN build_error_result('VALIDATION_FAILED', 'الفرع مطلوب', NULL);
  END IF;

  IF v_original_invoice_id IS NULL THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION_FAILED', 'original_invoice_id required');
    RETURN build_error_result('VALIDATION_FAILED', 'الفاتورة الأصلية مطلوبة', NULL);
  END IF;

  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'VALIDATION_FAILED', 'items required');
    RETURN build_error_result('VALIDATION_FAILED', 'يجب إضافة عناصر للمرتجع', NULL);
  END IF;

  SELECT invoice_number INTO v_original_invoice_number FROM invoices WHERE id = v_original_invoice_id AND invoice_type = 'sales' AND status IN ('posted', 'paid', 'partial');
  IF v_original_invoice_number IS NULL THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'ORIGINAL_INVOICE_NOT_ELIGIBLE', 'Invoice not eligible');
    RETURN build_error_result('ORIGINAL_INVOICE_NOT_ELIGIBLE', 'الفاتورة الأصلية غير مؤهلة للمرتجع', NULL);
  END IF;

  IF v_return_id IS NOT NULL THEN
    v_is_new := false;
    DELETE FROM item_movements WHERE reference_id = v_return_id AND reference_type = 'sales_return';
    DELETE FROM sales_return_lines WHERE return_id = v_return_id;
  ELSE
    v_return_number := 'SR-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || LPAD((floor(random() * 10000))::text, 4, '0');
    
    INSERT INTO invoices (invoice_number, invoice_type, invoice_date, branch_id, customer_id, subtotal, tax_amount, total_amount, status, notes, created_by, linked_invoice_id, payment_method)
    VALUES (v_return_number, 'sales_return', v_issue_date, v_branch_id, v_customer_id, 0, 0, 0, 'draft', v_notes, v_created_by, v_original_invoice_id, v_payment_method)
    RETURNING id INTO v_return_id;
  END IF;

  IF NOT v_is_new THEN
    SELECT invoice_number INTO v_return_number FROM invoices WHERE id = v_return_id;
  END IF;

  -- Lookup accounts
  SELECT id INTO v_inventory_account_id FROM chart_of_accounts WHERE account_code = '1301' AND is_active LIMIT 1;
  SELECT id INTO v_sales_return_account_id FROM chart_of_accounts WHERE account_code = '4102' AND is_active LIMIT 1;
  SELECT id INTO v_cogs_account_id FROM chart_of_accounts WHERE account_code = '5101' AND is_active LIMIT 1;
  SELECT id INTO v_cash_account_id FROM chart_of_accounts WHERE account_code = '1101' AND is_active LIMIT 1;
  SELECT id INTO v_vat_account_id FROM chart_of_accounts WHERE account_code = '2104' AND is_active LIMIT 1;

  -- Process items - FIX: use item_id not jewelry_item_id, no quantity
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_item_id := COALESCE((v_item->>'item_id')::uuid, (v_item->>'jewelry_item_id')::uuid);
    v_item_price := COALESCE((v_item->>'unit_price')::numeric, 0);
    
    v_subtotal := v_subtotal + v_item_price;
    v_tax_amount := v_tax_amount + ROUND(v_item_price * 0.15, 2);
    v_items_count := v_items_count + 1;
    
    SELECT COALESCE(cost, 0) INTO v_item_cost FROM jewelry_items WHERE id = v_item_id;
    v_total_cogs := v_total_cogs + v_item_cost;
    
    INSERT INTO sales_return_lines (return_id, jewelry_item_id, description, quantity, unit_price, tax_amount, total_amount)
    VALUES (v_return_id, v_item_id, COALESCE(v_item->>'description', 'Return item'), 1, v_item_price, ROUND(v_item_price * 0.15, 2), v_item_price + ROUND(v_item_price * 0.15, 2));
    
    -- FIX: item_movements INSERT - use item_id (not jewelry_item_id), no quantity
    IF v_item_id IS NOT NULL THEN
      INSERT INTO item_movements (item_id, movement_type, reference_type, reference_id, to_branch_id, cost, notes, performed_by)
      VALUES (v_item_id, 'sales_return', 'sales_return', v_return_id, v_branch_id, v_item_cost, 'Sales Return: ' || v_return_number, v_created_by);
      
      UPDATE jewelry_items SET sold_at = NULL, sale_status = 'available', branch_id = v_branch_id WHERE id = v_item_id;
    END IF;
  END LOOP;

  v_total_amount := v_subtotal + v_tax_amount;

  -- Create journal entry
  v_je_number := 'JE-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(floor(random() * 10000)::text, 4, '0');
  
  INSERT INTO journal_entries (entry_number, entry_date, reference_type, reference_id, description, is_posted, total_debit, total_credit, branch_id)
  VALUES (v_je_number, v_issue_date, 'sales_return', v_return_id, 'Sales Return: ' || v_return_number, true, v_total_amount + v_total_cogs, v_total_amount + v_total_cogs, v_branch_id)
  RETURNING id INTO v_journal_entry_id;

  -- Journal lines
  IF v_sales_return_account_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES (v_journal_entry_id, v_sales_return_account_id, v_subtotal, 0, 'Sales returns');
  END IF;
  IF v_vat_account_id IS NOT NULL AND v_tax_amount > 0 THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES (v_journal_entry_id, v_vat_account_id, v_tax_amount, 0, 'VAT reversal');
  END IF;
  IF v_cash_account_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES (v_journal_entry_id, v_cash_account_id, 0, v_total_amount, 'Refund');
  END IF;
  IF v_total_cogs > 0 AND v_inventory_account_id IS NOT NULL AND v_cogs_account_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES (v_journal_entry_id, v_inventory_account_id, v_total_cogs, 0, 'Inventory');
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES (v_journal_entry_id, v_cogs_account_id, 0, v_total_cogs, 'COGS reversal');
  END IF;

  -- Update invoice
  UPDATE invoices SET subtotal = v_subtotal, tax_amount = v_tax_amount, total_amount = v_total_amount, status = 'posted', journal_entry_id = v_journal_entry_id WHERE id = v_return_id;

  PERFORM link_item_movements_to_journal('sales_return', v_return_id, v_journal_entry_id);

  PERFORM public.core_workflow_success(v_client_request_id, v_return_id, jsonb_build_object('success', true, 'return_id', v_return_id));

  RETURN jsonb_build_object('success', true, 'return_id', v_return_id, 'return_number', v_return_number, 'journal_entry_id', v_journal_entry_id, 'total_amount', v_total_amount);

EXCEPTION WHEN OTHERS THEN
  PERFORM public.core_workflow_failed(v_client_request_id, 'DB_ERROR', SQLERRM);
  RAISE;
END;
$$;

-- ============================================================
-- Improved Gate View with more accurate detection
-- ============================================================
DROP VIEW IF EXISTS public.gate_item_movements_contract_violations;
CREATE OR REPLACE VIEW public.gate_item_movements_contract_violations AS
WITH writers AS (
  SELECT
    p.oid,
    n.nspname,
    p.proname,
    p.prosrc
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.prosrc ILIKE '%INSERT INTO%item_movements%'
),
violations AS (
  -- Check for phantom column: quantity in INSERT column list
  SELECT proname, 'PHANTOM_COLUMN_QUANTITY' AS issue
  FROM writers
  WHERE prosrc ~* E'INSERT INTO[^;]+item_movements[^)]+\\bquantity\\b'
  UNION ALL
  -- Check for phantom column: item_code in INSERT column list
  SELECT proname, 'PHANTOM_COLUMN_ITEM_CODE' AS issue
  FROM writers
  WHERE prosrc ~* E'INSERT INTO[^;]+item_movements[^)]+\\bitem_code\\b'
  UNION ALL
  -- Check for wrong column: jewelry_item_id (should be item_id)
  SELECT proname, 'WRONG_COLUMN_JEWELRY_ITEM_ID' AS issue
  FROM writers
  WHERE prosrc ~* E'INSERT INTO[^;]+item_movements[^)]+\\bjewelry_item_id\\b'
  UNION ALL
  -- Check for phantom column: value_amount (should be cost)
  SELECT proname, 'PHANTOM_COLUMN_VALUE_AMOUNT' AS issue
  FROM writers
  WHERE prosrc ~* E'INSERT INTO[^;]+item_movements[^)]+\\bvalue_amount\\b'
  UNION ALL
  -- Check for phantom column: unit_cost (should be cost)
  SELECT proname, 'PHANTOM_COLUMN_UNIT_COST' AS issue
  FROM writers
  WHERE prosrc ~* E'INSERT INTO[^;]+item_movements[^)]+\\bunit_cost\\b'
  UNION ALL
  -- Check for phantom column: sale_price
  SELECT proname, 'PHANTOM_COLUMN_SALE_PRICE' AS issue
  FROM writers
  WHERE prosrc ~* E'INSERT INTO[^;]+item_movements[^)]+\\bsale_price\\b'
)
SELECT DISTINCT * FROM violations;

GRANT SELECT ON public.gate_item_movements_contract_violations TO authenticated;
GRANT SELECT ON public.gate_item_movements_contract_violations TO anon;