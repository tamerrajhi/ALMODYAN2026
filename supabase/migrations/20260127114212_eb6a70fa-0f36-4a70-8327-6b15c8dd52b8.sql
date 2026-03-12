-- ============================================================
-- B-MIG-01: Schema Hardening & Track Separation (FIXED)
-- ============================================================

-- ============================================================
-- 1) Fix purchase_returns.purchase_type default (currently 'local')
-- ============================================================
ALTER TABLE public.purchase_returns 
ALTER COLUMN purchase_type SET DEFAULT 'general';

-- ============================================================
-- 2) Normalize item_movements movement_type casing
-- ============================================================

-- 2a) FIRST: Delete duplicate uppercase rows that would collide
-- Keep the older lowercase versions, delete newer uppercase duplicates
DELETE FROM public.item_movements 
WHERE id IN (
  SELECT im.id
  FROM public.item_movements im
  WHERE im.movement_type = 'PURCHASE_RETURN'
    AND EXISTS (
      SELECT 1 FROM public.item_movements im2
      WHERE im2.item_id = im.item_id
        AND im2.reference_type = im.reference_type
        AND im2.reference_id = im.reference_id
        AND im2.movement_type = 'purchase_return'
    )
);

-- 2b) Now safe to normalize remaining uppercase values
UPDATE public.item_movements SET movement_type = 'import' WHERE movement_type = 'IMPORT';
UPDATE public.item_movements SET movement_type = 'purchase_return' WHERE movement_type = 'PURCHASE_RETURN';
UPDATE public.item_movements SET movement_type = 'sale' WHERE movement_type = 'SALE';
UPDATE public.item_movements SET movement_type = 'transfer' WHERE movement_type = 'TRANSFER';
UPDATE public.item_movements SET movement_type = 'adjustment' WHERE movement_type = 'ADJUSTMENT';
UPDATE public.item_movements SET movement_type = 'void' WHERE movement_type = 'VOID';

-- 2c) Add CHECK constraint for allowed movement types (lowercase only)
ALTER TABLE public.item_movements 
ADD CONSTRAINT check_movement_type_values 
CHECK (movement_type IN (
  'import', 
  'purchase_return', 
  'purchase_return_void', 
  'transfer', 
  'sale', 
  'sale_return',
  'adjustment', 
  'void',
  'receive',
  'issue'
));

-- 2d) Create trigger to auto-lowercase movement_type on insert/update
CREATE OR REPLACE FUNCTION public.normalize_movement_type()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.movement_type := LOWER(NEW.movement_type);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_movement_type ON public.item_movements;
CREATE TRIGGER trg_normalize_movement_type
BEFORE INSERT OR UPDATE ON public.item_movements
FOR EACH ROW
EXECUTE FUNCTION public.normalize_movement_type();

-- ============================================================
-- 3) Add Foreign Keys for line tables
-- ============================================================

-- 3a) purchase_return_lines -> invoices (for mirror invoice storage)
ALTER TABLE public.purchase_return_lines
ADD CONSTRAINT fk_purchase_return_lines_invoice
FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;

-- 3b) purchase_return_lines -> purchase_invoice_lines (optional, if column exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema='public' AND table_name='purchase_return_lines' AND column_name='invoice_line_id'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'fk_purchase_return_lines_invoice_line'
    ) THEN
      ALTER TABLE public.purchase_return_lines
      ADD CONSTRAINT fk_purchase_return_lines_invoice_line
      FOREIGN KEY (invoice_line_id) REFERENCES public.purchase_invoice_lines(id) ON DELETE SET NULL;
    END IF;
  END IF;
END $$;

-- 3c) purchase_return_items -> purchase_returns
ALTER TABLE public.purchase_return_items
ADD CONSTRAINT fk_purchase_return_items_return
FOREIGN KEY (return_id) REFERENCES public.purchase_returns(id) ON DELETE CASCADE;

-- ============================================================
-- 4) Track Separation Triggers (enforce purchase_type alignment)
-- ============================================================

-- 4a) Trigger: purchase_return_items must belong to purchase_returns where purchase_type='import'
CREATE OR REPLACE FUNCTION public.validate_return_items_track()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_purchase_type text;
BEGIN
  SELECT purchase_type INTO v_purchase_type
  FROM public.purchase_returns
  WHERE id = NEW.return_id;
  
  IF v_purchase_type IS NULL THEN
    RAISE EXCEPTION 'TRACK_VALIDATION: Parent purchase_return not found for return_id=%', NEW.return_id;
  END IF;
  
  IF v_purchase_type <> 'import' THEN
    RAISE EXCEPTION 'TRACK_VALIDATION: purchase_return_items can only be used with import returns (purchase_type=import). Got purchase_type=%', v_purchase_type;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_return_items_track ON public.purchase_return_items;
CREATE TRIGGER trg_validate_return_items_track
BEFORE INSERT ON public.purchase_return_items
FOR EACH ROW
EXECUTE FUNCTION public.validate_return_items_track();

-- 4b) Trigger: purchase_return_lines must belong to invoices where purchase_type='general'
CREATE OR REPLACE FUNCTION public.validate_return_lines_track()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_invoice_type text;
  v_purchase_type text;
BEGIN
  SELECT invoice_type, purchase_type INTO v_invoice_type, v_purchase_type
  FROM public.invoices
  WHERE id = NEW.invoice_id;
  
  IF v_invoice_type IS NULL THEN
    RAISE EXCEPTION 'TRACK_VALIDATION: Parent invoice not found for invoice_id=%', NEW.invoice_id;
  END IF;
  
  -- For purchase_return_lines, the parent invoice should be a purchase_return type
  -- and must be general (not import which uses purchase_return_items)
  IF v_invoice_type = 'purchase_return' AND v_purchase_type = 'import' THEN
    RAISE EXCEPTION 'TRACK_VALIDATION: purchase_return_lines cannot be used with import returns. Use purchase_return_items instead.';
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_return_lines_track ON public.purchase_return_lines;
CREATE TRIGGER trg_validate_return_lines_track
BEFORE INSERT ON public.purchase_return_lines
FOR EACH ROW
EXECUTE FUNCTION public.validate_return_lines_track();

-- ============================================================
-- 5) Indexes for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_purchase_return_lines_invoice_id 
ON public.purchase_return_lines(invoice_id);

CREATE INDEX IF NOT EXISTS idx_purchase_return_items_return_id 
ON public.purchase_return_items(return_id);

CREATE INDEX IF NOT EXISTS idx_item_movements_movement_type 
ON public.item_movements(movement_type);