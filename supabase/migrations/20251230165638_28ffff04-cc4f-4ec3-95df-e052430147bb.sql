-- =============================================
-- POS Return Standard Controls - Database Layer
-- =============================================

-- 1. Create validation function for mandatory sale_id
CREATE OR REPLACE FUNCTION validate_return_has_sale()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.sale_id IS NULL THEN
    RAISE EXCEPTION 'لا يمكن إنشاء مرتجع بدون اختيار فاتورة أصلية. A return cannot be created without selecting an original invoice.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- 2. Create trigger for mandatory sale validation
DROP TRIGGER IF EXISTS trigger_validate_return_has_sale ON returns;
CREATE TRIGGER trigger_validate_return_has_sale
  BEFORE INSERT OR UPDATE ON returns
  FOR EACH ROW
  EXECUTE FUNCTION validate_return_has_sale();

-- 3. Update returns with NULL sale_id (if any exist) before adding NOT NULL constraint
-- First check if there are any returns without sale_id
DO $$
DECLARE
  null_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_count FROM returns WHERE sale_id IS NULL;
  
  IF null_count > 0 THEN
    -- Delete orphan returns that have no sale_id (they are invalid data)
    DELETE FROM return_items WHERE return_id IN (SELECT id FROM returns WHERE sale_id IS NULL);
    DELETE FROM returns WHERE sale_id IS NULL;
    RAISE NOTICE 'Deleted % orphan returns without sale_id', null_count;
  END IF;
END $$;

-- 4. Make sale_id NOT NULL (only if not already)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'returns' 
    AND column_name = 'sale_id' 
    AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE returns ALTER COLUMN sale_id SET NOT NULL;
  END IF;
END $$;

-- 5. Add CHECK constraint for additional safety (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'returns_sale_id_required' 
    AND conrelid = 'returns'::regclass
  ) THEN
    ALTER TABLE returns ADD CONSTRAINT returns_sale_id_required CHECK (sale_id IS NOT NULL);
  END IF;
END $$;

-- 6. Enhance the quantity validation function
CREATE OR REPLACE FUNCTION validate_return_quantity()
RETURNS TRIGGER AS $$
DECLARE
  available_qty INTEGER;
  sale_id_val UUID;
BEGIN
  -- Get sale_id from the return
  SELECT sale_id INTO sale_id_val FROM returns WHERE id = NEW.return_id;
  
  -- If no sale_id, skip validation (trigger on returns will handle this)
  IF sale_id_val IS NULL THEN
    RETURN NEW;
  END IF;
  
  -- Calculate available quantity
  available_qty := get_available_return_quantity_pos(sale_id_val, NEW.item_id);
  
  -- Add back current quantity if updating
  IF TG_OP = 'UPDATE' AND OLD.item_id = NEW.item_id THEN
    available_qty := available_qty + COALESCE(OLD.quantity, 1);
  END IF;
  
  -- Strict validation
  IF COALESCE(NEW.quantity, 1) > available_qty THEN
    RAISE EXCEPTION 'الكمية المراد إرجاعها (%) أكبر من الكمية المتاحة للإرجاع (%). Cannot return quantity (%) greater than available (%).', 
      COALESCE(NEW.quantity, 1), available_qty, COALESCE(NEW.quantity, 1), available_qty;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- 7. Enhance prevent duplicate credit return function
CREATE OR REPLACE FUNCTION prevent_duplicate_credit_return()
RETURNS TRIGGER AS $$
DECLARE
  existing_return_count INTEGER;
  existing_return_code TEXT;
BEGIN
  -- Check for existing return for the same sale
  IF NEW.sale_id IS NOT NULL AND NEW.credit_note_type = 'inventory' THEN
    SELECT COUNT(*), MAX(return_code) INTO existing_return_count, existing_return_code
    FROM returns 
    WHERE sale_id = NEW.sale_id;
    
    IF existing_return_count > 0 THEN
      RAISE EXCEPTION 'يوجد مرتجع مبيعات لهذه الفاتورة (%). استخدم شاشة المرتجعات للعمليات التي تتضمن حركة مخزون. Existing return found: %', 
        existing_return_code, existing_return_code;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- 8. Enhance validate return movement function  
CREATE OR REPLACE FUNCTION validate_return_movement()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.movement_type = 'RETURN_FROM_SALE' THEN
    -- Must have return_id OR reference_type = 'pos_return'
    IF NEW.return_id IS NULL AND NEW.reference_type != 'pos_return' THEN
      RAISE EXCEPTION 'حركة المخزون من نوع RETURN_FROM_SALE يجب أن تكون مرتبطة بسجل مرتجع. Movement type RETURN_FROM_SALE must be linked to a return record.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;