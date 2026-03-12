
-- ============================================================
-- P-PURCH-GENERAL-RET-LEDGER-ROOT
-- B1: Create General Inventory Movement Ledger
-- B2: Patch complete_purchase_return_general_atomic to write movements
-- ============================================================

-- ============================================================
-- B1: CREATE raw_material_movements LEDGER
-- ============================================================
CREATE TABLE IF NOT EXISTS public.raw_material_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES public.branches(id),
  material_id uuid REFERENCES public.raw_materials(id),
  product_id uuid, -- For non-raw-material products
  movement_type text NOT NULL,
  quantity numeric NOT NULL,
  unit_cost numeric,
  total_cost numeric,
  reference_type text,
  reference_id uuid,
  reference_code text,
  performed_by text,
  movement_date timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Add constraint for movement_type values
ALTER TABLE public.raw_material_movements
  DROP CONSTRAINT IF EXISTS raw_material_movements_type_check;
ALTER TABLE public.raw_material_movements
  ADD CONSTRAINT raw_material_movements_type_check 
  CHECK (movement_type IN ('purchase_invoice', 'purchase_return', 'adjustment', 'void', 'transfer', 'consumption'));

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_raw_material_movements_branch_material 
  ON public.raw_material_movements(branch_id, material_id, movement_date DESC);
