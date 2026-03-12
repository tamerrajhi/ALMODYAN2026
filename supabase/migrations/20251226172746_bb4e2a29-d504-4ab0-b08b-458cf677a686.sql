
-- Fix function search path for generate_employee_code
CREATE OR REPLACE FUNCTION public.generate_employee_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_code TEXT;
  seq_num INTEGER;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(employee_code FROM 4) AS INTEGER)), 0) + 1
  INTO seq_num
  FROM employees
  WHERE employee_code ~ '^EMP[0-9]+$';
  
  new_code := 'EMP' || LPAD(seq_num::TEXT, 4, '0');
  RETURN new_code;
END;
$$;

-- Fix function search path for generate_payroll_period_code
CREATE OR REPLACE FUNCTION public.generate_payroll_period_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_code TEXT;
BEGIN
  new_code := 'PP-' || TO_CHAR(CURRENT_DATE, 'YYYYMM');
  RETURN new_code;
END;
$$;
