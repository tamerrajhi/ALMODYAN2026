
-- ============================================================
-- STAGE-1 FIX PACK: item_movements Writers Fix
-- MODE: APPLY CHANGES (DB + RPC FUNCTIONS)
-- SCOPE: item_movements inserts/updates ONLY
-- ============================================================

-- ============================================================
-- 0) SAFETY BACKUP TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.rpc_backup_stage1_item_movements (
  id bigserial primary key,
  captured_at timestamptz not null default now(),
  proname text not null,
  oid oid not null,
  prosrc text not null
);

-- Backup the 7 broken writers BEFORE changes
INSERT INTO public.rpc_backup_stage1_item_movements (proname, oid, prosrc)
SELECT p.proname, p.oid, pg_get_functiondef(p.oid)
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
AND p.proname IN (
  'complete_imported_serial_transfer_atomic',
  'complete_pos_credit_note_atomic',
  'complete_purchase_invoice_atomic',
  'complete_purchase_return_atomic',
  'complete_purchase_return_unique_items_atomic',
  'complete_sales_invoice_atomic',
  'create_transfer_atomic'
);

-- Also backup create_transfer_v2
INSERT INTO public.rpc_backup_stage1_item_movements (proname, oid, prosrc)
SELECT p.proname, p.oid, pg_get_functiondef(p.oid)
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
AND p.proname = 'create_transfer_v2';

