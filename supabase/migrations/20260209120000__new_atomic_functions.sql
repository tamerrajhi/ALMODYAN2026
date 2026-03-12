-- Migration: New Atomic Functions for Direct Write Eradication
-- Date: 2026-02-09
-- Purpose: Replace all direct SQL writes in Express routes with atomic DB functions

-- 1. customer_create_atomic
CREATE OR REPLACE FUNCTION public.customer_create_atomic(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_customer_code text;
  v_name text;
  v_full_name text;
  v_name_en text;
  v_phone text;
  v_email text;
  v_address text;
  v_tax_number text;
  v_vat_number text;
  v_customer_type text;
  v_company_name text;
  v_result record;
BEGIN
  v_name := COALESCE(p_payload->>'name', p_payload->>'full_name', '');
  v_full_name := COALESCE(p_payload->>'full_name', v_name);
  v_name_en := p_payload->>'name_en';
  v_phone := p_payload->>'phone';
  v_email := p_payload->>'email';
  v_address := p_payload->>'address';
  v_tax_number := COALESCE(p_payload->>'tax_number', p_payload->>'vat_number');
  v_vat_number := COALESCE(p_payload->>'vat_number', p_payload->>'tax_number');
  v_customer_type := COALESCE(p_payload->>'customer_type', 'individual');
  v_company_name := p_payload->>'company_name';
  IF v_phone IS NOT NULL AND v_phone <> '' THEN
    v_phone := regexp_replace(v_phone, '\s+', '', 'g');
  END IF;
  SELECT generate_customer_code() INTO v_customer_code;
  INSERT INTO customers (customer_code, name, full_name, name_en, phone, email, address, tax_number, vat_number, customer_type, company_name)
  VALUES (v_customer_code, v_name, v_full_name, v_name_en, v_phone, v_email, v_address, v_tax_number, v_vat_number, v_customer_type, v_company_name)
  RETURNING * INTO v_result;
  RETURN jsonb_build_object('success', true, 'data', row_to_json(v_result)::jsonb);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'رقم الجوال مستخدم بالفعل', 'error_code', 'DUPLICATE_PHONE');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- 2. unique_item_create_atomic
