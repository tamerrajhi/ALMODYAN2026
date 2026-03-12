-- Create cost entries table for expenses, services, fixed assets, etc.
CREATE TABLE public.cost_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cost_code TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  description TEXT,
  cost_type TEXT NOT NULL CHECK (cost_type IN ('service', 'fixed_asset', 'direct_expense', 'indirect_overhead')),
  gl_account_id UUID NOT NULL REFERENCES public.chart_of_accounts(id),
  cost_center_id UUID REFERENCES public.cost_centers(id),
  tax_rate NUMERIC DEFAULT 15,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID
);

-- Add index for faster lookups
CREATE INDEX idx_cost_entries_cost_type ON public.cost_entries(cost_type);
CREATE INDEX idx_cost_entries_gl_account_id ON public.cost_entries(gl_account_id);
CREATE INDEX idx_cost_entries_is_active ON public.cost_entries(is_active);

-- Enable RLS
ALTER TABLE public.cost_entries ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can view cost entries"
ON public.cost_entries
FOR SELECT
USING (true);

CREATE POLICY "Users with permissions can insert cost entries"
ON public.cost_entries
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_screen_permission(auth.uid(), 'products'::text, 'create'::text));

CREATE POLICY "Users with permissions can update cost entries"
ON public.cost_entries
FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role) OR has_screen_permission(auth.uid(), 'products'::text, 'edit'::text));

CREATE POLICY "Admins can delete cost entries"
ON public.cost_entries
FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));

-- Add sequence for cost codes
INSERT INTO public.code_sequences (id, last_number) VALUES ('COST', 0)
ON CONFLICT (id) DO NOTHING;

-- Function to generate cost code
CREATE OR REPLACE FUNCTION public.generate_cost_code()
RETURNS TEXT AS $$
DECLARE
  next_number INTEGER;
  new_code TEXT;
BEGIN
  UPDATE public.code_sequences
  SET last_number = last_number + 1
  WHERE id = 'COST'
  RETURNING last_number INTO next_number;
  
  new_code := 'EXP-' || LPAD(next_number::TEXT, 4, '0');
  RETURN new_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for auto-generating cost code
CREATE OR REPLACE FUNCTION public.set_cost_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.cost_code IS NULL OR NEW.cost_code = '' THEN
    NEW.cost_code := generate_cost_code();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_set_cost_code
BEFORE INSERT ON public.cost_entries
FOR EACH ROW
EXECUTE FUNCTION public.set_cost_code();

-- Add updated_at trigger
CREATE TRIGGER update_cost_entries_updated_at
BEFORE UPDATE ON public.cost_entries
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();