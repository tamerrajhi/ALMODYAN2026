-- Fix: Replace 'created_by' with 'performed_by' in item_movements INSERT
CREATE OR REPLACE FUNCTION public.create_transfer_atomic(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_transfer_id uuid;
  v_transfer_code text;
  v_from_branch_id uuid;
  v_to_branch_id uuid;
  v_from_branch_name text;
  v_to_branch_name text;
  v_item_ids uuid[];
  v_total_items integer;
  v_total_cost numeric := 0;
  v_notes text;
  v_transferred_by uuid;
  v_purchase_invoice_id uuid;
  v_invalid_items text[];
  v_reference_type text;
  v_journal_entry_id uuid;
  v_je_number text;
  v_from_inventory_account_id uuid;
  v_to_inventory_account_id uuid;
BEGIN
  -- Extract parameters from payload
  v_from_branch_id := (p_payload->>'from_branch_id')::uuid;
  v_to_branch_id := (p_payload->>'to_branch_id')::uuid;
  v_notes := p_payload->>'notes';
  v_transferred_by := (p_payload->>'transferred_by')::uuid;
  v_purchase_invoice_id := (p_payload->>'purchase_invoice_id')::uuid;
  
  -- Extract item_ids array
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
  
  -- Lock and validate items - use sale_status instead of status
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
  SELECT COALESCE(SUM(COALESCE(ji.cost, 0)), 0)
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
    ji.g_weight,
    COALESCE(ji.cost, 0),
    now()
  FROM public.jewelry_items ji
  WHERE ji.id = ANY(v_item_ids);
  
  -- Update jewelry items branch
  UPDATE public.jewelry_items
  SET branch_id = v_to_branch_id,
      updated_at = now()
  WHERE id = ANY(v_item_ids);
  
  -- Create item movements (FIXED: use performed_by instead of created_by)
  INSERT INTO public.item_movements (
    item_id,
    movement_type,
    reference_type,
    reference_id,
    from_branch_id,
    to_branch_id,
    movement_date,
    notes,
    performed_by
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
  
  -- ==========================================
  -- PATCHED: Fallback Logic for inventory accounts
  -- Prefer general_inventory_account_id, fallback to imported_pieces_account_id
  -- ==========================================
  SELECT COALESCE(general_inventory_account_id, imported_pieces_account_id) 
  INTO v_from_inventory_account_id
  FROM public.branch_inventory_accounts 
  WHERE branch_id = v_from_branch_id;
  
  SELECT COALESCE(general_inventory_account_id, imported_pieces_account_id) 
  INTO v_to_inventory_account_id
  FROM public.branch_inventory_accounts 
  WHERE branch_id = v_to_branch_id;
  
  -- Create accounting entries if both branches have inventory accounts and cost > 0
  IF v_from_inventory_account_id IS NOT NULL AND v_to_inventory_account_id IS NOT NULL AND v_total_cost > 0 THEN
    -- Generate JE number
    v_je_number := public.next_branch_code(COALESCE(v_from_branch_id, v_to_branch_id), 'JE');
    
    -- Create journal entry
    INSERT INTO public.journal_entries (
      entry_number,
      entry_date,
      reference_type,
      reference_id,
      description,
      total_debit,
      total_credit,
      is_posted,
      posted_at,
      posted_by,
      branch_id,
      created_by
    ) VALUES (
      v_je_number,
      now(),
      v_reference_type,
      v_transfer_id,
      'قيد نقل مخزون: ' || COALESCE(v_from_branch_name, 'مستودع خارجي') || ' → ' || v_to_branch_name,
      v_total_cost,
      v_total_cost,
      true,
      now(),
      v_transferred_by,
      COALESCE(v_from_branch_id, v_to_branch_id),
      v_transferred_by
    )
    RETURNING id INTO v_journal_entry_id;
    
    -- Create journal entry lines
    -- Debit: To-branch inventory (increase)
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
      'زيادة مخزون ' || v_to_branch_name
    );
    
    -- Credit: From-branch inventory (decrease)
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
      'نقص مخزون ' || COALESCE(v_from_branch_name, 'مستودع خارجي')
    );
    
    -- Update transfer with journal entry
    UPDATE public.transfers
    SET journal_entry_id = v_journal_entry_id
    WHERE id = v_transfer_id;
  END IF;
  
  -- Return success with all relevant IDs
  RETURN jsonb_build_object(
    'success', true,
    'transfer_id', v_transfer_id,
    'transfer_code', v_transfer_code,
    'journal_entry_id', v_journal_entry_id,
    'total_items', v_total_items,
    'total_cost', v_total_cost
  );
  
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'error_detail', SQLSTATE
  );
END;
$function$;