-- ============================================================
-- FIX #1: complete_imported_serial_transfer_atomic
-- REMOVE: item_code from INSERT
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_imported_serial_transfer_atomic(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_client_request_id   TEXT;
  v_from_branch_id      UUID;
  v_to_branch_id        UUID;
  v_transfer_date       DATE;
  v_notes               TEXT;
  v_created_by          TEXT;
  v_serial_numbers      TEXT[];
  v_action              TEXT;
  v_source              JSONB;
  v_import_batch_id     UUID;
  v_transfer_id         UUID;
  v_transfer_code       TEXT;
  v_journal_entry_id    UUID;
  v_journal_code        TEXT;
  v_total_cost          NUMERIC := 0;
  v_items_count         INT := 0;
  v_from_branch_name    TEXT;
  v_to_branch_name      TEXT;
  v_from_inventory_account UUID;
  v_to_inventory_account   UUID;
  v_item_id             UUID;
  v_item_branch         UUID;
  v_item_cost           NUMERIC;
  v_item_sold_at        TIMESTAMPTZ;
  v_item_batch_id       UUID;
  v_locked_items        UUID[];
  v_serial              TEXT;
  v_workflow_result     JSONB;
  v_result              JSONB;
  v_error_code          TEXT;
  v_error_message       TEXT;
BEGIN
  -- 1) Extract params
  v_client_request_id := p_payload->>'client_request_id';
  v_from_branch_id    := (p_payload->>'from_branch_id')::UUID;
  v_to_branch_id      := (p_payload->>'to_branch_id')::UUID;
  v_transfer_date     := COALESCE((p_payload->>'transfer_date')::DATE, CURRENT_DATE);
  v_notes             := p_payload->>'notes';
  v_created_by        := COALESCE(p_payload->>'created_by', 'user');
  v_action            := COALESCE(p_payload->>'action', 'post');
  v_source            := p_payload->'source';

  IF p_payload ? 'serial_numbers' THEN
    SELECT array_agg(elem::TEXT)
    INTO v_serial_numbers
    FROM jsonb_array_elements_text(p_payload->'serial_numbers') AS elem;
  ELSIF p_payload ? 'item_codes' THEN
    SELECT array_agg(elem::TEXT)
    INTO v_serial_numbers
    FROM jsonb_array_elements_text(p_payload->'item_codes') AS elem;
  END IF;

  IF v_source IS NOT NULL AND v_source->>'type' = 'import_batch' THEN
    v_import_batch_id := (v_source->>'import_batch_id')::UUID;
  END IF;

  IF v_client_request_id IS NULL OR v_client_request_id = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: client_request_id مطلوب';
  END IF;
  IF v_from_branch_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: الفرع المصدر مطلوب';
  END IF;
  IF v_to_branch_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: الفرع المستهدف مطلوب';
  END IF;
  IF v_from_branch_id = v_to_branch_id THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: لا يمكن النقل لنفس الفرع';
  END IF;
  IF v_serial_numbers IS NULL OR array_length(v_serial_numbers, 1) IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: يجب اختيار سيريال واحد على الأقل';
  END IF;

  -- 2) Canonical begin
  PERFORM pg_advisory_xact_lock(hashtext(v_client_request_id));

  v_workflow_result := public.begin_workflow_request(
    v_client_request_id,
    'imported_serial_transfer',
    p_payload
  );

  IF v_workflow_result->>'status' = 'succeeded' THEN
    SELECT result INTO v_result
    FROM pos_workflow_requests
    WHERE client_request_id = v_client_request_id::UUID;
    IF v_result IS NOT NULL THEN
      RETURN v_result;
    END IF;
    RETURN v_workflow_result;
  ELSIF v_workflow_result->>'status' = 'failed' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', v_workflow_result->>'error_code',
      'error_message', v_workflow_result->>'error_message'
    );
  ELSIF v_workflow_result->>'status' <> 'processing' THEN
    RAISE EXCEPTION 'WORKFLOW_ERROR: حالة غير متوقعة %', v_workflow_result->>'status';
  END IF;

  -- 3) Branch names
  SELECT branch_name INTO v_from_branch_name
  FROM branches WHERE id = v_from_branch_id AND is_active = TRUE;
  IF NOT FOUND THEN
    v_error_code := 'VALIDATION_ERROR';
    v_error_message := 'الفرع المصدر غير موجود أو غير نشط';
    PERFORM public.core_workflow_failed(v_client_request_id, v_error_code, v_error_message);
    RETURN jsonb_build_object('success', false, 'error_code', v_error_code, 'error_message', v_error_message);
  END IF;

  SELECT branch_name INTO v_to_branch_name
  FROM branches WHERE id = v_to_branch_id AND is_active = TRUE;
  IF NOT FOUND THEN
    v_error_code := 'VALIDATION_ERROR';
    v_error_message := 'الفرع المستهدف غير موجود أو غير نشط';
    PERFORM public.core_workflow_failed(v_client_request_id, v_error_code, v_error_message);
    RETURN jsonb_build_object('success', false, 'error_code', v_error_code, 'error_message', v_error_message);
  END IF;

  -- 4) Resolve inventory accounts per branch
  SELECT COALESCE(bia.imported_pieces_account_id, bia.general_inventory_account_id)
  INTO v_from_inventory_account
  FROM branch_inventory_accounts bia
  WHERE bia.branch_id = v_from_branch_id;

  IF v_from_inventory_account IS NULL THEN
    v_error_code := 'MISSING_ACCOUNT';
    v_error_message := 'لم يتم إعداد حساب المخزون (قطع مستوردة/عام) للفرع المصدر';
    PERFORM public.core_workflow_failed(v_client_request_id, v_error_code, v_error_message);
    RETURN jsonb_build_object('success', false, 'error_code', v_error_code, 'error_message', v_error_message);
  END IF;

  SELECT COALESCE(bia.imported_pieces_account_id, bia.general_inventory_account_id)
  INTO v_to_inventory_account
  FROM branch_inventory_accounts bia
  WHERE bia.branch_id = v_to_branch_id;

  IF v_to_inventory_account IS NULL THEN
    v_error_code := 'MISSING_ACCOUNT';
    v_error_message := 'لم يتم إعداد حساب المخزون (قطع مستوردة/عام) للفرع المستهدف';
    PERFORM public.core_workflow_failed(v_client_request_id, v_error_code, v_error_message);
    RETURN jsonb_build_object('success', false, 'error_code', v_error_code, 'error_message', v_error_message);
  END IF;

  -- 5) Lock and validate serials
  v_locked_items := ARRAY[]::UUID[];
  
  FOR v_serial IN SELECT unnest(v_serial_numbers)
  LOOP
    BEGIN
      SELECT id, branch_id, cost, sold_at, batch_id
      INTO v_item_id, v_item_branch, v_item_cost, v_item_sold_at, v_item_batch_id
      FROM jewelry_items
      WHERE item_code = v_serial
      FOR UPDATE NOWAIT;
    EXCEPTION WHEN lock_not_available THEN
      v_error_code := 'SERIAL_LOCKED';
      v_error_message := format('السيريال %s مقفل حالياً من عملية أخرى', v_serial);
      PERFORM public.core_workflow_failed(v_client_request_id, v_error_code, v_error_message);
      RETURN jsonb_build_object('success', false, 'error_code', v_error_code, 'error_message', v_error_message);
    END;

    IF v_item_id IS NULL THEN
      v_error_code := 'SERIAL_NOT_FOUND';
      v_error_message := format('السيريال %s غير موجود', v_serial);
      PERFORM public.core_workflow_failed(v_client_request_id, v_error_code, v_error_message);
      RETURN jsonb_build_object('success', false, 'error_code', v_error_code, 'error_message', v_error_message);
    END IF;

    IF v_item_branch <> v_from_branch_id THEN
      v_error_code := 'SERIAL_WRONG_BRANCH';
      v_error_message := format('السيريال %s ليس في الفرع المصدر', v_serial);
      PERFORM public.core_workflow_failed(v_client_request_id, v_error_code, v_error_message);
      RETURN jsonb_build_object('success', false, 'error_code', v_error_code, 'error_message', v_error_message);
    END IF;

    IF v_item_sold_at IS NOT NULL THEN
      v_error_code := 'SERIAL_SOLD';
      v_error_message := format('السيريال %s تم بيعه ولا يمكن نقله', v_serial);
      PERFORM public.core_workflow_failed(v_client_request_id, v_error_code, v_error_message);
      RETURN jsonb_build_object('success', false, 'error_code', v_error_code, 'error_message', v_error_message);
    END IF;

    IF v_import_batch_id IS NOT NULL AND v_item_batch_id <> v_import_batch_id THEN
      v_error_code := 'SERIAL_NOT_IN_BATCH';
      v_error_message := format('السيريال %s لا ينتمي لدفعة الاستيراد المحددة', v_serial);
      PERFORM public.core_workflow_failed(v_client_request_id, v_error_code, v_error_message);
      RETURN jsonb_build_object('success', false, 'error_code', v_error_code, 'error_message', v_error_message);
    END IF;

    v_locked_items := array_append(v_locked_items, v_item_id);
    v_total_cost := v_total_cost + COALESCE(v_item_cost, 0);
    v_items_count := v_items_count + 1;
  END LOOP;

  -- 6) Generate transfer code
  v_transfer_code := public.generate_imported_serial_transfer_code();

  -- 7) Create transfer header
  INSERT INTO transfers (
    id, transfer_code, transfer_kind, from_branch_id, to_branch_id, 
    transfer_date, status, notes, total_items, created_by, created_at
  ) VALUES (
    gen_random_uuid(), v_transfer_code, 'imported_serial', v_from_branch_id, v_to_branch_id,
    v_transfer_date, CASE WHEN v_action = 'post' THEN 'posted' ELSE 'draft' END,
    v_notes, v_items_count, v_created_by, now()
  )
  RETURNING id INTO v_transfer_id;

  -- 8) Create transfer_items and update jewelry_items
  FOR v_serial IN SELECT unnest(v_serial_numbers)
  LOOP
    SELECT id, cost INTO v_item_id, v_item_cost
    FROM jewelry_items WHERE item_code = v_serial;

    INSERT INTO transfer_items (transfer_id, item_id, item_code, cost)
    VALUES (v_transfer_id, v_item_id, v_serial, COALESCE(v_item_cost, 0));

    UPDATE jewelry_items
    SET branch_id = v_to_branch_id, updated_at = now()
    WHERE id = v_item_id;

    -- FIX: REMOVED item_code from item_movements INSERT
    INSERT INTO item_movements (
      item_id, movement_type, reference_type, reference_id,
      from_branch_id, to_branch_id, movement_date, performed_by, notes, cost
    ) VALUES (
      v_item_id, 'transfer', 'imported_serial_transfer', v_transfer_id,
      v_from_branch_id, v_to_branch_id, v_transfer_date, v_created_by, v_notes,
      COALESCE(v_item_cost, 0)
    );
  END LOOP;

  -- 9) If posting, create JE
  IF v_action = 'post' AND v_total_cost > 0 THEN
    v_journal_code := public.generate_journal_entry_number();

    INSERT INTO journal_entries (
      id, entry_number, entry_date, reference_type, reference_id,
      description, total_debit, total_credit, status, branch_id, created_by
    ) VALUES (
      gen_random_uuid(), v_journal_code, v_transfer_date, 'imported_serial_transfer', v_transfer_id,
      format('نقل قطع مستوردة من %s إلى %s - %s', v_from_branch_name, v_to_branch_name, v_transfer_code),
      v_total_cost, v_total_cost, 'posted', v_from_branch_id, v_created_by
    )
    RETURNING id INTO v_journal_entry_id;

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES
      (v_journal_entry_id, v_to_inventory_account, v_total_cost, 0, 
       format('استلام مخزون من %s', v_from_branch_name)),
      (v_journal_entry_id, v_from_inventory_account, 0, v_total_cost, 
       format('نقل مخزون إلى %s', v_to_branch_name));

    UPDATE transfers SET journal_entry_id = v_journal_entry_id WHERE id = v_transfer_id;

    PERFORM public.validate_journal_entry_totals(v_journal_entry_id);

    PERFORM public.link_item_movements_to_journal(
      'imported_serial_transfer', v_transfer_id, v_journal_entry_id
    );
  END IF;

  -- 10) Build result
  v_result := jsonb_build_object(
    'success', true,
    'transfer_id', v_transfer_id,
    'transfer_code', v_transfer_code,
    'journal_entry_id', v_journal_entry_id,
    'journal_code', v_journal_code,
    'items_count', v_items_count,
    'total_cost', v_total_cost,
    'from_branch', v_from_branch_name,
    'to_branch', v_to_branch_name,
    'status', CASE WHEN v_action = 'post' THEN 'posted' ELSE 'draft' END
  );

  PERFORM public.core_workflow_success(v_client_request_id, v_transfer_id, v_result);

  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  v_error_code := COALESCE(SQLSTATE, 'UNKNOWN_ERROR');
  v_error_message := COALESCE(SQLERRM, 'خطأ غير معروف');
  
  BEGIN
    PERFORM public.core_workflow_failed(v_client_request_id, v_error_code, v_error_message);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  
  RETURN jsonb_build_object(
    'success', false,
    'error_code', v_error_code,
    'error_message', v_error_message
  );
