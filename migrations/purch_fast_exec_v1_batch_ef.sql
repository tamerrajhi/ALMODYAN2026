-- PURCH-FAST-EXEC-V1 Batch E+F: Import RPC fix + purchase_batch_status type
-- Idempotent: safe to re-run

-- 1. Create purchase_batch_status enum if missing (matches batch_status values)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'purchase_batch_status') THEN
    CREATE TYPE purchase_batch_status AS ENUM ('DRAFT', 'VALIDATED', 'IMPORTED', 'FAILED');
  END IF;
END $$;

-- 2. Fix import_purchase_batch_create_atomic: use batch_status cast, correct audit_logs columns
CREATE OR REPLACE FUNCTION public.import_purchase_batch_create_atomic(p_client_request_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_workflow_type TEXT := 'import_purchase_batch_create';
    v_idempotency_check jsonb;
    v_batch_id UUID;
    v_batch_no TEXT;
BEGIN
    v_idempotency_check := begin_workflow_request(p_client_request_id::TEXT, v_workflow_type, p_payload);

    IF (v_idempotency_check->>'status') = 'succeeded' THEN
        RETURN jsonb_build_object('success', true, 'cached', true, 'batch_id', v_idempotency_check->'result_payload'->>'batch_id');
    END IF;
    IF (v_idempotency_check->>'status') = 'conflict' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'IDEMPOTENCY_CONFLICT', 'error', 'Same request ID used with different payload');
    END IF;
    IF (v_idempotency_check->>'status') = 'in_progress' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'IN_PROGRESS', 'error', 'Request already in progress');
    END IF;

    v_batch_id := gen_random_uuid();
    v_batch_no := COALESCE(p_payload->>'batch_no', 'PB-' || EXTRACT(EPOCH FROM NOW())::TEXT);

    INSERT INTO purchase_batches (
        id, batch_no, status, supplier_id, branch_id,
        uploaded_file_name, total_items, total_weight, total_cost,
        notes, created_by
    ) VALUES (
        v_batch_id,
        v_batch_no,
        COALESCE(p_payload->>'status', 'IMPORTED')::batch_status,
        (p_payload->>'supplier_id')::UUID,
        (p_payload->>'branch_id')::UUID,
        p_payload->>'uploaded_file_name',
        COALESCE((p_payload->>'total_items')::INTEGER, 0),
        COALESCE((p_payload->>'total_weight')::NUMERIC, 0),
        COALESCE((p_payload->>'total_cost')::NUMERIC, 0),
        p_payload->>'notes',
        (p_payload->>'created_by')::UUID
    );

    INSERT INTO audit_logs (entity_type, entity_id, action_type, old_value, new_value, user_id)
    VALUES ('purchase_batch', v_batch_id, 'CREATE', NULL, p_payload, (p_payload->>'created_by')::UUID);

    PERFORM core_workflow_success(p_client_request_id::TEXT, v_batch_id, jsonb_build_object('batch_id', v_batch_id, 'batch_no', v_batch_no));
    RETURN jsonb_build_object('success', true, 'batch_id', v_batch_id, 'batch_no', v_batch_no);

EXCEPTION WHEN OTHERS THEN
    PERFORM core_workflow_failed(p_client_request_id::TEXT, 'DB_ERROR', SQLERRM);
    RETURN jsonb_build_object('success', false, 'error_code', 'DB_ERROR', 'error', SQLERRM);
END;
$function$;
