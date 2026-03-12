-- PV-FULL-EXEC-1: Payment Vouchers — tables, columns, and 4 RPC functions
-- Idempotent: safe to re-run (IF NOT EXISTS, CREATE OR REPLACE)

-- ============================================================
-- BATCH 1A: supplier_payment_allocations table
-- ============================================================
CREATE TABLE IF NOT EXISTS supplier_payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  supplier_id UUID REFERENCES suppliers(id),
  amount NUMERIC NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  UNIQUE(payment_id, invoice_id)
);
CREATE INDEX IF NOT EXISTS idx_spa_payment ON supplier_payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_spa_invoice ON supplier_payment_allocations(invoice_id);
CREATE INDEX IF NOT EXISTS idx_spa_supplier ON supplier_payment_allocations(supplier_id);

-- ============================================================
-- BATCH 1B: Add status/void columns to payments
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payments' AND column_name='status') THEN
    ALTER TABLE payments ADD COLUMN status TEXT NOT NULL DEFAULT 'posted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payments' AND column_name='void_reason') THEN
    ALTER TABLE payments ADD COLUMN void_reason TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payments' AND column_name='voided_at') THEN
    ALTER TABLE payments ADD COLUMN voided_at TIMESTAMPTZ;
  END IF;
END $$;

-- ============================================================
-- BATCH 2-1: generate_payment_number() / generate_payment_number(text)
-- ============================================================
CREATE OR REPLACE FUNCTION public.generate_payment_number()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_date_part TEXT;
  v_seq INT;
  v_number TEXT;
