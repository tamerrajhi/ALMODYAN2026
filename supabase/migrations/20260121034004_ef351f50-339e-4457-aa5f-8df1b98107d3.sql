-- =====================================================
-- PHASE 4 REFINEMENT: Split Functions + Hardened Gates
-- =====================================================

-- ===========================================
-- (A) SPLIT FUNCTIONS: Readonly vs Logging
-- ===========================================

-- Drop existing combined function
DROP FUNCTION IF EXISTS public.run_governance_checks();

-- 1. Readonly version (no side effects)
CREATE OR REPLACE FUNCTION public.run_governance_checks_readonly()
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
  
  -- Build result (NO INSERT)
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
  
  RETURN v_result;
END;
$$;

-- 2. Logging version (calls readonly + logs result)
CREATE OR REPLACE FUNCTION public.run_governance_checks_and_log()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_overall_status text;
BEGIN
  -- Get readonly result
  v_result := run_governance_checks_readonly();
  v_overall_status := v_result->>'overall_status';
  
  -- Log to audit_logs
  PERFORM governance_log_check_result(
    'Full_Governance_Check',
    v_overall_status,
    v_result
  );
  
  RETURN v_result;
END;
$$;

-- ===========================================
-- (B) HARDENED STATIC GATE
-- Focus: JE only, smarter detection
-- Rule: Any function with INSERT INTO journal_entries
--       MUST contain generate_journal_entry_number()
-- ===========================================

DROP FUNCTION IF EXISTS public.governance_static_gate_check();

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
DECLARE
  v_func_def text;
  v_func_name text;
  v_func_sig text;
  v_clean_def text;
  rec record;
BEGIN
  -- Target functions that handle accounting
  FOR rec IN 
    SELECT 
      p.proname::text AS fname,
      p.oid::regprocedure::text AS fsig,
      pg_get_functiondef(p.oid) AS fdef
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
        'complete_purchase_return_general_items_atomic'
      )
  LOOP
    v_func_name := rec.fname;
    v_func_sig := rec.fsig;
    v_func_def := rec.fdef;
    
    -- Strip single-line comments (-- ...)
    v_clean_def := regexp_replace(v_func_def, '--[^\n]*', '', 'g');
    -- Strip multi-line comments (/* ... */)
    v_clean_def := regexp_replace(v_clean_def, '/\*.*?\*/', '', 'gs');
    
    -- RULE 1: If function INSERTs into journal_entries, 
    --         it MUST use generate_journal_entry_number()
    IF v_clean_def ILIKE '%INSERT INTO journal_entries%' 
       OR v_clean_def ILIKE '%INSERT INTO public.journal_entries%' THEN
      
      -- Check if it uses the approved generator
      IF v_clean_def NOT ILIKE '%generate_journal_entry_number()%' THEN
        function_name := v_func_name;
        function_signature := v_func_sig;
        violation_type := 'MISSING_GENERATOR';
        gate_status := 'FAIL';
        RETURN NEXT;
        CONTINUE;
      END IF;
    END IF;
    
    -- RULE 2: Detect inline JE number literals in executable code
    --         Pattern: 'JE-' || ... (string concatenation)
    IF v_clean_def ~ '''JE-''\s*\|\|' THEN
      function_name := v_func_name;
      function_signature := v_func_sig;
      violation_type := 'INLINE_JE_LITERAL';
      gate_status := 'FAIL';
      RETURN NEXT;
      CONTINUE;
    END IF;
    
    -- RULE 3: Detect direct nextval for JE sequences
    --         Pattern: nextval('journal_entry... or nextval('je_...
    IF v_clean_def ~* 'nextval\s*\(\s*''(journal_entry|je_)' THEN
      function_name := v_func_name;
      function_signature := v_func_sig;
      violation_type := 'DIRECT_NEXTVAL_JE';
      gate_status := 'FAIL';
      RETURN NEXT;
    END IF;
    
  END LOOP;
  
  RETURN;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.run_governance_checks_readonly() TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_governance_checks_and_log() TO authenticated;
GRANT EXECUTE ON FUNCTION public.governance_static_gate_check() TO authenticated;