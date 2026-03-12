-- Create sequence for purchase return numbers (global, atomic)
CREATE SEQUENCE IF NOT EXISTS purchase_return_number_seq START WITH 1;

-- Drop both existing function overloads to avoid ambiguity
DROP FUNCTION IF EXISTS public.generate_purchase_return_number();
DROP FUNCTION IF EXISTS public.generate_purchase_return_number(text);

-- Create single, sequence-based function
CREATE OR REPLACE FUNCTION public.generate_purchase_return_number(p_branch_code text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_seq BIGINT;
    v_date_str TEXT;
    v_branch_part TEXT;
BEGIN
    -- Get next value from sequence (atomic, no race conditions)
    v_seq := nextval('purchase_return_number_seq');
    
    -- Format date
    v_date_str := to_char(CURRENT_DATE, 'YYYYMMDD');
    
    -- Add branch code if provided
    v_branch_part := '';
    IF p_branch_code IS NOT NULL AND p_branch_code != '' THEN
        v_branch_part := '-' || p_branch_code;
    END IF;
    
    -- Build return number: PR-YYYYMMDD-000001 or PR-BR01-YYYYMMDD-000001
    RETURN 'PR' || v_branch_part || '-' || v_date_str || '-' || lpad(v_seq::text, 6, '0');
END;
$function$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.generate_purchase_return_number(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_purchase_return_number(text) TO service_role;