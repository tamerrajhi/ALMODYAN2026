-- Add new columns to payments table for currency and document tracking
ALTER TABLE payments 
ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'SAR',
ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC DEFAULT 1,
ADD COLUMN IF NOT EXISTS document_number TEXT,
ADD COLUMN IF NOT EXISTS local_amount NUMERIC;

-- Create import_expenses table for tracking expense distribution
CREATE TABLE IF NOT EXISTS public.import_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  expense_type TEXT NOT NULL CHECK (expense_type IN ('invoice_value', 'shipping', 'customs', 'bank_fees', 'other')),
  amount NUMERIC NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'SAR',
  exchange_rate NUMERIC DEFAULT 1,
  local_amount NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on import_expenses
ALTER TABLE public.import_expenses ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for import_expenses
CREATE POLICY "Users can view import expenses" 
ON public.import_expenses 
FOR SELECT 
USING (true);

CREATE POLICY "Users can insert import expenses" 
ON public.import_expenses 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Users can update import expenses" 
ON public.import_expenses 
FOR UPDATE 
USING (true);

CREATE POLICY "Users can delete import expenses" 
ON public.import_expenses 
FOR DELETE 
USING (true);

-- Create trigger for updated_at
CREATE TRIGGER update_import_expenses_updated_at
BEFORE UPDATE ON public.import_expenses
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_import_expenses_payment_id ON public.import_expenses(payment_id);
CREATE INDEX IF NOT EXISTS idx_import_expenses_invoice_id ON public.import_expenses(invoice_id);
CREATE INDEX IF NOT EXISTS idx_import_expenses_expense_type ON public.import_expenses(expense_type);

-- Add index on payments for import-related queries
CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_supplier_id ON payments(supplier_id);