BEGIN
  v_date_part := to_char(CURRENT_DATE, 'YYYYMMDD');
  SELECT COALESCE(MAX(
    CASE WHEN payment_number ~ ('^PV-' || v_date_part || '-[0-9]+$')
         THEN CAST(split_part(payment_number, '-', 3) AS INT)
         ELSE 0 END
  ), 0) + 1 INTO v_seq
  FROM payments
  WHERE payment_number LIKE 'PV-' || v_date_part || '-%';

  v_number := 'PV-' || v_date_part || '-' || LPAD(v_seq::TEXT, 4, '0');
  RETURN v_number;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_payment_number(p_type TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_prefix TEXT;
  v_date_part TEXT;
  v_seq INT;
  v_number TEXT;
BEGIN
  v_prefix := CASE WHEN p_type = 'receipt' THEN 'RC' ELSE 'PV' END;
  v_date_part := to_char(CURRENT_DATE, 'YYYYMMDD');
  SELECT COALESCE(MAX(
    CASE WHEN payment_number ~ ('^' || v_prefix || '-' || v_date_part || '-[0-9]+$')
         THEN CAST(split_part(payment_number, '-', 3) AS INT)
         ELSE 0 END
  ), 0) + 1 INTO v_seq
  FROM payments
  WHERE payment_number LIKE v_prefix || '-' || v_date_part || '-%';

  v_number := v_prefix || '-' || v_date_part || '-' || LPAD(v_seq::TEXT, 4, '0');
  RETURN v_number;
END;
$$;

-- ============================================================
-- BATCH 2-2: payment_voucher_atomic(p_payload jsonb)
-- ============================================================
CREATE OR REPLACE FUNCTION public.payment_voucher_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_client_request_id TEXT;
  v_existing_result jsonb;
  v_payment_id UUID;
  v_payment_number TEXT;
  v_je_id UUID;
  v_je_number TEXT;
  v_payment jsonb;
  v_journal jsonb;
  v_lines jsonb;
  v_allocations jsonb;
  v_amount NUMERIC;
  v_payment_method TEXT;
  v_branch_id UUID;
  v_supplier_id UUID;
  v_credit_account_id UUID;
  v_debit_account_id UUID;
  v_alloc RECORD;
  v_alloc_total NUMERIC := 0;
  v_inv_paid NUMERIC;
  v_inv_total NUMERIC;
  v_inv_remaining NUMERIC;
  v_new_status TEXT;
BEGIN
  -- Extract client_request_id
  v_client_request_id := p_payload->>'client_request_id';
  IF v_client_request_id IS NULL OR v_client_request_id = '' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'client_request_id is required');
  END IF;

  -- Idempotency check
  SELECT result_payload INTO v_existing_result
  FROM atomic_workflow_requests
  WHERE client_request_id = v_client_request_id AND workflow_type = 'payment_voucher' AND status = 'completed';
  IF v_existing_result IS NOT NULL THEN
    RETURN v_existing_result || jsonb_build_object('cached', true, 'idempotent', true);
  END IF;

  -- Register workflow
  INSERT INTO atomic_workflow_requests (client_request_id, workflow_type, status, request_payload, created_at)
  VALUES (v_client_request_id, 'payment_voucher', 'in_progress', p_payload, NOW())
  ON CONFLICT (client_request_id) DO UPDATE SET status = 'in_progress', created_at = NOW();

  -- Extract payload sections
  v_payment := p_payload->'payment';
  v_journal := p_payload->'journal';
  v_lines := p_payload->'lines';
  v_allocations := p_payload->'allocations';
  v_amount := (v_payment->>'amount')::NUMERIC;
  v_payment_method := COALESCE(v_payment->>'payment_method', 'cash');
  v_branch_id := NULLIF(v_payment->>'branch_id', '')::UUID;
  v_supplier_id := NULLIF(v_payment->>'supplier_id', '')::UUID;

  IF v_amount IS NULL OR v_amount <= 0 THEN
    UPDATE atomic_workflow_requests SET status='failed', error_code='VALIDATION', error_message='amount must be > 0' WHERE client_request_id=v_client_request_id;
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'المبلغ يجب أن يكون أكبر من صفر');
  END IF;

  -- Generate payment number
  v_payment_number := public.generate_payment_number(COALESCE(v_payment->>'payment_type', 'payment'));
  v_payment_id := gen_random_uuid();

  -- Derive JE lines if not provided
  IF v_lines IS NULL OR jsonb_array_length(v_lines) = 0 THEN
    -- Get credit account (cash/bank) from payment_account_settings
    SELECT CASE v_payment_method
      WHEN 'cash' THEN pas.cash_account_id
      WHEN 'bank_transfer' THEN pas.bank_transfer_account_id
      WHEN 'bank' THEN pas.bank_transfer_account_id
      WHEN 'check' THEN pas.check_account_id
      WHEN 'card' THEN pas.card_account_id
      WHEN 'credit_card' THEN pas.card_account_id
      ELSE pas.cash_account_id
    END INTO v_credit_account_id
    FROM payment_account_settings pas
    WHERE pas.branch_id IS NOT DISTINCT FROM v_branch_id
    LIMIT 1;

    IF v_credit_account_id IS NULL THEN
      SELECT CASE v_payment_method
        WHEN 'cash' THEN pas.cash_account_id
        WHEN 'bank_transfer' THEN pas.bank_transfer_account_id
        WHEN 'bank' THEN pas.bank_transfer_account_id
        WHEN 'check' THEN pas.check_account_id
        WHEN 'card' THEN pas.card_account_id
        WHEN 'credit_card' THEN pas.card_account_id
        ELSE pas.cash_account_id
      END INTO v_credit_account_id
      FROM payment_account_settings pas
      WHERE pas.branch_id IS NULL
      LIMIT 1;
    END IF;

    IF v_credit_account_id IS NULL THEN
      SELECT id INTO v_credit_account_id FROM chart_of_accounts
      WHERE account_code = '110101' AND is_active = true LIMIT 1;
    END IF;

    IF v_credit_account_id IS NULL THEN
      UPDATE atomic_workflow_requests SET status='failed', error_code='MISSING_ACCOUNT_MAPPING', error_message='No cash/bank account found' WHERE client_request_id=v_client_request_id;
      RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_ACCOUNT_MAPPING', 'error', 'لم يتم العثور على حساب النقد/البنك');
    END IF;

    -- Get debit account (AP / supplier account)
    v_debit_account_id := NULL;
    IF v_supplier_id IS NOT NULL THEN
      BEGIN
        SELECT id INTO v_debit_account_id FROM chart_of_accounts
        WHERE account_code = '2101' AND is_active = true LIMIT 1;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;

    IF v_debit_account_id IS NULL THEN
      SELECT id INTO v_debit_account_id FROM chart_of_accounts
      WHERE account_code = '2101' AND is_active = true LIMIT 1;
    END IF;

    IF v_debit_account_id IS NULL THEN
      UPDATE atomic_workflow_requests SET status='failed', error_code='MISSING_PARTY_ACCOUNT', error_message='No AP account found' WHERE client_request_id=v_client_request_id;
      RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_PARTY_ACCOUNT', 'error', 'لم يتم العثور على حساب الذمم الدائنة');
    END IF;

    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_debit_account_id, 'debit_amount', v_amount, 'credit_amount', 0, 'description', COALESCE(v_journal->>'description', 'سند صرف')),
      jsonb_build_object('account_id', v_credit_account_id, 'debit_amount', 0, 'credit_amount', v_amount, 'description', COALESCE(v_journal->>'description', 'سند صرف'))
    );
  END IF;

  -- Create journal entry
  v_je_id := gen_random_uuid();
  v_je_number := 'JE-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || LPAD(floor(random() * 9000 + 1000)::TEXT, 4, '0');

  INSERT INTO journal_entries (id, entry_number, entry_date, description, reference_type, reference_id, is_posted, posted_at, branch_id, total_debit, total_credit, status, created_at)
  VALUES (v_je_id, v_je_number, COALESCE((v_payment->>'payment_date')::TIMESTAMPTZ, NOW()), COALESCE(v_journal->>'description', 'سند صرف'), 'payment', v_payment_id, true, NOW(), v_branch_id, v_amount, v_amount, 'posted', NOW());

  -- Insert JE lines
  FOR i IN 0..jsonb_array_length(v_lines)-1 LOOP
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (
      v_je_id,
      (v_lines->i->>'account_id')::UUID,
      COALESCE((v_lines->i->>'debit_amount')::NUMERIC, 0),
      COALESCE((v_lines->i->>'credit_amount')::NUMERIC, 0),
      v_lines->i->>'description'
    );
  END LOOP;

  -- Insert payment
  INSERT INTO payments (id, payment_number, payment_type, payment_date, amount, payment_method, supplier_id, customer_id, invoice_id, branch_id, journal_entry_id, notes, status, created_at, created_by)
  VALUES (
    v_payment_id,
    v_payment_number,
    COALESCE(v_payment->>'payment_type', 'payment'),
    COALESCE((v_payment->>'payment_date')::TIMESTAMPTZ, NOW()),
    v_amount,
    v_payment_method,
    v_supplier_id,
    NULLIF(v_payment->>'customer_id', '')::UUID,
    NULLIF(v_payment->>'invoice_id', '')::UUID,
    v_branch_id,
    v_je_id,
    v_payment->>'notes',
    'posted',
    NOW(),
    NULLIF(p_payload->>'created_by', '')::UUID
  );

  -- Process allocations
  IF v_allocations IS NOT NULL AND jsonb_array_length(v_allocations) > 0 THEN
    FOR i IN 0..jsonb_array_length(v_allocations)-1 LOOP
      INSERT INTO supplier_payment_allocations (payment_id, invoice_id, supplier_id, amount, created_by)
      VALUES (
        v_payment_id,
        (v_allocations->i->>'invoice_id')::UUID,
        v_supplier_id,
        (v_allocations->i->>'amount')::NUMERIC,
        NULLIF(p_payload->>'created_by', '')::UUID
      );

      -- Update invoice paid_amount, remaining_amount, status
      UPDATE invoices SET
        paid_amount = COALESCE(paid_amount, 0) + (v_allocations->i->>'amount')::NUMERIC,
        remaining_amount = GREATEST(COALESCE(total_amount, 0) - (COALESCE(paid_amount, 0) + (v_allocations->i->>'amount')::NUMERIC), 0)
      WHERE id = (v_allocations->i->>'invoice_id')::UUID;

      -- Update invoice status
      SELECT total_amount, paid_amount + (v_allocations->i->>'amount')::NUMERIC INTO v_inv_total, v_inv_paid
      FROM invoices WHERE id = (v_allocations->i->>'invoice_id')::UUID;

      IF v_inv_paid >= v_inv_total THEN v_new_status := 'paid';
      ELSIF v_inv_paid > 0 THEN v_new_status := 'partial';
      ELSE v_new_status := 'posted';
      END IF;

      UPDATE invoices SET status = v_new_status WHERE id = (v_allocations->i->>'invoice_id')::UUID;

      v_alloc_total := v_alloc_total + (v_allocations->i->>'amount')::NUMERIC;
    END LOOP;
  END IF;

  -- Build result
  DECLARE v_result jsonb;
  BEGIN
    v_result := jsonb_build_object(
      'success', true,
      'payment_id', v_payment_id,
      'payment_number', v_payment_number,
      'journal_entry_id', v_je_id,
      'journal_entry_number', v_je_number,
      'allocated_total', v_alloc_total,
      'meta', jsonb_build_object('workflowType', 'payment_voucher', 'clientRequestId', v_client_request_id)
    );

    UPDATE atomic_workflow_requests SET status='completed', result_payload=v_result, completed_at=NOW() WHERE client_request_id=v_client_request_id;
    RETURN v_result;
  END;

