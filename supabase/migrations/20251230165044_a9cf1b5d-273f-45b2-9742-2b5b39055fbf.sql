-- =====================================================
-- 1. تحديث جدول returns
-- =====================================================

-- إضافة الأعمدة الجديدة
ALTER TABLE returns ADD COLUMN IF NOT EXISTS return_type TEXT DEFAULT 'partial';
ALTER TABLE returns ADD COLUMN IF NOT EXISTS refund_method TEXT DEFAULT 'cash';
ALTER TABLE returns ADD COLUMN IF NOT EXISTS return_time TIME DEFAULT CURRENT_TIME;
ALTER TABLE returns ADD COLUMN IF NOT EXISTS subtotal_before_tax NUMERIC DEFAULT 0;
ALTER TABLE returns ADD COLUMN IF NOT EXISTS tax_amount NUMERIC DEFAULT 0;
ALTER TABLE returns ADD COLUMN IF NOT EXISTS bank_account_id UUID;
ALTER TABLE returns ADD COLUMN IF NOT EXISTS reference_number TEXT;

-- إضافة CHECK constraints
ALTER TABLE returns DROP CONSTRAINT IF EXISTS returns_return_type_check;
ALTER TABLE returns ADD CONSTRAINT returns_return_type_check CHECK (return_type IN ('partial', 'full'));

ALTER TABLE returns DROP CONSTRAINT IF EXISTS returns_refund_method_check;
ALTER TABLE returns ADD CONSTRAINT returns_refund_method_check CHECK (refund_method IN ('cash', 'card', 'store_credit'));

-- =====================================================
-- 2. تحديث جدول return_items
-- =====================================================

-- إضافة أعمدة الكميات والتفاصيل
ALTER TABLE return_items ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1;
ALTER TABLE return_items ADD COLUMN IF NOT EXISTS original_quantity INTEGER DEFAULT 1;
ALTER TABLE return_items ADD COLUMN IF NOT EXISTS previously_returned INTEGER DEFAULT 0;
ALTER TABLE return_items ADD COLUMN IF NOT EXISTS unit_price NUMERIC DEFAULT 0;
ALTER TABLE return_items ADD COLUMN IF NOT EXISTS discount_amount NUMERIC DEFAULT 0;
ALTER TABLE return_items ADD COLUMN IF NOT EXISTS tax_rate NUMERIC DEFAULT 0.15;
ALTER TABLE return_items ADD COLUMN IF NOT EXISTS tax_amount NUMERIC DEFAULT 0;
ALTER TABLE return_items ADD COLUMN IF NOT EXISTS line_total NUMERIC DEFAULT 0;
ALTER TABLE return_items ADD COLUMN IF NOT EXISTS return_reason TEXT;
ALTER TABLE return_items ADD COLUMN IF NOT EXISTS barcode TEXT;
ALTER TABLE return_items ADD COLUMN IF NOT EXISTS item_code TEXT;
ALTER TABLE return_items ADD COLUMN IF NOT EXISTS item_name TEXT;

-- =====================================================
-- 3. تحديث جدول item_movements
-- =====================================================

-- إضافة return_id للربط المباشر
ALTER TABLE item_movements ADD COLUMN IF NOT EXISTS return_id UUID REFERENCES returns(id);

-- =====================================================
-- 4. تحديث جدول credit_notes
-- =====================================================

-- إضافة أعمدة الربط
ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS sale_id UUID REFERENCES sales(id);
ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS related_return_id UUID REFERENCES returns(id);
ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS credit_note_type TEXT DEFAULT 'financial';

ALTER TABLE credit_notes DROP CONSTRAINT IF EXISTS credit_notes_type_check;
ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_type_check CHECK (credit_note_type IN ('financial', 'inventory'));

-- =====================================================
-- 5. إنشاء الدوال
-- =====================================================

-- دالة حساب الكمية المتاحة للإرجاع
CREATE OR REPLACE FUNCTION get_available_return_quantity_pos(
  p_sale_id UUID, 
  p_item_id UUID
) RETURNS INTEGER AS $$
DECLARE
  original_qty INTEGER;
  returned_qty INTEGER;
