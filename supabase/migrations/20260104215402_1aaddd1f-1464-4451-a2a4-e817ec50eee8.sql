-- =====================================================
-- AR/AP Migration: Fix journal entries on parent accounts
-- Move entries from parent accounts (1102, 2101) to customer/supplier sub-accounts
-- =====================================================

-- 1. Fix SALES entries on main AR account (1102) -> customer sub-accounts
UPDATE journal_entry_lines jel
SET account_id = c.account_id
FROM journal_entries je
JOIN sales s ON je.reference_id = s.id AND je.reference_type = 'sale'
JOIN customers c ON s.customer_id = c.id
WHERE jel.journal_entry_id = je.id
  AND jel.account_id = (SELECT id FROM chart_of_accounts WHERE account_code = '1102')
  AND c.account_id IS NOT NULL;

-- 2. Fix INVOICE (sales invoice) entries on main AR account
UPDATE journal_entry_lines jel
SET account_id = c.account_id
FROM journal_entries je
JOIN invoices i ON je.reference_id = i.id AND je.reference_type = 'invoice'
JOIN customers c ON i.customer_id = c.id
WHERE jel.journal_entry_id = je.id
  AND jel.account_id = (SELECT id FROM chart_of_accounts WHERE account_code = '1102')
  AND c.account_id IS NOT NULL
  AND i.invoice_type = 'sales';

-- 3. Fix SALE_RETURN entries on main AR account
UPDATE journal_entry_lines jel
SET account_id = c.account_id
FROM journal_entries je
JOIN returns r ON je.reference_id = r.id AND je.reference_type = 'sale_return'
JOIN sales s ON r.sale_id = s.id
JOIN customers c ON s.customer_id = c.id
WHERE jel.journal_entry_id = je.id
  AND jel.account_id = (SELECT id FROM chart_of_accounts WHERE account_code = '1102')
  AND c.account_id IS NOT NULL;

-- 4. Fix RECEIPT (customer receipt) entries on main AR account
UPDATE journal_entry_lines jel
SET account_id = c.account_id
FROM journal_entries je
JOIN customer_receipts cr ON je.reference_id = cr.id AND je.reference_type = 'receipt'
JOIN customers c ON cr.customer_id = c.id
WHERE jel.journal_entry_id = je.id
  AND jel.account_id = (SELECT id FROM chart_of_accounts WHERE account_code = '1102')
  AND c.account_id IS NOT NULL;

-- 5. Fix PURCHASE entries on main AP account (2101) -> supplier sub-accounts
UPDATE journal_entry_lines jel
SET account_id = s.account_id
FROM journal_entries je
JOIN invoices i ON je.reference_id = i.id AND je.reference_type = 'purchase'
JOIN suppliers s ON i.supplier_id = s.id
WHERE jel.journal_entry_id = je.id
  AND jel.account_id = (SELECT id FROM chart_of_accounts WHERE account_code = '2101')
  AND s.account_id IS NOT NULL;

-- 6. Fix PURCHASE_RETURN entries on main AP account
UPDATE journal_entry_lines jel
SET account_id = s.account_id
FROM journal_entries je
JOIN purchase_returns pr ON je.reference_id = pr.id AND je.reference_type = 'purchase_return'
JOIN suppliers s ON pr.supplier_id = s.id
WHERE jel.journal_entry_id = je.id
  AND jel.account_id = (SELECT id FROM chart_of_accounts WHERE account_code = '2101')
  AND s.account_id IS NOT NULL;

-- 7. Fix PAYMENT (supplier payment) entries on main AP account
UPDATE journal_entry_lines jel
SET account_id = s.account_id
FROM journal_entries je
JOIN payments p ON je.reference_id = p.id AND je.reference_type = 'payment'
JOIN invoices i ON p.invoice_id = i.id
JOIN suppliers s ON i.supplier_id = s.id
WHERE jel.journal_entry_id = je.id
  AND jel.account_id = (SELECT id FROM chart_of_accounts WHERE account_code = '2101')
  AND s.account_id IS NOT NULL;