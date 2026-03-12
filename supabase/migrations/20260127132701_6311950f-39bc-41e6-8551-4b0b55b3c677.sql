-- ============================================================
-- P-PURCH-D2-1A: Canonical General Returns DB Cutover Migration (FIXED)
-- ============================================================

-- D2-1A.1) Convert purchase_return_lines.quantity to numeric for fractional support
ALTER TABLE public.purchase_return_lines
  ALTER COLUMN quantity TYPE numeric(18,4)
  USING quantity::numeric;

-- D2-1A.2) Add purchase_invoice_id column to purchase_return_lines if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema='public' AND table_name='purchase_return_lines' AND column_name='purchase_invoice_id'
  ) THEN
    ALTER TABLE public.purchase_return_lines ADD COLUMN purchase_invoice_id uuid;
  END IF;
END $$;

-- ============================================================
-- D2-1A.3) Create NEW trigger on purchase_return_lines for returned_qty sync
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_returned_qty_from_canonical_lines()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice_line_id uuid;
  v_new_returned_qty numeric;
BEGIN
  -- Determine which invoice_line_id was affected
  IF TG_OP = 'DELETE' THEN
    v_invoice_line_id := OLD.invoice_line_id;
  ELSE
    v_invoice_line_id := NEW.invoice_line_id;
  END IF;
  
  -- Skip if no invoice_line_id
  IF v_invoice_line_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  
  -- Calculate total returned quantity from ALL canonical general return lines
  SELECT COALESCE(SUM(prl.quantity), 0)
  INTO v_new_returned_qty
  FROM public.purchase_return_lines prl
  JOIN public.purchase_returns pr ON pr.id = prl.return_id
  WHERE prl.invoice_line_id = v_invoice_line_id
    AND pr.purchase_type = 'general'
    AND pr.status NOT IN ('voided', 'cancelled');
  
  -- Update the original purchase invoice line's returned_qty
  UPDATE public.purchase_invoice_lines
  SET returned_qty = v_new_returned_qty,
      updated_at = now()
  WHERE id = v_invoice_line_id;
  
  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- Create trigger on purchase_return_lines (NO WHEN clause - logic is inside function)
DROP TRIGGER IF EXISTS trg_sync_returned_qty_canonical ON public.purchase_return_lines;
CREATE TRIGGER trg_sync_returned_qty_canonical
  AFTER INSERT OR UPDATE OR DELETE ON public.purchase_return_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_returned_qty_from_canonical_lines();

-- ============================================================
-- D2-1A.4) Create trigger to sync total_returned_amount on purchase_returns header changes
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_invoice_totals_from_canonical_return()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_purchase_invoice_id uuid;
  v_total_returns numeric;
  v_original_total numeric;
  v_paid_amount numeric;
  v_purchase_type text;
BEGIN
  -- Get the purchase_type to filter only general returns
  IF TG_OP = 'DELETE' THEN
    v_purchase_invoice_id := OLD.purchase_invoice_id;
    v_purchase_type := OLD.purchase_type;
  ELSE
    v_purchase_invoice_id := NEW.purchase_invoice_id;
    v_purchase_type := NEW.purchase_type;
  END IF;
  
  -- Only process general returns
  IF v_purchase_type != 'general' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  
  -- Skip if no linked invoice
  IF v_purchase_invoice_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  
  -- Calculate total returns for this original invoice from ALL canonical returns
  SELECT COALESCE(SUM(pr.total_amount), 0)
  INTO v_total_returns
  FROM public.purchase_returns pr
  WHERE pr.purchase_invoice_id = v_purchase_invoice_id
    AND pr.purchase_type = 'general'
    AND pr.status NOT IN ('voided', 'cancelled');
  
  -- Get original invoice details
  SELECT total_amount, COALESCE(paid_amount, 0)
  INTO v_original_total, v_paid_amount
  FROM public.invoices
  WHERE id = v_purchase_invoice_id;
  
  -- Update original invoice totals
  UPDATE public.invoices
  SET total_returned_amount = v_total_returns,
      remaining_amount = v_original_total - v_paid_amount - v_total_returns,
      updated_at = now()
  WHERE id = v_purchase_invoice_id;
  
  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- Create trigger on purchase_returns (NO WHEN clause - logic is inside function)
DROP TRIGGER IF EXISTS trg_sync_invoice_totals_canonical ON public.purchase_returns;
CREATE TRIGGER trg_sync_invoice_totals_canonical
  AFTER INSERT OR UPDATE OR DELETE ON public.purchase_returns
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_invoice_totals_from_canonical_return();

