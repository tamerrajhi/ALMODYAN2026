
-- Fix: Replace 'status' with 'sale_status' in jewelry_items update
CREATE OR REPLACE FUNCTION public.complete_purchase_return_unique_items_atomic(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
      
      -- FIX: Changed 'status' to 'sale_status'
      UPDATE public.jewelry_items SET sale_status = 'returned_to_supplier', branch_id = NULL, updated_at = NOW() WHERE id = v_jewelry_item_id;
    END IF;
  END LOOP;
  
  v_result := jsonb_build_object('success', true, 'return_id', v_return_id, 'return_number', v_return_number, 'journal_entry_id', v_je_id, 'journal_entry_number', v_je_number, 'total_amount', v_total_amount);
  
  PERFORM public.complete_workflow_request(v_client_request_id, v_result);
  
  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  PERFORM public.fail_workflow_request(v_client_request_id, SQLSTATE, SQLERRM);
  RAISE;
END;
$function$;

-- Ensure grants are preserved
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_unique_items_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_unique_items_atomic(jsonb) TO service_role;
