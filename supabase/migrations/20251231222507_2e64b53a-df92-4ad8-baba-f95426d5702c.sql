-- =====================================================
-- Sales Returns Enhancement: Database Triggers
-- =====================================================

-- 1. Enhanced function to get available return quantity for POS
-- This function calculates the available quantity considering all previous returns
CREATE OR REPLACE FUNCTION public.get_available_return_quantity_pos(p_sale_id uuid, p_item_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  original_qty INTEGER;
  returned_qty INTEGER;
BEGIN
  -- الكمية الأصلية من sale_items (عدد السجلات لهذا الصنف في هذه الفاتورة)
  SELECT COUNT(*) INTO original_qty
  FROM sale_items 
  WHERE sale_id = p_sale_id AND item_id = p_item_id;
  
  -- الكمية المرتجعة سابقاً (مجموع كميات الإرجاع من return_items)
  SELECT COALESCE(SUM(ri.quantity), 0) INTO returned_qty
  FROM return_items ri
  JOIN returns r ON ri.return_id = r.id
  WHERE r.sale_id = p_sale_id AND ri.item_id = p_item_id;
  
  RETURN GREATEST(original_qty - returned_qty, 0);
END;
$$;

-- 2. Trigger function to validate return quantities
CREATE OR REPLACE FUNCTION public.validate_return_quantity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
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
$$;

-- Drop existing trigger if exists and create new one
DROP TRIGGER IF EXISTS check_return_quantity ON return_items;
CREATE TRIGGER check_return_quantity
  BEFORE INSERT OR UPDATE ON return_items
  FOR EACH ROW
  EXECUTE FUNCTION validate_return_quantity();

-- 3. Trigger function to validate that returns must have a sale_id
CREATE OR REPLACE FUNCTION public.validate_return_has_sale()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.sale_id IS NULL THEN
    RAISE EXCEPTION 'لا يمكن إنشاء مرتجع بدون اختيار فاتورة أصلية. A return cannot be created without selecting an original invoice.';
  END IF;
  RETURN NEW;
END;
$$;

-- Drop existing trigger if exists and create new one
DROP TRIGGER IF EXISTS check_return_has_sale ON returns;
CREATE TRIGGER check_return_has_sale
  BEFORE INSERT OR UPDATE ON returns
  FOR EACH ROW
  EXECUTE FUNCTION validate_return_has_sale();

-- 4. Trigger function to restore inventory when return is deleted
CREATE OR REPLACE FUNCTION public.restore_inventory_on_return_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  return_sale_id UUID;
  original_sale_created_at TIMESTAMPTZ;
BEGIN
  -- Get the sale_id from the return
  SELECT sale_id INTO return_sale_id FROM returns WHERE id = OLD.return_id;
  
  -- Get original sale creation date
  SELECT created_at INTO original_sale_created_at 
  FROM sales WHERE id = return_sale_id;
  
  -- Restore the item status to sold
  UPDATE jewelry_items
  SET 
    sold_at = original_sale_created_at,
    status = 'sold',
    sale_id = return_sale_id
  WHERE id = OLD.item_id;
  
  -- Record a corrective movement
  INSERT INTO item_movements (
    item_id,
    movement_type,
    from_branch_id,
    reference_type,
    reference_id,
    notes,
    performed_by
  )
  SELECT 
    OLD.item_id,
    'RETURN_CANCELLED',
    r.branch_id,
    'return_cancelled',
    OLD.return_id,
    'إلغاء مرتجع - إعادة حالة المباع / Return cancelled - restored to sold',
    (SELECT full_name FROM profiles WHERE user_id = auth.uid())
  FROM returns r
  WHERE r.id = OLD.return_id;
  
  RETURN OLD;
END;
$$;

-- Drop existing trigger if exists and create new one
DROP TRIGGER IF EXISTS restore_on_return_item_delete ON return_items;
CREATE TRIGGER restore_on_return_item_delete
  AFTER DELETE ON return_items
  FOR EACH ROW
  EXECUTE FUNCTION restore_inventory_on_return_delete();

-- 5. Trigger to validate movement type for returns
CREATE OR REPLACE FUNCTION public.validate_return_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.movement_type = 'RETURN_FROM_SALE' THEN
    -- Must have return_id OR reference_type = 'pos_return'
    IF NEW.return_id IS NULL AND NEW.reference_type != 'pos_return' THEN
      RAISE EXCEPTION 'حركة المخزون من نوع RETURN_FROM_SALE يجب أن تكون مرتبطة بسجل مرتجع. Movement type RETURN_FROM_SALE must be linked to a return record.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Drop existing trigger if exists and create new one
DROP TRIGGER IF EXISTS check_return_movement ON item_movements;
CREATE TRIGGER check_return_movement
  BEFORE INSERT OR UPDATE ON item_movements
  FOR EACH ROW
  EXECUTE FUNCTION validate_return_movement();