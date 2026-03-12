CREATE OR REPLACE FUNCTION public.next_branch_code(
  p_branch_id uuid,
  p_code_type text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_code text;
  v_seq record;
  v_number bigint;
  v_code text;
  v_prefix text;
  v_padding int;
BEGIN
  SELECT branch_code INTO v_branch_code
  FROM public.branches
  WHERE id = p_branch_id;

  IF v_branch_code IS NULL OR v_branch_code = '' THEN
    RAISE EXCEPTION 'Branch code is missing for branch_id=%', p_branch_id;
  END IF;

  -- Lock row to avoid duplicates under concurrency
  SELECT * INTO v_seq
  FROM public.branch_code_sequences
  WHERE branch_id = p_branch_id
    AND code_type = upper(p_code_type)
  FOR UPDATE;

  IF NOT FOUND THEN
    v_prefix := upper(p_code_type) || '-' || v_branch_code || '-';
    v_padding := 6;
    INSERT INTO public.branch_code_sequences (branch_id, code_type, prefix, padding, next_value, updated_at)
    VALUES (p_branch_id, upper(p_code_type), v_prefix, v_padding, 1, now())
    RETURNING * INTO v_seq;
  END IF;

  v_number := v_seq.next_value;

  UPDATE public.branch_code_sequences
  SET next_value = next_value + 1,
      updated_at = now()
  WHERE branch_id = p_branch_id
    AND code_type = upper(p_code_type);

  v_code := v_seq.prefix || lpad(v_number::text, v_seq.padding, '0');

  RETURN v_code;
END;
$$;