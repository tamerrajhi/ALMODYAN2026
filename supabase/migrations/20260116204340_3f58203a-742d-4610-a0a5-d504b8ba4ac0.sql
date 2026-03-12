
-- Fix reverse_transfer_v2 RPC: remove status column reference
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
    
    INSERT INTO public.branch_code_sequences (branch_id, code_type, prefix, padding, next_value)
    VALUES (v_seq_branch_id, 'TRF', v_prefix, v_padding, 2)
    RETURNING prefix, padding, next_value - 1 INTO v_prefix, v_padding, v_next_code;
  ELSE
    UPDATE public.branch_code_sequences
    SET next_value = next_value + 1, updated_at = now()
    WHERE branch_id = v_seq_branch_id AND code_type = 'TRF';
  END IF;
  
  v_reversal_transfer_code := v_prefix || LPAD(v_next_code::text, v_padding, '0');
  v_reversal_transfer_id := gen_random_uuid();

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
    notes,
    reversal_of_transfer_id,
    total_cost,
    total_items,
    created_at,
    updated_at
  ) VALUES (
    v_reversal_transfer_id,
    v_reversal_transfer_code,
    v_original_transfer.to_branch_id,
    v_original_transfer.from_branch_id,
    CURRENT_DATE,
    'posted',
    COALESCE('REVERSAL OF ' || v_original_transfer.transfer_code || ' - ' || v_notes, 
             'REVERSAL OF ' || v_original_transfer.transfer_code),
    v_transfer_id,
    v_reversal_total_cost,
    v_reversal_total_items,
    now(),
    now()
  );

  -- =====================
  -- 6) CREATE REVERSAL TRANSFER ITEMS (FROM SNAPSHOTS)
  -- =====================
  INSERT INTO public.transfer_items (
    transfer_id,
    item_id,
    item_code,
    weight_grams,
    unit_cost,
    created_at
  )
  SELECT 
    v_reversal_transfer_id,
    ti.item_id,
    ti.item_code,
    ti.weight_grams,
    ti.unit_cost,
    now()
  FROM public.transfer_items ti
  WHERE ti.transfer_id = v_transfer_id;

  -- =====================
  -- 7) ACCOUNTING (MANDATORY IF COST > 0)
  -- =====================
  IF v_reversal_total_cost > 0 THEN
    -- Get inventory accounts for both branches
    -- Source account = original.to_branch (where items are now, will be credited)
    SELECT general_inventory_account_id INTO v_source_account_id
    FROM public.branch_inventory_accounts
    WHERE branch_id = v_original_transfer.to_branch_id;
    
    -- Target account = original.from_branch (where items will go, will be debited)
    SELECT general_inventory_account_id INTO v_target_account_id
    FROM public.branch_inventory_accounts
    WHERE branch_id = v_original_transfer.from_branch_id;
    
    IF v_source_account_id IS NULL OR v_target_account_id IS NULL THEN
      RAISE EXCEPTION 'حسابات المخزون غير مكتملة للفروع المعنية - لا يمكن إنشاء قيد محاسبي';
    END IF;
    
    -- Generate JE number using target branch (where items go)
    SELECT prefix, padding, next_value
    INTO v_je_prefix, v_je_padding, v_je_next_val
    FROM public.branch_code_sequences
    WHERE branch_id = v_original_transfer.from_branch_id AND code_type = 'JE'
    FOR UPDATE;
    
    IF NOT FOUND THEN
      RAISE EXCEPTION 'تسلسل القيود المحاسبية غير موجود للفرع المستهدف';
    END IF;
    
    UPDATE public.branch_code_sequences
    SET next_value = next_value + 1, updated_at = now()
    WHERE branch_id = v_original_transfer.from_branch_id AND code_type = 'JE';
    
    v_journal_entry_number := v_je_prefix || LPAD(v_je_next_val::text, v_je_padding, '0');
    v_journal_entry_id := gen_random_uuid();
    
    -- Create Journal Entry
    INSERT INTO public.journal_entries (
      id,
      entry_number,
      entry_date,
      description,
      reference_type,
      reference_id,
      is_posted,
      posted_at,
      total_debit,
      total_credit,
      branch_id,
      created_at,
      updated_at
    ) VALUES (
      v_journal_entry_id,
      v_journal_entry_number,
      CURRENT_DATE,
      'عكس قيد نقل مخزون - ' || v_original_transfer.transfer_code,
      'transfer',
      v_reversal_transfer_id,
      true,
      now(),
      v_reversal_total_cost,
      v_reversal_total_cost,
      v_original_transfer.from_branch_id,
      now(),
      now()
    );
    
    -- Create Journal Entry Lines (balanced)
    -- Debit: Target inventory (original.from_branch - where items go back)
    INSERT INTO public.journal_entry_lines (
      journal_entry_id,
      account_id,
      debit,
      credit,
      description,
      created_at
    ) VALUES (
      v_journal_entry_id,
      v_target_account_id,
      v_reversal_total_cost,
      0,
      'عكس نقل مخزون - مدين',
      now()
    );
    
    -- Credit: Source inventory (original.to_branch - where items were)
    INSERT INTO public.journal_entry_lines (
      journal_entry_id,
      account_id,
      debit,
      credit,
      description,
      created_at
    ) VALUES (
      v_journal_entry_id,
      v_source_account_id,
      0,
      v_reversal_total_cost,
      'عكس نقل مخزون - دائن',
      now()
    );
    
    -- Link reversal transfer to JE
    UPDATE public.transfers
    SET journal_entry_id = v_journal_entry_id
    WHERE id = v_reversal_transfer_id;
  END IF;

  -- =====================
  -- 8) CREATE ITEM MOVEMENTS FOR REVERSAL
  -- =====================
  INSERT INTO public.item_movements (
    item_id,
    item_code,
    movement_type,
    from_branch_id,
    to_branch_id,
    weight_grams,
    unit_cost,
    reference_type,
    reference_id,
    journal_entry_id,
    movement_date,
    created_at
  )
  SELECT 
    ti.item_id,
    ti.item_code,
    'transfer_reverse',
    v_original_transfer.to_branch_id,
    v_original_transfer.from_branch_id,
    ti.weight_grams,
    ti.unit_cost,
    'transfer',
    v_reversal_transfer_id,
    v_journal_entry_id,
    CURRENT_DATE,
    now()
  FROM public.transfer_items ti
  WHERE ti.transfer_id = v_transfer_id;

  -- =====================
  -- 9) MARK ORIGINAL TRANSFER AS REVERSED
  -- =====================
  UPDATE public.transfers
  SET reversed_at = now(),
      reversed_by = current_user,
      reversal_reason = v_notes
  WHERE id = v_transfer_id;

  -- =====================
  -- 10) RETURN SUCCESS
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
