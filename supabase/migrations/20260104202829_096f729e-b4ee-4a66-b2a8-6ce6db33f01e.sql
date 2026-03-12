-- تحديث القيود الموجودة بالفرع المناسب
UPDATE journal_entries je SET branch_id = (
  CASE 
    WHEN je.reference_type = 'sale' THEN (SELECT branch_id FROM sales WHERE id = je.reference_id)
    WHEN je.reference_type = 'purchase' THEN (SELECT branch_id FROM invoices WHERE id = je.reference_id)
    WHEN je.reference_type = 'sale_return' THEN (SELECT branch_id FROM returns WHERE id = je.reference_id)
    WHEN je.reference_type = 'purchase_return' THEN (SELECT branch_id FROM purchase_returns WHERE id = je.reference_id)
    WHEN je.reference_type = 'payment' THEN (SELECT i.branch_id FROM payments p JOIN invoices i ON p.invoice_id = i.id WHERE p.id = je.reference_id)
    WHEN je.reference_type = 'production_start' THEN (SELECT branch_id FROM work_orders WHERE id = je.reference_id)
    WHEN je.reference_type = 'production_complete' THEN (SELECT branch_id FROM work_orders WHERE id = je.reference_id)
    WHEN je.reference_type = 'customer_receipt' THEN (SELECT branch_id FROM customer_receipts WHERE id = je.reference_id)
    WHEN je.reference_type = 'credit_note' THEN (SELECT branch_id FROM credit_notes WHERE id = je.reference_id)
    WHEN je.reference_type = 'daily_settlement' THEN (SELECT branch_id FROM daily_settlements WHERE id = je.reference_id)
    ELSE NULL
  END
)
WHERE je.branch_id IS NULL AND je.reference_id IS NOT NULL;

-- دالة لتعيين الفرع تلقائياً عند إنشاء قيد جديد
CREATE OR REPLACE FUNCTION set_journal_entry_branch()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.branch_id IS NULL AND NEW.reference_id IS NOT NULL THEN
    NEW.branch_id := CASE 
      WHEN NEW.reference_type = 'sale' THEN (SELECT branch_id FROM sales WHERE id = NEW.reference_id)
      WHEN NEW.reference_type = 'purchase' THEN (SELECT branch_id FROM invoices WHERE id = NEW.reference_id)
      WHEN NEW.reference_type = 'sale_return' THEN (SELECT branch_id FROM returns WHERE id = NEW.reference_id)
      WHEN NEW.reference_type = 'purchase_return' THEN (SELECT branch_id FROM purchase_returns WHERE id = NEW.reference_id)
      WHEN NEW.reference_type = 'payment' THEN (SELECT i.branch_id FROM payments p JOIN invoices i ON p.invoice_id = i.id WHERE p.id = NEW.reference_id)
      WHEN NEW.reference_type = 'production_start' THEN (SELECT branch_id FROM work_orders WHERE id = NEW.reference_id)
      WHEN NEW.reference_type = 'production_complete' THEN (SELECT branch_id FROM work_orders WHERE id = NEW.reference_id)
      WHEN NEW.reference_type = 'customer_receipt' THEN (SELECT branch_id FROM customer_receipts WHERE id = NEW.reference_id)
      WHEN NEW.reference_type = 'credit_note' THEN (SELECT branch_id FROM credit_notes WHERE id = NEW.reference_id)
      WHEN NEW.reference_type = 'daily_settlement' THEN (SELECT branch_id FROM daily_settlements WHERE id = NEW.reference_id)
      ELSE NULL
    END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- إنشاء trigger
DROP TRIGGER IF EXISTS auto_set_journal_branch ON journal_entries;
CREATE TRIGGER auto_set_journal_branch
  BEFORE INSERT ON journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION set_journal_entry_branch();

COMMENT ON FUNCTION set_journal_entry_branch() IS 'يعين الفرع تلقائياً للقيود الجديدة بناءً على نوع المرجع';