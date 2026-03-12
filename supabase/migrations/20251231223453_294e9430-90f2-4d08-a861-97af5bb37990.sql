-- Update generate_purchase_return_number to query from invoices table instead of purchase_returns
CREATE OR REPLACE FUNCTION public.generate_purchase_return_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    today_str TEXT;
    return_count INTEGER;
BEGIN
    today_str := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
    
    -- Query from invoices table where invoice_type = 'purchase_return'
    SELECT COUNT(*) + 1 INTO return_count
    FROM public.invoices
    WHERE invoice_number LIKE 'PR-' || today_str || '%'
    AND invoice_type = 'purchase_return';
    
    RETURN 'PR-' || today_str || '-' || LPAD(return_count::TEXT, 4, '0');
END;
$function$;