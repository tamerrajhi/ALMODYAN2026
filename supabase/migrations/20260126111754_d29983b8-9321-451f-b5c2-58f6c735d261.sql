-- ============================================================
-- PURCH-PR2 STEP 4: One-Time Backfill for Legacy Unique Purchase Returns
-- Purpose: Retroactively create PURCHASE_RETURN movements + clear branch_id
-- Idempotent: Safe to run multiple times
-- FIXED: Movement creation is inclusive for all confirmed returns
-- ============================================================

DO $$
DECLARE
  v_movements_inserted INTEGER := 0;
  v_items_branch_cleared INTEGER := 0;
  v_returns_affected INTEGER := 0;
  v_mismatch_count INTEGER := 0;
  v_mismatch_returns TEXT;
BEGIN
  -- ============================================================
  -- STEP A: Insert missing item_movements (PURCHASE_RETURN)
  -- INCLUSIVE: For ALL confirmed purchase returns missing movements
  -- regardless of current item state
  -- ============================================================
  WITH targets AS (
    SELECT DISTINCT
      pr.id AS return_id,
      pr.return_number,
      pr.branch_id AS return_branch_id,
      pri.jewelry_item_id AS item_id,
      COALESCE(ji.cost, 0) AS item_cost
    FROM purchase_returns pr
    INNER JOIN purchase_return_items pri ON pri.return_id = pr.id
    LEFT JOIN jewelry_items ji ON ji.id = pri.jewelry_item_id
    WHERE pr.status IN ('confirmed', 'posted')
      AND pr.status != 'voided'
      -- Only where movement is missing (core condition)
      AND NOT EXISTS (
        SELECT 1 FROM item_movements im
        WHERE im.item_id = pri.jewelry_item_id
          AND im.movement_type = 'PURCHASE_RETURN'
          AND im.reference_type = 'purchase_return'
          AND im.reference_id = pr.id
      )
  ),
  inserted_movements AS (
    INSERT INTO item_movements (
      item_id,
      movement_type,
      movement_date,
      reference_type,
      reference_id,
      reference_code,
      from_branch_id,
      performed_by,
      cost,
      notes
    )
    SELECT
      t.item_id,
      'PURCHASE_RETURN',
      NOW(),
      'purchase_return',
      t.return_id,
      t.return_number,
      t.return_branch_id,
      'System Backfill',
      t.item_cost,
      'Backfill PURCHASE_RETURN movement for legacy return - ' || t.return_number
    FROM targets t
    WHERE t.item_id IS NOT NULL
    ON CONFLICT (item_id, movement_type, reference_type, reference_id) DO NOTHING
    RETURNING item_id
  )
  SELECT COUNT(*) INTO v_movements_inserted FROM inserted_movements;

  -- ============================================================
  -- STEP B: Clear branch_id for targeted items
  -- CONSERVATIVE: Only items still at return branch with correct status
  -- ============================================================
  WITH targets_for_branch_clear AS (
    SELECT DISTINCT
      pri.jewelry_item_id AS item_id,
      pr.branch_id AS return_branch_id
    FROM purchase_returns pr
    INNER JOIN purchase_return_items pri ON pri.return_id = pr.id
    INNER JOIN jewelry_items ji ON ji.id = pri.jewelry_item_id
    WHERE pr.status IN ('confirmed', 'posted')
      AND pr.status != 'voided'
      -- Only target items still in the return branch
      AND ji.branch_id IS NOT NULL
      AND ji.branch_id = pr.branch_id
      -- Only target items with returned status (safe to clear)
      AND ji.sale_status = 'returned'
      AND ji.is_available_for_sale = false
  ),
  updated_items AS (
    UPDATE jewelry_items ji
    SET 
      branch_id = NULL,
      updated_at = NOW()
    FROM targets_for_branch_clear t
    WHERE ji.id = t.item_id
      AND ji.branch_id = t.return_branch_id
      AND ji.sale_status = 'returned'
      AND ji.is_available_for_sale = false
    RETURNING ji.id
  )
  SELECT COUNT(*) INTO v_items_branch_cleared FROM updated_items;

  -- Count distinct returns with System Backfill movements
  SELECT COUNT(DISTINCT im.reference_id) INTO v_returns_affected
  FROM item_movements im
  WHERE im.movement_type = 'PURCHASE_RETURN'
    AND im.reference_type = 'purchase_return'
    AND im.performed_by = 'System Backfill';

  -- ============================================================
  -- STEP C: Post-condition guard - verify counts match for confirmed returns
  -- ============================================================
  WITH return_counts AS (
    SELECT 
      pr.id AS return_id,
      pr.return_number,
      (SELECT COUNT(*) FROM purchase_return_items pri2 WHERE pri2.return_id = pr.id) AS expected_count,
      (SELECT COUNT(*) FROM item_movements im 
       WHERE im.reference_type = 'purchase_return' 
         AND im.reference_id = pr.id 
         AND im.movement_type = 'PURCHASE_RETURN') AS actual_count
    FROM purchase_returns pr
    WHERE pr.status IN ('confirmed', 'posted')
      AND pr.status != 'voided'
      AND EXISTS (SELECT 1 FROM purchase_return_items pri WHERE pri.return_id = pr.id)
  ),
  mismatches AS (
    SELECT return_number, expected_count, actual_count
    FROM return_counts
    WHERE expected_count != actual_count
  )
  SELECT 
    COUNT(*),
    STRING_AGG(return_number || ' (expected=' || expected_count || ', actual=' || actual_count || ')', ', ')
  INTO v_mismatch_count, v_mismatch_returns
  FROM mismatches;

  -- Raise exception if any mismatches found
  IF v_mismatch_count > 0 THEN
    RAISE EXCEPTION 'BACKFILL_MISMATCH: % returns have count mismatch: %', v_mismatch_count, v_mismatch_returns;
  END IF;

  -- ============================================================
  -- Summary output
  -- ============================================================
  RAISE NOTICE '=== PURCH-PR2 STEP 4 Backfill Summary ===';
  RAISE NOTICE 'returns_fixed_count: %', v_returns_affected;
  RAISE NOTICE 'movements_inserted_count: %', v_movements_inserted;
  RAISE NOTICE 'items_branch_cleared_count: %', v_items_branch_cleared;
  RAISE NOTICE 'Post-condition guard: PASS (0 mismatches)';
  RAISE NOTICE '==========================================';
END $$;