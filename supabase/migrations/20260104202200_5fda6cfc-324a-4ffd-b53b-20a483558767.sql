
-- تحديث الدوال مع تحديد search_path للأمان
CREATE OR REPLACE FUNCTION validate_journal_entry_totals()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF ABS(COALESCE(NEW.total_debit, 0) - COALESCE(NEW.total_credit, 0)) > 0.01 THEN
    RAISE EXCEPTION 'القيد المحاسبي غير متوازن: المدين (%) لا يساوي الدائن (%) - قيد رقم %', 
      NEW.total_debit, NEW.total_credit, NEW.entry_number;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION check_journal_entry_final_balance()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_debits NUMERIC;
  total_credits NUMERIC;
  entry_number TEXT;
BEGIN
  SELECT je.entry_number INTO entry_number FROM journal_entries je WHERE je.id = NEW.journal_entry_id;
  SELECT COALESCE(SUM(debit_amount), 0), COALESCE(SUM(credit_amount), 0)
  INTO total_debits, total_credits FROM journal_entry_lines WHERE journal_entry_id = NEW.journal_entry_id;
  IF ABS(total_debits - total_credits) > 0.01 THEN
    RAISE WARNING 'تحذير: سطور القيد % غير متوازنة - مدين: %, دائن: %', entry_number, total_debits, total_credits;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
