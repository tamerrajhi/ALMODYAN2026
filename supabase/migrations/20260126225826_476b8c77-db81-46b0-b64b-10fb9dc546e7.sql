-- 1) Add new column (nullable, no default)
ALTER TABLE public.item_movements
ADD COLUMN IF NOT EXISTS purchase_return_id uuid NULL;

-- 2) Add FK to purchase_returns (do NOT touch existing return_id FK)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'item_movements_purchase_return_id_fkey'
  ) THEN
    ALTER TABLE public.item_movements
    ADD CONSTRAINT item_movements_purchase_return_id_fkey
    FOREIGN KEY (purchase_return_id)
    REFERENCES public.purchase_returns(id)
    ON DELETE RESTRICT;
  END IF;
END $$;

-- 3) Performance index (partial index; safest and keeps bloat low)
CREATE INDEX IF NOT EXISTS idx_item_movements_purchase_return_id
ON public.item_movements (purchase_return_id)
WHERE purchase_return_id IS NOT NULL;