-- =============================================================================
-- PURCH-PR2 STEP 6: Add Drift Detection View for Purchase Return Movements
--
-- Purpose: Lightweight READ-ONLY guardrail to detect movement/item count mismatches
-- Usage: SELECT * FROM v_purchase_return_movement_drift WHERE has_drift = true
-- =============================================================================

-- Drop if exists to allow idempotent creation
DROP VIEW IF EXISTS public.v_purchase_return_movement_drift;

CREATE OR REPLACE VIEW public.v_purchase_return_movement_drift AS
WITH return_item_counts AS (
    SELECT 
        pr.id as return_id,
        pr.return_number,
        pr.status,
        pr.branch_id,
        pr.created_at,
        COUNT(DISTINCT pri.jewelry_item_id) as expected_movement_count
    FROM purchase_returns pr
    JOIN purchase_return_items pri ON pri.return_id = pr.id
    WHERE pr.status IN ('confirmed', 'posted')
    GROUP BY pr.id, pr.return_number, pr.status, pr.branch_id, pr.created_at
),
movement_counts AS (
    SELECT 
        reference_id as return_id,
        COUNT(*) as actual_movement_count
    FROM item_movements
    WHERE reference_type = 'purchase_return'
      AND movement_type = 'PURCHASE_RETURN'
    GROUP BY reference_id
)
SELECT 
    ric.return_id,
    ric.return_number,
    ric.status,
    ric.branch_id,
    ric.created_at,
    ric.expected_movement_count,
    COALESCE(mc.actual_movement_count, 0) as actual_movement_count,
    (ric.expected_movement_count <> COALESCE(mc.actual_movement_count, 0)) as has_drift,
    CASE 
        WHEN ric.expected_movement_count > COALESCE(mc.actual_movement_count, 0) 
        THEN 'MISSING_MOVEMENTS'
        WHEN ric.expected_movement_count < COALESCE(mc.actual_movement_count, 0) 
        THEN 'EXTRA_MOVEMENTS'
        ELSE 'OK'
    END as drift_type
FROM return_item_counts ric
LEFT JOIN movement_counts mc ON mc.return_id = ric.return_id;

-- Grant access
GRANT SELECT ON public.v_purchase_return_movement_drift TO authenticated;

COMMENT ON VIEW public.v_purchase_return_movement_drift IS 
'Drift detection view for purchase return movements. Query with WHERE has_drift = true to find mismatches.';