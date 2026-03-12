-- ============================================
-- PHASE B: Unified JE Sequences for Transfers
-- ============================================

-- B1) Provisioning: Add JE sequences for missing branches
INSERT INTO public.branch_code_sequences (branch_id, code_type, prefix, padding, next_value, updated_at)
SELECT
  b.id,
  'JE',
  'JE-' || b.branch_code || '-',
  6,
  1,
  now()
FROM public.branches b
WHERE NOT EXISTS (
  SELECT 1
  FROM public.branch_code_sequences s
  WHERE s.branch_id = b.id AND s.code_type = 'JE'
);

-- B2 + B3) Recreate create_transfer_v2 with:
--   - Branch-specific JE numbering (NO daily sequences)
--   - NO fallback/auto-create for JE sequence (error if missing)
--   - Guardrail: RAISE EXCEPTION if missing accounts when total_cost > 0

CREATE OR REPLACE FUNCTION public.create_transfer_v2(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_from_branch_id uuid;
  v_to_branch_id uuid;
  v_transfer_date timestamptz;
  v_notes text;
  v_purchase_invoice_id uuid;
  v_item_ids uuid[];
  v_transfer_id uuid;
  v_transfer_code text;
  v_total_items integer := 0;
  v_total_cost numeric := 0;
  v_next_code integer;
  v_prefix text;
  v_padding integer;
  v_item record;
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
  -- Extract payload
  v_from_branch_id := (p_payload->>'from_branch_id')::uuid;
  v_to_branch_id := (p_payload->>'to_branch_id')::uuid;
  v_transfer_date := COALESCE((p_payload->>'transfer_date')::timestamptz, now());
  v_notes := p_payload->>'notes';
  v_purchase_invoice_id := (p_payload->>'purchase_invoice_id')::uuid;
  
  -- Parse item_ids array
  SELECT array_agg(elem::uuid)
  INTO v_item_ids
  FROM jsonb_array_elements_text(p_payload->'item_ids') elem;

  -- ===================
  -- VALIDATION
  -- ===================
  
  IF v_to_branch_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'الفرع المستهدف مطلوب');
  END IF;
  
  IF v_from_branch_id IS NOT NULL AND v_from_branch_id = v_to_branch_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'لا يمكن النقل إلى نفس الفرع');
  END IF;
  
  IF v_item_ids IS NULL OR array_length(v_item_ids, 1) IS NULL OR array_length(v_item_ids, 1) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'يجب اختيار قطعة واحدة على الأقل');
  END IF;
  
  -- ===================
  -- LOCKING (FOR UPDATE)
  -- ===================
  PERFORM id FROM public.jewelry_items 
  WHERE id = ANY(v_item_ids) 
  FOR UPDATE;
  
  -- ===================
  -- ITEM VALIDATION
  -- ===================
  FOR v_item IN 
    SELECT id, item_code, branch_id, sold_at, sale_status, purchase_invoice_id, cost, g_weight
    FROM public.jewelry_items 
    WHERE id = ANY(v_item_ids)
  LOOP
    IF v_from_branch_id IS NOT NULL AND v_item.branch_id IS DISTINCT FROM v_from_branch_id THEN
      RETURN jsonb_build_object('success', false, 'error', 
        format('القطعة %s ليست في الفرع المصدر', v_item.item_code));
    END IF;
    
    IF v_item.sold_at IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 
        format('القطعة %s مباعة ولا يمكن نقلها', v_item.item_code));
    END IF;
    
    IF v_item.sale_status IS NOT NULL AND v_item.sale_status NOT IN ('available', 'in_stock') THEN
      RETURN jsonb_build_object('success', false, 'error', 
        format('القطعة %s غير متاحة للنقل (الحالة: %s)', v_item.item_code, v_item.sale_status));
    END IF;
    
    IF v_purchase_invoice_id IS NOT NULL AND v_item.purchase_invoice_id IS DISTINCT FROM v_purchase_invoice_id THEN
      RETURN jsonb_build_object('success', false, 'error', 
        format('القطعة %s لا تنتمي للفاتورة المحددة', v_item.item_code));
    END IF;
  END LOOP;
  
  IF (SELECT count(*) FROM public.jewelry_items WHERE id = ANY(v_item_ids)) != array_length(v_item_ids, 1) THEN
    RETURN jsonb_build_object('success', false, 'error', 'بعض القطع غير موجودة');
  END IF;

  -- ===================
  -- GENERATE TRANSFER CODE (TRF-{branch_code}-NNNNNN)
  -- ===================
  v_seq_branch_id := v_to_branch_id;
  
  SELECT prefix, padding, next_value 
  INTO v_prefix, v_padding, v_next_code
  FROM public.branch_code_sequences
  WHERE branch_id = v_seq_branch_id AND code_type = 'TRF'
  FOR UPDATE;
  
  IF NOT FOUND THEN
    SELECT 'TRF-' || branch_code || '-' INTO v_prefix
    FROM public.branches WHERE id = v_seq_branch_id;
    
    v_padding := 5;
    v_next_code := 1;
    
    INSERT INTO public.branch_code_sequences (branch_id, code_type, prefix, padding, next_value)
    VALUES (v_seq_branch_id, 'TRF', v_prefix, v_padding, v_next_code + 1);
  ELSE
    UPDATE public.branch_code_sequences 
    SET next_value = next_value + 1, updated_at = now()
    WHERE branch_id = v_seq_branch_id AND code_type = 'TRF';
  END IF;
  
  v_transfer_code := v_prefix || lpad(v_next_code::text, v_padding, '0');
  
  -- ===================
  -- CALCULATE TOTALS FROM DB (not payload)
  -- ===================
  SELECT count(*), COALESCE(sum(COALESCE(cost, 0)), 0)
  INTO v_total_items, v_total_cost
  FROM public.jewelry_items
  WHERE id = ANY(v_item_ids);

  -- ===================
  -- GET INVENTORY ACCOUNTS FOR JE
  -- ===================
  IF v_from_branch_id IS NOT NULL THEN
    SELECT COALESCE(general_inventory_account_id, imported_pieces_account_id)
    INTO v_source_account_id
    FROM public.branch_inventory_accounts
    WHERE branch_id = v_from_branch_id;
  END IF;
  
  SELECT COALESCE(general_inventory_account_id, imported_pieces_account_id)
  INTO v_target_account_id
  FROM public.branch_inventory_accounts
  WHERE branch_id = v_to_branch_id;

  -- ===================
  -- B3) GUARDRAIL: Enforce "Posted = JE" when total_cost > 0
  -- ===================
  IF v_total_cost > 0 THEN
    -- Must have both accounts to create JE
    IF v_from_branch_id IS NOT NULL AND v_source_account_id IS NULL THEN
      RAISE EXCEPTION 'Missing inventory account for source branch. branch_id=%', v_from_branch_id;
    END IF;
    
    IF v_target_account_id IS NULL THEN
      RAISE EXCEPTION 'Missing inventory account for target branch. branch_id=%', v_to_branch_id;
    END IF;
  END IF;

  -- ===================
  -- CREATE TRANSFER RECORD
  -- ===================
  v_transfer_id := gen_random_uuid();
  
  INSERT INTO public.transfers (
    id,
    transfer_code,
    from_branch_id,
    to_branch_id,
    transfer_date,
    notes,
    purchase_invoice_id,
    status,
    total_items,
    total_cost,
    created_at
  ) VALUES (
    v_transfer_id,
    v_transfer_code,
    v_from_branch_id,
    v_to_branch_id,
    v_transfer_date,
    v_notes,
    v_purchase_invoice_id,
    'posted',
    v_total_items,
    v_total_cost,
    now()
  );

  -- ===================
  -- INSERT TRANSFER ITEMS (with DB snapshots)
  -- ===================
  INSERT INTO public.transfer_items (
    transfer_id,
    jewelry_item_id,
    item_code,
    weight_grams,
    unit_cost
  )
  SELECT 
    v_transfer_id,
    ji.id,
    ji.item_code,
    ji.g_weight,
    ji.cost
  FROM public.jewelry_items ji
  WHERE ji.id = ANY(v_item_ids);

  -- ===================
  -- UPDATE JEWELRY ITEMS (move to target branch)
  -- ===================
  UPDATE public.jewelry_items
  SET 
    branch_id = v_to_branch_id,
    updated_at = now()
  WHERE id = ANY(v_item_ids);

  -- ===================
  -- CREATE JOURNAL ENTRY (if total_cost > 0)
  -- ===================
  IF v_total_cost > 0 THEN
    v_journal_entry_id := gen_random_uuid();
    
    -- B2) Get JE sequence from branch_code_sequences (NO fallback/auto-create)
    SELECT prefix, padding, next_value
    INTO v_je_prefix, v_je_padding, v_je_next_val
    FROM public.branch_code_sequences
    WHERE branch_id = v_to_branch_id AND code_type = 'JE'
    FOR UPDATE;
    
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Missing JE sequence for branch. branch_id=% code_type=JE', v_to_branch_id;
    END IF;
    
    -- Increment sequence
    UPDATE public.branch_code_sequences
    SET next_value = next_value + 1, updated_at = now()
    WHERE branch_id = v_to_branch_id AND code_type = 'JE';
    
    -- Generate JE number: JE-{branch_code}-NNNNNN
    v_journal_entry_number := v_je_prefix || lpad(v_je_next_val::text, v_je_padding, '0');
    
    -- Create journal entry
    INSERT INTO public.journal_entries (
      id,
      entry_number,
      entry_date,
      reference_type,
      reference_id,
      description,
      total_debit,
      total_credit,
      is_posted,
      branch_id,
      created_at
    ) VALUES (
      v_journal_entry_id,
      v_journal_entry_number,
      v_transfer_date::date,
      'transfer',
      v_transfer_id,
      'قيد نقل مخزون - ' || v_transfer_code,
      v_total_cost,
      v_total_cost,
      true,
      v_to_branch_id,
      now()
    );
    
    -- Create journal entry lines (2 lines, balanced)
    -- Line 1: Debit target branch inventory
    INSERT INTO public.journal_entry_lines (
      journal_entry_id,
      account_id,
      debit_amount,
      credit_amount,
      description
    ) VALUES (
      v_journal_entry_id,
      v_target_account_id,
      v_total_cost,
      0,
      'مدين - مخزون الفرع المستلم'
    );
    
    -- Line 2: Credit source branch inventory (or target if from_branch is null)
    INSERT INTO public.journal_entry_lines (
      journal_entry_id,
      account_id,
      debit_amount,
      credit_amount,
      description
    ) VALUES (
      v_journal_entry_id,
      COALESCE(v_source_account_id, v_target_account_id),
      0,
      v_total_cost,
      'دائن - مخزون الفرع المصدر'
    );
    
    -- Link journal entry to transfer
    UPDATE public.transfers
    SET journal_entry_id = v_journal_entry_id
    WHERE id = v_transfer_id;
  END IF;

  -- ===================
  -- CREATE ITEM MOVEMENTS (with JE link)
  -- ===================
  INSERT INTO public.item_movements (
    jewelry_item_id,
    movement_type,
    from_branch_id,
    to_branch_id,
    reference_id,
    reference_type,
    notes,
    performed_by,
    journal_entry_id,
    created_at
  )
  SELECT 
    ji.id,
    'transfer',
    v_from_branch_id,
    v_to_branch_id,
    v_transfer_id,
    'transfer',
    v_notes,
    auth.uid(),
    v_journal_entry_id,
    now()
  FROM public.jewelry_items ji
  WHERE ji.id = ANY(v_item_ids);

  -- ===================
  -- RETURN SUCCESS
  -- ===================
  RETURN jsonb_build_object(
    'success', true,
    'transfer_id', v_transfer_id,
    'transfer_code', v_transfer_code,
    'total_items', v_total_items,
    'total_cost', v_total_cost,
    'journal_entry_id', v_journal_entry_id,
    'journal_entry_number', v_journal_entry_number
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$;