-- ============================================================
-- D2-1A.5) Update v_returns_hub view to source general returns from canonical tables
-- ============================================================
CREATE OR REPLACE VIEW public.v_returns_hub AS
WITH unique_returns AS (
  SELECT 
    pr.id,
    pr.return_number,
    pr.status,
    pr.branch_id,
    pr.supplier_id,
    pr.return_date,
    pr.subtotal,
    pr.tax_amount,
    pr.total_amount,
    pr.journal_entry_id,
    pr.created_at
  FROM public.purchase_returns pr
  WHERE pr.purchase_type = 'import'
),
general_returns AS (
  SELECT 
    pr.id,
    pr.return_number,
    pr.status,
    pr.branch_id,
    pr.supplier_id,
    pr.return_date,
    pr.subtotal,
    pr.tax_amount,
    pr.total_amount,
    pr.journal_entry_id,
    pr.created_at
  FROM public.purchase_returns pr
  WHERE pr.purchase_type = 'general'
),
unique_return_items_count AS (
  SELECT pri.return_id, count(DISTINCT pri.jewelry_item_id) AS expected_count
  FROM public.purchase_return_items pri
  GROUP BY pri.return_id
),
unique_movements_count AS (
  SELECT im.reference_id AS return_id, count(*) AS actual_count
  FROM public.item_movements im
  WHERE im.movement_type = 'PURCHASE_RETURN' AND im.reference_type = 'purchase_return'
  GROUP BY im.reference_id
),
branch_not_cleared AS (
  SELECT pri.return_id, count(*) AS items_with_branch
  FROM public.purchase_return_items pri
  JOIN public.jewelry_items ji ON ji.id = pri.jewelry_item_id
  JOIN public.purchase_returns pr ON pr.id = pri.return_id
  WHERE pr.status IN ('confirmed', 'posted', 'completed')
    AND ji.branch_id IS NOT NULL
  GROUP BY pri.return_id
),
general_return_lines_count AS (
  SELECT prl.return_id, count(*) AS line_count
  FROM public.purchase_return_lines prl
  GROUP BY prl.return_id
)
-- Unique (Import) Returns
SELECT 
  ur.return_number,
  'unique'::text AS return_type,
  ur.id AS canonical_id,
  ur.status,
  ur.branch_id,
  ur.supplier_id,
  ur.return_date,
  ur.subtotal,
  ur.tax_amount,
  ur.total_amount,
  false AS mirror_exists,
  ur.journal_entry_id IS NOT NULL AS has_je,
  ur.journal_entry_id,
  COALESCE(uric.expected_count, 0)::integer AS expected_movement_count,
  COALESCE(umc.actual_count, 0)::integer AS actual_movement_count,
  CASE
    WHEN ur.status IN ('voided', 'cancelled') THEN false
    WHEN COALESCE(bnc.items_with_branch, 0) > 0 THEN true
    WHEN COALESCE(uric.expected_count, 0) IS DISTINCT FROM COALESCE(umc.actual_count, 0) THEN true
    ELSE false
  END AS has_drift,
  CASE
    WHEN ur.status IN ('voided', 'cancelled') THEN 'none'::text
    WHEN COALESCE(bnc.items_with_branch, 0) > 0 THEN 'branch_not_cleared'::text
    WHEN COALESCE(uric.expected_count, 0) IS DISTINCT FROM COALESCE(umc.actual_count, 0) THEN 'movement_mismatch'::text
    ELSE 'none'::text
  END AS drift_type,
  ur.created_at
FROM unique_returns ur
LEFT JOIN unique_return_items_count uric ON uric.return_id = ur.id
LEFT JOIN unique_movements_count umc ON umc.return_id = ur.id
LEFT JOIN branch_not_cleared bnc ON bnc.return_id = ur.id

UNION ALL

-- General Returns (from canonical purchase_returns table)
SELECT 
  gr.return_number,
  'general'::text AS return_type,
  gr.id AS canonical_id,
  gr.status,
  gr.branch_id,
  gr.supplier_id,
  gr.return_date,
  gr.subtotal,
  gr.tax_amount,
  gr.total_amount,
  false AS mirror_exists,
  gr.journal_entry_id IS NOT NULL AS has_je,
  gr.journal_entry_id,
  COALESCE(grlc.line_count, 0)::integer AS expected_movement_count,
  0::integer AS actual_movement_count,
  false AS has_drift,
  'none'::text AS drift_type,
  gr.created_at
FROM general_returns gr
LEFT JOIN general_return_lines_count grlc ON grlc.return_id = gr.id;

