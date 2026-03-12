-- =====================================================
-- PHASE 4: GOVERNANCE & REGRESSION PREVENTION
-- =====================================================
-- Control 1: Static Gate Function
-- Control 2: Runtime Sentinel Function  
-- Control 3: Audit Evidence via existing audit_logs
-- NO SCHEMA CHANGES - Functions only
-- =====================================================

-- ===========================================
-- CONTROL 1: STATIC GATE
-- Detects inline JE generation in functions
-- ===========================================
CREATE OR REPLACE FUNCTION public.governance_static_gate_check()
RETURNS TABLE(
  function_name text,
  function_signature text,
  violation_type text,
  gate_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.proname::text AS function_name,
    p.oid::regprocedure::text AS function_signature,
    CASE 
      WHEN pg_get_functiondef(p.oid) ILIKE '%nextval(%' THEN 'INLINE_NEXTVAL'
      WHEN pg_get_functiondef(p.oid) ILIKE '%''JE-''%' THEN 'LITERAL_JE_PREFIX'
      WHEN pg_get_functiondef(p.oid) ILIKE '%''CN-''%' THEN 'LITERAL_CN_PREFIX'
      WHEN pg_get_functiondef(p.oid) ILIKE '%''SR-''%' THEN 'LITERAL_SR_PREFIX'
      WHEN pg_get_functiondef(p.oid) ILIKE '%''PSR-''%' THEN 'LITERAL_PSR_PREFIX'
      ELSE 'UNKNOWN_PATTERN'
    END AS violation_type,
    'FAIL'::text AS gate_status
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'complete_purchase_invoice_atomic',
      'complete_pos_credit_note_atomic',
      'complete_pos_sales_return_atomic',
      'complete_sales_return_atomic',
      'complete_erp_credit_note_atomic',
      'create_customer_receipt_atomic',
      'complete_purchase_return_unique_items_atomic',
      'complete_sales_invoice_atomic',
      'complete_pos_return_atomic'
    )
    AND (
      pg_get_functiondef(p.oid) ILIKE '%nextval(%'
      OR pg_get_functiondef(p.oid) ILIKE '%''JE-''%'
      OR pg_get_functiondef(p.oid) ILIKE '%''CN-''%'
      OR pg_get_functiondef(p.oid) ILIKE '%''SR-''%'
      OR pg_get_functiondef(p.oid) ILIKE '%''PSR-''%'
    );
END;
$$;

