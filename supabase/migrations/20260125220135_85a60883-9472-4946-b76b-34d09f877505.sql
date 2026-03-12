-- POS-P2H-FIX: Make item_movements (SALE/sale) Idempotent + Block Duplicate Items in Payload
-- Fixes 23505: duplicate key value violates unique constraint "ux_item_movements_sale_unique"

CREATE OR REPLACE FUNCTION public.complete_pos_sale_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Input variables
  v_client_request_id uuid;
  v_branch_id uuid;
  v_customer_id uuid;
  v_items jsonb;
  v_payment_method text;
  v_cash_amount numeric(12,2);
  v_card_amount numeric(12,2);
  v_discount_amount numeric(12,2);
  v_notes text;
  v_sold_by text;
  v_bank_account_code text;

  -- Counts and calculations
  v_items_count int;
  v_total_amount numeric(12,2);
  v_subtotal numeric(12,2);
  v_tax_amount numeric(12,2);
  v_final_amount numeric(12,2);
  v_items_cost numeric(12,2);
  v_base_discount_per_item numeric(12,2);
  v_discount_remainder numeric(12,2);

  -- Generated values
  v_sale_id uuid;
  v_sale_code text;
  v_invoice_id uuid;
  v_invoice_number text;
  v_je_id uuid;
  v_je_number text;
  v_branch_code text;
  v_payload_hash text;

  -- Lock counts
  v_locked_count int;
  v_updated_count int;
  v_existing_sale_moves int;  -- P2H: for idempotent movements check

  -- Account IDs (fetched from mapping table - NO hardcoded codes!)
  v_cash_account_id uuid;
  v_bank_account_id uuid;
  v_ar_account_id uuid;
  v_sales_account_id uuid;
  v_vat_account_id uuid;
  v_cogs_account_id uuid;
  v_inventory_account_id uuid;
  v_customer_account_id uuid;

  -- Existing request check
  v_existing_request record;

  -- Loop variables
  v_item record;
  v_item_idx int := 0;
  v_item_discount numeric(12,2);
  v_item_sale_price numeric(12,2);

  -- Mapping validation
  v_mapping_count int;

  -- Result
  v_result jsonb;
