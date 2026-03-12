-- =============================================
-- تحسين دورة طلبات الشراء وأوامر الشراء
-- =============================================

-- 1. إضافة أعمدة جديدة لجدول أوامر الشراء
ALTER TABLE public.purchase_orders 
ADD COLUMN IF NOT EXISTS payment_terms text,
ADD COLUMN IF NOT EXISTS delivery_terms text,
ADD COLUMN IF NOT EXISTS shipping_method text,
ADD COLUMN IF NOT EXISTS currency text DEFAULT 'SAR',
ADD COLUMN IF NOT EXISTS vat_rate numeric DEFAULT 15,
ADD COLUMN IF NOT EXISTS vat_amount numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS sent_to_supplier boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS sent_at timestamptz,
ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES branches(id),
ADD COLUMN IF NOT EXISTS cost_center_id uuid REFERENCES cost_centers(id);

-- 2. إضافة أعمدة جديدة لجدول بنود أوامر الشراء
ALTER TABLE public.purchase_order_items 
ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES branches(id),
ADD COLUMN IF NOT EXISTS cost_center_id uuid REFERENCES cost_centers(id),
ADD COLUMN IF NOT EXISTS pr_item_id uuid,
ADD COLUMN IF NOT EXISTS vat_amount numeric DEFAULT 0;

-- 3. إضافة أعمدة لبنود طلب الشراء
ALTER TABLE public.purchase_requisition_items
ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES branches(id),
ADD COLUMN IF NOT EXISTS cost_center_id uuid REFERENCES cost_centers(id),
ADD COLUMN IF NOT EXISTS converted_quantity numeric DEFAULT 0;

-- 4. إضافة أعمدة إضافية لطلبات الشراء
ALTER TABLE public.purchase_requisitions
ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES branches(id),
ADD COLUMN IF NOT EXISTS cost_center_id uuid REFERENCES cost_centers(id),
ADD COLUMN IF NOT EXISTS requisition_type text DEFAULT 'materials';

-- 5. إنشاء جدول ربط طلبات الشراء بأوامر الشراء (Many-to-Many)
CREATE TABLE IF NOT EXISTS public.po_pr_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    po_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    pr_id uuid NOT NULL REFERENCES purchase_requisitions(id) ON DELETE CASCADE,
    created_at timestamptz DEFAULT now(),
    created_by uuid,
    UNIQUE(po_id, pr_id)
);

-- 6. إنشاء جدول مستندات استلام البضاعة المجمعة (GRN)
CREATE TABLE IF NOT EXISTS public.goods_receipt_notes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    grn_number text NOT NULL UNIQUE,
    po_id uuid NOT NULL REFERENCES purchase_orders(id),
    receipt_date date NOT NULL DEFAULT CURRENT_DATE,
    supplier_id uuid REFERENCES suppliers(id),
    branch_id uuid REFERENCES branches(id),
    warehouse_id uuid REFERENCES branches(id),
    status text DEFAULT 'draft',
    notes text,
    received_by uuid,
    received_by_name text,
    journal_entry_id uuid REFERENCES journal_entries(id),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- 7. إنشاء جدول بنود مستند الاستلام
CREATE TABLE IF NOT EXISTS public.goods_receipt_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    grn_id uuid NOT NULL REFERENCES goods_receipt_notes(id) ON DELETE CASCADE,
    po_item_id uuid REFERENCES purchase_order_items(id),
    item_type text NOT NULL,
    description text,
    quantity_ordered numeric DEFAULT 0,
    quantity_received numeric DEFAULT 0,
    quantity_rejected numeric DEFAULT 0,
    weight_ordered numeric DEFAULT 0,
    weight_received numeric DEFAULT 0,
    unit_price numeric DEFAULT 0,
    total_amount numeric DEFAULT 0,
    warehouse_id uuid REFERENCES branches(id),
    karat_id uuid,
    gemstone_type_id uuid,
    raw_material_id uuid,
    notes text,
    created_at timestamptz DEFAULT now()
);

-- 8. إضافة أعمدة ربط فاتورة المشتريات بأمر الشراء ومستند الاستلام
ALTER TABLE public.invoices
ADD COLUMN IF NOT EXISTS po_id uuid REFERENCES purchase_orders(id),
ADD COLUMN IF NOT EXISTS grn_id uuid REFERENCES goods_receipt_notes(id);

ALTER TABLE public.purchase_invoice_lines
ADD COLUMN IF NOT EXISTS po_item_id uuid REFERENCES purchase_order_items(id),
ADD COLUMN IF NOT EXISTS grn_item_id uuid REFERENCES goods_receipt_items(id);

-- 9. إنشاء دالة لتوليد رقم مستند الاستلام
CREATE OR REPLACE FUNCTION public.generate_grn_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    today_str TEXT;
    grn_count INTEGER;
