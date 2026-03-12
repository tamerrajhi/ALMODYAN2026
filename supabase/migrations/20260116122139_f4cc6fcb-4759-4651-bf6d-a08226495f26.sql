
-- Fix create_transfer_atomic to use correct column names
CREATE OR REPLACE FUNCTION public.create_transfer_atomic(
  p_from_branch_id uuid,
  p_to_branch_id uuid,
  p_item_ids uuid[],
  p_notes text DEFAULT NULL,
  p_purchase_invoice_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_transfer_id uuid;
  v_transfer_code text;
  v_total_items integer;
  v_total_cost numeric := 0;
  v_journal_entry_id uuid;
  v_journal_number text;
  v_transferred_by uuid;
  v_transferred_by_name text;
  v_from_branch_name text;
  v_to_branch_name text;
  v_from_account_id uuid;
  v_to_account_id uuid;
  v_item_ids uuid[];
  v_invalid_items uuid[];
BEGIN
  -- Get current user
  v_transferred_by := auth.uid();
  
  SELECT full_name INTO v_transferred_by_name
  FROM public.profiles
  WHERE id = v_transferred_by;

  -- Validate branches
  IF p_from_branch_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Source branch is required'
    );
  END IF;

  IF p_to_branch_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Destination branch is required'
    );
  END IF;

  IF p_from_branch_id = p_to_branch_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Source and destination branches must be different'
    );
  END IF;

  -- Get branch names
  SELECT branch_name INTO v_from_branch_name
  FROM public.branches WHERE id = p_from_branch_id;
  
  SELECT branch_name INTO v_to_branch_name
  FROM public.branches WHERE id = p_to_branch_id;

  -- Get inventory accounts for branches
  SELECT general_inventory_account_id INTO v_from_account_id
  FROM public.branch_inventory_accounts
  WHERE branch_id = p_from_branch_id;

  SELECT general_inventory_account_id INTO v_to_account_id
  FROM public.branch_inventory_accounts
  WHERE branch_id = p_to_branch_id;

  -- Validate and lock items
  SELECT array_agg(ji.id)
  INTO v_item_ids
  FROM public.jewelry_items ji
  WHERE ji.id = ANY(p_item_ids)
    AND ji.branch_id = p_from_branch_id
    AND COALESCE(ji.sale_status, 'available') <> 'sold'
  FOR UPDATE;

  v_total_items := COALESCE(array_length(v_item_ids, 1), 0);

  IF v_total_items = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No valid items found for transfer'
    );
  END IF;

  -- Calculate total cost using correct column name (cost instead of total_value)
  SELECT COALESCE(SUM(COALESCE(ji.cost, 0)), 0)
  INTO v_total_cost
  FROM public.jewelry_items ji
  WHERE ji.id = ANY(v_item_ids);

  -- Generate transfer code using branch-specific sequence
  v_transfer_code := public.next_branch_code(p_from_branch_id, 'TRF');

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
    p_from_branch_id,
    p_to_branch_id,
    'posted',
    now(),
    v_total_items,
    v_total_cost,
    v_transferred_by,
    p_notes,
    p_purchase_invoice_id,
    now()
  )
  RETURNING id INTO v_transfer_id;

  -- Create transfer items using correct column names (g_weight instead of weight, cost instead of total_value)
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
    ji.cost,
    now()
  FROM public.jewelry_items ji
  WHERE ji.id = ANY(v_item_ids);

  -- Update jewelry items branch
  UPDATE public.jewelry_items
  SET 
    branch_id = p_to_branch_id,
    updated_at = now()
  WHERE id = ANY(v_item_ids);

  -- Create item movements
  INSERT INTO public.item_movements (
    item_id,
    item_code,
    movement_type,
    from_branch_id,
    to_branch_id,
    reference_type,
    reference_id,
    performed_by,
    notes,
    movement_date,
    created_at
  )
  SELECT
    ji.id,
    ji.item_code,
    'transfer',
    p_from_branch_id,
    p_to_branch_id,
    'transfer',
    v_transfer_id,
    v_transferred_by,
    p_notes,
    now(),
    now()
  FROM public.jewelry_items ji
  WHERE ji.id = ANY(v_item_ids);

  -- Create journal entry if accounts are configured
  IF v_from_account_id IS NOT NULL AND v_to_account_id IS NOT NULL AND v_total_cost > 0 THEN
    v_journal_number := public.next_sequence_number('journal_entry');
    
    INSERT INTO public.journal_entries (
      entry_number,
      entry_date,
      description,
      reference_type,
      reference_id,
      total_debit,
      total_credit,
      status,
      created_by,
      created_at
    ) VALUES (
      v_journal_number,
      now(),
      'نقل مخزون من ' || v_from_branch_name || ' إلى ' || v_to_branch_name,
      'transfer',
      v_transfer_id,
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
      debit,
      credit,
      description,
      created_at
    ) VALUES (
      v_journal_entry_id,
      v_to_account_id,
      v_total_cost,
      0,
      'استلام مخزون من ' || v_from_branch_name,
      now()
    );

    -- Credit source inventory
    INSERT INTO public.journal_entry_lines (
      journal_entry_id,
      account_id,
      debit,
      credit,
      description,
      created_at
    ) VALUES (
      v_journal_entry_id,
      v_from_account_id,
      0,
      v_total_cost,
      'نقل مخزون إلى ' || v_to_branch_name,
      now()
    );

    -- Update transfer with journal entry
    UPDATE public.transfers
    SET journal_entry_id = v_journal_entry_id
    WHERE id = v_transfer_id;

    -- Link item movements to journal entry
    UPDATE public.item_movements
    SET journal_entry_id = v_journal_entry_id
    WHERE reference_type = 'transfer'
      AND reference_id = v_transfer_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'transfer_id', v_transfer_id,
    'transfer_code', v_transfer_code,
    'total_items', v_total_items,
    'total_cost', v_total_cost,
    'journal_entry_id', v_journal_entry_id,
    'journal_number', v_journal_number
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM
  );
END;
$$;
