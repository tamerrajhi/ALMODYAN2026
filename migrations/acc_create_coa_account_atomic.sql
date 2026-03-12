-- ACC-COA-WRITE-2: Atomic RPC to create a chart_of_accounts row
-- Idempotent: CREATE OR REPLACE

CREATE OR REPLACE FUNCTION public.create_chart_of_account_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_code text := NULLIF(trim(p_payload->>'account_code'), '');
  v_name text := NULLIF(trim(p_payload->>'account_name'), '');
  v_name_en text := NULLIF(trim(p_payload->>'account_name_en'), '');
  v_type text := NULLIF(trim(p_payload->>'account_type'), '');
  v_parent uuid := NULLIF(p_payload->>'parent_id','')::uuid;
  v_new_id uuid;
BEGIN
  IF v_code IS NULL OR v_name IS NULL OR v_type IS NULL THEN
    RETURN jsonb_build_object('data', null, 'error', jsonb_build_object(
      'code','VALIDATION_ERROR','message','بيانات الحساب غير مكتملة'
    ));
  END IF;

  IF EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = v_code) THEN
    RETURN jsonb_build_object('data', null, 'error', jsonb_build_object(
      'code','DUPLICATE_CODE','message','رقم الحساب موجود بالفعل'
    ));
  END IF;

  IF v_parent IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE id = v_parent) THEN
    RETURN jsonb_build_object('data', null, 'error', jsonb_build_object(
      'code','PARENT_NOT_FOUND','message','الحساب الأب غير موجود'
    ));
  END IF;

  INSERT INTO chart_of_accounts (
    id, account_code, account_name, account_name_en, account_type, parent_id, is_active
  )
  VALUES (
    gen_random_uuid(), v_code, v_name, v_name_en, v_type::account_type, v_parent, true
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('data', jsonb_build_object(
    'success', true,
    'id', v_new_id,
    'account_code', v_code
  ), 'error', null);

EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('data', null, 'error', jsonb_build_object(
    'code','SERVER_ERROR','message', SQLERRM
  ));
END;
$$;