-- ===========================================
-- CONTROL 2: RUNTIME SENTINEL
-- Detects malformed/invalid JE numbers
-- ===========================================
CREATE OR REPLACE FUNCTION public.governance_runtime_sentinel()
RETURNS TABLE(
  je_id uuid,
  entry_number text,
  entry_date date,
  violation_type text,
  created_at timestamptz,
  gate_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today_pattern text;
BEGIN
  v_today_pattern := 'JE-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-%';
  
  RETURN QUERY
  -- Check 1: NULL or empty entry numbers
  SELECT 
    je.id AS je_id,
    je.entry_number::text,
    je.entry_date,
    'NULL_OR_EMPTY'::text AS violation_type,
    je.created_at,
    'FAIL'::text AS gate_status
  FROM journal_entries je
  WHERE je.entry_number IS NULL OR je.entry_number = ''
  
  UNION ALL
  
  -- Check 2: Malformed pattern (not matching JE-YYYYMMDD-####)
  SELECT 
    je.id AS je_id,
    je.entry_number::text,
    je.entry_date,
    'MALFORMED_PATTERN'::text AS violation_type,
    je.created_at,
    'FAIL'::text AS gate_status
  FROM journal_entries je
  WHERE je.entry_number IS NOT NULL 
    AND je.entry_number != ''
    AND je.entry_number !~ '^JE-[0-9]{8}-[0-9]{4,}$'
  
  UNION ALL
  
  -- Check 3: Date mismatch (JE date doesn't match entry_date)
  SELECT 
    je.id AS je_id,
    je.entry_number::text,
    je.entry_date,
    'DATE_MISMATCH'::text AS violation_type,
    je.created_at,
    'FAIL'::text AS gate_status
  FROM journal_entries je
  WHERE je.entry_number ~ '^JE-[0-9]{8}-[0-9]{4,}$'
    AND substring(je.entry_number FROM 4 FOR 8) != to_char(je.entry_date, 'YYYYMMDD')
  
  UNION ALL
  
  -- Check 4: Duplicate entry numbers
  SELECT 
    je.id AS je_id,
    je.entry_number::text,
    je.entry_date,
    'DUPLICATE'::text AS violation_type,
    je.created_at,
    'FAIL'::text AS gate_status
  FROM journal_entries je
  WHERE je.entry_number IN (
    SELECT entry_number 
    FROM journal_entries 
    WHERE entry_number IS NOT NULL
    GROUP BY entry_number 
    HAVING COUNT(*) > 1
  );
END;
$$;

-- ===========================================
-- CONTROL 3: AUDIT EVIDENCE LOGGER
-- Logs governance check results to audit_logs
-- ===========================================
CREATE OR REPLACE FUNCTION public.governance_log_check_result(
  p_check_type text,
  p_gate_status text,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log_id uuid;
BEGIN
  INSERT INTO audit_logs (
    action_type,
    entity_type,
    entity_id,
    description,
    metadata,
    user_id,
    user_name,
    timestamp
  ) VALUES (
    'Governance_Check',
    'System',
    gen_random_uuid()::text,
    'Phase 4 Governance: ' || p_check_type || ' - ' || p_gate_status,
    jsonb_build_object(
      'check_type', p_check_type,
      'gate_status', p_gate_status,
      'check_timestamp', now(),
      'details', p_details
    ),
    auth.uid(),
    COALESCE(
      (SELECT raw_user_meta_data->>'full_name' FROM auth.users WHERE id = auth.uid()),
      'System'
    ),
    now()
  )
  RETURNING id INTO v_log_id;
  
  RETURN v_log_id;
END;
$$;

-- ===========================================
-- COMBINED GOVERNANCE DASHBOARD FUNCTION
-- Runs all checks and returns summary
-- ===========================================
CREATE OR REPLACE FUNCTION public.run_governance_checks()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_static_violations integer;
  v_runtime_violations integer;
  v_result jsonb;
  v_static_details jsonb;
  v_runtime_details jsonb;
BEGIN
  -- Run Static Gate
  SELECT COUNT(*), COALESCE(jsonb_agg(row_to_json(s.*)), '[]'::jsonb)
  INTO v_static_violations, v_static_details
  FROM governance_static_gate_check() s;
  
  -- Run Runtime Sentinel
  SELECT COUNT(*), COALESCE(jsonb_agg(row_to_json(r.*)), '[]'::jsonb)
  INTO v_runtime_violations, v_runtime_details
  FROM governance_runtime_sentinel() r;
  
  -- Build result
  v_result := jsonb_build_object(
    'check_timestamp', now(),
    'overall_status', CASE 
      WHEN v_static_violations = 0 AND v_runtime_violations = 0 THEN 'PASS'
      ELSE 'FAIL'
    END,
    'controls', jsonb_build_object(
      'static_gate', jsonb_build_object(
        'status', CASE WHEN v_static_violations = 0 THEN 'PASS' ELSE 'FAIL' END,
        'violation_count', v_static_violations,
        'violations', v_static_details
      ),
      'runtime_sentinel', jsonb_build_object(
        'status', CASE WHEN v_runtime_violations = 0 THEN 'PASS' ELSE 'FAIL' END,
        'violation_count', v_runtime_violations,
        'violations', v_runtime_details
      )
    )
  );
  
  -- Log the check result
  PERFORM governance_log_check_result(
    'Full_Governance_Check',
    CASE WHEN v_static_violations = 0 AND v_runtime_violations = 0 THEN 'PASS' ELSE 'FAIL' END,
    v_result
  );
  
  RETURN v_result;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.governance_static_gate_check() TO authenticated;
GRANT EXECUTE ON FUNCTION public.governance_runtime_sentinel() TO authenticated;
GRANT EXECUTE ON FUNCTION public.governance_log_check_result(text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_governance_checks() TO authenticated;