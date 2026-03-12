-- Fix column names: debit_amount, credit_amount instead of debit, credit

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
  v_je_date_key text;
  v_je_next_seq integer;
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
  -- GENERATE TRANSFER CODE
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
  -- INSERT TRANSFER RECORD
  -- ===================
  INSERT INTO public.transfers (
    id, transfer_code, from_branch_id, to_branch_id, transfer_date,
    status, notes, purchase_invoice_id, total_items, total_cost, created_at
  )
  VALUES (
    gen_random_uuid(), v_transfer_code, v_from_branch_id, v_to_branch_id, v_transfer_date,
    'posted', v_notes, v_purchase_invoice_id, 0, 0, now()
  )
  RETURNING id INTO v_transfer_id;
  
  -- ===================
  -- INSERT TRANSFER_ITEMS (SNAPSHOTS FROM DB)
  -- ===================
  INSERT INTO public.transfer_items (id, transfer_id, item_id, item_code, weight_grams, unit_cost, created_at)
  SELECT gen_random_uuid(), v_transfer_id, ji.id, ji.item_code, ji.g_weight, ji.cost, now()
  FROM public.jewelry_items ji
  WHERE ji.id = ANY(v_item_ids);
  
  GET DIAGNOSTICS v_total_items = ROW_COUNT;
  
  -- ===================
  -- UPDATE JEWELRY_ITEMS.BRANCH_ID
  -- ===================
  UPDATE public.jewelry_items
  SET branch_id = v_to_branch_id, updated_at = now()
  WHERE id = ANY(v_item_ids);
  
  -- ===================
  -- CALCULATE TOTALS FROM DB
  -- ===================
  SELECT COALESCE(SUM(cost), 0)
  INTO v_total_cost
  FROM public.jewelry_items
  WHERE id = ANY(v_item_ids);
  
  -- ===================
  -- CREATE JOURNAL ENTRY (if total_cost > 0 AND accounts exist)
  -- ===================
  IF v_total_cost > 0 THEN
    -- Get source branch inventory account
    SELECT COALESCE(general_inventory_account_id, imported_pieces_account_id)
    INTO v_source_account_id
    FROM public.branch_inventory_accounts
    WHERE branch_id = v_from_branch_id;
    
    -- Get target branch inventory account
    SELECT COALESCE(general_inventory_account_id, imported_pieces_account_id)
    INTO v_target_account_id
    FROM public.branch_inventory_accounts
    WHERE branch_id = v_to_branch_id;
    
    -- Only create JE if both accounts exist
    IF v_source_account_id IS NOT NULL AND v_target_account_id IS NOT NULL THEN
      -- Generate journal entry number (JE-YYYYMMDD-NNNN)
      v_je_date_key := 'journal_entry_' || to_char(v_transfer_date, 'YYYYMMDD');
      
      INSERT INTO public.code_sequences (id, prefix, padding, next_value)
      VALUES (v_je_date_key, 'JE-' || to_char(v_transfer_date, 'YYYYMMDD') || '-', 4, 1)
      ON CONFLICT (id) DO NOTHING;
      
      SELECT next_value INTO v_je_next_seq
      FROM public.code_sequences
      WHERE id = v_je_date_key
      FOR UPDATE;
      
      UPDATE public.code_sequences
      SET next_value = next_value + 1, updated_at = now()
      WHERE id = v_je_date_key;
      
      v_journal_entry_number := 'JE-' || to_char(v_transfer_date, 'YYYYMMDD') || '-' || lpad(v_je_next_seq::text, 4, '0');
      
      -- Insert journal entry
      INSERT INTO public.journal_entries (
        id, entry_number, entry_date, description, reference_type, reference_id,
        is_posted, total_debit, total_credit, branch_id, created_at, created_by
      )
      VALUES (
        gen_random_uuid(), v_journal_entry_number, v_transfer_date::date,
        'قيد نقل مخزون - ' || v_transfer_code, 'transfer', v_transfer_id,
        true, v_total_cost, v_total_cost, v_to_branch_id, now(), auth.uid()
      )
      RETURNING id INTO v_journal_entry_id;
      
      -- Debit target branch inventory (receiving) - FIXED column names
      INSERT INTO public.journal_entry_lines (
        id, journal_entry_id, account_id, debit_amount, credit_amount, description, created_at
      )
      VALUES (
        gen_random_uuid(), v_journal_entry_id, v_target_account_id,
        v_total_cost, 0, 'مخزون وارد - ' || v_transfer_code, now()
      );
      
      -- Credit source branch inventory (sending) - FIXED column names
      INSERT INTO public.journal_entry_lines (
        id, journal_entry_id, account_id, debit_amount, credit_amount, description, created_at
      )
      VALUES (
        gen_random_uuid(), v_journal_entry_id, v_source_account_id,
        0, v_total_cost, 'مخزون صادر - ' || v_transfer_code, now()
      );
      
      -- Update transfer with journal_entry_id
      UPDATE public.transfers
      SET journal_entry_id = v_journal_entry_id
      WHERE id = v_transfer_id;
    END IF;
  END IF;
  
  -- ===================
  -- INSERT ITEM_MOVEMENTS (MANDATORY)
  -- ===================
  INSERT INTO public.item_movements (
    id, item_id, movement_type, from_branch_id, to_branch_id,
    reference_type, reference_id, reference_code, movement_date, cost, journal_entry_id, created_at
  )
  SELECT
    gen_random_uuid(), ji.id, 'transfer', v_from_branch_id, v_to_branch_id,
    'transfer', v_transfer_id, v_transfer_code, v_transfer_date, ji.cost, v_journal_entry_id, now()
  FROM public.jewelry_items ji
  WHERE ji.id = ANY(v_item_ids)
  ON CONFLICT DO NOTHING;
  
  -- ===================
  -- UPDATE TRANSFER TOTALS
  -- ===================
  UPDATE public.transfers
  SET total_items = v_total_items, total_cost = v_total_cost
  WHERE id = v_transfer_id;
  
  -- ===================
  -- RETURN SUCCESS
  -- ===================
  RETURN jsonb_build_object(
    'success', true,
    'transfer_id', v_transfer_id,
    'transfer_code', v_transfer_code,
    'total_items', v_total_items,
    'total_cost', v_total_cost,
    'journal_entry_id', v_journal_entry_id
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;