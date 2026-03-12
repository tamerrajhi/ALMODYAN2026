-- Phase 0: Backup table
CREATE TABLE IF NOT EXISTS jewelry_items_warehouse_backup AS
SELECT id, warehouse_id, branch_id, item_code, now() as backed_up_at
FROM jewelry_items;