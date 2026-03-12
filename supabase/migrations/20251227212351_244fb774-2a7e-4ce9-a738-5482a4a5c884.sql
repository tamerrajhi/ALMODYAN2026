-- إصلاح مسار البحث للدوال
CREATE OR REPLACE FUNCTION generate_receipt_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  next_num INTEGER;
  new_code TEXT;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(receipt_number FROM 4) AS INTEGER)), 0) + 1
  INTO next_num
  FROM customer_receipts;
  
  new_code := 'REC' || LPAD(next_num::TEXT, 6, '0');
  RETURN new_code;
END;
$$;

CREATE OR REPLACE FUNCTION generate_credit_note_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  next_num INTEGER;
  new_code TEXT;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(credit_note_number FROM 3) AS INTEGER)), 0) + 1
  INTO next_num
  FROM credit_notes;
  
  new_code := 'CN' || LPAD(next_num::TEXT, 6, '0');
  RETURN new_code;
END;
$$;