
-- Simple code generation functions that return text[] directly
-- No JSONB, no atomic workflows, no request tracking

-- Function to get next item codes as text array
CREATE OR REPLACE FUNCTION public.get_next_item_codes_array(count_needed integer)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix text;
  v_padding integer;
  v_start_value bigint;
  v_codes text[] := '{}';
  i integer;
BEGIN
  -- Handle edge case
  IF count_needed <= 0 THEN
    RETURN '{}';
  END IF;

  -- Lock and get sequence info
  SELECT prefix, padding, next_value
  INTO v_prefix, v_padding, v_start_value
  FROM public.code_sequences
  WHERE id = 'ITEM'
  FOR UPDATE;

  -- If sequence doesn't exist, initialize it
  IF v_prefix IS NULL THEN
    v_prefix := 'ITM-';
    v_padding := 8;
    v_start_value := 1;
    
    INSERT INTO public.code_sequences (id, prefix, padding, next_value)
    VALUES ('ITEM', v_prefix, v_padding, v_start_value)
    ON CONFLICT (id) DO NOTHING;
  END IF;

  -- Generate codes
  FOR i IN 0..(count_needed - 1) LOOP
    v_codes := array_append(v_codes, v_prefix || lpad((v_start_value + i)::text, v_padding, '0'));
  END LOOP;

  -- Update sequence
  UPDATE public.code_sequences
  SET next_value = v_start_value + count_needed,
      updated_at = now()
  WHERE id = 'ITEM';

  RETURN v_codes;
END;
$$;

-- Function to get next set codes as text array
CREATE OR REPLACE FUNCTION public.get_next_set_codes_array(count_needed integer)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix text;
  v_padding integer;
  v_start_value bigint;
  v_codes text[] := '{}';
  i integer;
BEGIN
  -- Handle edge case
  IF count_needed <= 0 THEN
    RETURN '{}';
  END IF;

  -- Lock and get sequence info
  SELECT prefix, padding, next_value
  INTO v_prefix, v_padding, v_start_value
  FROM public.code_sequences
  WHERE id = 'SET'
  FOR UPDATE;

  -- If sequence doesn't exist, initialize it
  IF v_prefix IS NULL THEN
    v_prefix := 'SET-';
    v_padding := 6;
    v_start_value := 1;
    
    INSERT INTO public.code_sequences (id, prefix, padding, next_value)
    VALUES ('SET', v_prefix, v_padding, v_start_value)
    ON CONFLICT (id) DO NOTHING;
  END IF;

  -- Generate codes
  FOR i IN 0..(count_needed - 1) LOOP
    v_codes := array_append(v_codes, v_prefix || lpad((v_start_value + i)::text, v_padding, '0'));
  END LOOP;

  -- Update sequence
  UPDATE public.code_sequences
  SET next_value = v_start_value + count_needed,
      updated_at = now()
  WHERE id = 'SET';

  RETURN v_codes;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.get_next_item_codes_array(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_next_set_codes_array(integer) TO authenticated;