CREATE OR REPLACE FUNCTION public.unique_item_create_atomic(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_result record;
BEGIN
  INSERT INTO unique_items (
    serial_no, stockcode, model, description, type, metal, stone, clarity,
    g_weight, d_weight, b_weight, cost, tag_price, branch_id, batch_id, supplier_id
  ) VALUES (
    p_payload->>'serial_no', p_payload->>'stockcode', p_payload->>'model', p_payload->>'description',
    p_payload->>'type', p_payload->>'metal', p_payload->>'stone', p_payload->>'clarity',
    (p_payload->>'g_weight')::numeric, (p_payload->>'d_weight')::numeric, (p_payload->>'b_weight')::numeric,
    (p_payload->>'cost')::numeric, (p_payload->>'tag_price')::numeric,
    (p_payload->>'branch_id')::uuid, (p_payload->>'batch_id')::uuid, (p_payload->>'supplier_id')::uuid
  )
  RETURNING *, serial_no as item_code, stockcode as barcode, cost as unit_cost, tag_price as selling_price
  INTO v_result;
  RETURN jsonb_build_object('success', true, 'data', row_to_json(v_result)::jsonb);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- 3. purchase_batch_create_atomic
CREATE OR REPLACE FUNCTION public.purchase_batch_create_atomic(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_batch_no text;
  v_result record;
BEGIN
  SELECT generate_batch_no() INTO v_batch_no;
  INSERT INTO purchase_batches (batch_no, supplier_id, branch_id, notes, status)
  VALUES (v_batch_no, (p_payload->>'supplier_id')::uuid, (p_payload->>'branch_id')::uuid, p_payload->>'notes', 'DRAFT')
  RETURNING * INTO v_result;
  RETURN jsonb_build_object('success', true, 'data', row_to_json(v_result)::jsonb);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- 4. app_settings_update_atomic
CREATE OR REPLACE FUNCTION public.app_settings_update_atomic(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_key text;
  v_value text;
  v_result record;
BEGIN
  v_key := p_payload->>'key';
  v_value := p_payload->>'value';
  IF v_key IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'key مطلوب');
  END IF;
  UPDATE app_settings SET value = v_value, updated_at = NOW() WHERE key = v_key RETURNING * INTO v_result;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'الإعداد غير موجود', 'error_code', 'NOT_FOUND');
  END IF;
  RETURN jsonb_build_object('success', true, 'data', row_to_json(v_result)::jsonb);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- 5. gold_price_upsert_atomic
CREATE OR REPLACE FUNCTION public.gold_price_upsert_atomic(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_karat text;
  v_price numeric;
  v_date timestamp;
  v_result record;
BEGIN
  v_karat := p_payload->>'karat';
  v_price := (p_payload->>'price_per_gram')::numeric;
  v_date := COALESCE((p_payload->>'effective_date')::timestamp, NOW());
  IF v_karat IS NULL OR v_price IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'karat و price_per_gram مطلوبان');
  END IF;
  UPDATE gold_prices SET is_current = false WHERE karat = v_karat;
  INSERT INTO gold_prices (karat, price_per_gram, effective_date, is_current)
  VALUES (v_karat, v_price, v_date, true) RETURNING * INTO v_result;
  RETURN jsonb_build_object('success', true, 'data', row_to_json(v_result)::jsonb);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- 6. user_set_primary_branch_atomic
CREATE OR REPLACE FUNCTION public.user_set_primary_branch_atomic(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_user_id uuid;
  v_branch_id uuid;
BEGIN
  v_user_id := (p_payload->>'user_id')::uuid;
  v_branch_id := (p_payload->>'branch_id')::uuid;
  IF v_user_id IS NULL OR v_branch_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_id and branch_id required');
  END IF;
  UPDATE user_branches SET is_primary = false WHERE user_id = v_user_id;
  UPDATE user_branches SET is_primary = true WHERE user_id = v_user_id AND branch_id = v_branch_id;
  RETURN jsonb_build_object('success', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- 7. cleanup_import_batch_atomic
CREATE OR REPLACE FUNCTION public.cleanup_import_batch_atomic(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_batch_id uuid;
  v_batch record;
  v_deleted_errors integer;
  v_deleted_items integer;
  v_deleted_sets integer;
BEGIN
  v_batch_id := (p_payload->>'batch_id')::uuid;
  IF v_batch_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'batch_id مطلوب');
  END IF;
  SELECT * INTO v_batch FROM purchase_batches WHERE id = v_batch_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'الدفعة غير موجودة', 'error_code', 'NOT_FOUND');
  END IF;
  DELETE FROM import_row_errors WHERE batch_id = v_batch_id;
  GET DIAGNOSTICS v_deleted_errors = ROW_COUNT;
  DELETE FROM unique_items WHERE batch_id = v_batch_id;
  GET DIAGNOSTICS v_deleted_items = ROW_COUNT;
  DELETE FROM jewelry_sets WHERE batch_id = v_batch_id;
  GET DIAGNOSTICS v_deleted_sets = ROW_COUNT;
  UPDATE purchase_batches SET status = 'DRAFT', total_items = 0, total_weight = 0, total_cost = 0, invoice_id = NULL WHERE id = v_batch_id;
  INSERT INTO audit_logs (entity_type, entity_id, entity_code, action_type, description, metadata)
  VALUES ('PurchaseBatch', v_batch_id, v_batch.batch_no, 'CLEANUP', 'تنظيف دفعة ' || v_batch.batch_no,
          jsonb_build_object('deleted_items', v_deleted_items, 'deleted_sets', v_deleted_sets, 'deleted_errors', v_deleted_errors));
  RETURN jsonb_build_object('success', true, 'deleted_items', v_deleted_items, 'deleted_sets', v_deleted_sets, 'deleted_errors', v_deleted_errors, 'message', 'تم تنظيف الدفعة بنجاح');
END;
$$;

-- 8. post_invoice_accounting_atomic
CREATE OR REPLACE FUNCTION public.post_invoice_accounting_atomic(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_invoice_id uuid;
  v_dry_run boolean;
  v_invoice record;
  v_inventory_account record;
  v_supplier_account record;
  v_vat_input_account record;
  v_entry_number text;
  v_je record;
  v_total_cost numeric;
  v_tax_amount numeric;
  v_subtotal numeric;
BEGIN
  v_invoice_id := (p_payload->>'invoice_id')::uuid;
  v_dry_run := COALESCE((p_payload->>'dry_run')::boolean, false);
  IF v_invoice_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invoice_id مطلوب');
  END IF;
  SELECT i.*, s.name as supplier_name INTO v_invoice FROM invoices i LEFT JOIN suppliers s ON i.supplier_id = s.id WHERE i.id = v_invoice_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'لم يتم العثور على الفاتورة', 'error_code', 'NOT_FOUND');
  END IF;
  IF v_invoice.journal_entry_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'already_posted', true, 'journal_entry_id', v_invoice.journal_entry_id, 'message', 'القيد المحاسبي موجود مسبقاً');
  END IF;
  IF v_invoice.invoice_type <> 'purchase' THEN
    RETURN jsonb_build_object('success', false, 'error', 'الترحيل المحاسبي متاح فقط لفواتير الشراء');
  END IF;
  IF v_invoice.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'لا يمكن ترحيل فاتورة ملغاة');
  END IF;
  IF v_invoice.supplier_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'الفاتورة ليس لها مورد مرتبط');
  END IF;
  v_total_cost := COALESCE(v_invoice.total_amount::numeric, 0);
  v_tax_amount := COALESCE(v_invoice.tax_amount::numeric, 0);
  v_subtotal := COALESCE(v_invoice.subtotal::numeric, v_total_cost);
  IF v_total_cost <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'إجمالي الفاتورة يجب أن يكون أكبر من صفر');
  END IF;
  IF v_dry_run THEN
    RETURN jsonb_build_object('dry_run', true, 'decision', 'CREATE_NEW', 'invoice_id', v_invoice.id, 'invoice_number', v_invoice.invoice_number, 'total_cost', v_total_cost, 'tax_amount', v_tax_amount, 'subtotal', v_subtotal, 'message', 'سيتم إنشاء قيد محاسبي جديد');
  END IF;
  SELECT * INTO v_inventory_account FROM chart_of_accounts WHERE account_code = '1301';
  SELECT * INTO v_supplier_account FROM chart_of_accounts WHERE account_code = '2101';
  SELECT * INTO v_vat_input_account FROM chart_of_accounts WHERE account_code = '2105';
  IF v_inventory_account.id IS NULL OR v_supplier_account.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'حسابات الدليل المحاسبي غير مكتملة');
  END IF;
  SELECT generate_journal_entry_number() INTO v_entry_number;
  INSERT INTO journal_entries (entry_number, entry_date, description, reference_type, reference_id, branch_id, total_debit, total_credit, is_posted, posted_at)
  VALUES (v_entry_number, COALESCE(v_invoice.invoice_date, NOW()), 'قيد فاتورة استيراد - ' || v_invoice.invoice_number, 'purchase_invoice', v_invoice_id, v_invoice.branch_id, v_total_cost, v_total_cost, true, NOW())
  RETURNING * INTO v_je;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
  VALUES (v_je.id, v_inventory_account.id, v_subtotal, 0, 'مخزون - فاتورة ' || v_invoice.invoice_number);
  IF v_tax_amount > 0 AND v_vat_input_account.id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_je.id, v_vat_input_account.id, v_tax_amount, 0, 'ضريبة مدخلات - ' || v_invoice.invoice_number);
  END IF;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
  VALUES (v_je.id, v_supplier_account.id, 0, v_total_cost, 'ذمم دائنة - ' || COALESCE(v_invoice.supplier_name, 'مورد'));
  UPDATE invoices SET journal_entry_id = v_je.id, status = 'posted' WHERE id = v_invoice_id;
  INSERT INTO audit_logs (entity_type, entity_id, entity_code, action_type, description, metadata)
  VALUES ('Invoice', v_invoice_id, v_invoice.invoice_number, 'ACCOUNTING_POST', 'تم ترحيل فاتورة ' || v_invoice.invoice_number,
          jsonb_build_object('journal_entry_id', v_je.id, 'total', v_total_cost));
  RETURN jsonb_build_object('success', true, 'journal_entry_id', v_je.id, 'entry_number', v_entry_number, 'message', 'تم إنشاء القيد المحاسبي ' || v_entry_number || ' بنجاح');
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- 9. create_batch_invoice_atomic
CREATE OR REPLACE FUNCTION public.create_batch_invoice_atomic(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_batch_id uuid;
  v_invoice_date timestamp;
  v_due_date timestamp;
  v_notes text;
  v_batch record;
  v_existing_invoice record;
  v_items_count integer;
  v_total_cost numeric;
  v_invoice_number text;
  v_invoice record;
BEGIN
  v_batch_id := (p_payload->>'batch_id')::uuid;
  v_invoice_date := (p_payload->>'invoice_date')::timestamp;
  v_due_date := (p_payload->>'due_date')::timestamp;
  v_notes := p_payload->>'notes';
  IF v_batch_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'batch_id مطلوب');
  END IF;
  SELECT pb.*, s.name as supplier_name, b.name as branch_name INTO v_batch
  FROM purchase_batches pb LEFT JOIN suppliers s ON pb.supplier_id = s.id LEFT JOIN branches b ON pb.branch_id = b.id
  WHERE pb.id = v_batch_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'الدفعة غير موجودة', 'error_code', 'NOT_FOUND');
  END IF;
  IF v_batch.invoice_id IS NOT NULL THEN
    SELECT * INTO v_existing_invoice FROM invoices WHERE id = v_batch.invoice_id;
    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'already_exists', true, 'invoice_id', v_existing_invoice.id, 'invoice_number', v_existing_invoice.invoice_number, 'message', 'الفاتورة مرتبطة بالدفعة مسبقاً');
    END IF;
  END IF;
  IF v_batch.supplier_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'الدفعة لا تحتوي على مورد مرتبط');
  END IF;
  SELECT COUNT(*), COALESCE(SUM(cost::numeric), 0) INTO v_items_count, v_total_cost FROM unique_items WHERE batch_id = v_batch_id;
  IF v_items_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'لا توجد قطع في هذه الدفعة');
  END IF;
  SELECT generate_invoice_number('purchase') INTO v_invoice_number;
  INSERT INTO invoices (invoice_number, invoice_type, invoice_date, due_date, supplier_id, branch_id, batch_id, subtotal, total_amount, notes, status)
  VALUES (v_invoice_number, 'purchase', COALESCE(v_invoice_date, NOW()), v_due_date, v_batch.supplier_id, v_batch.branch_id, v_batch_id, v_total_cost, v_total_cost, COALESCE(v_notes, 'فاتورة للدفعة ' || v_batch.batch_no), 'draft')
  RETURNING * INTO v_invoice;
  UPDATE purchase_batches SET invoice_id = v_invoice.id WHERE id = v_batch_id;
  INSERT INTO audit_logs (entity_type, entity_id, entity_code, action_type, description, metadata)
  VALUES ('Invoice', v_invoice.id, v_invoice_number, 'CREATE', 'إنشاء فاتورة للدفعة ' || v_batch.batch_no,
          jsonb_build_object('batch_id', v_batch_id, 'items_count', v_items_count, 'total_cost', v_total_cost));
  RETURN jsonb_build_object('success', true, 'invoice_id', v_invoice.id, 'invoice_number', v_invoice_number, 'items_count', v_items_count, 'total_cost', v_total_cost, 'message', 'تم إنشاء الفاتورة بنجاح');
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