END;
$function$;

-- ============================================================
-- FIX #2: complete_pos_credit_note_atomic
-- REMOVE: sale_price, Replace unit_cost with cost
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_pos_credit_note_atomic(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
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
  v_workflow_id UUID;
  
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
  v_line_order INT := 0;
  
  v_result JSONB;
BEGIN
  -- STEP 1: Extract and validate input parameters
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

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'branch_id is required';
  END IF;
  
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_id is required';
  END IF;
  
  IF jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'At least one item is required';
  END IF;
  
  IF v_credit_note_type NOT IN ('financial', 'return') THEN
    RAISE EXCEPTION 'credit_note_type must be "financial" or "return"';
  END IF;

  -- STEP 2: Refund method validation
  IF NOT v_is_draft THEN
    IF v_refund_method = 'card' AND v_bank_account_id IS NULL THEN
      RAISE EXCEPTION 'bank_account_id is required for card refunds';
    END IF;
    
    IF v_refund_method = 'split' THEN
      IF v_card_amount > 0 AND v_bank_account_id IS NULL THEN
        RAISE EXCEPTION 'bank_account_id is required when card_amount > 0 in split refund';
      END IF;
    END IF;
  END IF;

  -- STEP 3: Idempotency check with advisory lock
  v_request_hash := abs(hashtext(v_client_request_id));
  PERFORM pg_advisory_xact_lock(v_request_hash);
  
  SELECT status, result INTO v_existing_status, v_existing_result
  FROM pos_workflow_requests
  WHERE client_request_id = v_client_request_id;
  
  IF FOUND THEN
    IF v_existing_status = 'completed' THEN
      RETURN v_existing_result;
    ELSIF v_existing_status = 'failed' THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Request already in progress: %', v_client_request_id;
    END IF;
  END IF;
  
  PERFORM public.begin_workflow_request(v_client_request_id, 'pos_credit_note', p_payload);

  -- STEP 4: Generate or use provided credit note ID
  IF v_credit_note_id IS NOT NULL THEN
    SELECT status INTO v_existing_status
    FROM credit_notes
    WHERE id = v_credit_note_id;
    
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Credit note not found: %', v_credit_note_id;
    END IF;
    
    IF v_existing_status NOT IN ('pending', 'draft') THEN
      RAISE EXCEPTION 'Cannot modify credit note with status: %', v_existing_status;
    END IF;
    
    DELETE FROM credit_note_items WHERE credit_note_id = v_credit_note_id;
  ELSE
    v_credit_note_id := gen_random_uuid();
  END IF;

  -- STEP 5: Account preflight check (only for posting)
  IF NOT v_is_draft THEN
    SELECT id INTO v_cash_account_id
    FROM chart_of_accounts
    WHERE account_code = '1101' AND is_active = true;
    
    IF v_cash_account_id IS NULL AND v_refund_method IN ('cash', 'split') THEN
      RAISE EXCEPTION 'Cash account (1101) not found or inactive';
    END IF;
    
    SELECT id INTO v_sales_returns_account_id
    FROM chart_of_accounts
    WHERE account_code = '4102' AND is_active = true;
    
    IF v_sales_returns_account_id IS NULL THEN
      RAISE EXCEPTION 'Sales Returns account (4102) not found or inactive';
    END IF;
    
    SELECT id INTO v_vat_account_id
    FROM chart_of_accounts
    WHERE account_code = '2104' AND is_active = true;
    
    IF v_vat_account_id IS NULL THEN
      RAISE EXCEPTION 'VAT Payable account (2104) not found or inactive';
    END IF;
    
    IF v_bank_account_id IS NOT NULL THEN
      SELECT id INTO v_bank_account_uuid
      FROM chart_of_accounts
      WHERE id = v_bank_account_id AND is_active = true;
      
      IF v_bank_account_uuid IS NULL THEN
        RAISE EXCEPTION 'Bank account not found or inactive: %', v_bank_account_id;
      END IF;
    END IF;
    
    SELECT account_id INTO v_customer_account_id
    FROM customers
    WHERE id = v_customer_id;
    
    IF v_customer_account_id IS NULL THEN
      RAISE EXCEPTION 'Customer does not have a linked accounting sub-account';
    END IF;
    
    IF v_credit_note_type = 'return' THEN
      SELECT bia.general_inventory_account_id INTO v_inventory_account_id
      FROM branch_inventory_accounts bia
      WHERE bia.branch_id = v_branch_id;
      
      IF v_inventory_account_id IS NULL THEN
        SELECT id INTO v_inventory_account_id
        FROM chart_of_accounts
        WHERE account_code = '1301' AND is_active = true;
      END IF;
      
      IF v_inventory_account_id IS NULL THEN
        RAISE EXCEPTION 'Inventory account not found for branch';
      END IF;
      
      SELECT id INTO v_cogs_account_id
      FROM chart_of_accounts
      WHERE account_code = '5101' AND is_active = true;
      
      IF v_cogs_account_id IS NULL THEN
        RAISE EXCEPTION 'COGS account (5101) not found or inactive';
      END IF;
    END IF;
  END IF;

  -- STEP 6: Pre-calculate totals and validate items
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_item_id := (v_item->>'jewelry_item_id')::UUID;
    v_unit_price := COALESCE((v_item->>'unit_price')::NUMERIC, 0);
    
    IF v_item_id IS NULL THEN
      RAISE EXCEPTION 'jewelry_item_id is required for each item';
    END IF;
    
    IF v_credit_note_type = 'return' THEN
      SELECT sale_status, branch_id INTO v_current_status, v_current_branch
      FROM jewelry_items
      WHERE id = v_item_id;
      
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Jewelry item not found: %', v_item_id;
      END IF;
      
      IF NOT v_is_draft THEN
        IF v_current_status != 'sold' THEN
          RAISE EXCEPTION 'Item % is not sold (status: %), cannot return', v_item_id, v_current_status;
        END IF;
      END IF;
    END IF;
    
    v_item_tax := ROUND(v_unit_price * (v_tax_rate / 100), 2);
    v_item_total := ROUND(v_unit_price + v_item_tax, 2);
    
    v_subtotal := v_subtotal + v_unit_price;
    v_total_tax := v_total_tax + v_item_tax;
    v_total_amount := v_total_amount + v_item_total;
    
    IF v_credit_note_type = 'return' THEN
      SELECT COALESCE(cost_price, 0) INTO v_item_cost
      FROM jewelry_items
      WHERE id = v_item_id;
      
      v_total_cogs := v_total_cogs + COALESCE(v_item_cost, 0);
    END IF;
  END LOOP;
  
  v_subtotal := ROUND(v_subtotal, 2);
  v_total_tax := ROUND(v_total_tax, 2);
  v_total_amount := ROUND(v_total_amount, 2);
  v_total_cogs := ROUND(v_total_cogs, 2);

  IF NOT v_is_draft AND v_refund_method = 'split' THEN
    IF ROUND(v_cash_amount + v_card_amount, 2) != v_total_amount THEN
      RAISE EXCEPTION 'Split amounts (cash: %, card: %) must equal total amount (%)', 
        v_cash_amount, v_card_amount, v_total_amount;
    END IF;
  END IF;

  -- STEP 7: Generate credit note number
  SELECT credit_note_number INTO v_credit_note_number
  FROM credit_notes
  WHERE id = v_credit_note_id;
  
  IF v_credit_note_number IS NULL THEN
    SELECT 'CN-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || 
           LPAD((COALESCE(MAX(
             NULLIF(REGEXP_REPLACE(credit_note_number, '[^0-9]', '', 'g'), '')::INTEGER
           ), 0) + 1)::TEXT, 4, '0')
    INTO v_credit_note_number
    FROM credit_notes
    WHERE credit_note_number LIKE 'CN-' || TO_CHAR(NOW(), 'YYYYMMDD') || '%';
  END IF;

  -- STEP 8: Create/Update credit note header (DRAFT first)
  INSERT INTO credit_notes (
    id, credit_note_number, credit_note_date, customer_id, branch_id,
    sale_id, credit_note_type, reason, notes, subtotal, tax_amount,
    total_amount, status, created_at
  ) VALUES (
    v_credit_note_id, v_credit_note_number, v_credit_note_date, v_customer_id, v_branch_id,
    v_linked_sale_id, v_credit_note_type, v_reason, v_notes, v_subtotal, v_total_tax,
    v_total_amount, 'pending', NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    customer_id = EXCLUDED.customer_id,
    branch_id = EXCLUDED.branch_id,
    sale_id = EXCLUDED.sale_id,
    credit_note_type = EXCLUDED.credit_note_type,
    reason = EXCLUDED.reason,
    notes = EXCLUDED.notes,
    subtotal = EXCLUDED.subtotal,
    tax_amount = EXCLUDED.tax_amount,
    total_amount = EXCLUDED.total_amount,
    updated_at = NOW();

  -- STEP 9: Insert credit note items
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_item_id := (v_item->>'jewelry_item_id')::UUID;
    v_unit_price := COALESCE((v_item->>'unit_price')::NUMERIC, 0);
    v_item_tax := ROUND(v_unit_price * (v_tax_rate / 100), 2);
    v_item_total := ROUND(v_unit_price + v_item_tax, 2);
    
    INSERT INTO credit_note_items (
      credit_note_id, jewelry_item_id, description, quantity, unit_price,
      tax_rate, tax_amount, total_amount
    ) VALUES (
      v_credit_note_id, v_item_id, COALESCE(v_item->>'description', 'Credit Note Item'), 1, v_unit_price,
      v_tax_rate, v_item_tax, v_item_total
    );
  END LOOP;

  -- STEP 10: If draft mode, stop here
  IF v_is_draft THEN
    PERFORM public.core_workflow_success(v_workflow_id, v_credit_note_id, v_result);
    
    RETURN jsonb_build_object(
      'success', true,
      'credit_note_id', v_credit_note_id,
      'credit_note_number', v_credit_note_number,
      'status', 'pending',
      'is_draft', true,
      'message', 'Credit note saved as draft'
    );
  END IF;

  -- STEP 11: POSTING MODE - Update jewelry items (return type only)
  IF v_credit_note_type = 'return' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
      v_item_id := (v_item->>'jewelry_item_id')::UUID;
      
      UPDATE jewelry_items
      SET sale_status = 'available',
          sold_at = NULL,
          updated_at = NOW()
      WHERE id = v_item_id
        AND sale_status = 'sold';
      
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Failed to update item status for: %', v_item_id;
      END IF;
    END LOOP;
  END IF;

  -- STEP 12: Create journal entry
  v_journal_entry_id := gen_random_uuid();
  
  SELECT 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || 
         LPAD((COALESCE(MAX(
           NULLIF(REGEXP_REPLACE(entry_number, '[^0-9]', '', 'g'), '')::INTEGER
         ), 0) + 1)::TEXT, 4, '0')
  INTO v_journal_number
  FROM journal_entries
  WHERE entry_number LIKE 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '%';

  INSERT INTO journal_entries (
    id, entry_number, entry_date, reference_type, reference_id,
    description, total_debit, total_credit, status, branch_id, created_at
  ) VALUES (
    v_journal_entry_id, v_journal_number, v_credit_note_date, 'credit_note', v_credit_note_id,
    'Credit Note: ' || v_credit_note_number,
    v_total_amount + CASE WHEN v_credit_note_type = 'return' THEN v_total_cogs ELSE 0 END,
    v_total_amount + CASE WHEN v_credit_note_type = 'return' THEN v_total_cogs ELSE 0 END,
    'posted', v_branch_id, NOW()
  );

  -- STEP 13: Create journal entry lines
  v_line_order := v_line_order + 1;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
  VALUES (v_journal_entry_id, v_sales_returns_account_id, v_subtotal, 0, 'Sales Returns - Credit Note');
  
  IF v_total_tax > 0 THEN
    v_line_order := v_line_order + 1;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_journal_entry_id, v_vat_account_id, v_total_tax, 0, 'VAT Reversal - Credit Note');
  END IF;
  
  IF v_refund_method = 'cash' THEN
    v_line_order := v_line_order + 1;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_journal_entry_id, v_cash_account_id, 0, v_total_amount, 'Cash Refund - Credit Note');
    
  ELSIF v_refund_method = 'card' THEN
    v_line_order := v_line_order + 1;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_journal_entry_id, v_bank_account_uuid, 0, v_total_amount, 'Card Refund - Credit Note');
    
  ELSIF v_refund_method = 'split' THEN
    IF v_cash_amount > 0 THEN
      v_line_order := v_line_order + 1;
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
      VALUES (v_journal_entry_id, v_cash_account_id, 0, v_cash_amount, 'Cash Refund (Split) - Credit Note');
    END IF;
    
    IF v_card_amount > 0 THEN
      v_line_order := v_line_order + 1;
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
      VALUES (v_journal_entry_id, v_bank_account_uuid, 0, v_card_amount, 'Card Refund (Split) - Credit Note');
    END IF;
    
  ELSIF v_refund_method = 'credit' THEN
    v_line_order := v_line_order + 1;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_journal_entry_id, v_customer_account_id, 0, v_total_amount, 'Store Credit - Credit Note');
  END IF;
  
  -- COGS reversal entries for return type
  IF v_credit_note_type = 'return' AND v_total_cogs > 0 THEN
    v_line_order := v_line_order + 1;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_journal_entry_id, v_inventory_account_id, v_total_cogs, 0, 'Inventory Restored - Credit Note Return');
    
    v_line_order := v_line_order + 1;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_journal_entry_id, v_cogs_account_id, 0, v_total_cogs, 'COGS Reversal - Credit Note Return');
  END IF;

  -- STEP 14: Insert item movements (return type only)
  -- FIX: REMOVED unit_cost and sale_price, use cost instead
  IF v_credit_note_type = 'return' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
      v_item_id := (v_item->>'jewelry_item_id')::UUID;
      v_unit_price := COALESCE((v_item->>'unit_price')::NUMERIC, 0);
      
      SELECT cost_price INTO v_item_cost
      FROM jewelry_items
      WHERE id = v_item_id;
      
      INSERT INTO item_movements (
        item_id,
        movement_type,
        movement_date,
        from_branch_id,
        to_branch_id,
        reference_type,
        reference_id,
        cost,
        notes,
        performed_by,
        journal_entry_id
      ) VALUES (
        v_item_id,
        'CREDIT_NOTE_RETURN',
        NOW(),
        NULL,
        v_branch_id,
        'credit_note',
        v_credit_note_id,
        COALESCE(v_item_cost, 0),
        'Credit Note Return: ' || v_credit_note_number,
        auth.uid(),
        v_journal_entry_id
      );
    END LOOP;
  END IF;

  -- STEP 15: Update credit note to issued status
  UPDATE credit_notes
  SET status = 'issued',
      journal_entry_id = v_journal_entry_id,
      updated_at = NOW()
  WHERE id = v_credit_note_id;

  -- STEP 16: Complete workflow
  v_result := jsonb_build_object(
    'success', true,
    'credit_note_id', v_credit_note_id,
    'credit_note_number', v_credit_note_number,
    'journal_entry_id', v_journal_entry_id,
    'journal_number', v_journal_number,
    'subtotal', v_subtotal,
    'tax_amount', v_total_tax,
    'total_amount', v_total_amount,
    'cogs_reversed', v_total_cogs,
    'status', 'issued',
    'credit_note_type', v_credit_note_type,
    'refund_method', v_refund_method
  );
  
  PERFORM public.core_workflow_success(v_workflow_id, v_credit_note_id, v_result);
  
  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  PERFORM public.core_workflow_failed(v_client_request_id, 'INTERNAL_ERROR', SQLERRM);
  RAISE;
