-- Legacy Drift Backfill: Fix 3 items from pre-hardening unique purchase returns
-- Scope: Only items linked to confirmed/posted returns where branch_id IS NOT NULL
-- Updates: branch_id=NULL, sale_status='returned', is_available_for_sale=false, sold_at=NULL, sale_id=NULL

UPDATE jewelry_items ji
SET 
    branch_id = NULL,
    sale_status = 'returned',
    is_available_for_sale = false,
    sold_at = NULL,
    sale_id = NULL
FROM purchase_return_items pri
JOIN purchase_returns pr ON pr.id = pri.return_id
WHERE pri.jewelry_item_id = ji.id
  AND pr.status IN ('confirmed', 'posted', 'completed')
  AND ji.branch_id IS NOT NULL;