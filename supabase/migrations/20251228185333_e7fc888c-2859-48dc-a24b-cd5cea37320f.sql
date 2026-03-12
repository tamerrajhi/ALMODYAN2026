-- Fix function search path for security
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.set_cost_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.cost_code IS NULL OR NEW.cost_code = '' THEN
    NEW.cost_code := generate_cost_code();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;