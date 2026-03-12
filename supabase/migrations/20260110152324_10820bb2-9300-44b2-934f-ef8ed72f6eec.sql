-- Fix backfill function - UUID doesn't support MAX, use different approach
CREATE OR REPLACE FUNCTION public.backfill_item_movements_journal_entries()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count integer := 0;
  skipped_already_set integer := 0;
  no_match_count integer := 0;
  multiple_match_count integer := 0;
  rec record;
  matching_je_id uuid;
  match_count integer;
BEGIN
  -- Process all item_movements that have reference_type and reference_id but no journal_entry_id
  FOR rec IN 
    SELECT id, reference_type, reference_id 
    FROM item_movements 
    WHERE journal_entry_id IS NULL 
      AND reference_type IS NOT NULL 
      AND reference_id IS NOT NULL
  LOOP
    -- Count matching journal entries
    SELECT COUNT(*) INTO match_count
    FROM journal_entries je
    WHERE je.reference_type = rec.reference_type 
      AND je.reference_id::text = rec.reference_id::text;
    
    IF match_count = 1 THEN
      -- Exactly one match - get the id and update
      SELECT je.id INTO matching_je_id
      FROM journal_entries je
      WHERE je.reference_type = rec.reference_type 
        AND je.reference_id::text = rec.reference_id::text
      LIMIT 1;
      
      UPDATE item_movements 
      SET journal_entry_id = matching_je_id
      WHERE id = rec.id;
      updated_count := updated_count + 1;
    ELSIF match_count = 0 THEN
      no_match_count := no_match_count + 1;
    ELSE
      multiple_match_count := multiple_match_count + 1;
    END IF;
  END LOOP;
  
  -- Count already set
  SELECT COUNT(*) INTO skipped_already_set
  FROM item_movements 
  WHERE journal_entry_id IS NOT NULL;
  
  RETURN jsonb_build_object(
    'updated', updated_count,
    'already_set', skipped_already_set,
    'no_match', no_match_count,
    'multiple_matches', multiple_match_count,
    'status', 'completed'
  );
END;
$$;

-- Run backfill
SELECT public.backfill_item_movements_journal_entries();