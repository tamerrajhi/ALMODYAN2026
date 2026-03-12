
-- =====================================================
-- Fix Journal Entry Lines: Move entries from parent accounts to customer/supplier sub-accounts
-- This migration corrects historical entries that were posted to parent accounts (1102, 2101)
-- instead of the specific customer/supplier sub-accounts
-- =====================================================

DO $$
DECLARE
  v_customer_parent_id UUID;
  v_supplier_parent_id UUID;
  v_updated_count INT := 0;
BEGIN
  -- Get parent account IDs
  SELECT id INTO v_customer_parent_id FROM chart_of_accounts WHERE account_code = '1102';
  SELECT id INTO v_supplier_parent_id FROM chart_of_accounts WHERE account_code = '2101';

  -- ========== FIX CUSTOMER ENTRIES (1102 -> Customer Sub-accounts) ==========
  
  -- 1. Sales entries (reference_type = 'sale')
  UPDATE journal_entry_lines jel
  SET account_id = c.account_id
  FROM journal_entries je
  JOIN sales s ON s.id = je.reference_id
  JOIN customers c ON c.id = s.customer_id
  WHERE jel.journal_entry_id = je.id
    AND jel.account_id = v_customer_parent_id
    AND je.reference_type = 'sale'
    AND c.account_id IS NOT NULL;
  
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RAISE NOTICE 'Updated % sale entries to customer sub-accounts', v_updated_count;

  -- 2. Sales return entries (reference_type = 'sale_return') from returns table
  UPDATE journal_entry_lines jel
  SET account_id = c.account_id
  FROM journal_entries je
  JOIN returns r ON r.id = je.reference_id
  JOIN customers c ON c.id = r.customer_id
  WHERE jel.journal_entry_id = je.id
    AND jel.account_id = v_customer_parent_id
    AND je.reference_type = 'sale_return'
    AND c.account_id IS NOT NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RAISE NOTICE 'Updated % sale_return entries to customer sub-accounts', v_updated_count;

  -- 3. Receipt entries (reference_type = 'receipt') - from customer_receipts
  UPDATE journal_entry_lines jel
  SET account_id = c.account_id
  FROM journal_entries je
  JOIN customer_receipts cr ON cr.id = je.reference_id
  JOIN customers c ON c.id = cr.customer_id
  WHERE jel.journal_entry_id = je.id
    AND jel.account_id = v_customer_parent_id
    AND je.reference_type = 'receipt'
    AND c.account_id IS NOT NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RAISE NOTICE 'Updated % receipt entries to customer sub-accounts', v_updated_count;

  -- ========== FIX SUPPLIER ENTRIES (2101 -> Supplier Sub-accounts) ==========
  
  -- 1. Purchase entries (reference_type = 'purchase') - from invoices
  UPDATE journal_entry_lines jel
  SET account_id = sup.account_id
  FROM journal_entries je
  JOIN invoices inv ON inv.id = je.reference_id
  JOIN suppliers sup ON sup.id = inv.supplier_id
  WHERE jel.journal_entry_id = je.id
    AND jel.account_id = v_supplier_parent_id
    AND je.reference_type = 'purchase'
    AND sup.account_id IS NOT NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RAISE NOTICE 'Updated % purchase entries to supplier sub-accounts', v_updated_count;

  -- 2. Purchase return entries (reference_type = 'purchase_return')
  UPDATE journal_entry_lines jel
  SET account_id = sup.account_id
  FROM journal_entries je
  JOIN purchase_returns pr ON pr.id = je.reference_id
  JOIN suppliers sup ON sup.id = pr.supplier_id
  WHERE jel.journal_entry_id = je.id
    AND jel.account_id = v_supplier_parent_id
    AND je.reference_type = 'purchase_return'
    AND sup.account_id IS NOT NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RAISE NOTICE 'Updated % purchase_return entries to supplier sub-accounts', v_updated_count;

  -- 3. Payment entries (reference_type = 'payment') - from payments
  UPDATE journal_entry_lines jel
  SET account_id = sup.account_id
  FROM journal_entries je
  JOIN payments p ON p.id = je.reference_id
  JOIN invoices inv ON inv.id = p.invoice_id
  JOIN suppliers sup ON sup.id = inv.supplier_id
  WHERE jel.journal_entry_id = je.id
    AND jel.account_id = v_supplier_parent_id
    AND je.reference_type = 'payment'
    AND sup.account_id IS NOT NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RAISE NOTICE 'Updated % payment entries to supplier sub-accounts', v_updated_count;

  RAISE NOTICE 'Migration completed successfully!';
END $$;
