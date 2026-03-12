-- Drop and recreate with fixed column names
DROP FUNCTION IF EXISTS public.governance_runtime_sentinel();
DROP FUNCTION IF EXISTS public.run_governance_checks();

-- Recreate Runtime Sentinel with unique column names
CREATE OR REPLACE FUNCTION public.governance_runtime_sentinel()
RETURNS TABLE(
  violation_je_id uuid,
  violation_entry_number text,
  violation_entry_date date,
  violation_type text,
  violation_created_at timestamptz,
  gate_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  -- Check 1: NULL or empty entry numbers
  SELECT 
    je.id,
    je.entry_number::text,
    je.entry_date,
    'NULL_OR_EMPTY'::text,
    je.created_at,
    'FAIL'::text
  FROM journal_entries je
  WHERE je.entry_number IS NULL OR je.entry_number = ''
  
  UNION ALL
  
  -- Check 2: Malformed pattern (not matching JE-YYYYMMDD-####)
  SELECT 
    je.id,
    je.entry_number::text,
    je.entry_date,
    'MALFORMED_PATTERN'::text,
    je.created_at,
    'FAIL'::text
  FROM journal_entries je
  WHERE je.entry_number IS NOT NULL 
    AND je.entry_number != ''
    AND je.entry_number !~ '^JE-[0-9]{8}-[0-9]{4,}$'
  
  UNION ALL
  
  -- Check 3: Date mismatch (JE date doesn't match entry_date)
  SELECT 
    je.id,
    je.entry_number::text,
    je.entry_date,
    'DATE_MISMATCH'::text,
    je.created_at,
    'FAIL'::text
  FROM journal_entries je
  WHERE je.entry_number ~ '^JE-[0-9]{8}-[0-9]{4,}$'
    AND substring(je.entry_number FROM 4 FOR 8) != to_char(je.entry_date, 'YYYYMMDD')
  
  UNION ALL
  
  -- Check 4: Duplicate entry numbers
  SELECT 
    je.id,
    je.entry_number::text,
    je.entry_date,
    'DUPLICATE'::text,
    je.created_at,
    'FAIL'::text
  FROM journal_entries je
  WHERE je.entry_number IN (
    SELECT j2.entry_number 
    FROM journal_entries j2
    WHERE j2.entry_number IS NOT NULL
    GROUP BY j2.entry_number 
    HAVING COUNT(*) > 1
  );
END;
$$;

-- Recreate combined governance check function
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

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.governance_runtime_sentinel() TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_governance_checks() TO authenticated;