-- Fix the invoice entry on 1102 (reference_type was 'sale' but should use invoice data)
UPDATE journal_entry_lines jel
SET account_id = c.account_id
FROM journal_entries je
JOIN invoices i ON je.reference_id = i.id AND je.reference_type = 'sale'
JOIN customers c ON i.customer_id = c.id
WHERE jel.journal_entry_id = je.id
  AND jel.account_id = (SELECT id FROM chart_of_accounts WHERE account_code = '1102')
  AND c.account_id IS NOT NULL;

-- Fix payments using supplier_id directly from payments table
UPDATE journal_entry_lines jel
SET account_id = s.account_id
FROM journal_entries je
JOIN payments p ON je.reference_id = p.id AND je.reference_type = 'payment'
JOIN suppliers s ON p.supplier_id = s.id
WHERE jel.journal_entry_id = je.id
  AND jel.account_id = (SELECT id FROM chart_of_accounts WHERE account_code = '2101')
  AND s.account_id IS NOT NULL;