
-- FIX: Replace status with sale_status in create_transfer_atomic
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
  v_created_by text;
  v_transfer_id uuid;
  v_transfer_number text;
  v_from_branch_name text;
  v_to_branch_name text;
  v_total_cost numeric := 0;
  v_items_count int := 0;
  v_journal_entry_id uuid;
  v_journal_number text;
  v_from_inventory_account_id uuid;
  v_to_inventory_account_id uuid;
  v_items jsonb := '[]'::jsonb;
  v_item_record record;
BEGIN
  -- 1) Extract parameters
  v_from_branch_id := (p_payload->>'from_branch_id')::uuid;
  v_to_branch_id := (p_payload->>'to_branch_id')::uuid;
  v_notes := p_payload->>'notes';
  v_created_by := COALESCE(p_payload->>'created_by', 'user');
  
  -- Extract item_ids array
  SELECT array_agg(x::uuid)
  INTO v_item_ids
  FROM jsonb_array_elements_text(p_payload->'item_ids') x;

  -- 2) Validate inputs
  IF v_from_branch_id IS NULL OR v_to_branch_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'from_branch_id and to_branch_id are required');
  END IF;

  IF v_from_branch_id = v_to_branch_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot transfer to same branch');
  END IF;

  IF v_item_ids IS NULL OR array_length(v_item_ids, 1) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'at least one item is required');
  END IF;

  -- 3) Get branch names
  SELECT branch_name INTO v_from_branch_name FROM public.branches WHERE id = v_from_branch_id;
  SELECT branch_name INTO v_to_branch_name FROM public.branches WHERE id = v_to_branch_id;

  IF v_from_branch_name IS NULL OR v_to_branch_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid branch ID');
  END IF;

  -- 4) ✅ FIX: Validate items exist, belong to source branch, and are not sold
  -- Changed: status -> sale_status (status column does not exist)
  IF EXISTS (
    SELECT 1 FROM public.jewelry_items 
    WHERE id = ANY(v_item_ids) 
    AND (branch_id != v_from_branch_id OR COALESCE(sale_status, 'available') = 'sold')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Some items are sold or not in source branch');
  END IF;

  -- 5) Lock items FOR UPDATE to prevent concurrent modifications
  PERFORM id FROM public.jewelry_items WHERE id = ANY(v_item_ids) FOR UPDATE;

  -- 6) Calculate total cost and count
  SELECT COALESCE(SUM(cost), 0), COUNT(*)
  INTO v_total_cost, v_items_count
  FROM public.jewelry_items
  WHERE id = ANY(v_item_ids);

  -- 7) Generate transfer number
  v_transfer_number := public.generate_document_code('TRF');

  -- 8) Create transfer record
  INSERT INTO public.transfers (
    transfer_number,
    from_branch_id,
    to_branch_id,
    status,
    notes,
    created_by,
    total_items,
    total_cost
  ) VALUES (
    v_transfer_number,
    v_from_branch_id,
    v_to_branch_id,
    'completed',
    v_notes,
    v_created_by,
    v_items_count,
    v_total_cost
  ) RETURNING id INTO v_transfer_id;

  -- 9) Create item movements
  INSERT INTO public.item_movements (
    item_id,
    movement_type,
    reference_type,
    reference_id,
    from_branch_id,
    to_branch_id,
    cost,
    movement_date,
    notes,
    performed_by
  )
  SELECT 
    ji.id,
    'TRANSFER',
    'transfer',
    v_transfer_id,
    v_from_branch_id,
    v_to_branch_id,
    ji.cost,
    now(),
    v_notes,
    v_created_by
  FROM public.jewelry_items ji
  WHERE ji.id = ANY(v_item_ids);

  -- 10) Update jewelry items branch
  UPDATE public.jewelry_items
  SET branch_id = v_to_branch_id,
      updated_at = now()
  WHERE id = ANY(v_item_ids);

  -- 11) Create journal entry if cost > 0
  IF v_total_cost > 0 THEN
    -- Get inventory accounts for both branches
    SELECT general_inventory_account_id INTO v_from_inventory_account_id
    FROM public.branch_inventory_accounts WHERE branch_id = v_from_branch_id;
    
    SELECT general_inventory_account_id INTO v_to_inventory_account_id
    FROM public.branch_inventory_accounts WHERE branch_id = v_to_branch_id;

    -- Fallback to default inventory account if not configured
    IF v_from_inventory_account_id IS NULL THEN
      SELECT id INTO v_from_inventory_account_id FROM public.chart_of_accounts WHERE account_code = '1301' LIMIT 1;
    END IF;
    IF v_to_inventory_account_id IS NULL THEN
      SELECT id INTO v_to_inventory_account_id FROM public.chart_of_accounts WHERE account_code = '1301' LIMIT 1;
    END IF;

    -- Only create journal if we have valid accounts
    IF v_from_inventory_account_id IS NOT NULL AND v_to_inventory_account_id IS NOT NULL THEN
      -- Generate journal number
      v_journal_number := public.generate_document_code('JV');

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
        created_by
      ) VALUES (
        v_journal_number,
        CURRENT_DATE,
        'transfer',
        v_transfer_id,
        'قيد نقل بضاعة من ' || v_from_branch_name || ' إلى ' || v_to_branch_name || ' - ' || v_transfer_number,
        v_total_cost,
        v_total_cost,
        'posted',
        v_created_by
      ) RETURNING id INTO v_journal_entry_id;

      -- Create journal lines
      INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
      VALUES 
        (v_journal_entry_id, v_to_inventory_account_id, v_total_cost, 0, 'مخزون ' || v_to_branch_name),
        (v_journal_entry_id, v_from_inventory_account_id, 0, v_total_cost, 'مخزون ' || v_from_branch_name);

      -- Update transfer with journal entry
      UPDATE public.transfers SET journal_entry_id = v_journal_entry_id WHERE id = v_transfer_id;
    END IF;
  END IF;

  -- 12) Build items array for response
  FOR v_item_record IN
    SELECT id, item_code, cost FROM public.jewelry_items WHERE id = ANY(v_item_ids)
  LOOP
    v_items := v_items || jsonb_build_object(
      'id', v_item_record.id,
      'item_code', v_item_record.item_code,
      'cost', v_item_record.cost
    );
  END LOOP;

  -- 13) Return success
  RETURN jsonb_build_object(
    'success', true,
    'transfer_id', v_transfer_id,
    'transfer_number', v_transfer_number,
    'journal_entry_id', v_journal_entry_id,
    'journal_number', v_journal_number,
    'items_count', v_items_count,
    'total_cost', v_total_cost,
    'from_branch', v_from_branch_name,
    'to_branch', v_to_branch_name,
    'items', v_items
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'detail', SQLSTATE
  );
END;
$$;
