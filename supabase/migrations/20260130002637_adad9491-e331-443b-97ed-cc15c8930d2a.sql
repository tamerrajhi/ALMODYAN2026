-- =============================================
-- Fix: compatibility column expected by unique return RPC
-- Error: column "purchase_return_id" of relation "purchase_return_items" does not exist
-- Existing canonical column: return_id
-- Approach: add purchase_return_id column + keep it in sync with return_id
-- =============================================

-- 1) Add missing column (nullable for backward compatibility)
ALTER TABLE public.purchase_return_items
ADD COLUMN IF NOT EXISTS purchase_return_id uuid;

-- 2) Sync trigger to keep both columns aligned
CREATE OR REPLACE FUNCTION public.trg_sync_purchase_return_items_return_ids()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Fill purchase_return_id from return_id if not provided
  IF NEW.purchase_return_id IS NULL THEN
    NEW.purchase_return_id := NEW.return_id;
  END IF;

  -- Fill return_id from purchase_return_id if not provided (defensive)
  IF NEW.return_id IS NULL THEN
    NEW.return_id := NEW.purchase_return_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_purchase_return_items_return_ids ON public.purchase_return_items;
CREATE TRIGGER trg_sync_purchase_return_items_return_ids
BEFORE INSERT OR UPDATE ON public.purchase_return_items
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_purchase_return_items_return_ids();