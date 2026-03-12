-- Fix contract mismatch: complete_purchase_return_unique_items_atomic inserts into item_movements
-- with columns: jewelry_item_id, movement_type, from_branch_id, to_branch_id,
-- purchase_return_id, notes, created_by.

BEGIN;

-- 1) Add compatibility columns expected by RPC
ALTER TABLE public.item_movements
  ADD COLUMN IF NOT EXISTS jewelry_item_id uuid,
  ADD COLUMN IF NOT EXISTS created_by text;

-- 2) Sync compatibility columns with canonical columns
CREATE OR REPLACE FUNCTION public.trg_sync_item_movements_cols()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Sync jewelry_item_id <-> item_id
  IF NEW.jewelry_item_id IS NULL THEN
    NEW.jewelry_item_id := NEW.item_id;
  END IF;
  IF NEW.item_id IS NULL THEN
    NEW.item_id := NEW.jewelry_item_id;
  END IF;

  -- Sync created_by <-> performed_by
  IF NEW.created_by IS NULL OR NEW.created_by = '' THEN
    NEW.created_by := NEW.performed_by;
  END IF;
  IF NEW.performed_by IS NULL OR NEW.performed_by = '' THEN
    NEW.performed_by := NEW.created_by;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_item_movements_cols ON public.item_movements;
CREATE TRIGGER trg_sync_item_movements_cols
BEFORE INSERT OR UPDATE ON public.item_movements
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_item_movements_cols();

-- 3) Align privileges with atomic execution policy
GRANT EXECUTE ON FUNCTION public.trg_sync_item_movements_cols() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trg_sync_item_movements_cols() TO service_role;

COMMIT;