BEGIN
  -- الكمية الأصلية من sale_items
  SELECT COUNT(*) INTO original_qty
  FROM sale_items 
  WHERE sale_id = p_sale_id AND item_id = p_item_id;
  
  -- الكمية المرتجعة سابقاً
  SELECT COALESCE(SUM(ri.quantity), 0) INTO returned_qty
  FROM return_items ri
  JOIN returns r ON ri.return_id = r.id
  WHERE r.sale_id = p_sale_id AND ri.item_id = p_item_id;
  
  RETURN GREATEST(original_qty - returned_qty, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- دالة توليد رقم مرتجع POS
CREATE OR REPLACE FUNCTION generate_pos_return_code()
RETURNS TEXT AS $$
DECLARE
  today_str TEXT;
  return_count INTEGER;
BEGIN
  today_str := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
  
  SELECT COUNT(*) + 1 INTO return_count
  FROM returns
  WHERE return_code LIKE 'POSR-' || today_str || '%';
  
  RETURN 'POSR-' || today_str || '-' || LPAD(return_count::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =====================================================
-- 6. إنشاء الـ Triggers
-- =====================================================

-- Trigger للتحقق من عدم تجاوز الكمية المتاحة
CREATE OR REPLACE FUNCTION validate_return_quantity()
RETURNS TRIGGER AS $$
DECLARE
  available_qty INTEGER;
  sale_id_val UUID;
BEGIN
  -- جلب sale_id من المرتجع
  SELECT sale_id INTO sale_id_val FROM returns WHERE id = NEW.return_id;
  
  -- إذا لم يكن هناك sale_id، تخطي التحقق
  IF sale_id_val IS NULL THEN
    RETURN NEW;
  END IF;
  
  -- حساب الكمية المتاحة
  available_qty := get_available_return_quantity_pos(sale_id_val, NEW.item_id);
  
  -- إضافة الكمية الحالية إذا كان تحديث
  IF TG_OP = 'UPDATE' AND OLD.item_id = NEW.item_id THEN
    available_qty := available_qty + COALESCE(OLD.quantity, 1);
  END IF;
  
  -- التحقق
  IF COALESCE(NEW.quantity, 1) > available_qty THEN
    RAISE EXCEPTION 'الكمية المراد إرجاعها (%) أكبر من الكمية المتاحة للإرجاع (%)', 
      COALESCE(NEW.quantity, 1), available_qty;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trigger_validate_return_quantity ON return_items;
CREATE TRIGGER trigger_validate_return_quantity
  BEFORE INSERT OR UPDATE ON return_items
  FOR EACH ROW
  EXECUTE FUNCTION validate_return_quantity();

-- Trigger لضمان ربط حركة المخزون بالمرتجع
CREATE OR REPLACE FUNCTION validate_return_movement()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.movement_type = 'RETURN_FROM_SALE' AND NEW.return_id IS NULL AND NEW.reference_type != 'pos_return' THEN
    RAISE EXCEPTION 'حركة المخزون من نوع RETURN_FROM_SALE يجب أن تكون مرتبطة بسجل مرتجع';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trigger_validate_return_movement ON item_movements;
CREATE TRIGGER trigger_validate_return_movement
  BEFORE INSERT ON item_movements
  FOR EACH ROW
  EXECUTE FUNCTION validate_return_movement();

-- Trigger لمنع التداخل بين POS Return و POS Credit Note
CREATE OR REPLACE FUNCTION prevent_duplicate_credit_return()
RETURNS TRIGGER AS $$
DECLARE
  existing_return_count INTEGER;
BEGIN
  -- التحقق من وجود مرتجع لنفس الفاتورة
  IF NEW.sale_id IS NOT NULL AND NEW.credit_note_type = 'inventory' THEN
    SELECT COUNT(*) INTO existing_return_count
    FROM returns 
    WHERE sale_id = NEW.sale_id;
    
    IF existing_return_count > 0 THEN
      RAISE EXCEPTION 'يوجد مرتجع مبيعات لهذه الفاتورة. استخدم شاشة المرتجعات للعمليات التي تتضمن حركة مخزون.';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trigger_prevent_duplicate_credit_return ON credit_notes;
CREATE TRIGGER trigger_prevent_duplicate_credit_return
  BEFORE INSERT ON credit_notes
  FOR EACH ROW
  EXECUTE FUNCTION prevent_duplicate_credit_return();

-- =====================================================
-- 7. إضافة شاشة POS Return للصلاحيات
-- =====================================================

INSERT INTO screens (screen_key, screen_name, screen_name_en, screen_path, icon, sort_order)
VALUES ('pos_return', 'مرتجع مبيعات POS', 'POS Return', '/pos/return', 'RotateCcw', 26)
ON CONFLICT (screen_key) DO NOTHING;