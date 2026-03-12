-- Update generate_purchase_return_number to include branch code
CREATE OR REPLACE FUNCTION public.generate_purchase_return_number(p_branch_code text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    today_str TEXT;
    return_count INTEGER;
    branch_part TEXT;
BEGIN
    today_str := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
    
    -- Add branch code if provided
    branch_part := COALESCE(p_branch_code, '');
    IF branch_part != '' THEN
        branch_part := '-' || branch_part;
    END IF;
    
    -- Query from invoices table where invoice_type = 'purchase_return'
    SELECT COUNT(*) + 1 INTO return_count
    FROM public.invoices
    WHERE invoice_number LIKE 'PR' || branch_part || '-' || today_str || '%'
    AND invoice_type = 'purchase_return';
    
    RETURN 'PR' || branch_part || '-' || today_str || '-' || LPAD(return_count::TEXT, 4, '0');
END;
$function$;