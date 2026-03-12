-- Modify branch_create_atomic to auto-provision COA after branch insert
-- Same transaction = atomic: if provisioning fails, branch insert rolls back
CREATE OR REPLACE FUNCTION public.branch_create_atomic(
  p_client_request_id text,
  p_code text,
  p_name text,
  p_name_en text DEFAULT NULL,
  p_branch_type text DEFAULT 'jewelry',
  p_address text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_is_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_existing jsonb;
  v_branch_id uuid;
  v_result jsonb;
  v_coa_result jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM atomic_workflow_requests WHERE client_request_id = p_client_request_id AND workflow_type = 'branch_create' AND status = 'completed') THEN
    SELECT result_payload INTO v_existing FROM atomic_workflow_requests WHERE client_request_id = p_client_request_id AND workflow_type = 'branch_create' AND status = 'completed';
    RETURN jsonb_build_object('success', true, 'cached', true, 'branch_id', v_existing->>'branch_id', 'branch_code', v_existing->>'branch_code');
  END IF;

  IF p_code IS NULL OR trim(p_code) = '' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'error', 'كود الفرع مطلوب');
  END IF;
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'error', 'اسم الفرع مطلوب');
  END IF;

  IF EXISTS (SELECT 1 FROM branches WHERE code = p_code) THEN
    RETURN jsonb_build_object('success', false, 'error_code', '23505', 'error', 'كود الفرع مستخدم بالفعل');
  END IF;

  INSERT INTO atomic_workflow_requests (client_request_id, workflow_type, status, request_payload)
  VALUES (p_client_request_id, 'branch_create', 'processing', jsonb_build_object('code', p_code, 'name', p_name))
  ON CONFLICT (client_request_id) DO NOTHING;

  INSERT INTO branches (code, name, name_en, branch_type, address, phone, is_active, is_main)
  VALUES (
    trim(p_code),
    trim(p_name),
    NULLIF(trim(COALESCE(p_name_en, '')), ''),
    COALESCE(p_branch_type, 'jewelry'),
    NULLIF(trim(COALESCE(p_address, '')), ''),
    NULLIF(trim(COALESCE(p_phone, '')), ''),
    COALESCE(p_is_active, true),
    false
  )
  RETURNING id INTO v_branch_id;

  INSERT INTO audit_logs (action_type, entity_type, entity_id, entity_code, description)
  VALUES ('create', 'branch', v_branch_id, p_code, 'إنشاء فرع جديد: ' || p_name);

  -- Auto-provision COA for the new branch (same transaction)
  v_coa_result := provision_branch_coa_atomic(jsonb_build_object('branch_id', v_branch_id));

  -- Enforce provisioning success: roll back branch if COA fails
  IF NOT COALESCE((v_coa_result->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'فشل في إنشاء دليل الحسابات للفرع: %', COALESCE(v_coa_result->>'error', 'خطأ غير معروف');
  END IF;

  v_result := jsonb_build_object(
    'success', true,
    'cached', false,
    'branch_id', v_branch_id,
    'branch_code', p_code,
    'coa_provisioned', true,
    'coa_count', COALESCE((v_coa_result->>'created_count')::int, 0)
  );

  UPDATE atomic_workflow_requests
  SET status = 'completed', result_payload = v_result, completed_at = now()
  WHERE client_request_id = p_client_request_id;

  RETURN v_result;
END;
$function$;
