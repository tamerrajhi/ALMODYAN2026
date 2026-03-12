-- Fix the RPC to use transfer_code column (the actual column in transfers table)
CREATE OR REPLACE FUNCTION public.create_transfer_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_item_ids uuid[];
  v_from_branch_id uuid;
  v_to_branch_id uuid;
  v_notes text;
  v_purchase_invoice_id uuid;
  v_transfer_id uuid;
  v_transfer_code text;
  v_journal_entry_id uuid;
  v_journal_number text;
  v_total_value numeric := 0;
  v_from_account_id uuid;
  v_to_account_id uuid;
  v_item record;
  v_items_count int;
BEGIN
  -- Parse payload
  v_from_branch_id := (p_payload->>'from_branch_id')::uuid;
  v_to_branch_id := (p_payload->>'to_branch_id')::uuid;
  v_notes := p_payload->>'notes';
  v_purchase_invoice_id := (p_payload->>'purchase_invoice_id')::uuid;
  
  SELECT array_agg(x::uuid)
  INTO v_item_ids
  FROM jsonb_array_elements_text(p_payload->'item_ids') x;
  
  v_items_count := array_length(v_item_ids, 1);
  
  IF v_items_count IS NULL OR v_items_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'No items provided');
  END IF;
  
  IF v_to_branch_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target branch required');
  END IF;

  -- Validate items: check sale_status (not status)
  IF EXISTS (
    SELECT 1
    FROM public.jewelry_items ji
    WHERE ji.id = ANY(v_item_ids)
      AND (
        (v_from_branch_id IS NOT NULL AND ji.branch_id IS DISTINCT FROM v_from_branch_id)
        OR COALESCE(ji.sale_status, 'available') = 'sold'
      )
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'بعض القطع مباعة أو ليست في الفرع المصدر'
    );
  END IF;

  -- Generate transfer code
  SELECT public.generate_document_code('TRF') INTO v_transfer_code;
  
  -- Create transfer header
  INSERT INTO public.transfers (
    id, transfer_code, from_branch_id, to_branch_id, 
    status, notes, purchase_invoice_id, transfer_date, created_at, total_items
  ) VALUES (
    gen_random_uuid(), v_transfer_code, v_from_branch_id, v_to_branch_id,
    'completed', v_notes, v_purchase_invoice_id, now(), now(), v_items_count
  )
  RETURNING id INTO v_transfer_id;

  -- Insert transfer items and calculate total value
  FOR v_item IN
    SELECT ji.id, ji.item_code, ji.total_price, ji.branch_id as old_branch_id
    FROM public.jewelry_items ji
    WHERE ji.id = ANY(v_item_ids)
    FOR UPDATE
  LOOP
    -- Insert transfer item
    INSERT INTO public.transfer_items (
      transfer_id, jewelry_item_id, item_code
    ) VALUES (
      v_transfer_id, v_item.id, v_item.item_code
    );
    
    -- Record item movement
    INSERT INTO public.item_movements (
      jewelry_item_id, movement_type, from_branch_id, to_branch_id,
      reference_type, reference_id, notes, movement_date
    ) VALUES (
      v_item.id, 'transfer', v_item.old_branch_id, v_to_branch_id,
      'transfer', v_transfer_id, v_notes, now()
    );
    
    -- Update jewelry item branch
    UPDATE public.jewelry_items
    SET branch_id = v_to_branch_id, updated_at = now()
    WHERE id = v_item.id;
    
    v_total_value := v_total_value + COALESCE(v_item.total_price, 0);
  END LOOP;

  -- Update transfer total cost
  UPDATE public.transfers SET total_cost = v_total_value WHERE id = v_transfer_id;

  -- Create journal entry if we have branch inventory accounts
  SELECT bia.general_inventory_account_id INTO v_from_account_id
  FROM public.branch_inventory_accounts bia
  WHERE bia.branch_id = v_from_branch_id;
  
  SELECT bia.general_inventory_account_id INTO v_to_account_id
  FROM public.branch_inventory_accounts bia
  WHERE bia.branch_id = v_to_branch_id;

  IF v_from_account_id IS NOT NULL AND v_to_account_id IS NOT NULL AND v_total_value > 0 THEN
    SELECT public.generate_document_code('JE') INTO v_journal_number;
    
    INSERT INTO public.journal_entries (
      id, entry_number, entry_date, description, reference_type, reference_id,
      total_debit, total_credit, status, branch_id, created_at
    ) VALUES (
      gen_random_uuid(), v_journal_number, now(), 
      'قيد نقل مخزون - ' || v_transfer_code,
      'transfer', v_transfer_id,
      v_total_value, v_total_value, 'posted', v_to_branch_id, now()
    )
    RETURNING id INTO v_journal_entry_id;

    -- Debit destination inventory
    INSERT INTO public.journal_entry_lines (
      journal_entry_id, account_id, debit, credit, description
    ) VALUES (
      v_journal_entry_id, v_to_account_id, v_total_value, 0,
      'استلام مخزون من نقل'
    );
    
    -- Credit source inventory
    INSERT INTO public.journal_entry_lines (
      journal_entry_id, account_id, debit, credit, description
    ) VALUES (
      v_journal_entry_id, v_from_account_id, 0, v_total_value,
      'صرف مخزون لنقل'
    );

    -- Link transfer to journal
    UPDATE public.transfers
    SET journal_entry_id = v_journal_entry_id
    WHERE id = v_transfer_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'transfer_id', v_transfer_id,
    'transfer_number', v_transfer_code,
    'items_count', v_items_count,
    'total_value', v_total_value,
    'journal_entry_id', v_journal_entry_id,
    'journal_number', v_journal_number
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'detail', SQLSTATE
  );
END;
$$;