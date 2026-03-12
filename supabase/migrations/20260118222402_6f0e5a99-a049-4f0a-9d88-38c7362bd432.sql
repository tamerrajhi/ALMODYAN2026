-- =====================================================
-- PR-2: Purchase Return CREATE Atomic
-- Fixes critical bug in item_movements column name
-- Adds canonical workflow types for create operations
-- =====================================================

-- A0) Ensure workflow_types entries for PR-2 CREATE operations
INSERT INTO public.workflow_types (code, description, is_enabled)
VALUES 
  ('purchase_return_unique_create_atomic', 'Atomic create unique/jewelry purchase return', true),
  ('purchase_return_general_create_atomic', 'Atomic create general/qty purchase return', true)
ON CONFLICT (code) DO UPDATE SET 
  description = EXCLUDED.description,
  is_enabled = true;

-- A1) Fix complete_purchase_return_unique_items_atomic - item_movements bug
-- The function incorrectly used jewelry_item_id instead of item_id
CREATE OR REPLACE FUNCTION public.complete_purchase_return_unique_items_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_client_request_id text;
  v_gate jsonb;
  v_action text;
  v_cached jsonb;
  v_user_id uuid;
  v_user_name text;
  v_branch_id uuid;
  v_invoice_id uuid;
  v_return_date date;
  v_reason text;
  v_notes text;
  v_status text;
  v_return_number text;
  v_return_id uuid;
  v_supplier_id uuid;
  v_supplier_account_id uuid;
  v_inventory_account_id uuid;
  v_vat_input_account_id uuid;
  v_items jsonb;
  v_item jsonb;
  v_invoice_line_id uuid;
  v_jewelry_item_id uuid;
  v_item_record record;
  v_line record;
  v_subtotal numeric := 0;
  v_tax_amount numeric := 0;
  v_total_amount numeric := 0;
  v_journal_entry_id uuid;
  v_journal_number text;
  v_movement_ids uuid[] := ARRAY[]::uuid[];
  v_movement_id uuid;
  v_lock_key bigint;
