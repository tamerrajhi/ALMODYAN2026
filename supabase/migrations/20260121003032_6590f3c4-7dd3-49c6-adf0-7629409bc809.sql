-- ============================================================
-- STAGE-1 FIX PACK - REMAINING FIXES + GATE INSTALLATION
-- ============================================================

-- ============================================================
-- FIX #1: complete_purchase_return_unique_items_atomic
-- REMOVE: quantity column
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_purchase_return_unique_items_atomic(
  p_return_id uuid,
  p_items jsonb,
  p_user_id uuid,
  p_user_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_jewelry_item_id uuid;
  v_branch_id uuid;
  v_supplier_id uuid;
  v_return_number text;
  v_return_date date;
  v_updated_count int := 0;
BEGIN
  -- Get return details
  SELECT 
    pr.branch_id,
    pr.supplier_id,
    pr.return_number,
    pr.return_date
  INTO v_branch_id, v_supplier_id, v_return_number, v_return_date
  FROM purchase_returns pr
  WHERE pr.id = p_return_id;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Purchase return not found: %', p_return_id;
  END IF;

  -- Process each item
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_jewelry_item_id := (v_item->>'jewelry_item_id')::uuid;
    
    -- Update jewelry item status
    UPDATE jewelry_items
    SET 
      status = 'returned_to_supplier',
      updated_at = now()
    WHERE id = v_jewelry_item_id
      AND status = 'available';
    
    IF FOUND THEN
      -- Insert movement record (WITHOUT quantity - it's a phantom column)
      INSERT INTO public.item_movements (
        item_id,
        movement_type,
        reference_type,
        reference_id,
        from_branch_id,
        notes,
        performed_by,
        created_at
      ) VALUES (
        v_jewelry_item_id,
        'purchase_return',
        'purchase_return',
        p_return_id,
        v_branch_id,
        'Return: ' || v_return_number,
        p_user_id,
        now()
      );
      
      v_updated_count := v_updated_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'updated_count', v_updated_count,
    'return_id', p_return_id
  );
END;
$$;

-- ============================================================
-- FIX #2: complete_purchase_invoice_atomic
-- REMOVE: quantity, RENAME: value_amount -> cost
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_purchase_invoice_atomic(
  p_invoice_id uuid,
  p_items jsonb,
  p_user_id uuid,
  p_user_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_jewelry_item_id uuid;
  v_branch_id uuid;
  v_supplier_id uuid;
  v_invoice_number text;
  v_cost numeric;
  v_processed_count int := 0;
BEGIN
  -- Get invoice details
  SELECT 
    i.branch_id,
    i.supplier_id,
    i.invoice_number
  INTO v_branch_id, v_supplier_id, v_invoice_number
  FROM invoices i
  WHERE i.id = p_invoice_id;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Invoice not found: %', p_invoice_id;
  END IF;

  -- Process each item
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_jewelry_item_id := (v_item->>'jewelry_item_id')::uuid;
    v_cost := COALESCE((v_item->>'cost')::numeric, (v_item->>'value_amount')::numeric, 0);
    
    -- Update jewelry item
    UPDATE jewelry_items
    SET 
      status = 'available',
      branch_id = v_branch_id,
      updated_at = now()
    WHERE id = v_jewelry_item_id;
    
    IF FOUND THEN
      -- Insert movement record (WITHOUT quantity, using cost instead of value_amount)
      INSERT INTO public.item_movements (
        item_id,
        movement_type,
        reference_type,
        reference_id,
        to_branch_id,
        cost,
        notes,
        performed_by,
        created_at
      ) VALUES (
        v_jewelry_item_id,
        'purchase',
        'purchase_invoice',
        p_invoice_id,
        v_branch_id,
        v_cost,
        'Invoice: ' || v_invoice_number,
        p_user_id,
        now()
      );
      
      v_processed_count := v_processed_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'processed_count', v_processed_count,
    'invoice_id', p_invoice_id
  );
END;
$$;

-- ============================================================
-- FIX #3: complete_sales_invoice_atomic
-- REMOVE: quantity column
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_sales_invoice_atomic(
  p_sale_id uuid,
  p_items jsonb,
  p_user_id uuid,
  p_user_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_jewelry_item_id uuid;
  v_branch_id uuid;
  v_customer_id uuid;
  v_sale_number text;
  v_cost numeric;
  v_sold_count int := 0;
BEGIN
  -- Get sale details
  SELECT 
    s.branch_id,
    s.customer_id,
    s.sale_number
  INTO v_branch_id, v_customer_id, v_sale_number
  FROM sales s
  WHERE s.id = p_sale_id;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Sale not found: %', p_sale_id;
  END IF;

  -- Process each item
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_jewelry_item_id := (v_item->>'jewelry_item_id')::uuid;
    v_cost := COALESCE((v_item->>'cost')::numeric, 0);
    
    -- Update jewelry item status
    UPDATE jewelry_items
    SET 
      status = 'sold',
      updated_at = now()
    WHERE id = v_jewelry_item_id
      AND status = 'available';
    
    IF FOUND THEN
      -- Insert movement record (WITHOUT quantity)
      INSERT INTO public.item_movements (
        item_id,
        movement_type,
        reference_type,
        reference_id,
        from_branch_id,
        cost,
        notes,
        performed_by,
        created_at
      ) VALUES (
        v_jewelry_item_id,
        'sale',
        'sale',
        p_sale_id,
        v_branch_id,
        v_cost,
        'Sale: ' || v_sale_number,
        p_user_id,
        now()
      );
      
      v_sold_count := v_sold_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'sold_count', v_sold_count,
    'sale_id', p_sale_id
  );
END;
$$;

-- ============================================================
-- GATE VIEW: Detect item_movements contract violations
-- ============================================================
CREATE OR REPLACE VIEW public.gate_item_movements_contract_violations AS
WITH writers AS (
  SELECT
    p.oid,
    n.nspname,
    p.proname,
    p.prosrc
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND (p.prosrc ILIKE '%item_movements%')
),
violations AS (
  -- Check for phantom column: quantity
  SELECT proname, 'PHANTOM_COLUMN_QUANTITY' AS issue
  FROM writers
  WHERE prosrc ILIKE '%INSERT INTO%item_movements%'
    AND prosrc ~* 'quantity[^a-z_]'
    AND prosrc NOT ILIKE '%-- removed quantity%'
  UNION ALL
  -- Check for phantom column: item_code
  SELECT proname, 'PHANTOM_COLUMN_ITEM_CODE' AS issue
  FROM writers
  WHERE prosrc ILIKE '%INSERT INTO%item_movements%'
    AND prosrc ~* '[^a-z_]item_code[^a-z_]'
  UNION ALL
  -- Check for wrong column: jewelry_item_id (should be item_id)
  SELECT proname, 'WRONG_COLUMN_JEWELRY_ITEM_ID' AS issue
  FROM writers
  WHERE prosrc ILIKE '%INSERT INTO%item_movements%'
    AND prosrc ~* 'jewelry_item_id'
  UNION ALL
  -- Check for non-standard cost naming
  SELECT proname, 'NON_STANDARD_COST_NAMING' AS issue
  FROM writers
  WHERE prosrc ILIKE '%INSERT INTO%item_movements%'
    AND (
      prosrc ~* '[^a-z_]unit_cost[^a-z_]'
      OR prosrc ~* '[^a-z_]sale_price[^a-z_]'
      OR prosrc ~* '[^a-z_]value_amount[^a-z_]'
    )
    AND prosrc NOT ILIKE '%COALESCE%value_amount%'  -- Allow reading value_amount from input
)
SELECT * FROM violations;

-- Grant access
GRANT SELECT ON public.gate_item_movements_contract_violations TO authenticated;
GRANT SELECT ON public.gate_item_movements_contract_violations TO anon;