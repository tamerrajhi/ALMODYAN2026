-- =====================================================================
-- P4-9 STEP B: ERP Sales Returns Hardening - RLS + RPCs
-- =====================================================================

-- =====================================================================
-- STEP B1: Fix finished_goods_movements INSERT policy (CRITICAL)
-- Currently: WITH CHECK = TRUE (permissive)
-- Fix: Branch-scoped via from/to branch
-- =====================================================================

DROP POLICY IF EXISTS "Users can insert finished goods movements" ON finished_goods_movements;

CREATE POLICY "Users can insert finished goods movements in their branches"
ON finished_goods_movements
FOR INSERT
TO public
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR (
    (from_branch_id IS NULL OR from_branch_id = ANY(get_user_branches(auth.uid())))
    AND (to_branch_id IS NULL OR to_branch_id = ANY(get_user_branches(auth.uid())))
  )
);

-- Add UPDATE policy for completeness (branch-scoped)
DROP POLICY IF EXISTS "Users can update finished goods movements" ON finished_goods_movements;
CREATE POLICY "Users can update finished goods movements in their branches"
ON finished_goods_movements
FOR UPDATE
TO public
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR from_branch_id = ANY(get_user_branches(auth.uid()))
  OR to_branch_id = ANY(get_user_branches(auth.uid()))
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR (
    (from_branch_id IS NULL OR from_branch_id = ANY(get_user_branches(auth.uid())))
    AND (to_branch_id IS NULL OR to_branch_id = ANY(get_user_branches(auth.uid())))
  )
);

-- =====================================================================
-- STEP C1: Create complete_erp_sales_return_atomic
-- Uses invoices + sales_invoice_items pattern (ERP-style)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.complete_erp_sales_return_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_client_request_id text;
  v_return_id uuid;
  v_return_number text;
  v_branch_id uuid;
  v_customer_id uuid;
  v_linked_invoice_id uuid;
  v_return_date date;
  v_notes text;
  v_items jsonb;
  v_item record;
  v_subtotal numeric := 0;
  v_tax_amount numeric := 0;
  v_total_amount numeric := 0;
  v_total_discount numeric := 0;
  v_total_cogs numeric := 0;
  v_line_subtotal numeric;
  v_line_discount numeric;
  v_line_tax numeric;
  v_line_total numeric;
  v_unit_cogs numeric;
  v_je_number text;
  v_journal_entry_id uuid;
  v_inventory_account_id uuid;
  v_revenue_account_id uuid;
  v_ar_account_id uuid;
  v_cogs_account_id uuid;
  v_vat_account_id uuid;
  v_begin_result jsonb;
  v_result_payload jsonb;
  v_user_id uuid;
  v_user_name text;
  v_original_invoice record;
  v_line_available numeric;
  v_already_returned numeric;