BEGIN
  -- 1) Extract payload fields
  v_client_request_id := p_payload->>'client_request_id';
  v_user_id := NULLIF(p_payload->>'user_id','')::uuid;
  v_user_name := COALESCE(p_payload->>'user_name', v_user_id::text);
  v_branch_id := NULLIF(p_payload->>'branch_id','')::uuid;
  v_invoice_id := COALESCE(
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

  -- 2) Validate required fields
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

  -- 3) Advisory lock for concurrency safety
  v_lock_key := abs(hashtext(v_client_request_id));
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- 4) Canonical idempotency gate
  v_gate := public.begin_workflow_request(v_client_request_id, 'purchase_return_unique', p_payload);
  v_action := v_gate->>'action';
  IF v_action IS NULL THEN
    v_action := v_gate->>'status';
  END IF;
  v_cached := v_gate->'result';
  IF v_cached IS NULL THEN
    v_cached := v_gate->'cached_result';
  END IF;

  IF v_action = 'return_cached' OR v_action = 'succeeded' THEN
    RETURN COALESCE(v_cached, jsonb_build_object('success', true, 'idempotent', true));
  ELSIF v_action IN ('reject','conflict') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', COALESCE(v_gate->>'error_code', 'WORKFLOW_BLOCKED'),
      'error', COALESCE(v_gate->>'error_message', 'workflow blocked')
    );
  ELSIF v_action = 'in_progress' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'IN_PROGRESS', 'error', 'Request in progress');
  END IF;

  -- 5) Fetch invoice + supplier from invoices table
  SELECT i.supplier_id, s.account_id
    INTO v_supplier_id, v_supplier_account_id
  FROM public.invoices i
  JOIN public.suppliers s ON s.id = i.supplier_id
  WHERE i.id = v_invoice_id
    AND i.invoice_type = 'purchase';

  IF v_supplier_id IS NULL THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'INVOICE_NOT_FOUND', 'Purchase invoice not found');
    RETURN jsonb_build_object('success', false, 'error_code', 'INVOICE_NOT_FOUND', 'error', 'Purchase invoice not found');
  END IF;

  -- 6) Lookup system accounts (Inventory 1301, VAT Input 2105)
  SELECT id INTO v_inventory_account_id FROM public.chart_of_accounts WHERE account_code = '1301' LIMIT 1;
  SELECT id INTO v_vat_input_account_id FROM public.chart_of_accounts WHERE account_code = '2105' LIMIT 1;

  IF v_inventory_account_id IS NULL OR v_vat_input_account_id IS NULL THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'MISSING_ACCOUNTS', 'Required system accounts not found');
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_ACCOUNTS', 'error', 'Required system accounts not found');
  END IF;

  -- 7) Generate return number
  v_return_number := public.generate_document_code('PR-RET');

  -- 8) Subtransaction for atomicity
  BEGIN
    -- 8.1 Lock and validate each jewelry item + invoice line
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
      v_invoice_line_id := NULLIF(v_item->>'invoice_line_id','')::uuid;
      v_jewelry_item_id := NULLIF(v_item->>'jewelry_item_id','')::uuid;

      IF v_invoice_line_id IS NULL THEN
        RAISE EXCEPTION 'invoice_line_id is required for unique items';
      END IF;
      IF v_jewelry_item_id IS NULL THEN
        RAISE EXCEPTION 'jewelry_item_id is required for unique items';
      END IF;

      -- Ensure invoice_line belongs to this invoice and is jewelry
      SELECT *
      INTO v_line
      FROM public.purchase_invoice_lines pil
      WHERE pil.id = v_invoice_line_id
        AND pil.invoice_id = v_invoice_id
        AND pil.item_type = 'jewelry'
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid invoice_line_id for jewelry: %', v_invoice_line_id;
      END IF;

      -- Lock jewelry item
      SELECT ji.*
      INTO v_item_record
      FROM public.jewelry_items ji
      WHERE ji.id = v_jewelry_item_id
      FOR UPDATE;

      IF v_item_record IS NULL THEN
        RAISE EXCEPTION 'Jewelry item not found: %', v_jewelry_item_id;
      END IF;

      IF v_item_record.status <> 'in_stock' THEN
        RAISE EXCEPTION 'Item % not in_stock (status=%)', v_item_record.item_code, v_item_record.status;
      END IF;
    END LOOP;

    -- 8.2 Calculate totals from payload
    SELECT
      COALESCE(SUM((x->>'unit_price')::numeric), 0),
      COALESCE(SUM((x->>'tax_amount')::numeric), 0),
      COALESCE(SUM((x->>'total_amount')::numeric), 0)
    INTO v_subtotal, v_tax_amount, v_total_amount
    FROM jsonb_array_elements(v_items) x;

    -- 8.3 Insert purchase_returns header
    INSERT INTO public.purchase_returns (
      return_number,
      purchase_invoice_id,
      supplier_id,
      branch_id,
      return_date,
      reason,
      notes,
      status,
      subtotal,
      tax_amount,
      total_amount,
      processed_by
    ) VALUES (
      v_return_number,
      v_invoice_id,
      v_supplier_id,
      v_branch_id,
      v_return_date,
      v_reason,
      v_notes,
      v_status,
      v_subtotal,
      v_tax_amount,
      v_total_amount,
      v_user_name
    ) RETURNING id INTO v_return_id;

    -- 8.4 Insert items, update returned_qty, update jewelry status, insert movements
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
      v_invoice_line_id := NULLIF(v_item->>'invoice_line_id','')::uuid;
      v_jewelry_item_id := NULLIF(v_item->>'jewelry_item_id','')::uuid;

      -- Insert return item
      INSERT INTO public.purchase_return_items (
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
        weight_grams
      ) VALUES (
        v_return_id,
        v_jewelry_item_id,
        v_invoice_line_id,
        COALESCE(v_item->>'description',''),
        COALESCE(NULLIF(v_item->>'quantity','')::numeric, 1),
        COALESCE(NULLIF(v_item->>'unit_price','')::numeric, 0),
        COALESCE(NULLIF(v_item->>'discount_amount','')::numeric, 0),
        COALESCE(NULLIF(v_item->>'tax_rate','')::numeric, 0.15),
        COALESCE(NULLIF(v_item->>'tax_amount','')::numeric, 0),
        COALESCE(NULLIF(v_item->>'total_amount','')::numeric, 0),
        NULLIF(v_item->>'weight_grams','')::numeric
      );

      -- Update invoice line returned_qty
      UPDATE public.purchase_invoice_lines
      SET returned_qty = COALESCE(returned_qty, 0) + 1
      WHERE id = v_invoice_line_id;

      -- Update jewelry item status
      UPDATE public.jewelry_items
      SET status = 'returned_to_supplier',
          updated_at = now()
      WHERE id = v_jewelry_item_id;

      -- CRITICAL FIX: Use item_id NOT jewelry_item_id (item_movements schema)
      INSERT INTO public.item_movements (
        id,
        item_id,  -- FIXED: was jewelry_item_id
        movement_type,
        reference_type,
        reference_id,
        return_id,
        from_branch_id,
        notes,
        performed_by,
        movement_date
      ) VALUES (
        gen_random_uuid(),
        v_jewelry_item_id,  -- value goes into item_id column
        'return_to_supplier',
        'purchase_return',
        v_return_id,
        v_return_id,
        v_branch_id,
        'مرتجع مشتريات (Unique): ' || v_return_number,
        v_user_name,
        now()
      ) RETURNING id INTO v_movement_id;

      v_movement_ids := array_append(v_movement_ids, v_movement_id);
    END LOOP;

    -- 8.5 Create Journal Entry (if posted and total > 0)
    IF v_status = 'posted' AND v_total_amount > 0 THEN
      v_journal_number := public.generate_document_code('JE');

      INSERT INTO public.journal_entries (
        entry_number,
        entry_date,
        description,
        reference_type,
        reference_id,
        status,
        created_by,
        branch_id,
        total_debit,
        total_credit
      ) VALUES (
        v_journal_number,
        v_return_date,
        'مرتجع مشتريات (Unique): ' || v_return_number,
        'purchase_return',
        v_return_id,
        'posted',
        v_user_id,
        v_branch_id,
        v_total_amount,
        v_total_amount
      ) RETURNING id INTO v_journal_entry_id;

      -- Debit AP (reduce payable)
      INSERT INTO public.journal_entry_lines (
        journal_entry_id, account_id, debit_amount, credit_amount, description
      ) VALUES (
        v_journal_entry_id, v_supplier_account_id, v_total_amount, 0, 'مرتجع مشتريات - ذمم موردين'
      );

      -- Credit Inventory
      INSERT INTO public.journal_entry_lines (
        journal_entry_id, account_id, debit_amount, credit_amount, description
      ) VALUES (
        v_journal_entry_id, v_inventory_account_id, 0, v_subtotal, 'مرتجع مشتريات - مخزون'
      );

      -- Credit VAT Input (if > 0)
      IF v_tax_amount > 0 THEN
        INSERT INTO public.journal_entry_lines (
          journal_entry_id, account_id, debit_amount, credit_amount, description
        ) VALUES (
          v_journal_entry_id, v_vat_input_account_id, 0, v_tax_amount, 'مرتجع مشتريات - ضريبة مدخلات'
        );
      END IF;

      -- Link JE to return
      UPDATE public.purchase_returns
      SET journal_entry_id = v_journal_entry_id
      WHERE id = v_return_id;

      -- Link JE to movements
      UPDATE public.item_movements
      SET journal_entry_id = v_journal_entry_id
      WHERE id = ANY(v_movement_ids);
    END IF;

  EXCEPTION WHEN OTHERS THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'DB_ERROR', SQLERRM);
    RAISE;
  END;

  -- 9) Success - finalize workflow
  PERFORM public.core_workflow_success(
    v_client_request_id,
    v_return_id,
    jsonb_build_object(
      'success', true,
      'idempotent', false,
      'returnId', v_return_id,
      'returnNumber', v_return_number,
      'journalEntryId', v_journal_entry_id,
      'journalEntryNumber', v_journal_number,
      'status', v_status,
      'itemCount', jsonb_array_length(v_items),
      'totals', jsonb_build_object(
        'subtotal', v_subtotal,
        'taxAmount', v_tax_amount,
        'totalAmount', v_total_amount
      ),
      'meta', jsonb_build_object(
        'workflowType', 'purchase_return_unique',
        'clientRequestId', v_client_request_id
      )
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'returnId', v_return_id,
    'returnNumber', v_return_number,
    'journalEntryId', v_journal_entry_id,
    'journalEntryNumber', v_journal_number,
    'status', v_status,
    'itemCount', jsonb_array_length(v_items),
    'totals', jsonb_build_object(
      'subtotal', v_subtotal,
      'taxAmount', v_tax_amount,
      'totalAmount', v_total_amount
    ),
    'meta', jsonb_build_object(
      'workflowType', 'purchase_return_unique',
      'clientRequestId', v_client_request_id
    )
  );
END;
$function$;

-- A2) Fix complete_purchase_return_general_atomic (does not use item_movements, but standardize)
CREATE OR REPLACE FUNCTION public.complete_purchase_return_general_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_client_request_id text;
  v_gate jsonb;
  v_action text;
  v_cached jsonb;
  v_user_id uuid;
  v_user_name text;
  v_branch_id uuid;
  v_invoice_id uuid;
  v_return_date date;
  v_reason text;
  v_notes text;
  v_status text;
  v_return_number text;
  v_return_id uuid;
  v_supplier_id uuid;
  v_supplier_account_id uuid;
  v_inventory_account_id uuid;
  v_vat_input_account_id uuid;
  v_lines jsonb;
  v_line_json jsonb;
  v_invoice_line_id uuid;
  v_line record;
  v_qty numeric;
  v_unit_price numeric;
  v_discount numeric;
  v_tax_rate numeric;
  v_tax_amount numeric;
  v_total numeric;
  v_subtotal numeric := 0;
  v_tax_total numeric := 0;
  v_total_amount numeric := 0;
  v_journal_entry_id uuid;
  v_journal_number text;
  v_lock_key bigint;
  v_line_number int := 0;
  rec record;