END;
$function$;

-- ============================================================
-- FIX #3: complete_purchase_return_atomic  
-- REPLACE: jewelry_item_id with item_id in item_movements INSERT
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_purchase_return_atomic(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_client_request_id text;
  v_gate jsonb;
  v_workflow_action text;
  v_cached_result jsonb;
  v_user_id uuid;
  v_user_name text;
  v_branch_id uuid;
  v_invoice_id uuid;
  v_return_number text;
  v_return_id uuid;
  v_journal_entry_id uuid;
  v_journal_number text;
  v_return_date date;
  v_reason text;
  v_notes text;
  v_status text;
  v_items jsonb;
  v_item jsonb;
  v_jewelry_item_id uuid;
  v_item_record record;
  v_subtotal numeric := 0;
  v_tax_amount numeric := 0;
  v_total_amount numeric := 0;
  v_supplier_id uuid;
  v_supplier_account_id uuid;
  v_inventory_account_id uuid;
  v_vat_input_account_id uuid;
  v_movement_ids uuid[] := ARRAY[]::uuid[];
  v_movement_id uuid;
  v_lock_key bigint;
BEGIN
  -- 1) EXTRACT & VALIDATE PAYLOAD
  v_client_request_id := p_payload->>'client_request_id';
  v_user_id := NULLIF(p_payload->>'user_id','')::uuid;
  v_user_name := COALESCE(p_payload->>'user_name', v_user_id::text);
  v_branch_id := NULLIF(p_payload->>'branch_id','')::uuid;
  v_invoice_id :=
    COALESCE(
      NULLIF(p_payload->>'purchase_invoice_id','')::uuid,
      NULLIF(p_payload->>'original_invoice_id','')::uuid,
      NULLIF(p_payload->>'linked_invoice_id','')::uuid,
      NULLIF(p_payload->>'invoice_id','')::uuid
    );
  v_return_date := COALESCE(NULLIF(p_payload->>'return_date','')::date, CURRENT_DATE);
  v_reason := p_payload->>'reason';
  v_notes := p_payload->>'notes';
  v_status := COALESCE(NULLIF(p_payload->>'status',''), 'posted');
  v_items := p_payload->'items';

  IF v_client_request_id IS NULL OR btrim(v_client_request_id) = '' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_REQUEST_ID', 'error', 'client_request_id is required');
  END IF;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_USER', 'error', 'user_id is required');
  END IF;
  IF v_invoice_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_INVOICE', 'error', 'invoice id is required');
  END IF;
  IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_ITEMS', 'error', 'items array is required');
  END IF;

  -- 2) ADVISORY LOCK
  v_lock_key := abs(hashtext(v_client_request_id));
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- 3) IDEMPOTENCY GATE
  v_gate := public.begin_workflow_request(v_client_request_id, 'purchase_return', p_payload);
  v_workflow_action := v_gate->>'action';
  v_cached_result := v_gate->'result';

  IF v_workflow_action = 'return_cached' THEN
    RETURN COALESCE(v_cached_result, jsonb_build_object('success', true, 'idempotent', true));
  ELSIF v_workflow_action = 'reject' THEN
    RETURN jsonb_build_object('success', false, 'error_code', COALESCE(v_gate->>'error_code','DUPLICATE_REQUEST'), 'error', COALESCE(v_gate->>'error_message','Request already processed'));
  ELSIF v_workflow_action = 'conflict' THEN
    RETURN jsonb_build_object('success', false, 'error_code', COALESCE(v_gate->>'error_code','CONFLICT'), 'error', COALESCE(v_gate->>'error_message','Request is being processed'));
  END IF;

  -- 4) GET INVOICE & SUPPLIER INFO
  SELECT i.supplier_id, s.account_id
    INTO v_supplier_id, v_supplier_account_id
  FROM public.invoices i
  JOIN public.suppliers s ON s.id = i.supplier_id
  WHERE i.id = v_invoice_id
    AND i.invoice_type = 'purchase';

  IF v_supplier_id IS NULL THEN
    PERFORM core_workflow_failed(v_client_request_id, 'INVOICE_NOT_FOUND', 'Purchase invoice not found');
    RETURN jsonb_build_object('success', false, 'error_code', 'INVOICE_NOT_FOUND', 'error', 'Purchase invoice not found');
  END IF;

  -- 5) GET SYSTEM ACCOUNTS
  SELECT id INTO v_inventory_account_id FROM public.chart_of_accounts WHERE account_code = '1301' LIMIT 1;
  SELECT id INTO v_vat_input_account_id FROM public.chart_of_accounts WHERE account_code = '2105' LIMIT 1;

  IF v_inventory_account_id IS NULL OR v_vat_input_account_id IS NULL THEN
    PERFORM core_workflow_failed(v_client_request_id, 'MISSING_ACCOUNTS', 'Required system accounts not found');
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_ACCOUNTS', 'error', 'Required system accounts not found');
  END IF;

  -- 6) GENERATE RETURN NUMBER
  v_return_number := public.generate_document_code('PR-RET');

  -- 7) SUBTRANSACTION: ALL WRITES
  BEGIN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
      v_jewelry_item_id := NULLIF(v_item->>'jewelry_item_id','')::uuid;
      IF v_jewelry_item_id IS NULL THEN
        RAISE EXCEPTION 'jewelry_item_id is required in items';
      END IF;

      SELECT ji.* INTO v_item_record
      FROM public.jewelry_items ji
      WHERE ji.id = v_jewelry_item_id
      FOR UPDATE;

      IF v_item_record IS NULL THEN
        RAISE EXCEPTION 'Item not found: %', v_jewelry_item_id;
      END IF;

      IF v_item_record.status <> 'in_stock' THEN
        RAISE EXCEPTION 'Item % is not in stock (status: %)', v_item_record.item_code, v_item_record.status;
      END IF;
    END LOOP;

    SELECT
      COALESCE(SUM((item->>'unit_price')::numeric), 0),
      COALESCE(SUM((item->>'tax_amount')::numeric), 0),
      COALESCE(SUM((item->>'total_amount')::numeric), 0)
    INTO v_subtotal, v_tax_amount, v_total_amount
    FROM jsonb_array_elements(v_items) AS item;

    INSERT INTO public.purchase_returns (
      return_number, purchase_invoice_id, supplier_id, branch_id, return_date,
      reason, notes, status, subtotal, tax_amount, total_amount, processed_by
    ) VALUES (
      v_return_number, v_invoice_id, v_supplier_id, v_branch_id, v_return_date,
      v_reason, v_notes, v_status, v_subtotal, v_tax_amount, v_total_amount, v_user_name
    ) RETURNING id INTO v_return_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
      v_jewelry_item_id := NULLIF(v_item->>'jewelry_item_id','')::uuid;

      INSERT INTO public.purchase_return_items (
        return_id, jewelry_item_id, quantity, unit_price, tax_rate, tax_amount, total_amount
      ) VALUES (
        v_return_id, v_jewelry_item_id,
        COALESCE(NULLIF(v_item->>'quantity','')::integer, 1),
        COALESCE(NULLIF(v_item->>'unit_price','')::numeric, 0),
        COALESCE(NULLIF(v_item->>'tax_rate','')::numeric, 15),
        COALESCE(NULLIF(v_item->>'tax_amount','')::numeric, 0),
        COALESCE(NULLIF(v_item->>'total_amount','')::numeric, 0)
      );

      UPDATE public.jewelry_items
      SET status = 'returned_to_supplier', updated_at = now()
      WHERE id = v_jewelry_item_id;

      -- FIX: REPLACED jewelry_item_id with item_id
      INSERT INTO public.item_movements (
        item_id,
        movement_type,
        reference_type,
        reference_id,
        from_branch_id,
        notes,
        performed_by
      ) VALUES (
        v_jewelry_item_id,
        'return_to_supplier',
        'purchase_return',
        v_return_id,
        v_branch_id,
        'مرتجع مشتريات: ' || v_return_number,
        v_user_id
      ) RETURNING id INTO v_movement_id;

      v_movement_ids := array_append(v_movement_ids, v_movement_id);
    END LOOP;

    -- 8) Journal Entry
    IF v_status = 'posted' AND v_total_amount > 0 THEN
      v_journal_number := public.generate_document_code('JE');

      INSERT INTO public.journal_entries (
        entry_number, entry_date, description, reference_type, reference_id,
        status, created_by, total_debit, total_credit
      ) VALUES (
        v_journal_number, v_return_date, 'مرتجع مشتريات: ' || v_return_number,
        'purchase_return', v_return_id, 'posted', v_user_id, v_total_amount, v_total_amount
      ) RETURNING id INTO v_journal_entry_id;

      INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
      VALUES (v_journal_entry_id, v_supplier_account_id, v_total_amount, 0, 'مرتجع مشتريات - ذمم موردين');

      INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
      VALUES (v_journal_entry_id, v_inventory_account_id, 0, v_subtotal, 'مرتجع مشتريات - مخزون');

      IF v_tax_amount > 0 THEN
        INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
        VALUES (v_journal_entry_id, v_vat_input_account_id, 0, v_tax_amount, 'مرتجع مشتريات - ضريبة مدخلات');
      END IF;

      UPDATE public.purchase_returns
      SET journal_entry_id = v_journal_entry_id
      WHERE id = v_return_id;

      UPDATE public.item_movements
      SET journal_entry_id = v_journal_entry_id
      WHERE id = ANY(v_movement_ids);
    END IF;

  EXCEPTION WHEN OTHERS THEN
    PERFORM core_workflow_failed(v_client_request_id, 'DB_ERROR', SQLERRM);
    RAISE;
  END;

  -- 9) SUCCESS
  PERFORM core_workflow_success(
    v_client_request_id,
    v_return_id,
    jsonb_build_object(
      'success', true, 'idempotent', false,
      'return_id', v_return_id, 'return_number', v_return_number,
      'document_id', v_return_id, 'document_number', v_return_number,
      'journal_entry_id', v_journal_entry_id, 'journal_number', v_journal_number,
      'total_amount', v_total_amount
    )
  );

  RETURN jsonb_build_object(
    'success', true, 'idempotent', false,
    'return_id', v_return_id, 'return_number', v_return_number,
    'document_id', v_return_id, 'document_number', v_return_number,
    'journal_entry_id', v_journal_entry_id, 'journal_number', v_journal_number,
    'total_amount', v_total_amount
  );
