-- Expand suppliers table with all required fields
ALTER TABLE public.suppliers 
ADD COLUMN IF NOT EXISTS supplier_code TEXT,
ADD COLUMN IF NOT EXISTS supplier_type TEXT DEFAULT 'company',
ADD COLUMN IF NOT EXISTS business_type TEXT DEFAULT 'products',
ADD COLUMN IF NOT EXISTS business_activity TEXT,
ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'السعودية',
ADD COLUMN IF NOT EXISTS city TEXT,
ADD COLUMN IF NOT EXISTS detailed_address TEXT,
ADD COLUMN IF NOT EXISTS location_lat NUMERIC,
ADD COLUMN IF NOT EXISTS location_lng NUMERIC,
ADD COLUMN IF NOT EXISTS mobile_phone TEXT,
ADD COLUMN IF NOT EXISTS office_phone TEXT,
ADD COLUMN IF NOT EXISTS website TEXT,
ADD COLUMN IF NOT EXISTS contact_position TEXT,
ADD COLUMN IF NOT EXISTS commercial_register TEXT,
ADD COLUMN IF NOT EXISTS national_id TEXT,
ADD COLUMN IF NOT EXISTS license_expiry_date DATE,
ADD COLUMN IF NOT EXISTS default_currency TEXT DEFAULT 'SAR',
ADD COLUMN IF NOT EXISTS payment_terms TEXT DEFAULT 'net_30',
ADD COLUMN IF NOT EXISTS credit_limit NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS opening_balance NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS current_balance NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS default_payment_method TEXT DEFAULT 'cash',
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active',
ADD COLUMN IF NOT EXISTS internal_notes TEXT,
ADD COLUMN IF NOT EXISTS tags TEXT[],
ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.chart_of_accounts(id);

-- Create unique index for supplier_code
CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_code ON public.suppliers(supplier_code) WHERE supplier_code IS NOT NULL;

-- Create unique index for vat_number
CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_vat ON public.suppliers(vat_number) WHERE vat_number IS NOT NULL AND vat_number != '';

-- Create supplier_documents table for file uploads
CREATE TABLE IF NOT EXISTS public.supplier_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  document_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  expiry_date DATE,
  notes TEXT,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on supplier_documents
ALTER TABLE public.supplier_documents ENABLE ROW LEVEL SECURITY;

-- RLS policies for supplier_documents
CREATE POLICY "Authenticated users can view supplier documents"
ON public.supplier_documents FOR SELECT
USING (true);

CREATE POLICY "Users with permissions can insert supplier documents"
ON public.supplier_documents FOR INSERT
WITH CHECK (true);

CREATE POLICY "Users with permissions can update supplier documents"
ON public.supplier_documents FOR UPDATE
USING (true);

CREATE POLICY "Users with permissions can delete supplier documents"
ON public.supplier_documents FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));

-- Function to generate supplier code
CREATE OR REPLACE FUNCTION public.generate_supplier_code()
RETURNS TRIGGER AS $$
DECLARE
  next_num INTEGER;
BEGIN
  IF NEW.supplier_code IS NULL THEN
    SELECT COALESCE(MAX(CAST(SUBSTRING(supplier_code FROM 5) AS INTEGER)), 0) + 1
    INTO next_num
    FROM public.suppliers
    WHERE supplier_code LIKE 'SUP-%';
    
    NEW.supplier_code := 'SUP-' || LPAD(next_num::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for auto-generating supplier code
DROP TRIGGER IF EXISTS generate_supplier_code_trigger ON public.suppliers;
CREATE TRIGGER generate_supplier_code_trigger
BEFORE INSERT ON public.suppliers
FOR EACH ROW
EXECUTE FUNCTION public.generate_supplier_code();

-- Update existing suppliers with codes using a subquery
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) as rn
  FROM public.suppliers
  WHERE supplier_code IS NULL
)
UPDATE public.suppliers s
SET supplier_code = 'SUP-' || LPAD(n.rn::TEXT, 5, '0')
FROM numbered n
WHERE s.id = n.id;