BEGIN
  -- 1) Extract payload fields
  v_client_request_id := p_payload->>'client_request_id';
  v_user_id := NULLIF(p_payload->>'user_id','')::uuid;
  v_user_name := COALESCE(p_payload->>'user_name', v_user_id::text);
  v_branch_id := NULLIF(p_payload->>'branch_id','')::uuid;
  v_invoice_id := COALESCE(
    NULLIF(p_payload->>'purchase_invoice_id','')::uuid,
    NULLIF(p_payload->>'original_invoice_id','')::uuid,
    NULLIF(p_payload->>'linked_invoice_id','')::uuid,
    NULLIF(p_payload->>'invoice_id','')::uuid
  );
  v_return_date := COALESCE(NULLIF(p_payload->>'return_date','')::date, CURRENT_DATE);
  v_reason := p_payload->>'reason';
  v_notes := p_payload->>'notes';
  v_status := COALESCE(NULLIF(p_payload->>'status',''), 'posted');
  v_lines := p_payload->'lines';

  -- 2) Validate required fields
  IF v_client_request_id IS NULL OR btrim(v_client_request_id) = '' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_REQUEST_ID', 'error', 'client_request_id is required');
  END IF;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_USER', 'error', 'user_id is required');
  END IF;
  IF v_invoice_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_INVOICE', 'error', 'invoice id is required');
  END IF;
  IF v_lines IS NULL OR jsonb_typeof(v_lines) <> 'array' OR jsonb_array_length(v_lines) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_LINES', 'error', 'lines array is required');
  END IF;

  -- 3) Advisory lock
  v_lock_key := abs(hashtext(v_client_request_id));
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- 4) Canonical idempotency gate
  v_gate := public.begin_workflow_request(v_client_request_id, 'purchase_return_general', p_payload);
  v_action := v_gate->>'action';
  IF v_action IS NULL THEN
    v_action := v_gate->>'status';
  END IF;
  v_cached := v_gate->'result';
  IF v_cached IS NULL THEN
    v_cached := v_gate->'cached_result';
  END IF;

  IF v_action = 'return_cached' OR v_action = 'succeeded' THEN
    RETURN COALESCE(v_cached, jsonb_build_object('success', true, 'idempotent', true));
  ELSIF v_action IN ('reject','conflict') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', COALESCE(v_gate->>'error_code', 'WORKFLOW_BLOCKED'),
      'error', COALESCE(v_gate->>'error_message', 'workflow blocked')
    );
  ELSIF v_action = 'in_progress' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'IN_PROGRESS', 'error', 'Request in progress');
  END IF;

  -- 5) Fetch invoice + supplier
  SELECT i.supplier_id, s.account_id
    INTO v_supplier_id, v_supplier_account_id
  FROM public.invoices i
  JOIN public.suppliers s ON s.id = i.supplier_id
  WHERE i.id = v_invoice_id
    AND i.invoice_type = 'purchase';

  IF v_supplier_id IS NULL THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'INVOICE_NOT_FOUND', 'Purchase invoice not found');
    RETURN jsonb_build_object('success', false, 'error_code', 'INVOICE_NOT_FOUND', 'error', 'Purchase invoice not found');
  END IF;

  -- 6) System accounts
  SELECT id INTO v_inventory_account_id FROM public.chart_of_accounts WHERE account_code = '1301' LIMIT 1;
  SELECT id INTO v_vat_input_account_id FROM public.chart_of_accounts WHERE account_code = '2105' LIMIT 1;

  IF v_inventory_account_id IS NULL OR v_vat_input_account_id IS NULL THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'MISSING_ACCOUNTS', 'Required system accounts not found');
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_ACCOUNTS', 'error', 'Required system accounts not found');
  END IF;

  -- 7) Generate return number
  v_return_number := public.generate_document_code('PR-RET');

  -- 8) Subtransaction
  BEGIN
    -- 8.1 Calculate totals from payload lines
    FOR v_line_json IN SELECT * FROM jsonb_array_elements(v_lines)
    LOOP
      v_qty := COALESCE(NULLIF(v_line_json->>'qty','')::numeric, NULLIF(v_line_json->>'quantity','')::numeric, 1);
      v_unit_price := COALESCE(NULLIF(v_line_json->>'unit_price','')::numeric, 0);
      v_discount := COALESCE(NULLIF(v_line_json->>'discount_amount','')::numeric, 0);
      v_tax_rate := COALESCE(NULLIF(v_line_json->>'tax_rate','')::numeric, 0.15);
      
      v_total := (v_qty * v_unit_price) - v_discount;
      v_tax_amount := v_total * v_tax_rate;
      
      v_subtotal := v_subtotal + v_total;
      v_tax_total := v_tax_total + v_tax_amount;
    END LOOP;
    
    v_total_amount := v_subtotal + v_tax_total;

    -- 8.2 Insert purchase_returns header
    INSERT INTO public.purchase_returns (
      return_number,
      purchase_invoice_id,
      supplier_id,
      branch_id,
      return_date,
      reason,
      notes,
      status,
      subtotal,
      tax_amount,
      total_amount,
      processed_by
    ) VALUES (
      v_return_number,
      v_invoice_id,
      v_supplier_id,
      v_branch_id,
      v_return_date,
      v_reason,
      v_notes,
      v_status,
      v_subtotal,
      v_tax_total,
      v_total_amount,
      v_user_name
    ) RETURNING id INTO v_return_id;

    -- 8.3 Insert return lines (no item_movements for general returns)
    FOR v_line_json IN SELECT * FROM jsonb_array_elements(v_lines)
    LOOP
      v_line_number := v_line_number + 1;
      v_invoice_line_id := NULLIF(v_line_json->>'invoice_line_id','')::uuid;
      v_qty := COALESCE(NULLIF(v_line_json->>'qty','')::numeric, NULLIF(v_line_json->>'quantity','')::numeric, 1);
      v_unit_price := COALESCE(NULLIF(v_line_json->>'unit_price','')::numeric, 0);
      v_discount := COALESCE(NULLIF(v_line_json->>'discount_amount','')::numeric, 0);
      v_tax_rate := COALESCE(NULLIF(v_line_json->>'tax_rate','')::numeric, 0.15);
      v_total := (v_qty * v_unit_price) - v_discount;
      v_tax_amount := v_total * v_tax_rate;

      INSERT INTO public.purchase_return_items (
        return_id,
        invoice_line_id,
        description,
        quantity,
        unit_price,
        discount_amount,
        tax_rate,
        tax_amount,
        total_amount
      ) VALUES (
        v_return_id,
        v_invoice_line_id,
        COALESCE(v_line_json->>'description', ''),
        v_qty,
        v_unit_price,
        v_discount,
        v_tax_rate,
        v_tax_amount,
        v_total + v_tax_amount
      );

      -- Update invoice line returned_qty
      IF v_invoice_line_id IS NOT NULL THEN
        UPDATE public.purchase_invoice_lines
        SET returned_qty = COALESCE(returned_qty, 0) + v_qty
        WHERE id = v_invoice_line_id;
      END IF;
    END LOOP;

    -- 8.4 Create Journal Entry (if posted and total > 0)
    IF v_status = 'posted' AND v_total_amount > 0 THEN
      v_journal_number := public.generate_document_code('JE');

      INSERT INTO public.journal_entries (
        entry_number,
        entry_date,
        description,
        reference_type,
        reference_id,
        status,
        created_by,
        branch_id,
        total_debit,
        total_credit
      ) VALUES (
        v_journal_number,
        v_return_date,
        'مرتجع مشتريات (General): ' || v_return_number,
        'purchase_return',
        v_return_id,
        'posted',
        v_user_id,
        v_branch_id,
        v_total_amount,
        v_total_amount
      ) RETURNING id INTO v_journal_entry_id;

      -- Debit AP
      INSERT INTO public.journal_entry_lines (
        journal_entry_id, account_id, debit_amount, credit_amount, description
      ) VALUES (
        v_journal_entry_id, v_supplier_account_id, v_total_amount, 0, 'مرتجع مشتريات - ذمم موردين'
      );

      -- Credit Inventory
      INSERT INTO public.journal_entry_lines (
        journal_entry_id, account_id, debit_amount, credit_amount, description
      ) VALUES (
        v_journal_entry_id, v_inventory_account_id, 0, v_subtotal, 'مرتجع مشتريات - مخزون'
      );

      -- Credit VAT Input
      IF v_tax_total > 0 THEN
        INSERT INTO public.journal_entry_lines (
          journal_entry_id, account_id, debit_amount, credit_amount, description
        ) VALUES (
          v_journal_entry_id, v_vat_input_account_id, 0, v_tax_total, 'مرتجع مشتريات - ضريبة مدخلات'
        );
      END IF;

      -- Link JE to return
      UPDATE public.purchase_returns
      SET journal_entry_id = v_journal_entry_id
      WHERE id = v_return_id;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    PERFORM public.core_workflow_failed(v_client_request_id, 'DB_ERROR', SQLERRM);
    RAISE;
  END;

  -- 9) Success
  PERFORM public.core_workflow_success(
    v_client_request_id,
    v_return_id,
    jsonb_build_object(
      'success', true,
      'idempotent', false,
      'returnId', v_return_id,
      'returnNumber', v_return_number,
      'journalEntryId', v_journal_entry_id,
      'journalEntryNumber', v_journal_number,
      'status', v_status,
      'lineCount', jsonb_array_length(v_lines),
      'inventoryApplied', false,
      'totals', jsonb_build_object(
        'subtotal', v_subtotal,
        'taxAmount', v_tax_total,
        'totalAmount', v_total_amount
      ),
      'meta', jsonb_build_object(
        'workflowType', 'purchase_return_general',
        'clientRequestId', v_client_request_id
      )
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'returnId', v_return_id,
    'returnNumber', v_return_number,
    'journalEntryId', v_journal_entry_id,
    'journalEntryNumber', v_journal_number,
    'status', v_status,
    'lineCount', jsonb_array_length(v_lines),
    'inventoryApplied', false,
    'totals', jsonb_build_object(
      'subtotal', v_subtotal,
      'taxAmount', v_tax_total,
      'totalAmount', v_total_amount
    ),
    'meta', jsonb_build_object(
      'workflowType', 'purchase_return_general',
      'clientRequestId', v_client_request_id
    )
  );
END;
$function$;

-- A3) Grants (authenticated only)
REVOKE ALL ON FUNCTION public.complete_purchase_return_unique_items_atomic(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_purchase_return_unique_items_atomic(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_unique_items_atomic(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.complete_purchase_return_general_atomic(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_purchase_return_general_atomic(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_general_atomic(jsonb) TO authenticated;