CREATE INDEX IF NOT EXISTS idx_raw_material_movements_reference 
  ON public.raw_material_movements(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_raw_material_movements_product 
  ON public.raw_material_movements(product_id) WHERE product_id IS NOT NULL;

-- Enable RLS
ALTER TABLE public.raw_material_movements ENABLE ROW LEVEL SECURITY;

-- RLS Policies: SELECT for authenticated, INSERT/UPDATE via RPC only
DROP POLICY IF EXISTS "raw_material_movements_select" ON public.raw_material_movements;
CREATE POLICY "raw_material_movements_select" ON public.raw_material_movements
  FOR SELECT TO authenticated USING (true);

-- ============================================================
-- B2: PATCH complete_purchase_return_general_atomic
-- Added: Stock update + Movement ledger insert for stockable items
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
  v_material_id uuid;
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
  -- STEP 1B: Guard - Reject jewelry_item_id (Separation Enforcement)
  -- ============================================================
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    IF v_item->>'jewelry_item_id' IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'WRONG_FLOW', 
        'error', 'jewelry_item_id detected - use Unique Return flow instead');
    END IF;
  END LOOP;
  
  -- ============================================================
  -- STEP 2: Lookup GL Accounts (correct codes: 2101, branch inv, 2105)
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
  -- STEP 4: Idempotency Gate
  -- ============================================================
  v_gate := public.begin_workflow_request(v_client_request_id, 'purchase_return_general_create_atomic', p_payload);
  
  IF v_gate->>'status' = 'succeeded' THEN
    RETURN (v_gate->'cached_result') || jsonb_build_object('idempotent', true);
  ELSIF v_gate->>'status' = 'conflict' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'IDEMPOTENCY_CONFLICT', 'error', 'Same request ID with different payload');
  ELSIF v_gate->>'status' = 'in_progress' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'IN_PROGRESS', 'error', 'Request already processing');
  END IF;
  
  -- ============================================================
  -- STEP 5: Lock invoice lines & validate quantities
  -- ============================================================
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_invoice_line_id := (v_item->>'invoice_line_id')::uuid;
    
    IF v_invoice_line_id IS NOT NULL THEN
      SELECT pil.id, pil.product_id, pil.product_code, pil.line_number, pil.quantity,
             COALESCE(pil.returned_qty, 0) as returned_qty, pil.unit_price, pil.tax_rate, pil.description, pil.item_type
      INTO v_orig_line
      FROM public.purchase_invoice_lines pil
      WHERE pil.id = v_invoice_line_id
      FOR UPDATE NOWAIT;
      
      IF v_orig_line IS NULL THEN
        PERFORM public.fail_workflow_request(v_client_request_id, 'NOT_FOUND', 'Invoice line not found');
        RETURN jsonb_build_object('success', false, 'error_code', 'NOT_FOUND', 'error', 'Invoice line not found: ' || v_invoice_line_id::text);
      END IF;
      
      v_quantity := COALESCE((v_item->>'quantity')::numeric, (v_item->>'qty')::numeric, 1);
      v_available_qty := v_orig_line.quantity - v_orig_line.returned_qty;
      
      IF v_quantity > v_available_qty THEN
        PERFORM public.fail_workflow_request(v_client_request_id, 'QUANTITY_EXCEEDED', 
          format('Cannot return %s, only %s available', v_quantity, v_available_qty));
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
    
    IF v_tax_rate > 1 THEN v_tax_rate := v_tax_rate / 100; END IF;
    
    v_line_net := (v_quantity * v_unit_price) - v_discount_amount;
    v_line_tax := v_line_net * v_tax_rate;
    v_line_total := v_line_net + v_line_tax;
    
    v_subtotal := v_subtotal + v_line_net;
    v_tax_amount := v_tax_amount + v_line_tax;
    v_total_amount := v_total_amount + v_line_total;
  END LOOP;
  
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
    
    IF v_line_count < 2 THEN
      PERFORM public.fail_workflow_request(v_client_request_id, 'JE_LINES_MISSING', 'Insufficient JE lines');
      RAISE EXCEPTION 'JE_LINES_MISSING: Only % lines', v_line_count;
    END IF;
    
    IF ABS(v_sum_debit - v_total_amount) > 0.01 OR ABS(v_sum_credit - v_total_amount) > 0.01 THEN
      PERFORM public.fail_workflow_request(v_client_request_id, 'JE_BALANCE_MISMATCH', 'Totals mismatch');
      RAISE EXCEPTION 'JE_BALANCE_MISMATCH';
    END IF;
  END;
  
  -- ============================================================
  -- STEP 9: Create Purchase Return record (invoices table)
  -- ============================================================
  INSERT INTO public.invoices (id, invoice_number, invoice_date, invoice_type, supplier_id, branch_id,
                               subtotal, tax_amount, total_amount, notes, status, journal_entry_id, 
                               created_by, linked_invoice_id)
  VALUES (v_return_id, v_return_number, v_return_date, 'purchase_return', v_supplier_id, v_branch_id,
          v_subtotal, v_tax_amount, v_total_amount,
          COALESCE(v_reason, '') || CASE WHEN v_notes IS NOT NULL THEN ' | ' || v_notes ELSE '' END,
          'posted', v_je_id, v_user_name, v_purchase_invoice_id);
  
  -- ============================================================
  -- STEP 10: Create Return Line Items + Stock Movement Ledger
  -- ============================================================
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_invoice_line_id := (v_item->>'invoice_line_id')::uuid;
    
    SELECT pil.product_id, pil.product_code, pil.line_number, pil.unit_price, pil.tax_rate, pil.description, pil.item_type
    INTO v_orig_line
    FROM public.purchase_invoice_lines pil WHERE pil.id = v_invoice_line_id;
    
    v_product_id := COALESCE((v_item->>'product_id')::uuid, (v_item->>'item_id')::uuid, v_orig_line.product_id);
    v_product_code := COALESCE(v_item->>'product_code', v_item->>'item_code', v_orig_line.product_code);
    v_line_number := v_orig_line.line_number;
    v_quantity := COALESCE((v_item->>'quantity')::numeric, (v_item->>'qty')::numeric, 1);
    v_description := COALESCE(v_item->>'description', v_orig_line.description, 'Return item');
    v_unit_price := COALESCE((v_item->>'unit_price')::numeric, v_orig_line.unit_price, 0);
    v_discount_amount := COALESCE((v_item->>'discount_amount')::numeric, 0);
    v_tax_rate := COALESCE((v_item->>'tax_rate')::numeric, v_orig_line.tax_rate, 15);
    v_item_type := COALESCE(v_item->>'item_type', v_orig_line.item_type, 'product');
    
    IF v_tax_rate > 1 THEN v_tax_rate := v_tax_rate / 100; END IF;
    
    v_line_net := (v_quantity * v_unit_price) - v_discount_amount;
    v_line_tax := v_line_net * v_tax_rate;
    v_line_total := v_line_net + v_line_tax;
    
    -- Insert return line -> Trigger fires and updates original line's returned_qty
    INSERT INTO public.purchase_invoice_lines (id, invoice_id, product_id, product_code, line_number,
                                               description, quantity, unit_price, discount_amount,
                                               tax_rate, tax_amount, total_amount, item_type)
    VALUES (gen_random_uuid(), v_return_id, v_product_id, v_product_code, v_line_number,
            v_description, v_quantity, v_unit_price, v_discount_amount, v_tax_rate, v_line_tax, v_line_total, v_item_type);
    
    -- ============================================================
    -- STEP 10B: Stock Update + Movement Ledger (for stockable items only)
    -- Skip services/non-stockable items
    -- ============================================================
    IF v_item_type IS DISTINCT FROM 'service' AND v_item_type IS DISTINCT FROM 'cost' THEN
      
      -- Try to find material_id from raw_materials if product_id matches
      SELECT rm.id INTO v_material_id
      FROM public.raw_materials rm
      WHERE rm.id = v_product_id;
      
      -- Update raw_materials_stock (reduce quantity - returning to supplier)
      IF v_material_id IS NOT NULL THEN
        UPDATE public.raw_materials_stock
        SET quantity = quantity - v_quantity,
            updated_at = now()
        WHERE material_id = v_material_id 
          AND (branch_id = v_branch_id OR (branch_id IS NULL AND v_branch_id IS NULL));
        
        IF FOUND THEN
          v_stock_updated := v_stock_updated + 1;
        END IF;
      END IF;
      
      -- Insert movement record (always, for audit trail)
      INSERT INTO public.raw_material_movements (
        branch_id, material_id, product_id, movement_type, quantity,
        unit_cost, total_cost, reference_type, reference_id, reference_code,
        performed_by, movement_date, notes
      ) VALUES (
        v_branch_id,
        v_material_id,  -- May be NULL if not a raw material
        v_product_id,   -- Product ID for non-raw-material products
        'purchase_return',
        -v_quantity,    -- Negative = outgoing from our stock
        v_unit_price,
        v_line_net,
        'purchase_return',
        v_return_id,
        v_return_number,
        v_user_name,
        v_return_date,
        v_description
      );
      v_movements_inserted := v_movements_inserted + 1;
      
    END IF;
    -- For services: No stock update, no movement ledger (JE + line only)
    
  END LOOP;
  
  -- ============================================================
  -- STEP 11: Post-check returned_qty integrity (verify trigger worked)
  -- ============================================================
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_invoice_line_id := (v_item->>'invoice_line_id')::uuid;
    
    SELECT id, quantity, returned_qty, (quantity - COALESCE(returned_qty, 0)) as remaining
    INTO v_check_line
    FROM public.purchase_invoice_lines WHERE id = v_invoice_line_id;
    
    IF v_check_line.remaining < 0 THEN
      v_integrity_errors := array_append(v_integrity_errors, 
        format('Line %s has negative remaining: %s', v_invoice_line_id, v_check_line.remaining));
    END IF;
    
    IF COALESCE(v_check_line.returned_qty, 0) > v_check_line.quantity THEN
      v_integrity_errors := array_append(v_integrity_errors,
        format('Line %s returned_qty (%s) exceeds quantity (%s)', 
          v_invoice_line_id, v_check_line.returned_qty, v_check_line.quantity));
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
    'movementsInserted', v_movements_inserted,
    'stockUpdated', v_stock_updated,
    'totals', jsonb_build_object('subtotal', v_subtotal, 'taxAmount', v_tax_amount, 'totalAmount', v_total_amount),
    'meta', jsonb_build_object('workflowType', 'purchase_return_general_create_atomic', 'clientRequestId', v_client_request_id)
  );
  
  PERFORM public.complete_workflow_request(v_client_request_id, v_result);
  RETURN v_result;
  
EXCEPTION 
  WHEN lock_not_available THEN
    PERFORM public.fail_workflow_request(v_client_request_id, 'CONCURRENT_LOCK', 'Another operation in progress');
    RETURN jsonb_build_object('success', false, 'error_code', 'CONCURRENT_LOCK', 'error', 'Another operation in progress, please retry');
  WHEN OTHERS THEN
    PERFORM public.fail_workflow_request(v_client_request_id, SQLSTATE, SQLERRM);
    RAISE;
END;
$function$;

-- Grant execute to authenticated users
REVOKE ALL ON FUNCTION public.complete_purchase_return_general_atomic(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_general_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_general_atomic(jsonb) TO service_role;

-- ============================================================
-- COMMENT: Document the changes
-- ============================================================
COMMENT ON TABLE public.raw_material_movements IS 
  'Ledger for general inventory (raw materials, products) movements. Mirrors item_movements for jewelry items.';

COMMENT ON FUNCTION public.complete_purchase_return_general_atomic(jsonb) IS 
  'Atomic RPC for General Purchase Returns. Creates return header (in invoices), lines, JE, and stock movements. Rejects jewelry_item_id to enforce flow separation.';
