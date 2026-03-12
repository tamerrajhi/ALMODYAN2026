-- Create bulk function for generating multiple item codes at once
CREATE OR REPLACE FUNCTION public.get_next_item_codes_bulk(count_needed INTEGER)
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    codes TEXT[];
    current_last BIGINT;
    i INTEGER;
BEGIN
    -- Lock the row and get current value
    UPDATE public.code_sequences
    SET last_number = last_number + count_needed
    WHERE id = 'ITEM'
    RETURNING last_number - count_needed INTO current_last;
    
    IF current_last IS NULL THEN
        RAISE EXCEPTION 'ITEM sequence not found in code_sequences';
    END IF;
    
    -- Generate all codes at once
    codes := ARRAY[]::TEXT[];
    FOR i IN 1..count_needed LOOP
        codes := array_append(codes, 'ITM-' || LPAD((current_last + i)::TEXT, 8, '0'));
    END LOOP;
    
    RETURN codes;
END;
$$;

-- Create bulk function for generating multiple set codes at once
CREATE OR REPLACE FUNCTION public.get_next_set_codes_bulk(count_needed INTEGER)
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    codes TEXT[];
    current_last BIGINT;
    i INTEGER;
BEGIN
    -- Lock the row and get current value
    UPDATE public.code_sequences
    SET last_number = last_number + count_needed
    WHERE id = 'SET'
    RETURNING last_number - count_needed INTO current_last;
    
    IF current_last IS NULL THEN
        RAISE EXCEPTION 'SET sequence not found in code_sequences';
    END IF;
    
    -- Generate all codes at once
    codes := ARRAY[]::TEXT[];
    FOR i IN 1..count_needed LOOP
        codes := array_append(codes, 'SET-' || LPAD((current_last + i)::TEXT, 6, '0'));
    END LOOP;
    
    RETURN codes;
END;
$$;