EXCEPTION WHEN OTHERS THEN
  UPDATE atomic_workflow_requests SET status='failed', error_code='DB_ERROR', error_message=SQLERRM WHERE client_request_id=v_client_request_id;
  RETURN jsonb_build_object('success', false, 'error_code', 'DB_ERROR', 'error', SQLERRM);
END;
$$;

-- ============================================================
-- BATCH 2-3: payment_voucher_update_atomic(p_payload jsonb)
-- ============================================================
CREATE OR REPLACE FUNCTION public.payment_voucher_update_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_client_request_id TEXT;
  v_existing_result jsonb;
  v_payment_id UUID;
  v_old_je_id UUID;
  v_old_amount NUMERIC;
  v_old_status TEXT;
  v_new_je_id UUID;
  v_new_je_number TEXT;
  v_reversal_je_id UUID;
  v_reversal_je_number TEXT;
  v_payment_update jsonb;
  v_lines jsonb;
  v_new_amount NUMERIC;
  v_new_method TEXT;
  v_branch_id UUID;
  v_supplier_id UUID;
  v_credit_account_id UUID;
  v_debit_account_id UUID;
BEGIN
  v_client_request_id := p_payload->>'client_request_id';
  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'client_request_id is required');
  END IF;

  v_payment_id := (p_payload->>'payment_id')::UUID;
  IF v_payment_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'payment_id is required');
  END IF;

  -- Idempotency
  SELECT result_payload INTO v_existing_result
  FROM atomic_workflow_requests
  WHERE client_request_id = v_client_request_id AND workflow_type = 'payment_voucher_update' AND status = 'completed';
  IF v_existing_result IS NOT NULL THEN
    RETURN v_existing_result || jsonb_build_object('cached', true);
  END IF;

  INSERT INTO atomic_workflow_requests (client_request_id, workflow_type, status, request_payload, created_at)
  VALUES (v_client_request_id, 'payment_voucher_update', 'in_progress', p_payload, NOW())
  ON CONFLICT (client_request_id) DO UPDATE SET status = 'in_progress', created_at = NOW();

  -- Get existing payment
  SELECT journal_entry_id, amount, status, branch_id, supplier_id
  INTO v_old_je_id, v_old_amount, v_old_status, v_branch_id, v_supplier_id
  FROM payments WHERE id = v_payment_id;

  IF v_old_je_id IS NULL AND v_old_amount IS NULL THEN
    UPDATE atomic_workflow_requests SET status='failed', error_code='NOT_FOUND' WHERE client_request_id=v_client_request_id;
    RETURN jsonb_build_object('success', false, 'error_code', 'NOT_FOUND', 'error', 'السند غير موجود');
  END IF;

  IF v_old_status = 'voided' THEN
    UPDATE atomic_workflow_requests SET status='failed', error_code='ALREADY_VOIDED' WHERE client_request_id=v_client_request_id;
    RETURN jsonb_build_object('success', false, 'error_code', 'ALREADY_VOIDED', 'error', 'السند ملغي ولا يمكن تعديله');
  END IF;

  v_payment_update := p_payload->'payment';
  v_lines := p_payload->'lines';
  v_new_amount := COALESCE((v_payment_update->>'amount')::NUMERIC, v_old_amount);
  v_new_method := COALESCE(v_payment_update->>'payment_method', 'cash');
  v_branch_id := COALESCE(NULLIF(v_payment_update->>'branch_id', '')::UUID, v_branch_id);
  v_supplier_id := COALESCE(NULLIF(v_payment_update->>'supplier_id', '')::UUID, v_supplier_id);

  -- Reverse old allocations
  UPDATE invoices SET
    paid_amount = GREATEST(COALESCE(paid_amount, 0) - spa.amount, 0),
    remaining_amount = LEAST(COALESCE(total_amount, 0), COALESCE(total_amount, 0) - GREATEST(COALESCE(paid_amount, 0) - spa.amount, 0))
  FROM supplier_payment_allocations spa
  WHERE spa.payment_id = v_payment_id AND invoices.id = spa.invoice_id;

  -- Update invoice statuses after reversal
  UPDATE invoices SET status = CASE
    WHEN COALESCE(paid_amount, 0) <= 0 THEN 'posted'
    WHEN COALESCE(paid_amount, 0) >= COALESCE(total_amount, 0) THEN 'paid'
    ELSE 'partial'
  END
  WHERE id IN (SELECT invoice_id FROM supplier_payment_allocations WHERE payment_id = v_payment_id);

  DELETE FROM supplier_payment_allocations WHERE payment_id = v_payment_id;

  -- Create reversal JE for old JE
  IF v_old_je_id IS NOT NULL THEN
    v_reversal_je_id := gen_random_uuid();
    v_reversal_je_number := 'JE-REV-' || to_char(NOW(), 'YYYYMMDD') || '-' || LPAD(floor(random() * 9000 + 1000)::TEXT, 4, '0');

    INSERT INTO journal_entries (id, entry_number, entry_date, description, reference_type, reference_id, is_posted, posted_at, branch_id, total_debit, total_credit, status, reversal_of_je_id, created_at)
    SELECT v_reversal_je_id, v_reversal_je_number, NOW(), 'عكس قيد: ' || entry_number, 'payment_reversal', v_payment_id, true, NOW(), branch_id, total_debit, total_credit, 'posted', v_old_je_id, NOW()
    FROM journal_entries WHERE id = v_old_je_id;

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    SELECT v_reversal_je_id, account_id, credit_amount, debit_amount, 'عكس: ' || COALESCE(description, '')
    FROM journal_entry_lines WHERE journal_entry_id = v_old_je_id;

    UPDATE journal_entries SET reversed_by_je_id = v_reversal_je_id, status = 'reversed' WHERE id = v_old_je_id;
  END IF;

  -- Derive new lines if not provided
  IF v_lines IS NULL OR jsonb_array_length(v_lines) = 0 THEN
    SELECT CASE v_new_method
      WHEN 'cash' THEN pas.cash_account_id
      WHEN 'bank_transfer' THEN pas.bank_transfer_account_id
      WHEN 'bank' THEN pas.bank_transfer_account_id
      WHEN 'check' THEN pas.check_account_id
      WHEN 'card' THEN pas.card_account_id
      ELSE pas.cash_account_id
    END INTO v_credit_account_id
    FROM payment_account_settings pas
    WHERE pas.branch_id IS NOT DISTINCT FROM v_branch_id LIMIT 1;

    IF v_credit_account_id IS NULL THEN
      SELECT CASE v_new_method WHEN 'cash' THEN pas.cash_account_id ELSE COALESCE(pas.bank_transfer_account_id, pas.cash_account_id) END INTO v_credit_account_id
      FROM payment_account_settings pas WHERE pas.branch_id IS NULL LIMIT 1;
    END IF;
    IF v_credit_account_id IS NULL THEN
      SELECT id INTO v_credit_account_id FROM chart_of_accounts WHERE account_code='110101' AND is_active=true LIMIT 1;
    END IF;

    SELECT id INTO v_debit_account_id FROM chart_of_accounts WHERE account_code='2101' AND is_active=true LIMIT 1;

    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_debit_account_id, 'debit_amount', v_new_amount, 'credit_amount', 0),
      jsonb_build_object('account_id', v_credit_account_id, 'debit_amount', 0, 'credit_amount', v_new_amount)
    );
  END IF;

  -- Create new JE
  v_new_je_id := gen_random_uuid();
  v_new_je_number := 'JE-' || to_char(NOW(), 'YYYYMMDD') || '-' || LPAD(floor(random() * 9000 + 1000)::TEXT, 4, '0');

  INSERT INTO journal_entries (id, entry_number, entry_date, description, reference_type, reference_id, is_posted, posted_at, branch_id, total_debit, total_credit, status, created_at)
  VALUES (v_new_je_id, v_new_je_number, COALESCE((v_payment_update->>'payment_date')::TIMESTAMPTZ, NOW()), 'سند صرف محدث', 'payment', v_payment_id, true, NOW(), v_branch_id, v_new_amount, v_new_amount, 'posted', NOW());

  FOR i IN 0..jsonb_array_length(v_lines)-1 LOOP
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES (v_new_je_id, (v_lines->i->>'account_id')::UUID, COALESCE((v_lines->i->>'debit_amount')::NUMERIC,0), COALESCE((v_lines->i->>'credit_amount')::NUMERIC,0), v_lines->i->>'description');
  END LOOP;

  -- Update payment row
  UPDATE payments SET
    payment_date = COALESCE((v_payment_update->>'payment_date')::TIMESTAMPTZ, payment_date),
    amount = v_new_amount,
    payment_method = v_new_method,
    notes = COALESCE(v_payment_update->>'notes', notes),
    journal_entry_id = v_new_je_id
  WHERE id = v_payment_id;

  DECLARE v_result jsonb;
  BEGIN
    v_result := jsonb_build_object(
      'success', true, 'payment_id', v_payment_id, 'journal_entry_id', v_new_je_id,
      'journal_entry_number', v_new_je_number, 'reversed_journal_entry_id', v_reversal_je_id,
      'meta', jsonb_build_object('workflowType', 'payment_voucher_update', 'clientRequestId', v_client_request_id)
    );
    UPDATE atomic_workflow_requests SET status='completed', result_payload=v_result, completed_at=NOW() WHERE client_request_id=v_client_request_id;
    RETURN v_result;
  END;

