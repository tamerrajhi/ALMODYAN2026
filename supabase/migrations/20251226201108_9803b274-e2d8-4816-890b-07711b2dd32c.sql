-- ==========================================
-- 1. Create purchase_requisitions table
-- ==========================================

CREATE TABLE public.purchase_requisitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_number text NOT NULL UNIQUE,
  requested_by uuid NOT NULL,
  branch_id uuid REFERENCES branches(id),
  status text NOT NULL DEFAULT 'draft',
  request_date date NOT NULL DEFAULT CURRENT_DATE,
  required_date date,
  total_estimated_amount numeric DEFAULT 0,
  priority text DEFAULT 'normal',
  justification text,
  notes text,
  approved_by uuid,
  approved_at timestamptz,
  rejection_reason text,
  converted_to_po_id uuid,
  converted_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  CONSTRAINT valid_status CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'converted'))
);

-- ==========================================
-- 2. Create purchase_requisition_items table
-- ==========================================

CREATE TABLE public.purchase_requisition_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_id uuid NOT NULL REFERENCES purchase_requisitions(id) ON DELETE CASCADE,
  item_description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  unit text DEFAULT 'قطعة',
  estimated_unit_price numeric DEFAULT 0,
  estimated_total numeric GENERATED ALWAYS AS (quantity * estimated_unit_price) STORED,
  supplier_id uuid REFERENCES suppliers(id),
  notes text,
  created_at timestamptz DEFAULT now()
);

-- ==========================================
-- 3. Enable RLS
-- ==========================================

ALTER TABLE public.purchase_requisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_requisition_items ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- 4. RLS Policies for purchase_requisitions
-- ==========================================

-- Users can view requisitions from their branch or that they created
CREATE POLICY "Users can view requisitions" ON public.purchase_requisitions
FOR SELECT USING (
  has_role(auth.uid(), 'admin') OR 
  requested_by = auth.uid() OR
  branch_id = ANY(get_user_branches(auth.uid()))
);

-- Users can create requisitions
CREATE POLICY "Users can create requisitions" ON public.purchase_requisitions
FOR INSERT WITH CHECK (
  has_role(auth.uid(), 'admin') OR 
  requested_by = auth.uid() OR
  branch_id = ANY(get_user_branches(auth.uid()))
);

-- Users can update their own draft requisitions, admins can update any
CREATE POLICY "Users can update requisitions" ON public.purchase_requisitions
FOR UPDATE USING (
  has_role(auth.uid(), 'admin') OR 
  (requested_by = auth.uid() AND status = 'draft')
);

-- Only admins can delete
CREATE POLICY "Admins can delete requisitions" ON public.purchase_requisitions
FOR DELETE USING (has_role(auth.uid(), 'admin'));

-- ==========================================
-- 5. RLS Policies for requisition items
-- ==========================================

CREATE POLICY "Users can view requisition items" ON public.purchase_requisition_items
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM purchase_requisitions pr 
    WHERE pr.id = requisition_id 
    AND (has_role(auth.uid(), 'admin') OR pr.requested_by = auth.uid() OR pr.branch_id = ANY(get_user_branches(auth.uid())))
  )
);

CREATE POLICY "Users can insert requisition items" ON public.purchase_requisition_items
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM purchase_requisitions pr 
    WHERE pr.id = requisition_id 
    AND (has_role(auth.uid(), 'admin') OR pr.requested_by = auth.uid())
  )
);

CREATE POLICY "Users can update requisition items" ON public.purchase_requisition_items
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM purchase_requisitions pr 
    WHERE pr.id = requisition_id 
    AND (has_role(auth.uid(), 'admin') OR (pr.requested_by = auth.uid() AND pr.status = 'draft'))
  )
);

CREATE POLICY "Users can delete requisition items" ON public.purchase_requisition_items
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM purchase_requisitions pr 
    WHERE pr.id = requisition_id 
    AND (has_role(auth.uid(), 'admin') OR (pr.requested_by = auth.uid() AND pr.status = 'draft'))
  )
);

-- ==========================================
-- 6. Create function to generate requisition number
-- ==========================================

CREATE OR REPLACE FUNCTION generate_requisition_number()
RETURNS text AS $$
DECLARE
  next_num integer;
  year_prefix text;
BEGIN
  year_prefix := 'REQ-' || to_char(CURRENT_DATE, 'YYYY') || '-';
  
  SELECT COALESCE(MAX(
    CAST(NULLIF(regexp_replace(requisition_number, '^REQ-\d{4}-', ''), '') AS integer)
  ), 0) + 1
  INTO next_num
  FROM purchase_requisitions
  WHERE requisition_number LIKE year_prefix || '%';
  
  RETURN year_prefix || LPAD(next_num::text, 5, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ==========================================
-- 7. Create trigger to update total amount
-- ==========================================

CREATE OR REPLACE FUNCTION update_requisition_total()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE purchase_requisitions
  SET total_estimated_amount = (
    SELECT COALESCE(SUM(quantity * estimated_unit_price), 0)
    FROM purchase_requisition_items
    WHERE requisition_id = COALESCE(NEW.requisition_id, OLD.requisition_id)
  ),
  updated_at = now()
  WHERE id = COALESCE(NEW.requisition_id, OLD.requisition_id);
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER update_requisition_total_trigger
AFTER INSERT OR UPDATE OR DELETE ON purchase_requisition_items
FOR EACH ROW EXECUTE FUNCTION update_requisition_total();

-- ==========================================
-- 8. Add screen for purchase requisitions
-- ==========================================

INSERT INTO screens (screen_key, screen_name, screen_name_en, screen_path, sort_order) VALUES
  ('purchase_requisitions', 'طلبات الشراء', 'Purchase Requisitions', '/purchasing/requisitions', 9)
ON CONFLICT (screen_key) DO NOTHING;

-- ==========================================
-- 9. Add permissions for relevant roles
-- ==========================================

-- مدير المشتريات - Full access
SELECT setup_role_permissions('مدير المشتريات', 
  ARRAY['purchase_requisitions'],
  true, true, true, true);

-- موظف مشتريات - Can create and edit own
SELECT setup_role_permissions('موظف مشتريات', 
  ARRAY['purchase_requisitions'],
  true, true, true, false);

-- المدير العام, نائب المدير - Full access for approvals
SELECT setup_role_permissions('المدير العام', 
  ARRAY['purchase_requisitions'],
  true, true, true, true);

SELECT setup_role_permissions('نائب المدير العام', 
  ARRAY['purchase_requisitions'],
  true, true, true, false);

-- مدير النظام
SELECT setup_role_permissions('مدير النظام', 
  ARRAY['purchase_requisitions'],
  true, true, true, true);