-- PRODUCT_CREATE_ATOMIC: Atomic RPC to create a product row
-- Idempotent: CREATE OR REPLACE
-- Called via Group 3 jsonb handler — receives all p_* params as a single jsonb

CREATE OR REPLACE FUNCTION public.product_create_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_client_req_id text := p_payload->>'p_client_request_id';
  v_name_ar text := NULLIF(trim(p_payload->>'p_name_ar'), '');
  v_name_en text := NULLIF(trim(p_payload->>'p_name_en'), '');
  v_description text := NULLIF(trim(p_payload->>'p_description'), '');
  v_product_type text := COALESCE(NULLIF(trim(p_payload->>'p_product_type'), ''), 'general');
  v_product_sub_type text := NULLIF(trim(p_payload->>'p_product_sub_type'), '');
  v_category text := NULLIF(trim(p_payload->>'p_category'), '');
  v_unit text := COALESCE(NULLIF(trim(p_payload->>'p_unit'), ''), 'piece');
  v_barcode text := NULLIF(trim(p_payload->>'p_barcode'), '');
  v_sku text := NULLIF(trim(p_payload->>'p_sku'), '');
  v_cost_price numeric := COALESCE((p_payload->>'p_cost_price')::numeric, 0);
  v_selling_price numeric := COALESCE((p_payload->>'p_selling_price')::numeric, 0);
  v_min_price numeric := (p_payload->>'p_min_price')::numeric;
  v_tax_rate numeric := COALESCE((p_payload->>'p_tax_rate')::numeric, 15);
  v_is_tax_inclusive boolean := COALESCE((p_payload->>'p_is_tax_inclusive')::boolean, false);
  v_is_service boolean := COALESCE((p_payload->>'p_is_service')::boolean, false);
  v_inventory_account_id uuid := NULLIF(p_payload->>'p_inventory_account_id','')::uuid;
  v_expense_account_id uuid := NULLIF(p_payload->>'p_expense_account_id','')::uuid;
  v_default_warehouse_id uuid := NULLIF(p_payload->>'p_default_warehouse_id','')::uuid;
  v_new_id uuid;
  v_product_code text;
  v_next_seq int;
BEGIN
  -- Validate required fields
  IF v_name_ar IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'اسم المنتج بالعربي مطلوب'
    );
  END IF;

  -- Idempotency check
  IF v_client_req_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM atomic_workflow_requests WHERE client_request_id = v_client_req_id) THEN
      RETURN jsonb_build_object(
        'success', true,
        'product_id', (SELECT (result_payload->>'product_id')::uuid FROM atomic_workflow_requests WHERE client_request_id = v_client_req_id),
        'product_code', (SELECT result_payload->>'product_code' FROM atomic_workflow_requests WHERE client_request_id = v_client_req_id),
        'idempotent_hit', true
      );
    END IF;
  END IF;

  -- Generate next product code (PRD-NNNN)
  SELECT COALESCE(MAX(NULLIF(regexp_replace(product_code, '^PRD-', ''), product_code)::int), 0) + 1
    INTO v_next_seq
    FROM products
    WHERE product_code ~ '^PRD-[0-9]+$';
  v_product_code := 'PRD-' || LPAD(v_next_seq::text, 4, '0');

  -- Duplicate barcode check
  IF v_barcode IS NOT NULL AND EXISTS (SELECT 1 FROM products WHERE barcode = v_barcode) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'الباركود مستخدم بالفعل في منتج آخر'
    );
  END IF;

  -- Duplicate SKU check
  IF v_sku IS NOT NULL AND EXISTS (SELECT 1 FROM products WHERE sku = v_sku) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'رمز SKU مستخدم بالفعل في منتج آخر'
    );
  END IF;

  -- Insert product
  INSERT INTO products (
    id, product_code, name_ar, name_en, description,
    product_type, product_sub_type, category, unit,
    barcode, sku,
    cost_price, selling_price, min_price,
    tax_rate, is_tax_inclusive, is_service,
    inventory_account_id, expense_account_id, default_warehouse_id,
    is_active
  ) VALUES (
    gen_random_uuid(), v_product_code, v_name_ar, v_name_en, v_description,
    v_product_type, v_product_sub_type, v_category, v_unit,
    v_barcode, v_sku,
    v_cost_price, v_selling_price, v_min_price,
    v_tax_rate, v_is_tax_inclusive, v_is_service,
    v_inventory_account_id, v_expense_account_id, v_default_warehouse_id,
    true
  )
  RETURNING id INTO v_new_id;

  -- Record idempotency
  IF v_client_req_id IS NOT NULL THEN
    INSERT INTO atomic_workflow_requests (client_request_id, workflow_type, status, result_payload)
    VALUES (v_client_req_id, 'product_create_atomic', 'completed', jsonb_build_object(
      'product_id', v_new_id,
      'product_code', v_product_code
    ))
    ON CONFLICT (client_request_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'product_id', v_new_id,
    'product_code', v_product_code
  );

EXCEPTION WHEN others THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM
  );
END;
$$;
