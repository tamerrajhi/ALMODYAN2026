-- Phase P1: Schema parity for operational screens
-- Adds missing columns and tables expected by the UI

-- invoices: add sale_id, return_id, paid_amount, remaining_amount, zatca_status
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sale_id UUID REFERENCES sales(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS return_id UUID REFERENCES returns(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(15,2) DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(15,2) DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS zatca_status TEXT DEFAULT 'pending';

-- payments: add invoice_id for direct invoice linkage
ALTER TABLE payments ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES invoices(id);

-- sales: add sale_code
ALTER TABLE sales ADD COLUMN IF NOT EXISTS sale_code TEXT;

-- jewelry_items: add fields expected by UI
ALTER TABLE jewelry_items ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE jewelry_items ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE jewelry_items ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE jewelry_items ADD COLUMN IF NOT EXISTS metal TEXT;
ALTER TABLE jewelry_items ADD COLUMN IF NOT EXISTS g_weight NUMERIC(10,3);
ALTER TABLE jewelry_items ADD COLUMN IF NOT EXISTS d_weight NUMERIC(10,3);
ALTER TABLE jewelry_items ADD COLUMN IF NOT EXISTS b_weight NUMERIC(10,3);
ALTER TABLE jewelry_items ADD COLUMN IF NOT EXISTS clarity TEXT;
ALTER TABLE jewelry_items ADD COLUMN IF NOT EXISTS stone TEXT;
ALTER TABLE jewelry_items ADD COLUMN IF NOT EXISTS sold_at TIMESTAMPTZ;

-- sale_items: add sale_price alias column
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS sale_price NUMERIC(15,2);

-- return_items: add return_price alias column
ALTER TABLE return_items ADD COLUMN IF NOT EXISTS return_price NUMERIC(15,2);

-- purchase_requisitions: add missing columns
ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS requisition_number TEXT;
ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS required_date DATE;
ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS requested_by UUID;
ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS department_id UUID;

-- suppliers: add supplier_name alias column
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS supplier_name TEXT;
-- Set supplier_name from name where null
UPDATE suppliers SET supplier_name = name WHERE supplier_name IS NULL;

-- customers: ensure full_name exists (alias for name)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS full_name TEXT;
UPDATE customers SET full_name = name WHERE full_name IS NULL;

-- Create departments table if not exists
CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_name TEXT NOT NULL,
  department_name_en TEXT,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create employees table if not exists
CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id),
  employee_code TEXT,
  department_id UUID REFERENCES departments(id),
  position TEXT,
  hire_date DATE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create purchase_requisition_items table if not exists
CREATE TABLE IF NOT EXISTS purchase_requisition_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_id UUID REFERENCES purchase_requisitions(id),
  item_description TEXT,
  quantity NUMERIC(10,2) DEFAULT 1,
  estimated_unit_price NUMERIC(15,2) DEFAULT 0,
  jewelry_item_id UUID REFERENCES jewelry_items(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create sales_invoice_items table if not exists
CREATE TABLE IF NOT EXISTS sales_invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id),
  jewelry_item_id UUID REFERENCES jewelry_items(id),
  quantity NUMERIC(10,2) DEFAULT 1,
  unit_price NUMERIC(15,2) DEFAULT 0,
  total_price NUMERIC(15,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Set requisition_number from pr_no where null
UPDATE purchase_requisitions SET requisition_number = pr_no WHERE requisition_number IS NULL AND pr_no IS NOT NULL;