EXCEPTION WHEN OTHERS THEN
  UPDATE atomic_workflow_requests SET status='failed', error_code='DB_ERROR', error_message=SQLERRM WHERE client_request_id=v_client_request_id;
  RETURN jsonb_build_object('success', false, 'error_code', 'DB_ERROR', 'error', SQLERRM);
END;
$$;

-- ============================================================
-- BATCH 2-4: payment_voucher_void_atomic(p_payload jsonb)
-- ============================================================
CREATE OR REPLACE FUNCTION public.payment_voucher_void_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_client_request_id TEXT;
  v_existing_result jsonb;
  v_payment_id UUID;
  v_old_je_id UUID;
  v_old_status TEXT;
  v_old_amount NUMERIC;
  v_reversal_je_id UUID;
  v_reversal_je_number TEXT;
  v_void_reason TEXT;
BEGIN
  v_client_request_id := p_payload->>'client_request_id';
  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'client_request_id is required');
  END IF;

  v_payment_id := (p_payload->>'payment_id')::UUID;
  IF v_payment_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION', 'error', 'payment_id is required');
  END IF;

  v_void_reason := COALESCE(p_payload->>'void_reason', 'إلغاء بواسطة المستخدم');

  -- Idempotency
  SELECT result_payload INTO v_existing_result
  FROM atomic_workflow_requests
  WHERE client_request_id = v_client_request_id AND workflow_type = 'payment_voucher_void' AND status = 'completed';
  IF v_existing_result IS NOT NULL THEN
    RETURN v_existing_result || jsonb_build_object('cached', true);
  END IF;

  INSERT INTO atomic_workflow_requests (client_request_id, workflow_type, status, request_payload, created_at)
  VALUES (v_client_request_id, 'payment_voucher_void', 'in_progress', p_payload, NOW())
  ON CONFLICT (client_request_id) DO UPDATE SET status = 'in_progress', created_at = NOW();

  -- Get existing payment
  SELECT journal_entry_id, status, amount INTO v_old_je_id, v_old_status, v_old_amount
  FROM payments WHERE id = v_payment_id;

  IF v_old_status IS NULL THEN
    UPDATE atomic_workflow_requests SET status='failed', error_code='NOT_FOUND' WHERE client_request_id=v_client_request_id;
    RETURN jsonb_build_object('success', false, 'error_code', 'NOT_FOUND', 'error', 'السند غير موجود');
  END IF;

  IF v_old_status = 'voided' THEN
    DECLARE v_r jsonb;
    BEGIN
      v_r := jsonb_build_object('success', true, 'already_voided', true, 'payment_id', v_payment_id,
        'meta', jsonb_build_object('workflowType', 'payment_voucher_void', 'clientRequestId', v_client_request_id));
      UPDATE atomic_workflow_requests SET status='completed', result_payload=v_r, completed_at=NOW() WHERE client_request_id=v_client_request_id;
      RETURN v_r;
    END;
  END IF;

  -- Reverse allocations
  UPDATE invoices SET
    paid_amount = GREATEST(COALESCE(paid_amount, 0) - spa.amount, 0),
    remaining_amount = LEAST(COALESCE(total_amount, 0), COALESCE(total_amount, 0) - GREATEST(COALESCE(paid_amount, 0) - spa.amount, 0))
  FROM supplier_payment_allocations spa
  WHERE spa.payment_id = v_payment_id AND invoices.id = spa.invoice_id;

  UPDATE invoices SET status = CASE
    WHEN COALESCE(paid_amount, 0) <= 0 THEN 'posted'
    WHEN COALESCE(paid_amount, 0) >= COALESCE(total_amount, 0) THEN 'paid'
    ELSE 'partial'
  END
  WHERE id IN (SELECT invoice_id FROM supplier_payment_allocations WHERE payment_id = v_payment_id);

  DELETE FROM supplier_payment_allocations WHERE payment_id = v_payment_id;

  -- Create reversal JE
  IF v_old_je_id IS NOT NULL THEN
    v_reversal_je_id := gen_random_uuid();
    v_reversal_je_number := 'JE-REV-' || to_char(NOW(), 'YYYYMMDD') || '-' || LPAD(floor(random() * 9000 + 1000)::TEXT, 4, '0');

    INSERT INTO journal_entries (id, entry_number, entry_date, description, reference_type, reference_id, is_posted, posted_at, total_debit, total_credit, status, reversal_of_je_id, created_at)
    SELECT v_reversal_je_id, v_reversal_je_number, NOW(), 'عكس قيد إلغاء سند: ' || entry_number, 'payment_void', v_payment_id, true, NOW(), total_debit, total_credit, 'posted', v_old_je_id, NOW()
    FROM journal_entries WHERE id = v_old_je_id;

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    SELECT v_reversal_je_id, account_id, credit_amount, debit_amount, 'عكس: ' || COALESCE(description, '')
    FROM journal_entry_lines WHERE journal_entry_id = v_old_je_id;

    UPDATE journal_entries SET reversed_by_je_id = v_reversal_je_id, status = 'reversed' WHERE id = v_old_je_id;
  END IF;

  -- Void the payment
  UPDATE payments SET status = 'voided', void_reason = v_void_reason, voided_at = NOW() WHERE id = v_payment_id;

  DECLARE v_result jsonb;
  BEGIN
    v_result := jsonb_build_object(
      'success', true, 'voided', true, 'payment_id', v_payment_id,
      'reversal_journal_entry_id', v_reversal_je_id,
      'meta', jsonb_build_object('workflowType', 'payment_voucher_void', 'clientRequestId', v_client_request_id)
    );
    UPDATE atomic_workflow_requests SET status='completed', result_payload=v_result, completed_at=NOW() WHERE client_request_id=v_client_request_id;
    RETURN v_result;
  END;