END;
$function$;

-- ============================================================
-- FIX #4: create_transfer_atomic (jsonb variant)
-- REMOVE: item_code from item_movements INSERT
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_transfer_atomic(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_transfer_id uuid;
  v_transfer_code text;
  v_from_branch_id uuid;
  v_to_branch_id uuid;
  v_from_branch_name text;
  v_to_branch_name text;
  v_item_ids uuid[];
  v_total_items integer;
  v_total_cost numeric := 0;
  v_notes text;
  v_transferred_by uuid;
  v_purchase_invoice_id uuid;
  v_invalid_items text[];
  v_reference_type text;
  v_journal_entry_id uuid;
  v_je_number text;
  v_from_inventory_account_id uuid;
  v_to_inventory_account_id uuid;
BEGIN
  v_from_branch_id := (p_payload->>'from_branch_id')::uuid;
  v_to_branch_id := (p_payload->>'to_branch_id')::uuid;
  v_notes := p_payload->>'notes';
  v_transferred_by := (p_payload->>'transferred_by')::uuid;
  v_purchase_invoice_id := (p_payload->>'purchase_invoice_id')::uuid;
  
  SELECT array_agg(x::uuid)
  INTO v_item_ids
  FROM jsonb_array_elements_text(p_payload->'item_ids') x;
  
  IF v_to_branch_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'to_branch_id is required');
  END IF;
  
  IF v_item_ids IS NULL OR array_length(v_item_ids, 1) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'item_ids array is required and cannot be empty');
  END IF;
  
  v_total_items := array_length(v_item_ids, 1);
  
  SELECT branch_name INTO v_from_branch_name FROM public.branches WHERE id = v_from_branch_id;
  SELECT branch_name INTO v_to_branch_name FROM public.branches WHERE id = v_to_branch_id;
  
  IF v_to_branch_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid to_branch_id');
  END IF;
  
  v_reference_type := CASE 
    WHEN v_purchase_invoice_id IS NOT NULL THEN 'imported_serial_transfer'
    ELSE 'transfer'
  END;
  
  SELECT array_agg(ji.item_code)
  INTO v_invalid_items
  FROM public.jewelry_items ji
  WHERE ji.id = ANY(v_item_ids)
    AND (
      (v_from_branch_id IS NOT NULL AND ji.branch_id IS DISTINCT FROM v_from_branch_id)
      OR COALESCE(ji.sale_status, 'available') = 'sold'
    );
  
  IF v_invalid_items IS NOT NULL AND array_length(v_invalid_items, 1) > 0 THEN
    RETURN jsonb_build_object(
      'success', false, 
      'error', 'Invalid items: not in source branch or already sold',
      'invalid_items', v_invalid_items
    );
  END IF;
  
  PERFORM ji.id
  FROM public.jewelry_items ji
  WHERE ji.id = ANY(v_item_ids)
  FOR UPDATE;
  
  SELECT COALESCE(SUM(COALESCE(ji.cost, 0)), 0)
  INTO v_total_cost
  FROM public.jewelry_items ji
  WHERE ji.id = ANY(v_item_ids);
  
  IF v_from_branch_id IS NOT NULL THEN
    v_transfer_code := public.next_branch_code(v_from_branch_id, 'TRF');
  ELSE
    v_transfer_code := public.next_branch_code(v_to_branch_id, 'TRF');
  END IF;
  
  INSERT INTO public.transfers (
    transfer_code, from_branch_id, to_branch_id, status, transfer_date,
    total_items, total_cost, transferred_by, notes, purchase_invoice_id, created_at
  ) VALUES (
    v_transfer_code, v_from_branch_id, v_to_branch_id, 'posted', now(),
    v_total_items, v_total_cost, v_transferred_by, v_notes, v_purchase_invoice_id, now()
  )
  RETURNING id INTO v_transfer_id;
  
  INSERT INTO public.transfer_items (transfer_id, item_id, item_code, weight_grams, unit_cost, created_at)
  SELECT v_transfer_id, ji.id, ji.item_code, ji.g_weight, COALESCE(ji.cost, 0), now()
  FROM public.jewelry_items ji
  WHERE ji.id = ANY(v_item_ids);
  
  UPDATE public.jewelry_items
  SET branch_id = v_to_branch_id, updated_at = now()
  WHERE id = ANY(v_item_ids);
  
  -- FIX: REMOVED item_code from item_movements INSERT
  INSERT INTO public.item_movements (
    item_id,
    movement_type,
    reference_type,
    reference_id,
    from_branch_id,
    to_branch_id,
    movement_date,
    notes,
    performed_by
  )
  SELECT 
    ji.id,
    'transfer_out',
    v_reference_type,
    v_transfer_id,
    v_from_branch_id,
    v_to_branch_id,
    now(),
    v_notes,
    v_transferred_by
  FROM public.jewelry_items ji
  WHERE ji.id = ANY(v_item_ids);
  
  SELECT COALESCE(general_inventory_account_id, imported_pieces_account_id) 
  INTO v_from_inventory_account_id
  FROM public.branch_inventory_accounts 
  WHERE branch_id = v_from_branch_id;
  
  SELECT COALESCE(general_inventory_account_id, imported_pieces_account_id) 
  INTO v_to_inventory_account_id
  FROM public.branch_inventory_accounts 
  WHERE branch_id = v_to_branch_id;
  
  IF v_from_inventory_account_id IS NOT NULL AND v_to_inventory_account_id IS NOT NULL AND v_total_cost > 0 THEN
    v_je_number := public.next_branch_code(COALESCE(v_from_branch_id, v_to_branch_id), 'JE');
    
    INSERT INTO public.journal_entries (
      entry_number, entry_date, reference_type, reference_id, description,
      total_debit, total_credit, is_posted, posted_at, posted_by, branch_id, created_by
    ) VALUES (
      v_je_number, now(), v_reference_type, v_transfer_id,
      'قيد نقل مخزون: ' || COALESCE(v_from_branch_name, 'مستودع خارجي') || ' → ' || v_to_branch_name,
      v_total_cost, v_total_cost, true, now(), v_transferred_by,
      COALESCE(v_from_branch_id, v_to_branch_id), v_transferred_by
    )
    RETURNING id INTO v_journal_entry_id;
    
    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_journal_entry_id, v_to_inventory_account_id, v_total_cost, 0, 'زيادة مخزون ' || v_to_branch_name);
    
    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_journal_entry_id, v_from_inventory_account_id, 0, v_total_cost, 'نقص مخزون ' || COALESCE(v_from_branch_name, 'مستودع خارجي'));
    
    UPDATE public.transfers SET journal_entry_id = v_journal_entry_id WHERE id = v_transfer_id;
  END IF;
  
  RETURN jsonb_build_object(
    'success', true,
    'transfer_id', v_transfer_id,
    'transfer_code', v_transfer_code,
    'journal_entry_id', v_journal_entry_id,
    'total_items', v_total_items,
    'total_cost', v_total_cost
  );
  
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'error_detail', SQLSTATE
  );
