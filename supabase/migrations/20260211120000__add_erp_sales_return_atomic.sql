-- P0-SR-ERP-01: Create complete_erp_sales_return_atomic and generate_sales_return_number
-- These functions enable ERP sales returns (separate path from POS returns)
-- ERP returns link via returns.original_invoice_id (not original_sale_id)

-- Helper: Generate sequential sales return numbers (SR-YYYYMMDD-NNNN)
CREATE OR REPLACE FUNCTION public.generate_sales_return_number()
RETURNS text
LANGUAGE plpgsql
AS $function$
DECLARE
  v_today text;
  v_seq int;
  v_result text;
BEGIN
  v_today := to_char(now(), 'YYYYMMDD');
  SELECT COALESCE(MAX(
    CASE WHEN return_number LIKE 'SR-' || v_today || '-%'
    THEN NULLIF(regexp_replace(return_number, '^SR-' || v_today || '-', ''), '')::int
    ELSE 0 END
  ), 0) + 1 INTO v_seq
  FROM returns
  WHERE return_number LIKE 'SR-' || v_today || '-%';

  v_result := 'SR-' || v_today || '-' || LPAD(v_seq::text, 4, '0');
  RETURN v_result;
END;
$function$;

-- Main: Atomic ERP sales return function
-- Payload shape (from SalesReturnFormPage.tsx):
--   client_request_id: uuid (idempotency key)
--   branch_id: uuid
--   customer_id: uuid
--   linked_invoice_id: uuid (the ERP invoice being returned against)
--   return_date: date string
--   notes: text
--   items: array of { jewelry_item_id, description, quantity, unit_price, tax_rate, discount_amount, discount_percentage }
CREATE OR REPLACE FUNCTION public.complete_erp_sales_return_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_client_request_id uuid;
  v_branch_id uuid;
  v_customer_id uuid;
  v_linked_invoice_id uuid;
  v_return_date date;
  v_notes text;
  v_items jsonb;
  v_items_count int;

  v_existing RECORD;
  v_inv RECORD;
  v_ui RECORD;
  v_sii RECORD;

  v_total_refund numeric := 0;
  v_total_cost numeric := 0;
  v_taxable_base numeric := 0;
  v_tax_amount numeric := 0;
  v_final_amount numeric := 0;

  v_return_id uuid;
  v_return_number text;
  v_je_id uuid;
  v_je_number text;
  v_payment_number text;

  v_cash_account_id uuid;
  v_bank_account_id uuid;
  v_inventory_account_id uuid;
  v_cogs_account_id uuid;
  v_sales_revenue_account_id uuid;
  v_vat_output_account_id uuid;

  v_total_debit numeric := 0;
  v_total_credit numeric := 0;

  v_result jsonb;
  v_item_record jsonb;
  v_item_id uuid;
  v_item_unit_price numeric;
  v_item_tax_rate numeric;
  v_item_discount_amount numeric;
  v_item_discount_percentage numeric;
  v_item_qty int;
  v_line_subtotal numeric;
  v_line_discount numeric;
  v_line_after_discount numeric;
  v_line_tax numeric;
  v_line_total numeric;
  v_item_description text;
  i int;
