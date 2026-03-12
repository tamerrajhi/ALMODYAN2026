
-- دالة للتحقق من توازن القيد المحاسبي عند تحديث الإجماليات
CREATE OR REPLACE FUNCTION validate_journal_entry_totals()
RETURNS TRIGGER AS $$
BEGIN
  -- التحقق من أن المدين يساوي الدائن (مع هامش خطأ صغير للأرقام العشرية)
  IF ABS(COALESCE(NEW.total_debit, 0) - COALESCE(NEW.total_credit, 0)) > 0.01 THEN
    RAISE EXCEPTION 'القيد المحاسبي غير متوازن: المدين (%) لا يساوي الدائن (%) - قيد رقم %', 
      NEW.total_debit, NEW.total_credit, NEW.entry_number;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- دالة للتحقق من توازن سطور القيد
CREATE OR REPLACE FUNCTION check_journal_entry_final_balance()
RETURNS TRIGGER AS $$
DECLARE
  total_debits NUMERIC;
  total_credits NUMERIC;
  entry_number TEXT;
BEGIN
  -- جلب رقم القيد
  SELECT je.entry_number
  INTO entry_number
  FROM journal_entries je
  WHERE je.id = NEW.journal_entry_id;
  
  -- حساب مجموع السطور
  SELECT 
    COALESCE(SUM(debit_amount), 0),
    COALESCE(SUM(credit_amount), 0)
  INTO total_debits, total_credits
  FROM journal_entry_lines
  WHERE journal_entry_id = NEW.journal_entry_id;
  
  -- إصدار تحذير عند عدم التوازن
  IF ABS(total_debits - total_credits) > 0.01 THEN
    RAISE WARNING 'تحذير: سطور القيد % غير متوازنة - مدين: %, دائن: %', 
      entry_number, total_debits, total_credits;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- إنشاء trigger للتحقق عند إدخال سطور جديدة
DROP TRIGGER IF EXISTS check_journal_line_balance ON journal_entry_lines;
CREATE TRIGGER check_journal_line_balance
  AFTER INSERT OR UPDATE ON journal_entry_lines
  FOR EACH ROW
  EXECUTE FUNCTION check_journal_entry_final_balance();

-- إنشاء trigger للتحقق من إجماليات القيد
DROP TRIGGER IF EXISTS validate_journal_totals ON journal_entries;
CREATE TRIGGER validate_journal_totals
  BEFORE INSERT OR UPDATE ON journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION validate_journal_entry_totals();

-- تعليقات توضيحية
COMMENT ON FUNCTION validate_journal_entry_totals() IS 'يمنع إنشاء قيود محاسبية غير متوازنة';
COMMENT ON FUNCTION check_journal_entry_final_balance() IS 'يصدر تحذيراً عند عدم توازن سطور القيد';
