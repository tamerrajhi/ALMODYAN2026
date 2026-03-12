-- =====================================================
-- Fix remaining legacy overloads that still use status
-- =====================================================

-- =====================================================
-- Fix: complete_purchase_invoice_atomic(p_invoice_id uuid, p_items jsonb, p_user_id uuid, p_user_name text)
-- =====================================================
CREATE OR REPLACE FUNCTION public.complete_purchase_invoice_atomic(p_invoice_id uuid, p_items jsonb, p_user_id uuid, p_user_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    
    -- FIX: Changed status → sale_status, added is_available_for_sale
    UPDATE jewelry_items
    SET 
      sale_status = 'available',
      is_available_for_sale = true,
      branch_id = v_branch_id,
      updated_at = now()
    WHERE id = v_jewelry_item_id;
    
    IF FOUND THEN
      -- Insert movement record
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
$function$;

-- =====================================================
-- Fix: complete_sales_invoice_atomic(p_sale_id uuid, p_items jsonb, p_user_id uuid, p_user_name text)
-- =====================================================
CREATE OR REPLACE FUNCTION public.complete_sales_invoice_atomic(p_sale_id uuid, p_items jsonb, p_user_id uuid, p_user_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    
    -- FIX: Changed status → sale_status, added is_available_for_sale
    UPDATE jewelry_items
    SET 
      sale_status = 'sold',
      is_available_for_sale = false,
      updated_at = now()
    WHERE id = v_jewelry_item_id
      AND sale_status = 'available';  -- FIX: Changed from status to sale_status
    
    IF FOUND THEN
      -- Insert movement record
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
$function$;