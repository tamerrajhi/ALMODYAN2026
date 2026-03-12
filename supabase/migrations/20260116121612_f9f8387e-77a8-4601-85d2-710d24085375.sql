CREATE OR REPLACE FUNCTION public.create_transfer_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_from_branch_id uuid;
  v_to_branch_id uuid;
  v_item_ids uuid[];
  v_notes text;
  v_purchase_invoice_id uuid;
  v_transfer_id uuid;
  v_transfer_code text;
  v_total_items int;
  v_total_cost numeric := 0;
  v_transferred_by uuid;
  v_journal_entry_id uuid;
  v_je_number text;
  v_from_branch_name text;
  v_to_branch_name text;
  v_from_inventory_account_id uuid;
  v_to_inventory_account_id uuid;
  v_item_record record;
  v_invalid_items text[];
  v_reference_type text;
BEGIN
  -- Extract parameters
  v_from_branch_id := (p_payload->>'from_branch_id')::uuid;
  v_to_branch_id := (p_payload->>'to_branch_id')::uuid;
  v_notes := p_payload->>'notes';
  v_purchase_invoice_id := (p_payload->>'purchase_invoice_id')::uuid;
  v_transferred_by := auth.uid();
  
  -- Parse item_ids array
  SELECT array_agg(x::uuid)
  INTO v_item_ids
  FROM jsonb_array_elements_text(p_payload->'item_ids') x;
  
  -- Validate inputs
  IF v_to_branch_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'to_branch_id is required');
  END IF;
  
  IF v_item_ids IS NULL OR array_length(v_item_ids, 1) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'item_ids array is required and cannot be empty');
  END IF;
  
  v_total_items := array_length(v_item_ids, 1);
  
  -- Get branch names
  SELECT branch_name INTO v_from_branch_name FROM public.branches WHERE id = v_from_branch_id;
  SELECT branch_name INTO v_to_branch_name FROM public.branches WHERE id = v_to_branch_id;
  
  IF v_to_branch_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid to_branch_id');
  END IF;
  
  -- Determine reference type
  v_reference_type := CASE 
    WHEN v_purchase_invoice_id IS NOT NULL THEN 'imported_serial_transfer'
    ELSE 'transfer'
  END;
  
  -- Lock and validate items - FIXED: use sale_status instead of status
  SELECT array_agg(ji.item_code)
  INTO v_invalid_items
  FROM public.jewelry_items ji
  WHERE ji.id = ANY(v_item_ids)
    AND (
      (v_from_branch_id IS NOT NULL AND ji.branch_id IS DISTINCT FROM v_from_branch_id)
      OR COALESCE(ji.sale_status, 'available') = 'sold'
    );
  
  IF v_invalid_items IS NOT NULL AND array_length(v_invalid_items, 1) > 0 THEN
    RETURN jsonb_build_object(
      'success', false, 
      'error', 'Invalid items: not in source branch or already sold',
      'invalid_items', v_invalid_items
    );
  END IF;
  
  -- Lock items for update
  PERFORM ji.id
  FROM public.jewelry_items ji
  WHERE ji.id = ANY(v_item_ids)
  FOR UPDATE;
  
  -- Calculate total cost
  SELECT COALESCE(SUM(ji.total_value), 0)
  INTO v_total_cost
  FROM public.jewelry_items ji
  WHERE ji.id = ANY(v_item_ids);
  
  -- Generate transfer code using branch-based sequence
  IF v_from_branch_id IS NOT NULL THEN
    v_transfer_code := public.next_branch_code(v_from_branch_id, 'TRF');
  ELSE
    -- For initial imports without source branch, use target branch
    v_transfer_code := public.next_branch_code(v_to_branch_id, 'TRF');
  END IF;
  
  -- Create transfer record
  INSERT INTO public.transfers (
    transfer_code,
    from_branch_id,
    to_branch_id,
    status,
    transfer_date,
    total_items,
    total_cost,
    transferred_by,
    notes,
    purchase_invoice_id,
    created_at
  ) VALUES (
    v_transfer_code,
    v_from_branch_id,
    v_to_branch_id,
    'posted',
    now(),
    v_total_items,
    v_total_cost,
    v_transferred_by,
    v_notes,
    v_purchase_invoice_id,
    now()
  )
  RETURNING id INTO v_transfer_id;
  
  -- Create transfer items
  INSERT INTO public.transfer_items (
    transfer_id,
    item_id,
    item_code,
    weight_grams,
    unit_cost,
    created_at
  )
  SELECT 
    v_transfer_id,
    ji.id,
    ji.item_code,
    ji.weight,
    ji.total_value,
    now()
  FROM public.jewelry_items ji
  WHERE ji.id = ANY(v_item_ids);
  
  -- Update jewelry items branch
  UPDATE public.jewelry_items
  SET branch_id = v_to_branch_id,
      updated_at = now()
  WHERE id = ANY(v_item_ids);
  
  -- Create item movements
  INSERT INTO public.item_movements (
    item_id,
    movement_type,
    reference_type,
    reference_id,
    from_branch_id,
    to_branch_id,
    movement_date,
    notes,
    created_by
  )
  SELECT 
    ji.id,
    'transfer_out',
    v_reference_type,
    v_transfer_id,
    v_from_branch_id,
    v_to_branch_id,
    now(),
    v_notes,
    v_transferred_by
  FROM public.jewelry_items ji
  WHERE ji.id = ANY(v_item_ids);
  
  -- Create accounting entries if both branches have inventory accounts
  SELECT general_inventory_account_id INTO v_from_inventory_account_id
  FROM public.branch_inventory_accounts WHERE branch_id = v_from_branch_id;
  
  SELECT general_inventory_account_id INTO v_to_inventory_account_id
  FROM public.branch_inventory_accounts WHERE branch_id = v_to_branch_id;
  
  IF v_from_inventory_account_id IS NOT NULL AND v_to_inventory_account_id IS NOT NULL AND v_total_cost > 0 THEN
    -- Generate JE number
    SELECT COALESCE(MAX(CAST(SUBSTRING(entry_number FROM '[0-9]+$') AS INTEGER)), 0) + 1
    INTO v_je_number
    FROM public.journal_entries
    WHERE entry_number LIKE 'JE-%';
    
    v_je_number := 'JE-' || LPAD(v_je_number::text, 6, '0');
    
    -- Create journal entry
    INSERT INTO public.journal_entries (
      entry_number,
      entry_date,
      reference_type,
      reference_id,
      description,
      total_debit,
      total_credit,
      status,
      created_by,
      created_at
    ) VALUES (
      v_je_number,
      now(),
      v_reference_type,
      v_transfer_id,
      'تحويل مخزون من ' || COALESCE(v_from_branch_name, 'غير محدد') || ' إلى ' || v_to_branch_name || ' - ' || v_transfer_code,
      v_total_cost,
      v_total_cost,
      'posted',
      v_transferred_by,
      now()
    )
    RETURNING id INTO v_journal_entry_id;
    
    -- Debit destination inventory
    INSERT INTO public.journal_entry_lines (
      journal_entry_id,
      account_id,
      debit_amount,
      credit_amount,
      description
    ) VALUES (
      v_journal_entry_id,
      v_to_inventory_account_id,
      v_total_cost,
      0,
      'استلام مخزون - ' || v_transfer_code
    );
    
    -- Credit source inventory
    INSERT INTO public.journal_entry_lines (
      journal_entry_id,
      account_id,
      debit_amount,
      credit_amount,
      description
    ) VALUES (
      v_journal_entry_id,
      v_from_inventory_account_id,
      0,
      v_total_cost,
      'تحويل مخزون - ' || v_transfer_code
    );
    
    -- Update transfer with journal entry
    UPDATE public.transfers
    SET journal_entry_id = v_journal_entry_id
    WHERE id = v_transfer_id;
  END IF;
  
  -- Return success
  RETURN jsonb_build_object(
    'success', true,
    'transfer_id', v_transfer_id,
    'transfer_code', v_transfer_code,
    'total_items', v_total_items,
    'total_cost', v_total_cost,
    'journal_entry_id', v_journal_entry_id
  );
  
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'error_detail', SQLSTATE
  );
END;
$$;