EXCEPTION WHEN OTHERS THEN
  UPDATE atomic_workflow_requests SET status='failed', error_code='DB_ERROR', error_message=SQLERRM WHERE client_request_id=v_client_request_id;
  RETURN jsonb_build_object('success', false, 'error_code', 'DB_ERROR', 'error', SQLERRM);
END;
$$;

-- ============================================================
-- SEED DATA: Required chart_of_accounts + payment_account_settings
-- Idempotent: uses WHERE NOT EXISTS for safe re-runs
-- ============================================================

-- Cash account (110101) - required by PV RPCs as fallback
INSERT INTO chart_of_accounts (id, account_code, account_name, account_type, is_active)
SELECT gen_random_uuid(), '110101', 'الصندوق - نقدي', 'asset', true
WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = '110101');

-- Bank transfer account (110104)
INSERT INTO chart_of_accounts (id, account_code, account_name, account_type, is_active)
SELECT gen_random_uuid(), '110104', 'البنك - تحويل بنكي', 'asset', true
WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = '110104');

-- Accounts Payable (2101) - required by PV RPCs for AP debit line
INSERT INTO chart_of_accounts (id, account_code, account_name, account_type, is_active)
SELECT gen_random_uuid(), '2101', 'الذمم الدائنة - الموردين', 'liability', true
WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = '2101');

-- Default payment_account_settings: link first branch to cash/bank accounts
-- Only inserts if no payment_account_settings exist at all
INSERT INTO payment_account_settings (id, branch_id, cash_account_id, bank_transfer_account_id)
SELECT
  gen_random_uuid(),
  b.id,
  (SELECT id FROM chart_of_accounts WHERE account_code = '110101' LIMIT 1),
  (SELECT id FROM chart_of_accounts WHERE account_code = '110104' LIMIT 1)
FROM branches b
WHERE NOT EXISTS (SELECT 1 FROM payment_account_settings)
LIMIT 1;