BEGIN
  -- Extract payload
  v_client_request_id := p_payload->>'client_request_id';
  v_branch_id := (p_payload->>'branch_id')::uuid;
  v_customer_id := (p_payload->>'customer_id')::uuid;
  v_linked_invoice_id := (p_payload->>'linked_invoice_id')::uuid;
  v_return_date := COALESCE((p_payload->>'return_date')::date, CURRENT_DATE);
  v_notes := p_payload->>'notes';
  v_items := p_payload->'items';

  -- Validations
  IF v_client_request_id IS NULL THEN 
    RETURN jsonb_build_object('success', false, 'errorCode', 'VALIDATION_ERROR', 'error', 'client_request_id is required'); 
  END IF;
  IF v_branch_id IS NULL THEN 
    RETURN jsonb_build_object('success', false, 'errorCode', 'VALIDATION_ERROR', 'error', 'branch_id is required'); 
  END IF;
  IF v_customer_id IS NULL THEN 
    RETURN jsonb_build_object('success', false, 'errorCode', 'VALIDATION_ERROR', 'error', 'customer_id is required'); 
  END IF;
  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN 
    RETURN jsonb_build_object('success', false, 'errorCode', 'VALIDATION_ERROR', 'error', 'items array is required'); 
  END IF;

  -- Idempotency check
  v_begin_result := public.atomic_begin_request(v_client_request_id, 'erp_sales_return', p_payload, NULL);
  IF v_begin_result->>'status' = 'completed' THEN RETURN v_begin_result->'result'; END IF;
  IF v_begin_result->>'status' = 'failed' THEN RETURN v_begin_result->'result'; END IF;

  -- Get user info
  v_user_id := auth.uid();
  SELECT COALESCE(raw_user_meta_data->>'full_name', email, 'System') INTO v_user_name 
  FROM auth.users WHERE id = v_user_id;

  -- Access control: user must have access to branch
  IF NOT (has_role(v_user_id, 'admin'::app_role) OR v_branch_id = ANY(get_user_branches(v_user_id))) THEN
    v_result_payload := jsonb_build_object('success', false, 'errorCode', 'ACCESS_DENIED', 'error', 'No access to this branch');
    PERFORM public.atomic_failed(v_client_request_id, 'erp_sales_return', v_result_payload, 'ACCESS_DENIED', 'No access to branch');
    RETURN v_result_payload;
  END IF;

  -- Validate original invoice if linked
  IF v_linked_invoice_id IS NOT NULL THEN
    SELECT * INTO v_original_invoice 
    FROM invoices 
    WHERE id = v_linked_invoice_id AND invoice_type = 'sales' 
    FOR UPDATE;
    
    IF v_original_invoice.id IS NULL THEN
      v_result_payload := jsonb_build_object('success', false, 'errorCode', 'INVALID_INVOICE', 'error', 'Original invoice not found');
      PERFORM public.atomic_failed(v_client_request_id, 'erp_sales_return', v_result_payload, 'INVALID_INVOICE', 'Invoice not found');
      RETURN v_result_payload;
    END IF;
    
    IF v_original_invoice.status = 'voided' THEN
      v_result_payload := jsonb_build_object('success', false, 'errorCode', 'INVOICE_VOIDED', 'error', 'Cannot return from voided invoice');
      PERFORM public.atomic_failed(v_client_request_id, 'erp_sales_return', v_result_payload, 'INVOICE_VOIDED', 'Invoice voided');
      RETURN v_result_payload;
    END IF;
  END IF;

  -- Generate return number
  v_return_id := gen_random_uuid();
  v_return_number := public.generate_sales_return_number();

  -- Get account IDs
  SELECT id INTO v_inventory_account_id FROM chart_of_accounts WHERE account_code = '1301' AND is_active = true LIMIT 1;
  SELECT id INTO v_revenue_account_id FROM chart_of_accounts WHERE account_code = '4001' AND is_active = true LIMIT 1;
  SELECT id INTO v_cogs_account_id FROM chart_of_accounts WHERE account_code = '5001' AND is_active = true LIMIT 1;
  SELECT id INTO v_vat_account_id FROM chart_of_accounts WHERE account_code = '2102' AND is_active = true LIMIT 1;
  IF v_customer_id IS NOT NULL THEN 
    SELECT account_id INTO v_ar_account_id FROM customers WHERE id = v_customer_id; 
  END IF;
  IF v_ar_account_id IS NULL THEN 
    SELECT id INTO v_ar_account_id FROM chart_of_accounts WHERE account_code = '1201' AND is_active = true LIMIT 1; 
  END IF;

  -- Process items and calculate totals
  FOR v_item IN SELECT * FROM jsonb_to_recordset(v_items) AS x(
    jewelry_item_id uuid, 
    description text, 
    quantity numeric, 
    unit_price numeric, 
    tax_rate numeric,
    discount_amount numeric,
    discount_percentage numeric
  )
  LOOP
    -- Validate return quantity against original if linked
    IF v_linked_invoice_id IS NOT NULL AND v_item.jewelry_item_id IS NOT NULL THEN
      -- Get original sold qty
      SELECT COALESCE(SUM(quantity), 0) INTO v_line_available
      FROM sales_invoice_items
      WHERE invoice_id = v_linked_invoice_id AND jewelry_item_id = v_item.jewelry_item_id;
      
      -- Get already returned qty
      SELECT COALESCE(SUM(sii.quantity), 0) INTO v_already_returned
      FROM sales_invoice_items sii
      JOIN invoices i ON i.id = sii.invoice_id
      WHERE i.linked_invoice_id = v_linked_invoice_id 
        AND i.invoice_type = 'sales_return'
        AND i.status != 'voided'
        AND sii.jewelry_item_id = v_item.jewelry_item_id;
      
      IF COALESCE(v_item.quantity, 1) > (v_line_available - v_already_returned) THEN
        v_result_payload := jsonb_build_object(
          'success', false, 
          'errorCode', 'OVER_RETURN_NOT_ALLOWED', 
          'error', format('Return qty %s exceeds available %s for item', v_item.quantity, v_line_available - v_already_returned)
        );
        PERFORM public.atomic_failed(v_client_request_id, 'erp_sales_return', v_result_payload, 'OVER_RETURN_NOT_ALLOWED', 'Qty exceeds available');
        RETURN v_result_payload;
      END IF;
    END IF;

    -- Calculate line totals
    v_line_subtotal := COALESCE(v_item.quantity, 1) * COALESCE(v_item.unit_price, 0);
    v_line_discount := COALESCE(v_item.discount_amount, 0);
    IF COALESCE(v_item.discount_percentage, 0) > 0 THEN
      v_line_discount := v_line_subtotal * (v_item.discount_percentage / 100);
    END IF;
    v_line_tax := (v_line_subtotal - v_line_discount) * COALESCE(v_item.tax_rate, 0.15);
    v_line_total := v_line_subtotal - v_line_discount + v_line_tax;

    v_subtotal := v_subtotal + (v_line_subtotal - v_line_discount);
    v_tax_amount := v_tax_amount + v_line_tax;
    v_total_discount := v_total_discount + v_line_discount;

    -- Get COGS for inventory items
    IF v_item.jewelry_item_id IS NOT NULL THEN
      SELECT COALESCE(cost_price, 0) INTO v_unit_cogs FROM jewelry_items WHERE id = v_item.jewelry_item_id;
      v_total_cogs := v_total_cogs + (COALESCE(v_unit_cogs, 0) * COALESCE(v_item.quantity, 1));
      
      -- Restore inventory: clear sale linkage, set available
      UPDATE jewelry_items SET 
        sale_id = NULL,
        sale_status = 'available',
        is_available_for_sale = true,
        branch_id = v_branch_id,
        updated_at = NOW()
      WHERE id = v_item.jewelry_item_id;
      
      -- Record movement
      INSERT INTO finished_goods_movements (
        item_id, item_code, movement_type, to_branch_id, to_location,
        weight_grams, value_amount, performed_by, notes, movement_date
      )
      SELECT 
        v_item.jewelry_item_id,
        ji.item_code,
        'sale_return',
        v_branch_id,
        'showroom',
        COALESCE(ji.gold_weight, 0),
        v_line_total,
        v_user_name,
        'مرتجع مبيعات - ' || v_return_number,
        NOW()
      FROM jewelry_items ji WHERE ji.id = v_item.jewelry_item_id;
    END IF;

    -- Insert return line item
    INSERT INTO sales_invoice_items (
      invoice_id, description, quantity, unit_price,
      discount_amount, discount_percentage, tax_rate, tax_amount,
      total_before_tax, total_amount, jewelry_item_id
    ) VALUES (
      v_return_id,
      v_item.description,
      COALESCE(v_item.quantity, 1),
      COALESCE(v_item.unit_price, 0),
      v_line_discount,
      COALESCE(v_item.discount_percentage, 0),
      COALESCE(v_item.tax_rate, 0.15),
      v_line_tax,
      v_line_subtotal - v_line_discount,
      v_line_total,
      v_item.jewelry_item_id
    );
  END LOOP;

  v_total_amount := v_subtotal + v_tax_amount;

  -- Create Journal Entry
  v_je_number := public.generate_journal_entry_number();
  
  INSERT INTO journal_entries (
    entry_number, entry_date, reference_type, reference_id, 
    description, is_posted, total_debit, total_credit, branch_id
  )
  VALUES (
    v_je_number, v_return_date, 'sales_return', v_return_id,
    'مرتجع مبيعات: ' || v_return_number, true, 
    v_total_amount + v_total_cogs, v_total_amount + v_total_cogs, v_branch_id
  )
  RETURNING id INTO v_journal_entry_id;

  -- JE Lines: Debit Revenue (reverse sale)
  IF v_revenue_account_id IS NOT NULL AND v_subtotal > 0 THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_journal_entry_id, v_revenue_account_id, v_subtotal, 0, 'عكس إيراد المبيعات');
  END IF;

  -- JE Lines: Debit VAT (reverse VAT collected)
  IF v_vat_account_id IS NOT NULL AND v_tax_amount > 0 THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_journal_entry_id, v_vat_account_id, v_tax_amount, 0, 'عكس ضريبة القيمة المضافة');
  END IF;

  -- JE Lines: Credit AR (reduce customer receivable)
  IF v_ar_account_id IS NOT NULL AND v_total_amount > 0 THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_journal_entry_id, v_ar_account_id, 0, v_total_amount, 'تخفيض ذمم العميل');
  END IF;

  -- JE Lines: COGS reversal (if inventory items)
  IF v_total_cogs > 0 THEN
    IF v_inventory_account_id IS NOT NULL THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
      VALUES (v_journal_entry_id, v_inventory_account_id, v_total_cogs, 0, 'استعادة المخزون');
    END IF;
    IF v_cogs_account_id IS NOT NULL THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
      VALUES (v_journal_entry_id, v_cogs_account_id, 0, v_total_cogs, 'عكس تكلفة البضاعة المباعة');
    END IF;
  END IF;

  -- Insert return header (invoices table with type='sales_return')
  INSERT INTO invoices (
    id, invoice_number, invoice_type, invoice_date, due_date,
    customer_id, branch_id, subtotal, tax_amount, discount_amount,
    total_amount, paid_amount, remaining_amount, status, notes,
    linked_invoice_id, journal_entry_id, created_by
  ) VALUES (
    v_return_id, v_return_number, 'sales_return', v_return_date, v_return_date,
    v_customer_id, v_branch_id, v_subtotal, v_tax_amount, v_total_discount,
    v_total_amount, 0, v_total_amount, 'completed', v_notes,
    v_linked_invoice_id, v_journal_entry_id, v_user_name
  );

  -- Update original invoice if linked (reduce remaining/status)
  IF v_linked_invoice_id IS NOT NULL THEN
    UPDATE invoices SET
      remaining_amount = GREATEST(0, COALESCE(remaining_amount, total_amount) - v_total_amount),
      status = CASE 
        WHEN GREATEST(0, COALESCE(remaining_amount, total_amount) - v_total_amount) <= 0 THEN 'paid'
        ELSE status
      END
    WHERE id = v_linked_invoice_id;
  END IF;

  -- Build success result
  v_result_payload := jsonb_build_object(
    'success', true,
    'return_id', v_return_id,
    'return_number', v_return_number,
    'total_amount', v_total_amount,
    'journal_entry_id', v_journal_entry_id,
    'journal_entry_number', v_je_number,
    'linked_invoice_id', v_linked_invoice_id
  );
  
  PERFORM public.atomic_complete(v_client_request_id, 'erp_sales_return', v_result_payload);
  RETURN v_result_payload;