BEGIN
  v_client_request_id := (p_payload->>'client_request_id')::uuid;
  v_branch_id := NULLIF(p_payload->>'branch_id', '')::uuid;
  v_customer_id := NULLIF(p_payload->>'customer_id', '')::uuid;
  v_linked_invoice_id := NULLIF(p_payload->>'linked_invoice_id', '')::uuid;
  v_return_date := COALESCE((p_payload->>'return_date')::date, CURRENT_DATE);
  v_notes := p_payload->>'notes';
  v_items := p_payload->'items';
  v_items_count := jsonb_array_length(v_items);

  IF v_items_count = 0 OR v_items IS NULL THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'VALIDATION_ERROR',
      'error', 'يجب إضافة بند واحد على الأقل');
  END IF;

  -- Idempotency guard
  SELECT * INTO v_existing FROM pos_workflow_requests WHERE client_request_id = v_client_request_id;
  IF FOUND AND v_existing.status = 'succeeded' AND v_existing.result IS NOT NULL THEN
    RETURN v_existing.result || jsonb_build_object('idempotent', true);
  END IF;
  IF NOT FOUND THEN
    INSERT INTO pos_workflow_requests (client_request_id, workflow_type, status, created_at, updated_at)
    VALUES (v_client_request_id, 'erp_sales_return', 'processing', now(), now())
    ON CONFLICT (client_request_id) DO NOTHING;
  END IF;

  -- Validate linked invoice (required for ERP return)
  IF v_linked_invoice_id IS NULL THEN
    UPDATE pos_workflow_requests SET status='failed', error_code='VALIDATION_ERROR',
      error_message='الفاتورة الأصلية مطلوبة', updated_at=now()
    WHERE client_request_id = v_client_request_id;
    RETURN jsonb_build_object('success', false, 'errorCode', 'VALIDATION_ERROR',
      'error', 'الفاتورة الأصلية مطلوبة للمرتجع');
  END IF;

  -- Lock and fetch invoice
  SELECT * INTO v_inv FROM invoices WHERE id = v_linked_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE pos_workflow_requests SET status='failed', error_code='INVALID_INVOICE',
      error_message='الفاتورة الأصلية غير موجودة', updated_at=now()
    WHERE client_request_id = v_client_request_id;
    RETURN jsonb_build_object('success', false, 'errorCode', 'INVALID_INVOICE',
      'error', 'الفاتورة الأصلية غير موجودة');
  END IF;

  -- Must be ERP invoice (sale_id IS NULL)
  IF v_inv.sale_id IS NOT NULL THEN
    UPDATE pos_workflow_requests SET status='failed', error_code='VALIDATION_ERROR',
      error_message='هذه فاتورة نقاط بيع - استخدم مسار مرتجع POS', updated_at=now()
    WHERE client_request_id = v_client_request_id;
    RETURN jsonb_build_object('success', false, 'errorCode', 'VALIDATION_ERROR',
      'error', 'هذه فاتورة نقاط بيع - استخدم مسار مرتجع POS');
  END IF;

  -- Must be sales invoice
  IF v_inv.invoice_type != 'sales' THEN
    UPDATE pos_workflow_requests SET status='failed', error_code='VALIDATION_ERROR',
      error_message='نوع الفاتورة غير صحيح', updated_at=now()
    WHERE client_request_id = v_client_request_id;
    RETURN jsonb_build_object('success', false, 'errorCode', 'VALIDATION_ERROR',
      'error', 'نوع الفاتورة غير صحيح - يجب أن تكون فاتورة مبيعات');
  END IF;

  -- Must be posted (reject draft/voided)
  IF v_inv.status = 'voided' THEN
    UPDATE pos_workflow_requests SET status='failed', error_code='INVOICE_VOIDED',
      error_message='لا يمكن الإرجاع من فاتورة ملغاة', updated_at=now()
    WHERE client_request_id = v_client_request_id;
    RETURN jsonb_build_object('success', false, 'errorCode', 'INVOICE_VOIDED',
      'error', 'لا يمكن الإرجاع من فاتورة ملغاة');
  END IF;
  IF v_inv.status != 'posted' THEN
    UPDATE pos_workflow_requests SET status='failed', error_code='VALIDATION_ERROR',
      error_message='الفاتورة ليست مرحلة - لا يمكن الإرجاع', updated_at=now()
    WHERE client_request_id = v_client_request_id;
    RETURN jsonb_build_object('success', false, 'errorCode', 'VALIDATION_ERROR',
      'error', 'الفاتورة ليست مرحلة - لا يمكن الإرجاع إلا من فواتير مرحلة');
  END IF;

  -- Use invoice branch if not provided
  IF v_branch_id IS NULL THEN
    v_branch_id := v_inv.branch_id;
  END IF;

  -- Calculate amounts from items and validate each
  FOR i IN 0..v_items_count-1 LOOP
    v_item_record := v_items->i;
    v_item_id := NULLIF(v_item_record->>'jewelry_item_id', '')::uuid;
    v_item_qty := COALESCE((v_item_record->>'quantity')::int, 1);
    v_item_unit_price := COALESCE((v_item_record->>'unit_price')::numeric, 0);
    v_item_tax_rate := COALESCE((v_item_record->>'tax_rate')::numeric, 0.15);
    v_item_discount_amount := COALESCE((v_item_record->>'discount_amount')::numeric, 0);
    v_item_discount_percentage := COALESCE((v_item_record->>'discount_percentage')::numeric, 0);

    -- Validate item belongs to the invoice
    IF v_item_id IS NOT NULL THEN
      SELECT * INTO v_sii FROM sales_invoice_items
      WHERE invoice_id = v_linked_invoice_id AND jewelry_item_id = v_item_id;
      IF NOT FOUND THEN
        UPDATE pos_workflow_requests SET status='failed', error_code='VALIDATION_ERROR',
          error_message='القطعة لا تنتمي للفاتورة الأصلية', updated_at=now()
        WHERE client_request_id = v_client_request_id;
        RETURN jsonb_build_object('success', false, 'errorCode', 'VALIDATION_ERROR',
          'error', 'القطعة لا تنتمي للفاتورة الأصلية');
      END IF;

      -- Lock and validate unique_item is still sold (prevent double return)
      SELECT id, status, sold_at, sale_id, cost INTO v_ui
      FROM unique_items WHERE id = v_item_id FOR UPDATE;
      IF NOT FOUND THEN
        UPDATE pos_workflow_requests SET status='failed', error_code='VALIDATION_ERROR',
          error_message='القطعة غير موجودة في النظام', updated_at=now()
        WHERE client_request_id = v_client_request_id;
        RETURN jsonb_build_object('success', false, 'errorCode', 'VALIDATION_ERROR',
          'error', 'القطعة غير موجودة في النظام');
      END IF;

      IF v_ui.status != 'sold' OR v_ui.sold_at IS NULL THEN
        IF EXISTS (SELECT 1 FROM return_items ri JOIN returns r ON r.id = ri.return_id
                   WHERE ri.item_id = v_item_id AND r.status = 'completed') THEN
          UPDATE pos_workflow_requests SET status='failed', error_code='OVER_RETURN_NOT_ALLOWED',
            error_message='القطعة تم إرجاعها مسبقاً', updated_at=now()
          WHERE client_request_id = v_client_request_id;
          RETURN jsonb_build_object('success', false, 'errorCode', 'OVER_RETURN_NOT_ALLOWED',
            'error', 'القطعة تم إرجاعها مسبقاً - لا يمكن إرجاعها مرة أخرى');
        END IF;
        UPDATE pos_workflow_requests SET status='failed', error_code='VALIDATION_ERROR',
          error_message='القطعة غير مباعة حالياً', updated_at=now()
        WHERE client_request_id = v_client_request_id;
        RETURN jsonb_build_object('success', false, 'errorCode', 'VALIDATION_ERROR',
          'error', 'القطعة غير مباعة حالياً - لا يمكن إرجاعها');
      END IF;

      v_total_cost := v_total_cost + COALESCE(v_ui.cost, 0);
    END IF;

    -- Calculate line amounts
    v_line_subtotal := v_item_qty * v_item_unit_price;
    v_line_discount := CASE
      WHEN v_item_discount_percentage > 0 THEN v_line_subtotal * (v_item_discount_percentage / 100)
      ELSE v_item_discount_amount
    END;
    v_line_after_discount := v_line_subtotal - v_line_discount;
    v_line_tax := ROUND(v_line_after_discount * v_item_tax_rate, 2);
    v_line_total := v_line_after_discount + v_line_tax;

    v_taxable_base := v_taxable_base + v_line_after_discount;
    v_tax_amount := v_tax_amount + v_line_tax;
    v_final_amount := v_final_amount + v_line_total;
  END LOOP;

  -- Lookup branch accounting accounts
  SELECT account_id INTO v_cash_account_id FROM branch_coa_accounts WHERE branch_id = v_branch_id AND template_code = 'CASH';
  SELECT account_id INTO v_bank_account_id FROM branch_coa_accounts WHERE branch_id = v_branch_id AND template_code = 'BANK';
  SELECT account_id INTO v_inventory_account_id FROM branch_coa_accounts WHERE branch_id = v_branch_id AND template_code = 'INVENTORY';
  SELECT account_id INTO v_cogs_account_id FROM branch_coa_accounts WHERE branch_id = v_branch_id AND template_code = 'COGS';
  SELECT account_id INTO v_sales_revenue_account_id FROM branch_coa_accounts WHERE branch_id = v_branch_id AND template_code = 'SALES_REVENUE';
  SELECT account_id INTO v_vat_output_account_id FROM branch_coa_accounts WHERE branch_id = v_branch_id AND template_code = 'VAT_OUTPUT';

  IF v_sales_revenue_account_id IS NULL OR v_inventory_account_id IS NULL OR v_cogs_account_id IS NULL THEN
    UPDATE pos_workflow_requests SET status='failed', error_code='MISSING_ACCOUNTS',
      error_message='حسابات الفرع غير مكتملة', updated_at=now()
    WHERE client_request_id = v_client_request_id;
    RETURN jsonb_build_object('success', false, 'errorCode', 'MISSING_ACCOUNTS',
      'error', 'حسابات الفرع المحاسبية غير مكتملة - تواصل مع مدير النظام');
  END IF;

  IF v_cash_account_id IS NULL THEN
    UPDATE pos_workflow_requests SET status='failed', error_code='MISSING_ACCOUNTS',
      error_message='حساب الصندوق النقدي غير موجود', updated_at=now()
    WHERE client_request_id = v_client_request_id;
    RETURN jsonb_build_object('success', false, 'errorCode', 'MISSING_ACCOUNTS',
      'error', 'حساب الصندوق النقدي غير مُعرّف للفرع');
  END IF;

  -- Generate return number and JE number
  v_return_number := public.generate_sales_return_number();
  v_je_number := public.generate_journal_entry_number();

  -- Create return header (ERP: original_invoice_id set, original_sale_id NULL)
  INSERT INTO returns (return_number, return_type, return_date, original_invoice_id, original_sale_id,
    customer_id, branch_id, subtotal, tax_amount, total_amount, status, notes, created_at)
  VALUES (v_return_number, 'sales_return', v_return_date, v_linked_invoice_id, NULL,
    v_customer_id, v_branch_id, v_taxable_base, v_tax_amount, v_final_amount, 'completed', v_notes, now())
  RETURNING id INTO v_return_id;

  -- Create return items + update unique_items
  FOR i IN 0..v_items_count-1 LOOP
    v_item_record := v_items->i;
    v_item_id := NULLIF(v_item_record->>'jewelry_item_id', '')::uuid;
    v_item_qty := COALESCE((v_item_record->>'quantity')::int, 1);
    v_item_unit_price := COALESCE((v_item_record->>'unit_price')::numeric, 0);
    v_item_description := v_item_record->>'description';

    v_item_tax_rate := COALESCE((v_item_record->>'tax_rate')::numeric, 0.15);
    v_item_discount_amount := COALESCE((v_item_record->>'discount_amount')::numeric, 0);
    v_item_discount_percentage := COALESCE((v_item_record->>'discount_percentage')::numeric, 0);
    v_line_subtotal := v_item_qty * v_item_unit_price;
    v_line_discount := CASE
      WHEN v_item_discount_percentage > 0 THEN v_line_subtotal * (v_item_discount_percentage / 100)
      ELSE v_item_discount_amount
    END;
    v_line_after_discount := v_line_subtotal - v_line_discount;
    v_line_tax := ROUND(v_line_after_discount * v_item_tax_rate, 2);
    v_line_total := v_line_after_discount + v_line_tax;

    INSERT INTO return_items (return_id, item_id, quantity, unit_price, total_price, return_price, reason)
    VALUES (v_return_id, v_item_id, v_item_qty, v_item_unit_price, v_line_total, v_line_total, v_item_description);

    IF v_item_id IS NOT NULL THEN
      UPDATE unique_items SET sold_at = NULL, sale_id = NULL, status = 'in_stock' WHERE id = v_item_id;
    END IF;
  END LOOP;

  -- Create Journal Entry (reversal of sale — same logic as POS return)
  INSERT INTO journal_entries (entry_number, entry_date, description, reference_type, reference_id,
    is_posted, posted_at, branch_id, total_debit, total_credit, created_at, status)
  VALUES (v_je_number, v_return_date, 'قيد مرتجع مبيعات ERP - ' || v_return_number, 'return', v_return_id,
    true, now(), v_branch_id, 0, 0, now(), 'posted')
  RETURNING id INTO v_je_id;

  UPDATE returns SET journal_entry_id = v_je_id WHERE id = v_return_id;

  -- REVERSAL JE LINES (mirror POS return pattern):
  -- 1) Revenue DEBIT (reverse revenue recognition)
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
  VALUES (v_je_id, v_sales_revenue_account_id, v_taxable_base, 0, 'إلغاء إيرادات مبيعات - ' || v_return_number);
  v_total_debit := v_total_debit + v_taxable_base;

  -- 2) VAT DEBIT (reverse VAT output)
  IF v_tax_amount > 0 AND v_vat_output_account_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_vat_output_account_id, v_tax_amount, 0, 'إلغاء ض.ق.م مخرجة - ' || v_return_number);
    v_total_debit := v_total_debit + v_tax_amount;
  END IF;

  -- 3) Inventory DEBIT (items returning to stock)
  IF v_total_cost > 0 THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_inventory_account_id, v_total_cost, 0, 'إعادة مخزون - ' || v_return_number);
    v_total_debit := v_total_debit + v_total_cost;
  END IF;

  -- 4) Cash CREDIT (refund going out — ERP returns default to cash refund)
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
  VALUES (v_je_id, v_cash_account_id, 0, v_final_amount, 'رد نقدي - مرتجع ' || v_return_number);
  v_total_credit := v_total_credit + v_final_amount;

  -- 5) COGS CREDIT (reverse cost of goods sold)
  IF v_total_cost > 0 THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je_id, v_cogs_account_id, 0, v_total_cost, 'إلغاء تكلفة بضائع مباعة - ' || v_return_number);
    v_total_credit := v_total_credit + v_total_cost;
  END IF;

  -- Update JE totals
  UPDATE journal_entries SET total_debit = v_total_debit, total_credit = v_total_credit WHERE id = v_je_id;

  -- Payment record (refund) — mirrors POS return
  v_payment_number := 'REF-' || to_char(now(), 'YYYYMMDD') || '-' || LPAD(
    (COALESCE((SELECT COUNT(*) FROM payments WHERE payment_number LIKE 'REF-' || to_char(now(), 'YYYYMMDD') || '-%'), 0) + 1)::text, 4, '0');

  INSERT INTO payments (payment_number, payment_type, payment_date, amount, payment_method,
    reference_type, reference_id, customer_id, branch_id, journal_entry_id, invoice_id, status, created_at)
  VALUES (v_payment_number, 'refund', v_return_date, v_final_amount, 'cash',
    'return', v_return_id, v_customer_id, v_branch_id, v_je_id, v_linked_invoice_id, 'completed', now());

  -- Build result
  v_result := jsonb_build_object(
    'success', true,
    'return_id', v_return_id,
    'return_number', v_return_number,
    'journal_entry_id', v_je_id,
    'journal_entry_number', v_je_number,
    'total_amount', v_final_amount,
    'tax_amount', v_tax_amount,
    'items_count', v_items_count,
    'idempotent', false
  );

  UPDATE pos_workflow_requests SET status='succeeded', result=v_result, updated_at=now()
  WHERE client_request_id = v_client_request_id;

  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  BEGIN
    UPDATE pos_workflow_requests SET status='failed', error_code='SERVER_ERROR',
      error_message=SQLERRM, updated_at=now()
    WHERE client_request_id = v_client_request_id;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN jsonb_build_object('success', false, 'errorCode', 'SERVER_ERROR',
    'error', 'خطأ داخلي في الخادم: ' || SQLERRM);
END;
$function$;