BEGIN
    today_str := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
    
    SELECT COUNT(*) + 1 INTO grn_count
    FROM public.goods_receipt_notes
    WHERE grn_number LIKE 'GRN-' || today_str || '%';
    
    RETURN 'GRN-' || today_str || '-' || LPAD(grn_count::TEXT, 4, '0');
END;
$function$;

-- 10. دالة تحديث حالة طلب الشراء بعد التحويل
CREATE OR REPLACE FUNCTION public.update_pr_conversion_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_pr_id uuid;
    v_total_items integer;
    v_converted_items integer;
BEGIN
    -- Get PR ID from the link
    v_pr_id := COALESCE(NEW.pr_id, OLD.pr_id);
    
    IF v_pr_id IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    
    -- Count total and converted items
    SELECT COUNT(*) INTO v_total_items
    FROM purchase_requisition_items WHERE requisition_id = v_pr_id;
    
    SELECT COUNT(*) INTO v_converted_items
    FROM purchase_requisition_items 
    WHERE requisition_id = v_pr_id AND converted_quantity >= quantity;
    
    -- Update PR status
    IF v_converted_items = 0 THEN
        UPDATE purchase_requisitions 
        SET status = 'approved' 
        WHERE id = v_pr_id AND status IN ('partially_converted', 'fully_converted');
    ELSIF v_converted_items >= v_total_items THEN
        UPDATE purchase_requisitions 
        SET status = 'fully_converted' 
        WHERE id = v_pr_id;
    ELSE
        UPDATE purchase_requisitions 
        SET status = 'partially_converted' 
        WHERE id = v_pr_id;
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$function$;

-- 11. Trigger لتحديث حالة PR
DROP TRIGGER IF EXISTS update_pr_status_on_link ON po_pr_links;
CREATE TRIGGER update_pr_status_on_link
AFTER INSERT OR DELETE ON po_pr_links
FOR EACH ROW EXECUTE FUNCTION update_pr_conversion_status();

-- 12. دالة تحديث حالة أمر الشراء بعد الاستلام
CREATE OR REPLACE FUNCTION public.update_po_receipt_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_po_id uuid;
    v_total_qty numeric;
    v_received_qty numeric;
BEGIN
    v_po_id := COALESCE(NEW.po_id, OLD.po_id);
    
    IF v_po_id IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    
    -- Calculate totals for this PO
    SELECT 
        COALESCE(SUM(COALESCE(quantity, weight_grams)), 0),
        COALESCE(SUM(COALESCE(received_quantity, received_weight)), 0)
    INTO v_total_qty, v_received_qty
    FROM purchase_order_items 
    WHERE po_id = v_po_id;
    
    -- Update PO status
    IF v_received_qty = 0 THEN
        UPDATE purchase_orders SET status = 'approved' WHERE id = v_po_id AND status IN ('partially_received', 'fully_received');
    ELSIF v_received_qty >= v_total_qty THEN
        UPDATE purchase_orders SET status = 'fully_received' WHERE id = v_po_id;
    ELSE
        UPDATE purchase_orders SET status = 'partially_received' WHERE id = v_po_id;
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$function$;

-- 13. Trigger لتحديث حالة PO
DROP TRIGGER IF EXISTS update_po_status_on_receipt ON purchase_order_receipts;
CREATE TRIGGER update_po_status_on_receipt
AFTER INSERT OR UPDATE OR DELETE ON purchase_order_receipts
FOR EACH ROW EXECUTE FUNCTION update_po_receipt_status();

-- 14. تفعيل RLS على الجداول الجديدة
ALTER TABLE public.po_pr_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goods_receipt_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goods_receipt_items ENABLE ROW LEVEL SECURITY;

-- 15. سياسات RLS
CREATE POLICY "Allow all for authenticated users" ON public.po_pr_links
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for authenticated users" ON public.goods_receipt_notes
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for authenticated users" ON public.goods_receipt_items
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 16. إضافة الفهارس للأداء
CREATE INDEX IF NOT EXISTS idx_po_pr_links_po_id ON po_pr_links(po_id);
CREATE INDEX IF NOT EXISTS idx_po_pr_links_pr_id ON po_pr_links(pr_id);
CREATE INDEX IF NOT EXISTS idx_grn_po_id ON goods_receipt_notes(po_id);
CREATE INDEX IF NOT EXISTS idx_grn_items_grn_id ON goods_receipt_items(grn_id);
CREATE INDEX IF NOT EXISTS idx_grn_items_po_item_id ON goods_receipt_items(po_item_id);
CREATE INDEX IF NOT EXISTS idx_invoices_po_id ON invoices(po_id);
CREATE INDEX IF NOT EXISTS idx_invoices_grn_id ON invoices(grn_id);