-- Phase 2: Trigger Enforcement for warehouse_id = branch_id sync

-- 1) Create/update the sync function
CREATE OR REPLACE FUNCTION sync_warehouse_to_branch()
RETURNS TRIGGER AS $$
BEGIN
  NEW.warehouse_id := NEW.branch_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2) Create trigger with safe recreation
DROP TRIGGER IF EXISTS trg_sync_warehouse_branch ON jewelry_items;

CREATE TRIGGER trg_sync_warehouse_branch
BEFORE INSERT OR UPDATE ON jewelry_items
FOR EACH ROW EXECUTE FUNCTION sync_warehouse_to_branch();