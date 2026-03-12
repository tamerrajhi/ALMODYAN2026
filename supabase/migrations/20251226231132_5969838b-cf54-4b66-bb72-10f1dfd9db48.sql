-- Function to sync item code sequence with max existing code (to avoid gaps)
CREATE OR REPLACE FUNCTION public.sync_item_code_sequence()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    max_num BIGINT;
    current_seq BIGINT;
BEGIN
    -- Get the maximum item code number from existing items
    SELECT COALESCE(MAX(
        CASE 
            WHEN item_code ~ '^ITM-[0-9]+$' 
            THEN CAST(SUBSTRING(item_code FROM 5) AS BIGINT)
            ELSE 0
        END
    ), 0) INTO max_num
    FROM public.jewelry_items;
    
    -- Get current sequence value
    SELECT last_number INTO current_seq
    FROM public.code_sequences
    WHERE id = 'ITEM';
    
    -- Only update if max_num is less than current sequence (there are gaps)
    -- OR if sequence doesn't exist
    IF current_seq IS NULL THEN
        INSERT INTO public.code_sequences (id, last_number) VALUES ('ITEM', max_num);
    ELSIF max_num < current_seq THEN
        -- There are gaps, reset sequence to max existing number
        UPDATE public.code_sequences
        SET last_number = max_num
        WHERE id = 'ITEM';
    END IF;
    
    RETURN max_num;
END;
$function$;

-- Function to sync set code sequence with max existing code
CREATE OR REPLACE FUNCTION public.sync_set_code_sequence()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    max_num BIGINT;
    current_seq BIGINT;
BEGIN
    -- Get the maximum set code number from existing sets
    SELECT COALESCE(MAX(
        CASE 
            WHEN set_code ~ '^SET-[0-9]+$' 
            THEN CAST(SUBSTRING(set_code FROM 5) AS BIGINT)
            ELSE 0
        END
    ), 0) INTO max_num
    FROM public.jewelry_sets;
    
    -- Get current sequence value
    SELECT last_number INTO current_seq
    FROM public.code_sequences
    WHERE id = 'SET';
    
    IF current_seq IS NULL THEN
        INSERT INTO public.code_sequences (id, last_number) VALUES ('SET', max_num);
    ELSIF max_num < current_seq THEN
        UPDATE public.code_sequences
        SET last_number = max_num
        WHERE id = 'SET';
    END IF;
    
    RETURN max_num;
END;
$function$;