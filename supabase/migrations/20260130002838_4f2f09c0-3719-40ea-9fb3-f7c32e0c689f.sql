-- Fix contract mismatch: complete_purchase_return_unique_items_atomic inserts into purchase_return_items
-- with columns: purchase_return_id, jewelry_item_id, item_code, description, unit_price, tax_rate,
-- tax_amount, total_amount, gold_weight, karat_id, invoice_line_id, reason.

BEGIN;

-- 1) Add missing columns used by the RPC (nullable for backwards compatibility)
ALTER TABLE public.purchase_return_items
  ADD COLUMN IF NOT EXISTS item_code text,
  ADD COLUMN IF NOT EXISTS gold_weight numeric,
  ADD COLUMN IF NOT EXISTS karat_id uuid,
  ADD COLUMN IF NOT EXISTS reason text;

-- 2) Ensure legacy NOT NULL columns that the RPC does NOT provide have safe defaults
--    (unique-item return implies quantity = 1, and no discount by default)
ALTER TABLE public.purchase_return_items
  ALTER COLUMN quantity SET DEFAULT 1;

ALTER TABLE public.purchase_return_items
  ALTER COLUMN discount_amount SET DEFAULT 0;

-- 3) Keep legacy/new columns in sync to prevent future drift
CREATE OR REPLACE FUNCTION public.trg_sync_purchase_return_items_cols()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Sync return_id <-> purchase_return_id
  IF NEW.purchase_return_id IS NULL THEN
    NEW.purchase_return_id := NEW.return_id;
  END IF;
  IF NEW.return_id IS NULL THEN
    NEW.return_id := NEW.purchase_return_id;
  END IF;

  -- Sync weight_grams <-> gold_weight
  IF NEW.gold_weight IS NULL THEN
    NEW.gold_weight := NEW.weight_grams;
  END IF;
  IF NEW.weight_grams IS NULL THEN
    NEW.weight_grams := NEW.gold_weight;
  END IF;

  -- Sync quantity: unique flow doesn't send it, so default to 1 if still null
  IF NEW.quantity IS NULL THEN
    NEW.quantity := 1;
  END IF;

  -- Sync discount_amount default
  IF NEW.discount_amount IS NULL THEN
    NEW.discount_amount := 0;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_purchase_return_items_cols ON public.purchase_return_items;
CREATE TRIGGER trg_sync_purchase_return_items_cols
BEFORE INSERT OR UPDATE ON public.purchase_return_items
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_purchase_return_items_cols();

-- 4) Align privileges with atomic execution policy
GRANT EXECUTE ON FUNCTION public.trg_sync_purchase_return_items_cols() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trg_sync_purchase_return_items_cols() TO service_role;

COMMIT;