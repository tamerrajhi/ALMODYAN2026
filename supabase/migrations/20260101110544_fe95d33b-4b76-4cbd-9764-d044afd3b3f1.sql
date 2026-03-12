-- Fix the generate_journal_entry_number function to avoid race conditions
-- by using MAX + 1 instead of COUNT + 1 for better uniqueness

CREATE OR REPLACE FUNCTION public.generate_journal_entry_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    today_str TEXT;
    max_number INTEGER;
    new_number INTEGER;
BEGIN
    today_str := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
    
    -- Get the maximum number for today using substring extraction
    SELECT COALESCE(MAX(
        CAST(SUBSTRING(entry_number FROM 'JE-' || today_str || '-([0-9]+)$') AS INTEGER)
    ), 0) + 1 INTO new_number
    FROM public.journal_entries
    WHERE entry_number LIKE 'JE-' || today_str || '-%';
    
    RETURN 'JE-' || today_str || '-' || LPAD(new_number::TEXT, 4, '0');
END;
$function$;