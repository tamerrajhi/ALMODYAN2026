DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  -- 1) Get current function definition
  SELECT pg_get_functiondef('public.create_transfer_atomic(jsonb)'::regprocedure)
  INTO v_def;

  IF v_def IS NULL OR v_def = '' THEN
    RAISE EXCEPTION 'Could not read function definition for public.create_transfer_atomic(jsonb)';
  END IF;

  v_new := v_def;

  -- 2) Fix total_value -> cost in SUM
  v_new := replace(
    v_new,
    'SELECT COALESCE(SUM(ji.total_value), 0)',
    'SELECT COALESCE(SUM(COALESCE(ji.cost, 0)), 0)'
  );

  -- 3) Fix ji.weight -> ji.g_weight (weight field in jewelry_items)
  v_new := replace(v_new, 'ji.weight', 'ji.g_weight');

  -- 4) Fix ji.total_value -> COALESCE(ji.cost, 0) where used as unit cost
  v_new := replace(v_new, 'ji.total_value', 'COALESCE(ji.cost, 0)');

  -- 5) Sanity check: make sure we actually changed something
  IF v_new = v_def THEN
    RAISE EXCEPTION 'No changes were applied. The function body may differ from expected strings.';
  END IF;

  -- 6) Recreate function with patched definition
  EXECUTE v_new;
END $$;