BEGIN
  -- =====================================================
  -- STEP 1: Extract and validate input
  -- =====================================================
  v_client_request_id := (p_payload->>'client_request_id')::uuid;
  v_branch_id := (p_payload->>'branch_id')::uuid;
  v_customer_id := NULLIF(p_payload->>'customer_id', '')::uuid;
  v_items := p_payload->'items';
  v_payment_method := COALESCE(p_payload->>'payment_method', 'cash');
  v_cash_amount := COALESCE((p_payload->>'cash_amount')::numeric, 0)::numeric(12,2);
  v_card_amount := COALESCE((p_payload->>'card_amount')::numeric, 0)::numeric(12,2);
  v_discount_amount := COALESCE((p_payload->>'discount_amount')::numeric, 0)::numeric(12,2);
  v_notes := p_payload->>'notes';
  v_sold_by := COALESCE(p_payload->>'sold_by', 'System');
  v_bank_account_code := p_payload->>'bank_account_code';

  IF v_client_request_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT: client_request_id is required';
  END IF;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT: branch_id is required';
  END IF;

  v_items_count := COALESCE(jsonb_array_length(v_items), 0);
  IF v_items_count = 0 THEN
    RAISE EXCEPTION 'INVALID_INPUT: At least one item is required';
  END IF;

  IF v_discount_amount < 0 THEN
    RAISE EXCEPTION 'INVALID_INPUT: discount_amount cannot be negative';
  END IF;

  -- =====================================================
  -- STEP 2: Fetch account mappings from branch_pos_account_mappings
  -- =====================================================
  SELECT COUNT(*) INTO v_mapping_count
  FROM public.branch_pos_account_mappings
  WHERE branch_id = v_branch_id;

  IF v_mapping_count < 7 THEN
    RAISE EXCEPTION 'POS_MAPPING_INCOMPLETE: Branch % has only % of 7 required account mappings', v_branch_id, v_mapping_count;
  END IF;

  SELECT bpm.account_id INTO v_sales_account_id
  FROM public.branch_pos_account_mappings bpm
  WHERE bpm.branch_id = v_branch_id AND bpm.role = 'SALES_REVENUE';
  IF v_sales_account_id IS NULL THEN
    RAISE EXCEPTION 'POS_MAPPING_MISSING: SALES_REVENUE not configured for branch %', v_branch_id;
  END IF;

  SELECT bpm.account_id INTO v_vat_account_id
  FROM public.branch_pos_account_mappings bpm
  WHERE bpm.branch_id = v_branch_id AND bpm.role = 'VAT_PAYABLE';
  IF v_vat_account_id IS NULL THEN
    RAISE EXCEPTION 'POS_MAPPING_MISSING: VAT_PAYABLE not configured for branch %', v_branch_id;
  END IF;

  SELECT bpm.account_id INTO v_ar_account_id
  FROM public.branch_pos_account_mappings bpm
  WHERE bpm.branch_id = v_branch_id AND bpm.role = 'ACCOUNTS_RECEIVABLE';
  IF v_ar_account_id IS NULL THEN
    RAISE EXCEPTION 'POS_MAPPING_MISSING: ACCOUNTS_RECEIVABLE not configured for branch %', v_branch_id;
  END IF;

  SELECT bpm.account_id INTO v_inventory_account_id
  FROM public.branch_pos_account_mappings bpm
  WHERE bpm.branch_id = v_branch_id AND bpm.role = 'INVENTORY';
  IF v_inventory_account_id IS NULL THEN
    RAISE EXCEPTION 'POS_MAPPING_MISSING: INVENTORY not configured for branch %', v_branch_id;
  END IF;

  SELECT bpm.account_id INTO v_cogs_account_id
  FROM public.branch_pos_account_mappings bpm
  WHERE bpm.branch_id = v_branch_id AND bpm.role = 'COGS';
  IF v_cogs_account_id IS NULL THEN
    RAISE EXCEPTION 'POS_MAPPING_MISSING: COGS not configured for branch %', v_branch_id;
  END IF;

  SELECT bpm.account_id INTO v_cash_account_id
  FROM public.branch_pos_account_mappings bpm
  WHERE bpm.branch_id = v_branch_id AND bpm.role = 'CASH';
  IF v_cash_account_id IS NULL THEN
    RAISE EXCEPTION 'POS_MAPPING_MISSING: CASH not configured for branch %', v_branch_id;
  END IF;

  SELECT bpm.account_id INTO v_bank_account_id
  FROM public.branch_pos_account_mappings bpm
  WHERE bpm.branch_id = v_branch_id AND bpm.role = 'BANK';
  IF v_bank_account_id IS NULL THEN
    RAISE EXCEPTION 'POS_MAPPING_MISSING: BANK not configured for branch %', v_branch_id;
  END IF;

  SELECT b.branch_code INTO v_branch_code
  FROM public.branches b
  WHERE b.id = v_branch_id;

  -- =====================================================
  -- STEP 3: Idempotency check
  -- =====================================================
  v_payload_hash := md5(p_payload::text);

  BEGIN
    SELECT * INTO v_existing_request
    FROM public.pos_sale_requests
    WHERE client_request_id = v_client_request_id;

    IF FOUND THEN
      IF v_existing_request.status = 'succeeded' THEN
        RETURN jsonb_build_object(
          'success', true,
          'sale_id', v_existing_request.sale_id,
          'invoice_id', v_existing_request.invoice_id,
          'journal_entry_id', v_existing_request.journal_entry_id,
          'idempotent', true,
          'message', 'Request already processed successfully'
        );
      ELSIF v_existing_request.status = 'processing' THEN
        RAISE EXCEPTION 'CONFLICT_IN_PROGRESS: This request is currently being processed';
      ELSE
        IF v_existing_request.payload_hash != v_payload_hash THEN
          RAISE EXCEPTION 'CONFLICT_PAYLOAD_MISMATCH: Previous request with same ID had different payload';
        END IF;
        DELETE FROM public.pos_sale_requests WHERE client_request_id = v_client_request_id;
        INSERT INTO public.pos_sale_requests (client_request_id, status, payload_hash)
        VALUES (v_client_request_id, 'processing', v_payload_hash);
      END IF;
    ELSE
      INSERT INTO public.pos_sale_requests (client_request_id, status, payload_hash)
      VALUES (v_client_request_id, 'processing', v_payload_hash);
    END IF;
  END;

  -- =====================================================
  -- STEP 4: Lock items and validate availability
  -- =====================================================
  CREATE TEMP TABLE tmp_sale_items (
    item_id uuid,
    sale_price numeric(12,2),
    item_cost numeric(12,2) DEFAULT 0,
    idx int
  ) ON COMMIT DROP;

  -- IMPORTANT: Match UI payload keys:
  -- { jewelry_item_id, unit_price, ... }
  INSERT INTO tmp_sale_items (item_id, sale_price, idx)
  SELECT
    COALESCE(
      NULLIF(elem->>'jewelry_item_id','')::uuid,
      NULLIF(elem->>'item_id','')::uuid,
      NULLIF(elem->>'id','')::uuid
    ) AS item_id,
    COALESCE(
      NULLIF(elem->>'unit_price','')::numeric,
      NULLIF(elem->>'sale_price','')::numeric
    )::numeric(12,2) AS sale_price,
    row_number() OVER () AS idx
  FROM jsonb_array_elements(v_items) AS elem;

  IF EXISTS (SELECT 1 FROM tmp_sale_items WHERE item_id IS NULL) THEN
    RAISE EXCEPTION 'INVALID_INPUT: items[].jewelry_item_id is required';
  END IF;

  IF EXISTS (SELECT 1 FROM tmp_sale_items WHERE sale_price IS NULL OR sale_price <= 0) THEN
    RAISE EXCEPTION 'INVALID_INPUT: All item prices must be greater than 0';
  END IF;

  -- =====================================================
  -- P2H-A: Block duplicate items in payload (hard stop)
  -- =====================================================
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT item_id, COUNT(*) AS c
      FROM tmp_sale_items
      GROUP BY item_id
      HAVING COUNT(*) > 1
    ) d
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_ITEMS_IN_PAYLOAD: items[] contains duplicate jewelry_item_id';
  END IF;

  -- P2C: split FOR UPDATE locking from aggregate to avoid 0A000
  -- Phase A: Lock rows (no aggregate)
  PERFORM 1 
  FROM public.jewelry_items ji
  WHERE ji.id IN (SELECT item_id FROM tmp_sale_items)
    AND ji.branch_id = v_branch_id
    AND ji.sold_at IS NULL
    AND ji.sale_status = 'available'
  ORDER BY ji.id
  FOR UPDATE;

  -- Phase B: Count locked rows (no FOR UPDATE)
  SELECT COUNT(*) INTO v_locked_count
  FROM public.jewelry_items ji
  WHERE ji.id IN (SELECT item_id FROM tmp_sale_items)
    AND ji.branch_id = v_branch_id
    AND ji.sold_at IS NULL
    AND ji.sale_status = 'available';

  IF v_locked_count != v_items_count THEN
    IF EXISTS (
      SELECT 1 FROM tmp_sale_items tsi
      LEFT JOIN public.jewelry_items ji ON ji.id = tsi.item_id
      WHERE ji.id IS NULL
    ) THEN
      RAISE EXCEPTION 'ITEM_NOT_FOUND: One or more items do not exist';
    END IF;

    IF EXISTS (
      SELECT 1 FROM tmp_sale_items tsi
      JOIN public.jewelry_items ji ON ji.id = tsi.item_id
      WHERE ji.branch_id != v_branch_id
    ) THEN
      RAISE EXCEPTION 'ITEM_WRONG_BRANCH: One or more items are not in the selected branch';
    END IF;

    IF EXISTS (
      SELECT 1 FROM tmp_sale_items tsi
      JOIN public.jewelry_items ji ON ji.id = tsi.item_id
      WHERE ji.sold_at IS NOT NULL OR ji.sale_status != 'available'
    ) THEN
      RAISE EXCEPTION 'ITEM_ALREADY_SOLD: One or more items have already been sold or are not available';
    END IF;

    RAISE EXCEPTION 'ITEM_VALIDATION_FAILED: Could not lock all items for sale';
  END IF;

  UPDATE tmp_sale_items tsi
  SET item_cost = COALESCE(ji.cost, 0)
  FROM public.jewelry_items ji
  WHERE ji.id = tsi.item_id;

  -- =====================================================
  -- STEP 5: Calculate amounts
  -- =====================================================
  SELECT SUM(sale_price), SUM(item_cost)
  INTO v_total_amount, v_items_cost
  FROM tmp_sale_items;

  IF v_discount_amount > v_total_amount THEN
    RAISE EXCEPTION 'INVALID_INPUT: Discount cannot exceed total amount';
  END IF;

  v_subtotal := round(v_total_amount - v_discount_amount, 2);
  v_tax_amount := round(v_subtotal * 0.15, 2);
  v_final_amount := round(v_subtotal + v_tax_amount, 2);

  v_base_discount_per_item := floor((v_discount_amount / v_items_count) * 100) / 100;
  v_discount_remainder := round(v_discount_amount - (v_base_discount_per_item * v_items_count), 2);

  -- =====================================================
  -- STEP 6: Validate payment amounts
  -- =====================================================
  IF v_payment_method = 'cash' THEN
    IF round(v_cash_amount, 2) != v_final_amount OR v_card_amount != 0 THEN
      v_cash_amount := v_final_amount;
      v_card_amount := 0;
    END IF;
  ELSIF v_payment_method = 'card' THEN
    IF round(v_card_amount, 2) != v_final_amount OR v_cash_amount != 0 THEN
      v_card_amount := v_final_amount;
      v_cash_amount := 0;
    END IF;
  ELSIF v_payment_method = 'split' THEN
    IF round(v_cash_amount + v_card_amount, 2) != v_final_amount THEN
      RAISE EXCEPTION 'INVALID_PAYMENT: Split payment amounts (% + %) do not equal final amount (%)',
        v_cash_amount, v_card_amount, v_final_amount;
    END IF;
  ELSIF v_payment_method = 'credit' THEN
    v_cash_amount := 0;
    v_card_amount := 0;

    IF v_customer_id IS NOT NULL THEN
      SELECT c.account_id INTO v_customer_account_id
      FROM public.customers c
      WHERE c.id = v_customer_id AND c.account_id IS NOT NULL;

      IF v_customer_account_id IS NOT NULL THEN
        v_ar_account_id := v_customer_account_id;
      END IF;
    END IF;
  ELSE
    RAISE EXCEPTION 'INVALID_PAYMENT: Unknown payment method: %', v_payment_method;
  END IF;

  -- =====================================================
  -- STEP 7: Generate sale code
  -- =====================================================
  SELECT public.generate_sale_code(v_branch_id) INTO v_sale_code;

  -- =====================================================
  -- STEP 8: Create sale record
  -- =====================================================
  INSERT INTO public.sales (
    sale_code,
    branch_id,
    customer_id,
    total_items,
    total_amount,
    discount_amount,
    final_amount,
    payment_method,
    notes,
    sold_by,
    sale_date
  ) VALUES (
    v_sale_code,
    v_branch_id,
    v_customer_id,
    v_items_count,
    v_total_amount,
    v_discount_amount,
    v_final_amount,
    v_payment_method,
    v_notes,
    v_sold_by,
    now()
  ) RETURNING id INTO v_sale_id;

  -- =====================================================
  -- STEP 9: Create sale_items
  -- =====================================================
  FOR v_item IN
    SELECT item_id, sale_price, idx FROM tmp_sale_items ORDER BY idx
  LOOP
    v_item_idx := v_item_idx + 1;

    IF v_item_idx = v_items_count THEN
      v_item_discount := v_base_discount_per_item + v_discount_remainder;
    ELSE
      v_item_discount := v_base_discount_per_item;
    END IF;

    v_item_sale_price := round(v_item.sale_price - v_item_discount, 2);

    INSERT INTO public.sale_items (sale_id, item_id, sale_price)
    VALUES (v_sale_id, v_item.item_id, v_item_sale_price);
  END LOOP;

  -- =====================================================
  -- STEP 10: Update jewelry_items as sold
  -- =====================================================
  WITH updated AS (
    UPDATE public.jewelry_items
    SET
      sold_at = now(),
      sold_price = tsi.sale_price -
        CASE
          WHEN tsi.idx = v_items_count THEN v_base_discount_per_item + v_discount_remainder
          ELSE v_base_discount_per_item
        END,
      sale_id = v_sale_id,
      sale_status = 'sold',
      is_available_for_sale = false
    FROM tmp_sale_items tsi
    WHERE public.jewelry_items.id = tsi.item_id
      AND public.jewelry_items.sold_at IS NULL
      AND public.jewelry_items.sale_status = 'available'
    RETURNING public.jewelry_items.id
  )
  SELECT COUNT(*) INTO v_updated_count FROM updated;

  IF v_updated_count != v_items_count THEN
    RAISE EXCEPTION 'ITEM_ALREADY_SOLD: Race condition detected - items were sold by another transaction';
  END IF;

  -- =====================================================
  -- STEP 11: Create item_movements (P2H-B: Idempotent insert)
  -- =====================================================
  WITH ins AS (
    INSERT INTO public.item_movements (
      item_id,
      movement_type,
      movement_date,
      reference_type,
      reference_id,
      reference_code,
      from_branch_id,
      performed_by,
      cost,
      notes
    )
    SELECT
      tsi.item_id,
      'SALE',
      now(),
      'sale',
      v_sale_id,
      v_sale_code,
      v_branch_id,
      v_sold_by,
      tsi.sale_price -
        CASE
          WHEN tsi.idx = v_items_count THEN v_base_discount_per_item + v_discount_remainder
          ELSE v_base_discount_per_item
        END,
      'بيع قطعة - فاتورة ' || v_sale_code
    FROM tmp_sale_items tsi
    ON CONFLICT (movement_type, reference_type, reference_id, item_id)
      WHERE (movement_type = 'SALE' AND reference_type = 'sale')
    DO NOTHING
    RETURNING id
  )
  SELECT COUNT(*) INTO v_updated_count FROM ins;

  -- P2H-B2: Ensure movements are complete (inserted or already existed)
  SELECT COUNT(*) INTO v_existing_sale_moves
  FROM public.item_movements im
  WHERE im.movement_type = 'SALE'
    AND im.reference_type = 'sale'
    AND im.reference_id = v_sale_id
    AND im.item_id IN (SELECT item_id FROM tmp_sale_items);

  IF v_existing_sale_moves != v_items_count THEN
    RAISE EXCEPTION 'SALE_MOVEMENTS_INCOMPLETE: expected % movements, found % for sale_id=%',
      v_items_count, v_existing_sale_moves, v_sale_id;
  END IF;

  -- =====================================================
  -- STEP 12: Update customer if exists
  -- =====================================================
  IF v_customer_id IS NOT NULL THEN
    UPDATE public.customers
    SET
      total_purchases = COALESCE(total_purchases, 0) + v_final_amount,
      loyalty_points = floor((COALESCE(total_purchases, 0) + v_final_amount) / 100)
    WHERE id = v_customer_id;
  END IF;

  -- =====================================================
  -- STEP 13: Generate journal entry number
  -- =====================================================
  SELECT public.generate_journal_entry_number() INTO v_je_number;

  -- =====================================================
  -- STEP 14: Create journal entry header
  -- =====================================================
  INSERT INTO public.journal_entries (
    entry_number,
    entry_date,
    reference_type,
    reference_id,
    description,
    branch_id,
    total_debit,
    total_credit,
    is_posted,
    created_by
  ) VALUES (
    v_je_number,
    CURRENT_DATE,
    'sale',
    v_sale_id,
    'قيد بيع POS - فاتورة ' || v_sale_code,
    v_branch_id,
    v_final_amount + v_items_cost,
    v_final_amount + v_items_cost,
    true,
    v_sold_by
  ) RETURNING id INTO v_je_id;

  -- =====================================================
  -- STEP 15: Create journal entry lines
  -- =====================================================
  IF v_payment_method = 'cash' THEN
    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_cash_account_id, v_final_amount, 0, 'تحصيل نقدي - ' || v_sale_code);
  ELSIF v_payment_method = 'card' THEN
    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_bank_account_id, v_final_amount, 0, 'تحصيل شبكة - ' || v_sale_code);
  ELSIF v_payment_method = 'split' THEN
    IF v_cash_amount > 0 THEN
      INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
      VALUES (v_je_id, v_cash_account_id, v_cash_amount, 0, 'تحصيل نقدي (مقسم) - ' || v_sale_code);
    END IF;
    IF v_card_amount > 0 THEN
      INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
      VALUES (v_je_id, v_bank_account_id, v_card_amount, 0, 'تحصيل شبكة (مقسم) - ' || v_sale_code);
    END IF;
  ELSIF v_payment_method = 'credit' THEN
    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_ar_account_id, v_final_amount, 0, 'ذمم مدينة - ' || v_sale_code);
  END IF;

  INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
  VALUES (v_je_id, v_sales_account_id, 0, v_subtotal, 'إيراد مبيعات - ' || v_sale_code);

  INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
  VALUES (v_je_id, v_vat_account_id, 0, v_tax_amount, 'ضريبة القيمة المضافة - ' || v_sale_code);

  IF v_items_cost > 0 THEN
    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_cogs_account_id, v_items_cost, 0, 'تكلفة البضاعة المباعة - ' || v_sale_code);

    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_inventory_account_id, 0, v_items_cost, 'تخفيض المخزون - ' || v_sale_code);
  END IF;

  -- =====================================================
  -- STEP 16: Link journal entry to sale
  -- =====================================================
  UPDATE public.sales SET journal_entry_id = v_je_id WHERE id = v_sale_id;

  -- =====================================================
  -- STEP 17: Generate invoice
  -- =====================================================
  SELECT public.generate_invoice_number('sales', COALESCE(v_branch_code, '')) INTO v_invoice_number;

  INSERT INTO public.invoices (
    invoice_number,
    invoice_type,
    invoice_date,
    customer_id,
    branch_id,
    sale_id,
    subtotal,
    discount_amount,
    tax_amount,
    total_amount,
    paid_amount,
    remaining_amount,
    status,
    created_by
  ) VALUES (
    v_invoice_number,
    'sales',
    CURRENT_DATE,
    v_customer_id,
    v_branch_id,
    v_sale_id,
    v_total_amount,
    v_discount_amount,
    v_tax_amount,
    v_final_amount,
    CASE WHEN v_payment_method = 'credit' THEN 0 ELSE v_final_amount END,
    CASE WHEN v_payment_method = 'credit' THEN v_final_amount ELSE 0 END,
    CASE WHEN v_payment_method = 'credit' THEN 'pending' ELSE 'paid' END,
    v_sold_by
  ) RETURNING id INTO v_invoice_id;

  -- =====================================================
  -- STEP 18: Update idempotency record with success
  -- =====================================================
  UPDATE public.pos_sale_requests
  SET
    status = 'succeeded',
    sale_id = v_sale_id,
    invoice_id = v_invoice_id,
    journal_entry_id = v_je_id,
    completed_at = now()
  WHERE client_request_id = v_client_request_id;

  -- =====================================================
  -- STEP 19: Return success result
  -- =====================================================
  v_result := jsonb_build_object(
    'success', true,
    'sale_id', v_sale_id,
    'sale_code', v_sale_code,
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'journal_entry_id', v_je_id,
    'journal_entry_number', v_je_number,
    'total_amount', v_total_amount,
    'discount_amount', v_discount_amount,
    'tax_amount', v_tax_amount,
    'final_amount', v_final_amount,
    'items_count', v_items_count,
    'payment_method', v_payment_method
  );

  RETURN v_result;

-- P2H-C: Enhanced exception handling for unique violations
EXCEPTION 
  WHEN unique_violation THEN
    UPDATE public.pos_sale_requests
    SET
      status = 'failed',
      error_message = SQLERRM,
      completed_at = now()
    WHERE client_request_id = v_client_request_id;

    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM,
      'error_code', 'POS_DUP_MOVEMENT',
      'sqlstate', SQLSTATE
    );

  WHEN OTHERS THEN
    UPDATE public.pos_sale_requests
    SET
      status = 'failed',
      error_message = SQLERRM,
      completed_at = now()
    WHERE client_request_id = v_client_request_id;

    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM,
      'error_code', SQLSTATE
    );
END;
$$;

-- Ensure proper permissions
REVOKE EXECUTE ON FUNCTION public.complete_pos_sale_atomic(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_pos_sale_atomic(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_pos_sale_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_pos_sale_atomic(jsonb) TO service_role;

COMMENT ON FUNCTION public.complete_pos_sale_atomic(p_payload jsonb) IS 
'Atomic POS sale - P2H patched: idempotent item_movements + block duplicate items in payload + enhanced 23505 handling';