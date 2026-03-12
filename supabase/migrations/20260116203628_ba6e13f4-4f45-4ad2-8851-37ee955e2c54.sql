-- D4 Step 1: Add reversal_of_transfer_id column to transfers
-- This allows tracking the original transfer that was reversed

-- Add column for linking reversal transfers
ALTER TABLE public.transfers
ADD COLUMN IF NOT EXISTS reversal_of_transfer_id uuid NULL;

-- Add foreign key constraint (DROP IF EXISTS first to avoid duplicate)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'fk_transfers_reversal_of_transfer'
  ) THEN
    ALTER TABLE public.transfers
    ADD CONSTRAINT fk_transfers_reversal_of_transfer
    FOREIGN KEY (reversal_of_transfer_id) REFERENCES public.transfers(id);
  END IF;
END $$;

-- Add unique partial index to prevent double reversals
CREATE UNIQUE INDEX IF NOT EXISTS idx_transfers_unique_reversal 
ON public.transfers (reversal_of_transfer_id) 
WHERE reversal_of_transfer_id IS NOT NULL;

-- ============================================
-- REVERSE_TRANSFER_V2 RPC
-- Single transaction for reversing transfers with full accounting
-- ============================================

CREATE OR REPLACE FUNCTION public.reverse_transfer_v2(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_transfer_id uuid;
  v_notes text;
  -- Original transfer data
  v_original_transfer record;
  v_item record;
  v_item_validation record;
  -- Reversal transfer data
  v_reversal_transfer_id uuid;
  v_reversal_transfer_code text;
  v_reversal_total_cost numeric := 0;
  v_reversal_total_items integer := 0;
  -- Code generation
  v_next_code integer;
  v_prefix text;
  v_padding integer;
  v_seq_branch_id uuid;
  -- Journal Entry variables
  v_journal_entry_id uuid;
  v_journal_entry_number text;
  v_source_account_id uuid;
  v_target_account_id uuid;
  v_je_prefix text;
  v_je_padding integer;
  v_je_next_val integer;
BEGIN
  -- =====================
  -- EXTRACT PAYLOAD
  -- =====================
  v_transfer_id := (p_payload->>'transfer_id')::uuid;
  v_notes := p_payload->>'notes';
  
  IF v_transfer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'معرف التحويل مطلوب');
  END IF;

  -- =====================
  -- 1) LOAD & LOCK TRANSFER
  -- =====================
  SELECT id, transfer_code, from_branch_id, to_branch_id, 
         status, total_cost, total_items, journal_entry_id
  INTO v_original_transfer
  FROM public.transfers
  WHERE id = v_transfer_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'التحويل غير موجود');
  END IF;
  
  IF v_original_transfer.status != 'posted' THEN
    RETURN jsonb_build_object('success', false, 'error', 
      format('لا يمكن عكس تحويل بحالة: %s', v_original_transfer.status));
  END IF;
  
  -- Check if already reversed
  IF EXISTS (
    SELECT 1 FROM public.transfers 
    WHERE reversal_of_transfer_id = v_transfer_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'تم عكس هذا التحويل مسبقاً');
  END IF;

  -- =====================
  -- 2) LOAD & LOCK TRANSFER ITEMS (SNAPSHOTS)
  -- =====================
  -- Lock items in transfer_items
  PERFORM id FROM public.transfer_items
  WHERE transfer_id = v_transfer_id
  FOR UPDATE;
  
  -- Validate each item can be reversed
  FOR v_item IN 
    SELECT ti.id, ti.item_id, ti.item_code, ti.weight_grams, ti.unit_cost
    FROM public.transfer_items ti
    WHERE ti.transfer_id = v_transfer_id
  LOOP
    -- Lock and validate jewelry_item
    SELECT id, item_code, branch_id, sold_at
    INTO v_item_validation
    FROM public.jewelry_items
    WHERE id = v_item.item_id
    FOR UPDATE;
    
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 
        format('القطعة %s غير موجودة في النظام', v_item.item_code));
    END IF;
    
    IF v_item_validation.sold_at IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 
        format('القطعة %s تم بيعها ولا يمكن عكس نقلها', v_item.item_code));
    END IF;
    
    IF v_item_validation.branch_id IS DISTINCT FROM v_original_transfer.to_branch_id THEN
      RETURN jsonb_build_object('success', false, 'error', 
        format('القطعة %s لم تعد في الفرع المستهدف - ربما تم نقلها مرة أخرى', v_item.item_code));
    END IF;
    
    -- Accumulate totals from snapshots
    v_reversal_total_cost := v_reversal_total_cost + COALESCE(v_item.unit_cost, 0);
    v_reversal_total_items := v_reversal_total_items + 1;
  END LOOP;
  
  IF v_reversal_total_items = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'لا توجد قطع في التحويل الأصلي');
  END IF;

  -- =====================
  -- 3) REVERSE THE ITEMS MOVE
  -- =====================
  UPDATE public.jewelry_items
  SET branch_id = v_original_transfer.from_branch_id,
      updated_at = now()
  WHERE id IN (SELECT item_id FROM public.transfer_items WHERE transfer_id = v_transfer_id);

  -- =====================
  -- 4) GENERATE REVERSAL TRANSFER CODE
  -- =====================
  v_seq_branch_id := v_original_transfer.to_branch_id;
  
  SELECT prefix, padding, next_value 
  INTO v_prefix, v_padding, v_next_code
  FROM public.branch_code_sequences
  WHERE branch_id = v_seq_branch_id AND code_type = 'TRF'
  FOR UPDATE;
  
  IF NOT FOUND THEN
    SELECT 'TRF-' || b.branch_code || '-', 6
    INTO v_prefix, v_padding
    FROM public.branches b WHERE b.id = v_seq_branch_id;
    
    v_next_code := 1;
    
    INSERT INTO public.branch_code_sequences (branch_id, code_type, prefix, padding, next_value, updated_at)
    VALUES (v_seq_branch_id, 'TRF', v_prefix, v_padding, v_next_code + 1, now());
  ELSE
    UPDATE public.branch_code_sequences
    SET next_value = next_value + 1, updated_at = now()
    WHERE branch_id = v_seq_branch_id AND code_type = 'TRF';
  END IF;
  
  v_reversal_transfer_code := v_prefix || lpad(v_next_code::text, v_padding, '0');

  -- =====================
  -- 5) CREATE REVERSAL TRANSFER RECORD
  -- =====================
  INSERT INTO public.transfers (
    id,
    transfer_code,
    from_branch_id,
    to_branch_id,
    transfer_date,
    status,
    total_items,
    total_cost,
    notes,
    reversal_of_transfer_id,
    created_by,
    created_at
  )
  VALUES (
    gen_random_uuid(),
    v_reversal_transfer_code,
    v_original_transfer.to_branch_id,
    v_original_transfer.from_branch_id,
    now(),
    'posted',
    v_reversal_total_items,
    v_reversal_total_cost,
    CASE 
      WHEN v_notes IS NOT NULL AND v_notes != '' 
      THEN 'عكس التحويل ' || v_original_transfer.transfer_code || ' - ' || v_notes
      ELSE 'عكس التحويل ' || v_original_transfer.transfer_code
    END,
    v_transfer_id,
    current_user,
    now()
  )
  RETURNING id INTO v_reversal_transfer_id;

  -- =====================
  -- 5.1) CREATE REVERSAL TRANSFER ITEMS (SNAPSHOTS)
  -- =====================
  INSERT INTO public.transfer_items (id, transfer_id, item_id, item_code, weight_grams, unit_cost, created_at)
  SELECT 
    gen_random_uuid(),
    v_reversal_transfer_id,
    ti.item_id,
    ti.item_code,
    ti.weight_grams,
    ti.unit_cost,
    now()
  FROM public.transfer_items ti
  WHERE ti.transfer_id = v_transfer_id;

  -- =====================
  -- 6) ACCOUNTING (MANDATORY IF COST > 0)
  -- =====================
  IF v_reversal_total_cost > 0 THEN
    SELECT general_inventory_account_id INTO v_target_account_id
    FROM public.branch_inventory_accounts
    WHERE branch_id = v_original_transfer.from_branch_id;
    
    SELECT general_inventory_account_id INTO v_source_account_id
    FROM public.branch_inventory_accounts
    WHERE branch_id = v_original_transfer.to_branch_id;
    
    IF v_target_account_id IS NULL THEN
      RAISE EXCEPTION 'حساب مخزون الفرع المستهدف غير محدد (from_branch: %)', v_original_transfer.from_branch_id;
    END IF;
    
    IF v_source_account_id IS NULL THEN
      RAISE EXCEPTION 'حساب مخزون الفرع المصدر غير محدد (to_branch: %)', v_original_transfer.to_branch_id;
    END IF;
    
    SELECT prefix, padding, next_value 
    INTO v_je_prefix, v_je_padding, v_je_next_val
    FROM public.branch_code_sequences
    WHERE branch_id = v_original_transfer.from_branch_id AND code_type = 'JE'
    FOR UPDATE;
    
    IF NOT FOUND THEN
      RAISE EXCEPTION 'تسلسل قيد الفرع غير موجود للفرع: %', v_original_transfer.from_branch_id;
    END IF;
    
    UPDATE public.branch_code_sequences
    SET next_value = next_value + 1, updated_at = now()
    WHERE branch_id = v_original_transfer.from_branch_id AND code_type = 'JE';
    
    v_journal_entry_number := v_je_prefix || lpad(v_je_next_val::text, v_je_padding, '0');
    
    INSERT INTO public.journal_entries (
      id,
      entry_number,
      entry_date,
      description,
      reference_type,
      reference_id,
      status,
      total_debit,
      total_credit,
      is_balanced,
      created_at,
      created_by
    )
    VALUES (
      gen_random_uuid(),
      v_journal_entry_number,
      now(),
      'عكس قيد نقل مخزون - ' || v_original_transfer.transfer_code,
      'transfer',
      v_reversal_transfer_id,
      'posted',
      v_reversal_total_cost,
      v_reversal_total_cost,
      true,
      now(),
      current_user
    )
    RETURNING id INTO v_journal_entry_id;
    
    INSERT INTO public.journal_entry_lines (
      id, journal_entry_id, account_id, debit, credit, description, created_at
    )
    VALUES (
      gen_random_uuid(),
      v_journal_entry_id,
      v_target_account_id,
      v_reversal_total_cost,
      0,
      'عكس نقل مخزون - استلام',
      now()
    );
    
    INSERT INTO public.journal_entry_lines (
      id, journal_entry_id, account_id, debit, credit, description, created_at
    )
    VALUES (
      gen_random_uuid(),
      v_journal_entry_id,
      v_source_account_id,
      0,
      v_reversal_total_cost,
      'عكس نقل مخزون - إرسال',
      now()
    );
    
    UPDATE public.transfers
    SET journal_entry_id = v_journal_entry_id
    WHERE id = v_reversal_transfer_id;
  END IF;

  -- =====================
  -- 7) CREATE ITEM MOVEMENTS FOR REVERSAL
  -- =====================
  INSERT INTO public.item_movements (
    id,
    item_id,
    movement_type,
    from_branch_id,
    to_branch_id,
    reference_type,
    reference_id,
    reference_code,
    cost,
    journal_entry_id,
    movement_date,
    notes,
    created_at
  )
  SELECT 
    gen_random_uuid(),
    ti.item_id,
    'transfer_reverse',
    v_original_transfer.to_branch_id,
    v_original_transfer.from_branch_id,
    'transfer',
    v_reversal_transfer_id,
    v_reversal_transfer_code,
    ti.unit_cost,
    v_journal_entry_id,
    now(),
    'عكس التحويل ' || v_original_transfer.transfer_code,
    now()
  FROM public.transfer_items ti
  WHERE ti.transfer_id = v_transfer_id;

  -- =====================
  -- 8) MARK ORIGINAL TRANSFER AS REVERSED
  -- =====================
  UPDATE public.transfers
  SET 
    reversed_at = now(),
    reversed_by = current_user,
    reversal_reason = COALESCE(v_notes, 'عكس التحويل')
  WHERE id = v_transfer_id;

  -- =====================
  -- RETURN SUCCESS
  -- =====================
  RETURN jsonb_build_object(
    'success', true,
    'reversal_transfer_id', v_reversal_transfer_id,
    'reversal_transfer_code', v_reversal_transfer_code,
    'journal_entry_id', v_journal_entry_id,
    'journal_entry_number', v_journal_entry_number,
    'total_items', v_reversal_total_items,
    'total_cost', v_reversal_total_cost
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM
  );
END;
$$;