END;
$function$;

-- ============================================================
-- FIX #5: create_transfer_atomic (params variant)
-- REMOVE: item_code from item_movements INSERT
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_transfer_atomic(p_from_branch_id uuid, p_to_branch_id uuid, p_item_ids uuid[], p_notes text DEFAULT NULL::text, p_purchase_invoice_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_transfer_id uuid;
  v_transfer_code text;
  v_total_items integer;
  v_total_cost numeric := 0;
  v_journal_entry_id uuid;
  v_journal_number text;
  v_transferred_by uuid;
  v_transferred_by_name text;
  v_from_branch_name text;
  v_to_branch_name text;
  v_from_account_id uuid;
  v_to_account_id uuid;
  v_item_ids uuid[];
  v_invalid_items uuid[];
BEGIN
  v_transferred_by := auth.uid();
  
  SELECT full_name INTO v_transferred_by_name
  FROM public.profiles
  WHERE id = v_transferred_by;

  IF p_from_branch_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Source branch is required');
  END IF;

  IF p_to_branch_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Destination branch is required');
  END IF;

  IF p_from_branch_id = p_to_branch_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Source and destination branches must be different');
  END IF;

  SELECT branch_name INTO v_from_branch_name FROM public.branches WHERE id = p_from_branch_id;
  SELECT branch_name INTO v_to_branch_name FROM public.branches WHERE id = p_to_branch_id;

  SELECT general_inventory_account_id INTO v_from_account_id
  FROM public.branch_inventory_accounts WHERE branch_id = p_from_branch_id;

  SELECT general_inventory_account_id INTO v_to_account_id
  FROM public.branch_inventory_accounts WHERE branch_id = p_to_branch_id;

  SELECT array_agg(ji.id)
  INTO v_item_ids
  FROM public.jewelry_items ji
  WHERE ji.id = ANY(p_item_ids)
    AND ji.branch_id = p_from_branch_id
    AND COALESCE(ji.sale_status, 'available') <> 'sold'
  FOR UPDATE;

  v_total_items := COALESCE(array_length(v_item_ids, 1), 0);

  IF v_total_items = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'No valid items found for transfer');
  END IF;

  SELECT COALESCE(SUM(COALESCE(ji.cost, 0)), 0)
  INTO v_total_cost
  FROM public.jewelry_items ji
  WHERE ji.id = ANY(v_item_ids);

  v_transfer_code := public.next_branch_code(p_from_branch_id, 'TRF');

  INSERT INTO public.transfers (
    transfer_code, from_branch_id, to_branch_id, status, transfer_date,
    total_items, total_cost, transferred_by, notes, purchase_invoice_id, created_at
  ) VALUES (
    v_transfer_code, p_from_branch_id, p_to_branch_id, 'posted', now(),
    v_total_items, v_total_cost, v_transferred_by, p_notes, p_purchase_invoice_id, now()
  )
  RETURNING id INTO v_transfer_id;

  INSERT INTO public.transfer_items (transfer_id, item_id, item_code, weight_grams, unit_cost, created_at)
  SELECT v_transfer_id, ji.id, ji.item_code, ji.g_weight, ji.cost, now()
  FROM public.jewelry_items ji
  WHERE ji.id = ANY(v_item_ids);

  UPDATE public.jewelry_items
  SET branch_id = p_to_branch_id, updated_at = now()
  WHERE id = ANY(v_item_ids);

  -- FIX: REMOVED item_code from item_movements INSERT
  INSERT INTO public.item_movements (
    item_id,
    movement_type,
    from_branch_id,
    to_branch_id,
    reference_type,
    reference_id,
    performed_by,
    notes,
    movement_date,
    created_at
  )
  SELECT
    ji.id,
    'transfer',
    p_from_branch_id,
    p_to_branch_id,
    'transfer',
    v_transfer_id,
    v_transferred_by,
    p_notes,
    now(),
    now()
  FROM public.jewelry_items ji
  WHERE ji.id = ANY(v_item_ids);

  IF v_from_account_id IS NOT NULL AND v_to_account_id IS NOT NULL AND v_total_cost > 0 THEN
    v_journal_number := public.next_sequence_number('journal_entry');
    
    INSERT INTO public.journal_entries (
      entry_number, entry_date, description, reference_type, reference_id,
      total_debit, total_credit, status, created_by, created_at
    ) VALUES (
      v_journal_number, now(), 'نقل مخزون من ' || v_from_branch_name || ' إلى ' || v_to_branch_name,
      'transfer', v_transfer_id, v_total_cost, v_total_cost, 'posted', v_transferred_by, now()
    )
    RETURNING id INTO v_journal_entry_id;

    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description, created_at)
    VALUES (v_journal_entry_id, v_to_account_id, v_total_cost, 0, 'استلام مخزون من ' || v_from_branch_name, now());

    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description, created_at)
    VALUES (v_journal_entry_id, v_from_account_id, 0, v_total_cost, 'نقل مخزون إلى ' || v_to_branch_name, now());

    UPDATE public.transfers SET journal_entry_id = v_journal_entry_id WHERE id = v_transfer_id;

    UPDATE public.item_movements
    SET journal_entry_id = v_journal_entry_id
    WHERE reference_type = 'transfer' AND reference_id = v_transfer_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'transfer_id', v_transfer_id,
    'transfer_code', v_transfer_code,
    'total_items', v_total_items,
    'total_cost', v_total_cost,
    'journal_entry_id', v_journal_entry_id,
    'journal_number', v_journal_number
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- ============================================================
-- RE-GRANT EXECUTE PERMISSIONS
-- ============================================================
GRANT EXECUTE ON FUNCTION public.complete_imported_serial_transfer_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_pos_credit_note_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_transfer_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_transfer_atomic(uuid, uuid, uuid[], text, uuid) TO authenticated;
