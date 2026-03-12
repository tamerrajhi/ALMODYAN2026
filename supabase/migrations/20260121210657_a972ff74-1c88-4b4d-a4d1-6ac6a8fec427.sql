-- Purchasing V2 Big-Bang: Idempotent Tables + Generators + RPCs (NO RLS/Views)

-- Tables with IF NOT EXISTS
CREATE TABLE IF NOT EXISTS public.purchase_requisitions_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_number text NOT NULL,
  requester_id uuid, requester_name text, department_id uuid, branch_id uuid,
  priority text DEFAULT 'normal', status text DEFAULT 'draft', notes text,
  total_amount numeric DEFAULT 0, required_approval_level integer DEFAULT 1,
  current_approval_level integer DEFAULT 0, submitted_at timestamptz,
  approved_at timestamptz, rejected_at timestamptz, rejection_reason text,
  created_by uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.purchase_requisition_items_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_id uuid NOT NULL, item_description text NOT NULL,
  quantity numeric DEFAULT 1, unit_price numeric DEFAULT 0, notes text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pr_approval_history_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_id uuid NOT NULL, approval_level integer NOT NULL, action text NOT NULL,
  performed_by uuid, performed_by_name text, notes text, performed_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pr_approval_thresholds_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  threshold_name text NOT NULL, min_amount numeric DEFAULT 0, max_amount numeric,
  required_level integer DEFAULT 1, approver_role text, is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.purchase_orders_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL, supplier_id uuid, branch_id uuid, status text DEFAULT 'draft',
  order_date date DEFAULT CURRENT_DATE, expected_delivery_date date, notes text,
  subtotal numeric DEFAULT 0, tax_amount numeric DEFAULT 0, total_amount numeric DEFAULT 0,
  submitted_at timestamptz, approved_at timestamptz, sent_at timestamptz,
  received_at timestamptz, cancelled_at timestamptz, cancellation_reason text,
  created_by uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.purchase_order_items_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL, requisition_item_id uuid, item_description text NOT NULL,
  quantity numeric DEFAULT 1, unit_price numeric DEFAULT 0, quantity_received numeric DEFAULT 0,
  notes text, created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.purchase_order_receipts_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL, order_item_id uuid NOT NULL, receipt_number text,
  quantity_received numeric NOT NULL, received_by uuid, received_by_name text,
  received_at timestamptz DEFAULT now(), notes text, created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.po_pr_links_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL, requisition_id uuid NOT NULL, created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pr_v2_status ON public.purchase_requisitions_v2(status);
CREATE INDEX IF NOT EXISTS idx_po_v2_status ON public.purchase_orders_v2(status);
CREATE INDEX IF NOT EXISTS idx_po_items_v2_order ON public.purchase_order_items_v2(order_id);
CREATE INDEX IF NOT EXISTS idx_po_pr_links_v2_req ON public.po_pr_links_v2(requisition_id);

-- Generators
CREATE OR REPLACE FUNCTION public.generate_pr_number_v2() RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_num text;
BEGIN
  SELECT 'PR-' || to_char(CURRENT_DATE,'YYYYMMDD') || '-' || lpad((COALESCE(MAX(NULLIF(regexp_replace(requisition_number,'^PR-\d{8}-',''),'')::int),0)+1)::text,4,'0')
  INTO v_num FROM purchase_requisitions_v2 WHERE requisition_number LIKE 'PR-' || to_char(CURRENT_DATE,'YYYYMMDD') || '-%';
  RETURN v_num;
END; $$;

CREATE OR REPLACE FUNCTION public.generate_po_number_v2() RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_num text;
BEGIN
  SELECT 'PO-' || to_char(CURRENT_DATE,'YYYYMMDD') || '-' || lpad((COALESCE(MAX(NULLIF(regexp_replace(order_number,'^PO-\d{8}-',''),'')::int),0)+1)::text,4,'0')
  INTO v_num FROM purchase_orders_v2 WHERE order_number LIKE 'PO-' || to_char(CURRENT_DATE,'YYYYMMDD') || '-%';
  RETURN v_num;
END; $$;

CREATE OR REPLACE FUNCTION public.generate_receipt_number_v2() RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_num text;
BEGIN
  SELECT 'RCV-' || to_char(CURRENT_DATE,'YYYYMMDD') || '-' || lpad((COALESCE(MAX(NULLIF(regexp_replace(receipt_number,'^RCV-\d{8}-',''),'')::int),0)+1)::text,4,'0')
  INTO v_num FROM purchase_order_receipts_v2 WHERE receipt_number LIKE 'RCV-' || to_char(CURRENT_DATE,'YYYYMMDD') || '-%';
  RETURN v_num;
END; $$;