EXCEPTION WHEN OTHERS THEN
  v_result_payload := jsonb_build_object('success', false, 'errorCode', 'EXCEPTION', 'error', SQLERRM);
  PERFORM public.atomic_failed(v_client_request_id, 'erp_sales_return', v_result_payload, 'EXCEPTION', SQLERRM);
  RETURN v_result_payload;
END;
$$;

-- =====================================================================
-- STEP C2: Create void_erp_sales_return_atomic
-- =====================================================================

CREATE OR REPLACE FUNCTION public.void_erp_sales_return_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_client_request_id text;
  v_return_id uuid;
  v_void_reason text;
  v_return_record record;
  v_begin_result jsonb;
  v_result_payload jsonb;
  v_user_id uuid;
  v_user_name text;
  v_reversal_je_id uuid;
  v_reversal_je_number text;
  v_original_je record;
  v_line record;
BEGIN
  -- Extract payload
  v_client_request_id := p_payload->>'client_request_id';
  v_return_id := (p_payload->>'return_id')::uuid;
  v_void_reason := p_payload->>'void_reason';

  -- Validations
  IF v_client_request_id IS NULL THEN 
    RETURN jsonb_build_object('success', false, 'errorCode', 'VALIDATION_ERROR', 'error', 'client_request_id is required'); 
  END IF;
  IF v_return_id IS NULL THEN 
    RETURN jsonb_build_object('success', false, 'errorCode', 'VALIDATION_ERROR', 'error', 'return_id is required'); 
  END IF;
  IF v_void_reason IS NULL OR trim(v_void_reason) = '' THEN 
    RETURN jsonb_build_object('success', false, 'errorCode', 'VALIDATION_ERROR', 'error', 'void_reason is required'); 
  END IF;

  -- Idempotency check
  v_begin_result := public.atomic_begin_request(v_client_request_id, 'erp_sales_return_void', p_payload, NULL);
  IF v_begin_result->>'status' = 'completed' THEN RETURN v_begin_result->'result'; END IF;
  IF v_begin_result->>'status' = 'failed' THEN RETURN v_begin_result->'result'; END IF;

  -- Get user info
  v_user_id := auth.uid();
  SELECT COALESCE(raw_user_meta_data->>'full_name', email, 'System') INTO v_user_name 
  FROM auth.users WHERE id = v_user_id;

  -- Lock and fetch return
  SELECT * INTO v_return_record
  FROM invoices
  WHERE id = v_return_id AND invoice_type = 'sales_return'
  FOR UPDATE;

  IF v_return_record.id IS NULL THEN
    v_result_payload := jsonb_build_object('success', false, 'errorCode', 'NOT_FOUND', 'error', 'Sales return not found');
    PERFORM public.atomic_failed(v_client_request_id, 'erp_sales_return_void', v_result_payload, 'NOT_FOUND', 'Return not found');
    RETURN v_result_payload;
  END IF;

  -- Access control
  IF NOT (has_role(v_user_id, 'admin'::app_role) OR v_return_record.branch_id = ANY(get_user_branches(v_user_id))) THEN
    v_result_payload := jsonb_build_object('success', false, 'errorCode', 'ACCESS_DENIED', 'error', 'No access to this branch');
    PERFORM public.atomic_failed(v_client_request_id, 'erp_sales_return_void', v_result_payload, 'ACCESS_DENIED', 'No access');
    RETURN v_result_payload;
  END IF;

  -- Check if already voided
  IF v_return_record.status = 'voided' THEN
    v_result_payload := jsonb_build_object('success', false, 'errorCode', 'ALREADY_VOIDED', 'error', 'Return is already voided');
    PERFORM public.atomic_failed(v_client_request_id, 'erp_sales_return_void', v_result_payload, 'ALREADY_VOIDED', 'Already voided');
    RETURN v_result_payload;
  END IF;

  -- Create reversal JE if original JE exists and is posted
  IF v_return_record.journal_entry_id IS NOT NULL THEN
    SELECT * INTO v_original_je FROM journal_entries WHERE id = v_return_record.journal_entry_id;
    
    IF v_original_je.is_posted = true THEN
      v_reversal_je_number := public.generate_journal_entry_number();
      
      INSERT INTO journal_entries (
        entry_number, entry_date, reference_type, reference_id,
        description, is_posted, total_debit, total_credit, branch_id
      )
      VALUES (
        v_reversal_je_number, CURRENT_DATE, 'sales_return_reversal', v_return_id,
        'عكس قيد مرتجع: ' || v_return_record.invoice_number, true,
        v_original_je.total_debit, v_original_je.total_credit, v_return_record.branch_id
      )
      RETURNING id INTO v_reversal_je_id;

      -- Insert reversed lines (swap debit/credit)
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description, cost_center_id)
      SELECT v_reversal_je_id, account_id, credit_amount, debit_amount, 
             'عكس: ' || COALESCE(description, ''), cost_center_id
      FROM journal_entry_lines
      WHERE journal_entry_id = v_original_je.id;

      -- Mark original JE as reversed
      UPDATE journal_entries SET 
        is_reversed = true,
        reversed_by_entry_id = v_reversal_je_id
      WHERE id = v_original_je.id;
    END IF;
  END IF;

  -- Reverse inventory: Re-apply sale state to returned items
  FOR v_line IN 
    SELECT sii.jewelry_item_id, sii.total_amount
    FROM sales_invoice_items sii
    WHERE sii.invoice_id = v_return_id AND sii.jewelry_item_id IS NOT NULL
  LOOP
    -- Mark item as sold again (since we're undoing the return)
    UPDATE jewelry_items SET
      sale_status = 'sold',
      is_available_for_sale = false,
      updated_at = NOW()
    WHERE id = v_line.jewelry_item_id;

    -- Record void movement
    INSERT INTO finished_goods_movements (
      item_id, item_code, movement_type, from_branch_id, from_location,
      value_amount, performed_by, notes, movement_date
    )
    SELECT 
      v_line.jewelry_item_id,
      ji.item_code,
      'void_return',
      v_return_record.branch_id,
      'showroom',
      v_line.total_amount,
      v_user_name,
      'إلغاء مرتجع - ' || v_return_record.invoice_number,
      NOW()
    FROM jewelry_items ji WHERE ji.id = v_line.jewelry_item_id;
  END LOOP;

  -- Update original invoice if linked (restore remaining)
  IF v_return_record.linked_invoice_id IS NOT NULL THEN
    UPDATE invoices SET
      remaining_amount = LEAST(total_amount, COALESCE(remaining_amount, 0) + v_return_record.total_amount),
      status = CASE 
        WHEN COALESCE(remaining_amount, 0) + v_return_record.total_amount > 0 THEN 'pending'
        ELSE status
      END
    WHERE id = v_return_record.linked_invoice_id;
  END IF;

  -- Void the return
  UPDATE invoices SET
    status = 'voided',
    voided_at = NOW(),
    voided_by = v_user_id,
    void_reason = v_void_reason
  WHERE id = v_return_id;

  -- Build success result
  v_result_payload := jsonb_build_object(
    'success', true,
    'return_id', v_return_id,
    'voided_at', NOW(),
    'reversal_journal_entry_id', v_reversal_je_id,
    'reversal_journal_entry_number', v_reversal_je_number
  );
  
  PERFORM public.atomic_complete(v_client_request_id, 'erp_sales_return_void', v_result_payload);
  RETURN v_result_payload;

EXCEPTION WHEN OTHERS THEN
  v_result_payload := jsonb_build_object('success', false, 'errorCode', 'EXCEPTION', 'error', SQLERRM);
  PERFORM public.atomic_failed(v_client_request_id, 'erp_sales_return_void', v_result_payload, 'EXCEPTION', SQLERRM);
  RETURN v_result_payload;
END;
$$;

-- =====================================================================
-- Grant permissions
-- =====================================================================

REVOKE EXECUTE ON FUNCTION public.complete_erp_sales_return_atomic(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_erp_sales_return_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_erp_sales_return_atomic(jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.void_erp_sales_return_atomic(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_erp_sales_return_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_erp_sales_return_atomic(jsonb) TO service_role;