-- ============================================================
-- D2-1A.6) Patch the RPC to write to canonical tables
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
      SELECT pil.id, pil.product_id, pil.product_code, pil.line_number, pil.quantity,
             COALESCE(pil.returned_qty, 0) as returned_qty, pil.unit_price, pil.tax_rate, pil.description, pil.item_type
      INTO v_orig_line
      FROM public.purchase_invoice_lines pil
      WHERE pil.id = v_invoice_line_id
      FOR UPDATE NOWAIT;
      
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
  v_return_number := public.generate_purchase_return_number(NULL);
  v_je_number := public.generate_journal_entry_number();
  
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
  -- STEP 9: Create CANONICAL purchase_returns record (NOT invoices!)
  -- ============================================================
  INSERT INTO public.purchase_returns (
    id, return_number, return_date, purchase_type, supplier_id, branch_id,
    subtotal, tax_amount, total_amount, reason, notes, status, 
    journal_entry_id, purchase_invoice_id, created_by, created_at
  )
  VALUES (
    v_return_id, v_return_number, v_return_date, 'general', v_supplier_id, v_branch_id,
    v_subtotal, v_tax_amount, v_total_amount, v_reason, v_notes, 'confirmed',
    v_je_id, v_purchase_invoice_id, v_user_name, now()
  );
  
  -- ============================================================
  -- STEP 10: Create CANONICAL purchase_return_lines + Stock Movement
  -- ============================================================
  v_line_number := 0;
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_invoice_line_id := (v_item->>'invoice_line_id')::uuid;
    v_line_number := v_line_number + 1;
    
    SELECT pil.product_id, pil.product_code, pil.line_number, pil.unit_price, pil.tax_rate, pil.description, pil.item_type
    INTO v_orig_line
    FROM public.purchase_invoice_lines pil WHERE pil.id = v_invoice_line_id;
    
    v_product_id := COALESCE((v_item->>'product_id')::uuid, (v_item->>'item_id')::uuid, v_orig_line.product_id);
    v_product_code := COALESCE(v_item->>'product_code', v_item->>'item_code', v_orig_line.product_code);
    v_quantity := COALESCE((v_item->>'quantity')::numeric, (v_item->>'qty')::numeric, 1);
    v_description := COALESCE(v_item->>'description', v_orig_line.description, 'Return item');
    v_unit_price := COALESCE((v_item->>'unit_price')::numeric, v_orig_line.unit_price, 0);
    v_discount_amount := COALESCE((v_item->>'discount_amount')::numeric, 0);
    v_tax_rate := COALESCE((v_item->>'tax_rate')::numeric, v_orig_line.tax_rate, 15);
    v_item_type := COALESCE(v_item->>'item_type', v_orig_line.item_type, 'product');
    
    IF v_tax_rate > 1 THEN 
      v_vat_rate_decimal := v_tax_rate / 100; 
    ELSE 
      v_vat_rate_decimal := v_tax_rate;
    END IF;
    
    v_line_net := (v_quantity * v_unit_price) - v_discount_amount;
    v_line_tax := v_line_net * v_vat_rate_decimal;
    v_line_total := v_line_net + v_line_tax;
    
    -- INSERT into CANONICAL purchase_return_lines
    INSERT INTO public.purchase_return_lines (
      id, return_id, invoice_id, invoice_line_id, purchase_invoice_id,
      line_number, item_id, quantity, unit_cost, vat_rate, tax_amount, line_total,
      item_type, description, created_at
    )
    VALUES (
      gen_random_uuid(), v_return_id, v_purchase_invoice_id, v_invoice_line_id, v_purchase_invoice_id,
      v_line_number, v_product_id, v_quantity, v_unit_price, v_vat_rate_decimal, v_line_tax, v_line_total,
      v_item_type, v_description, now()
    );
    
    -- ============================================================
    -- STEP 10B: Stock Update + Movement Ledger
    -- ============================================================
    IF v_item_type IS DISTINCT FROM 'service' AND v_item_type IS DISTINCT FROM 'cost' THEN
      
      SELECT rm.id INTO v_material_id
      FROM public.raw_materials rm
      WHERE rm.id = v_product_id;
      
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
      
      INSERT INTO public.raw_material_movements (
        branch_id, material_id, product_id, movement_type, quantity,
        unit_cost, total_cost, reference_type, reference_id, reference_code,
        performed_by, movement_date, notes
      ) VALUES (
        v_branch_id,
        v_material_id,
        v_product_id,
        'purchase_return',
        -v_quantity,
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
    
  END LOOP;
  
  -- ============================================================
  -- STEP 11: Post-check returned_qty integrity
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
    'status', 'confirmed',
    'jeLineCount', v_lines_inserted,
    'returnLinesInserted', v_line_number,
    'movementsInserted', v_movements_inserted,
    'stockUpdated', v_stock_updated,
    'totals', jsonb_build_object('subtotal', v_subtotal, 'taxAmount', v_tax_amount, 'totalAmount', v_total_amount),
    'meta', jsonb_build_object('workflowType', 'purchase_return_general_create_atomic', 'clientRequestId', v_client_request_id, 'canonical', true)
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

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_general_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_returned_qty_from_canonical_lines() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_invoice_totals_from_canonical_return() TO authenticated;