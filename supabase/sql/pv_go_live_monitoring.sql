-- ============================================================
-- Purchasing Go-Live Monitoring Queries
-- Modules: Payment Vouchers (PV) + Purchase Invoices (PI)
-- Version: PI-1.0 / PV-4.2
-- Date: 2026-01-17
-- ============================================================

-- ############################################################
-- SECTION A: PAYMENT VOUCHER MONITORING (PV-4)
-- ############################################################

-- ------------------------------------------------------------
-- PV-M1) Posted payments missing JE link
-- Description: Finds payments that are NOT voided but have no linked journal entry
-- Impact: Accounting integrity - all posted payments MUST have JE
-- ------------------------------------------------------------
SELECT 
  p.id AS payment_id,
  p.payment_number,
  p.payment_type,
  p.payment_date,
  p.amount,
  p.payment_method,
  p.status,
  p.branch_id,
  p.supplier_id,
  p.customer_id,
  p.created_at,
  p.journal_entry_id
FROM public.payments p
WHERE p.status != 'voided'
  AND p.journal_entry_id IS NULL
ORDER BY p.created_at DESC;

-- ------------------------------------------------------------
-- PV-M2) Unbalanced posted journal entries
-- Description: Finds JE where debit != credit (tolerance: 0.01 SAR)
-- Impact: Fundamental accounting rule violation
-- ------------------------------------------------------------
SELECT 
  je.id AS journal_entry_id,
  je.entry_number,
  je.entry_date,
  je.reference_type,
  je.reference_id,
  je.total_debit,
  je.total_credit,
  ABS(COALESCE(je.total_debit, 0) - COALESCE(je.total_credit, 0)) AS imbalance,
  je.is_posted,
  je.is_reversed,
  je.created_by,
  je.created_at
FROM public.journal_entries je
WHERE je.is_posted = true
  AND ABS(COALESCE(je.total_debit, 0) - COALESCE(je.total_credit, 0)) > 0.01
ORDER BY je.created_at DESC;

-- ------------------------------------------------------------
-- PV-M3) Duplicate payment numbers
-- Description: Detects collisions in payment numbering
-- Impact: Unique constraint violations, audit trail confusion
-- ------------------------------------------------------------
SELECT 
  payment_number,
  COUNT(*) AS duplicate_count,
  ARRAY_AGG(id ORDER BY created_at) AS payment_ids,
  ARRAY_AGG(payment_type ORDER BY created_at) AS payment_types,
  ARRAY_AGG(created_at ORDER BY created_at) AS creation_times,
  MAX(created_at) AS latest_occurrence
FROM public.payments
GROUP BY payment_number
HAVING COUNT(*) > 1
ORDER BY MAX(created_at) DESC;

-- ------------------------------------------------------------
-- PV-M4) Orphaned JE lines (JE without payment link)
-- Description: JE lines for payment reference_type but no matching payment
-- Impact: Data integrity issue - orphaned accounting records
-- ------------------------------------------------------------
SELECT 
  je.id AS journal_entry_id,
  je.entry_number,
  je.reference_type,
  je.reference_id,
  je.total_debit,
  je.total_credit,
  je.created_at
FROM public.journal_entries je
WHERE je.reference_type IN ('payment', 'receipt', 'payment_void', 'payment_update')
  AND NOT EXISTS (
    SELECT 1 FROM public.payments p WHERE p.id = je.reference_id
  )
ORDER BY je.created_at DESC;

-- ------------------------------------------------------------
-- PV-M5) Payments with voided status but no reversal JE
-- Description: Voided payments should have an is_reversed=true original JE
-- Impact: Incomplete void process - accounting not properly reversed
-- ------------------------------------------------------------
SELECT 
  p.id AS payment_id,
  p.payment_number,
  p.status,
  p.amount,
  p.journal_entry_id,
  je.is_reversed,
  je.entry_number AS original_je_number,
  p.created_at
FROM public.payments p
LEFT JOIN public.journal_entries je ON je.id = p.journal_entry_id
WHERE p.status = 'voided'
  AND p.journal_entry_id IS NOT NULL
  AND (je.is_reversed IS NULL OR je.is_reversed = false)
ORDER BY p.created_at DESC;

-- ############################################################
-- SECTION B: PURCHASE INVOICE MONITORING (PI-1)
-- ############################################################

-- ------------------------------------------------------------
-- PI-M1) Posted purchase invoices missing JE link
-- Description: Finds invoices with status='posted' but no journal_entry_id
-- Impact: Accounting integrity - posted invoices MUST have JE
-- ------------------------------------------------------------
SELECT 
  inv.id AS invoice_id,
  inv.invoice_number,
  inv.invoice_date,
  inv.status,
  inv.total_amount,
  inv.supplier_id,
  inv.branch_id,
  inv.journal_entry_id,
  inv.created_at
FROM public.invoices inv
WHERE inv.invoice_type = 'purchase'
  AND inv.status IN ('posted', 'paid', 'partial')
  AND inv.journal_entry_id IS NULL
ORDER BY inv.created_at DESC;

-- ------------------------------------------------------------
-- PI-M2) Purchase invoice JEs not posted
-- Description: JE exists but is_posted=false for purchase invoices
-- Impact: Financial statements may be inaccurate
-- ------------------------------------------------------------
SELECT 
  je.id AS journal_entry_id,
  je.entry_number,
  je.entry_date,
  je.reference_type,
  je.reference_id,
  je.is_posted,
  je.total_debit,
  je.total_credit,
  je.created_at
FROM public.journal_entries je
WHERE je.reference_type IN ('purchase_invoice', 'purchase_invoice_post', 'purchase')
  AND (je.is_posted IS DISTINCT FROM true)
ORDER BY je.created_at DESC;

-- ------------------------------------------------------------
-- PI-M3) Unbalanced JE for purchase invoices
-- Description: JE where debit != credit for purchase-related entries
-- Impact: Fundamental accounting rule violation
-- ------------------------------------------------------------
SELECT 
  je.id AS journal_entry_id,
  je.entry_number,
  je.reference_type,
  je.reference_id,
  je.total_debit,
  je.total_credit,
  ABS(COALESCE(je.total_debit, 0) - COALESCE(je.total_credit, 0)) AS imbalance
FROM public.journal_entries je
WHERE je.reference_type IN ('purchase_invoice', 'purchase_invoice_post', 'purchase', 'purchase_invoice_void')
  AND ABS(COALESCE(je.total_debit, 0) - COALESCE(je.total_credit, 0)) > 0.01
ORDER BY je.created_at DESC;

-- ------------------------------------------------------------
-- PI-M4) Orphan JE lines for purchase invoices
-- Description: JE lines without corresponding journal_entries record
-- Impact: Data integrity - orphaned records
-- ------------------------------------------------------------
SELECT 
  jel.id AS line_id,
  jel.journal_entry_id,
  jel.account_id,
  jel.debit_amount,
  jel.credit_amount,
  jel.description
FROM public.journal_entry_lines jel
LEFT JOIN public.journal_entries je ON je.id = jel.journal_entry_id
WHERE je.id IS NULL
ORDER BY jel.id;

-- ------------------------------------------------------------
-- PI-M5) Duplicate invoice numbers
-- Description: Detects collisions in invoice numbering
-- Impact: Unique constraint violations, audit trail confusion
-- ------------------------------------------------------------
SELECT 
  invoice_number,
  COUNT(*) AS duplicate_count,
  ARRAY_AGG(id ORDER BY created_at) AS invoice_ids,
  ARRAY_AGG(status ORDER BY created_at) AS statuses,
  MAX(created_at) AS latest_occurrence
FROM public.invoices
WHERE invoice_type = 'purchase'
GROUP BY invoice_number
HAVING COUNT(*) > 1
ORDER BY MAX(created_at) DESC;

-- ------------------------------------------------------------
-- PI-M6) Workflow failures for PI workflows
-- Description: Failed atomic workflow requests for purchase invoices
-- Impact: Debugging atomic RPC failures
-- ------------------------------------------------------------
SELECT 
  client_request_id,
  workflow_type,
  status,
  error_code,
  error_message,
  created_at,
  completed_at
FROM public.pos_workflow_requests
WHERE workflow_type IN (
  'purchase_invoice_create_atomic',
  'purchase_invoice_post_atomic',
  'purchase_invoice_void_atomic'
)
  AND status IN ('failed', 'conflict')
ORDER BY created_at DESC
LIMIT 50;

-- ------------------------------------------------------------
-- PI-M7) Voided invoices without reversal JE
-- Description: Voided invoices should have reversed JE
-- Impact: Incomplete void process
-- ------------------------------------------------------------
SELECT 
  inv.id AS invoice_id,
  inv.invoice_number,
  inv.status,
  inv.total_amount,
  inv.journal_entry_id,
  je.is_reversed,
  je.entry_number AS original_je_number,
  inv.created_at
FROM public.invoices inv
LEFT JOIN public.journal_entries je ON je.id = inv.journal_entry_id
WHERE inv.invoice_type = 'purchase'
  AND inv.status = 'voided'
  AND inv.journal_entry_id IS NOT NULL
  AND (je.is_reversed IS NULL OR je.is_reversed = false)
ORDER BY inv.created_at DESC;

-- ############################################################
-- SECTION C: PURCHASE RETURN MONITORING (PR-1)
-- ############################################################

-- ------------------------------------------------------------
-- PR-M1) Posted returns missing journal_entry_id
-- ------------------------------------------------------------
SELECT id, return_number, status, total_amount, created_at
FROM public.purchase_returns
WHERE status IN ('posted', 'confirmed') AND journal_entry_id IS NULL
ORDER BY created_at DESC;

-- ------------------------------------------------------------
-- PR-M2) Unbalanced JEs for purchase_return reference_type
-- ------------------------------------------------------------
SELECT je.id, je.entry_number, je.total_debit, je.total_credit,
  ABS(COALESCE(je.total_debit,0) - COALESCE(je.total_credit,0)) AS imbalance
FROM public.journal_entries je
WHERE je.reference_type = 'purchase_return'
  AND ABS(COALESCE(je.total_debit,0) - COALESCE(je.total_credit,0)) > 0.01
ORDER BY je.created_at DESC;

-- ------------------------------------------------------------
-- PR-M3) Orphaned return_items (return_id not in purchase_returns)
-- ------------------------------------------------------------
SELECT ri.id, ri.return_id, ri.description, ri.total_amount
FROM public.purchase_return_items ri
LEFT JOIN public.purchase_returns pr ON pr.id = ri.return_id
WHERE pr.id IS NULL;

-- ------------------------------------------------------------
-- PR-M4) Returns referencing missing invoice
-- ------------------------------------------------------------
SELECT pr.id, pr.return_number, pr.purchase_invoice_id
FROM public.purchase_returns pr
LEFT JOIN public.invoices i ON i.id = pr.purchase_invoice_id
WHERE pr.purchase_invoice_id IS NOT NULL AND i.id IS NULL;

-- ------------------------------------------------------------
-- PR-M5) Duplicate return numbers
-- ------------------------------------------------------------
SELECT return_number, COUNT(*) AS cnt
FROM public.purchase_returns
GROUP BY return_number HAVING COUNT(*) > 1;

-- ------------------------------------------------------------
-- PR-M6) Workflow failures for PR types in last 24h (CANONICAL names)
-- ------------------------------------------------------------
SELECT client_request_id, workflow_type, status, error_code, error_message, created_at
FROM public.pos_workflow_requests
WHERE workflow_type IN (
  'purchase_return_unique_create_atomic',
  'purchase_return_general_create_atomic',
  'purchase_return_void_atomic'
)
  AND status = 'failed'
  AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;

-- ------------------------------------------------------------
-- PR-M7) Voided returns without reversal JE when original JE existed
-- ------------------------------------------------------------
SELECT pr.id, pr.return_number, pr.status, pr.journal_entry_id,
  je.is_reversed, je.reversed_by_entry_id
FROM public.purchase_returns pr
LEFT JOIN public.journal_entries je ON je.id = pr.journal_entry_id
WHERE pr.status = 'voided'
  AND pr.journal_entry_id IS NOT NULL
  AND (je.is_reversed IS NULL OR je.is_reversed = false);

-- ############################################################
-- SECTION D: PR-2 ADDITIONAL MONITORING (Create Atomic)
-- ############################################################

-- ------------------------------------------------------------
-- PR2-M1) Posted returns missing journal_entry_id (same as PR-M1)
-- ------------------------------------------------------------
SELECT count(*) as pr2_m1_missing_je 
FROM public.purchase_returns 
WHERE status = 'posted' AND journal_entry_id IS NULL;

-- ------------------------------------------------------------
-- PR2-M2) Unbalanced JEs for purchase returns
-- ------------------------------------------------------------
SELECT count(*) as pr2_m2_unbalanced
FROM public.journal_entries je
WHERE je.reference_type = 'purchase_return'
  AND je.is_reversed = false
  AND COALESCE(je.total_debit, 0) <> COALESCE(je.total_credit, 0);

-- ------------------------------------------------------------
-- PR2-M3) Item movements missing reference_id
-- ------------------------------------------------------------
SELECT count(*) as pr2_m3_orphan_movements
FROM public.item_movements
WHERE reference_type = 'purchase_return'
  AND reference_id IS NULL;

-- ------------------------------------------------------------
-- PR2-M4) Duplicate return_number
-- ------------------------------------------------------------
SELECT return_number, COUNT(*) as cnt
FROM public.purchase_returns
WHERE return_number IS NOT NULL
GROUP BY return_number
HAVING COUNT(*) > 1;

-- ------------------------------------------------------------
-- PR2-M5) Orphan purchase_return_items (return_id missing parent)
-- ------------------------------------------------------------
SELECT count(*) as pr2_m5_orphan_items
FROM public.purchase_return_items pri
LEFT JOIN public.purchase_returns pr ON pr.id = pri.return_id
WHERE pr.id IS NULL;

-- ------------------------------------------------------------
-- PR2-M6) Stuck workflows > 10 min for PR-2 types
-- ------------------------------------------------------------
SELECT count(*) as pr2_m6_stuck
FROM public.pos_workflow_requests
WHERE workflow_type IN ('purchase_return_unique_create_atomic', 'purchase_return_general_create_atomic')
  AND status = 'in_progress'
  AND created_at < NOW() - INTERVAL '10 minutes';

-- ############################################################
-- SECTION E: SET-1 PAYMENT ALLOCATIONS MONITORING
-- ############################################################

-- ------------------------------------------------------------
-- SET1-M1) Supplier payments without allocations (unallocated)
-- Description: Payments that exist but have no allocation records
-- Note: Historical payments may be unallocated - focus on recent ones
-- ------------------------------------------------------------
SELECT 
  p.id AS payment_id,
  p.payment_number,
  p.payment_date,
  p.amount,
  p.supplier_id,
  s.supplier_name,
  p.created_at
FROM public.payments p
LEFT JOIN public.supplier_payment_allocations a ON a.payment_id = p.id
LEFT JOIN public.suppliers s ON s.id = p.supplier_id
WHERE p.payment_type = 'payment'
  AND p.status != 'voided'
GROUP BY p.id, s.supplier_name
HAVING COUNT(a.payment_id) = 0
ORDER BY p.created_at DESC
LIMIT 50;

-- ------------------------------------------------------------
-- SET1-M2) Orphan allocations (payment_id or invoice_id missing)
-- Description: Allocation records pointing to non-existent parents
-- Impact: Data integrity - should be 0
-- ------------------------------------------------------------
SELECT 
  a.id AS allocation_id,
  a.payment_id,
  a.invoice_id,
  a.amount,
  p.id IS NULL AS payment_missing,
  i.id IS NULL AS invoice_missing
FROM public.supplier_payment_allocations a
LEFT JOIN public.payments p ON p.id = a.payment_id
LEFT JOIN public.invoices i ON i.id = a.invoice_id
WHERE p.id IS NULL OR i.id IS NULL;

-- ------------------------------------------------------------
-- SET1-M3) Over-allocated invoices (allocations exceed total)
-- Description: Invoices where SUM of allocations > total_amount
-- Impact: Business logic violation
-- ------------------------------------------------------------
SELECT 
  i.id AS invoice_id,
  i.invoice_number,
  i.total_amount,
  SUM(a.amount) AS allocated_amount,
  SUM(a.amount) - i.total_amount AS over_allocated
FROM public.supplier_payment_allocations a
JOIN public.invoices i ON i.id = a.invoice_id
GROUP BY i.id, i.invoice_number, i.total_amount
HAVING SUM(a.amount) > COALESCE(i.total_amount, 0) + 0.01
ORDER BY over_allocated DESC;

-- ------------------------------------------------------------
-- SET1-M4) Invoices with negative remaining_amount
-- Description: Should never happen - indicates logic error
-- Impact: Critical data anomaly
-- GAP-02: Using tolerance 0.01
-- ------------------------------------------------------------
SELECT 
  id AS invoice_id,
  invoice_number,
  total_amount,
  paid_amount,
  total_returned_amount,
  remaining_amount,
  status,
  created_at
FROM public.invoices
WHERE remaining_amount < -0.01
ORDER BY remaining_amount ASC;

-- ------------------------------------------------------------
-- SET1-M5) Invoices paid_amount > (total - returned) - Overpaid
-- Description: Over-payment beyond invoice allowable balance
-- Impact: Business logic violation
-- GAP-02: Canonical formula: paid > total - returned + tolerance
-- ------------------------------------------------------------
SELECT 
  id AS invoice_id,
  invoice_number,
  total_amount,
  COALESCE(total_returned_amount, 0) AS total_returned_amount,
  paid_amount,
  remaining_amount,
  status,
  (COALESCE(paid_amount, 0) - (COALESCE(total_amount, 0) - COALESCE(total_returned_amount, 0))) AS overpaid_amount
FROM public.invoices
WHERE COALESCE(paid_amount, 0) > (COALESCE(total_amount, 0) - COALESCE(total_returned_amount, 0) + 0.01)
ORDER BY overpaid_amount DESC;

-- ------------------------------------------------------------
-- SET1-M6) Mismatch: paid_amount vs allocations sum
-- Description: Invoice paid_amount should match allocations total
-- Impact: Source of truth divergence
-- ------------------------------------------------------------
SELECT 
  i.id AS invoice_id,
  i.invoice_number,
  i.paid_amount AS invoice_paid_amount,
  COALESCE(SUM(a.amount), 0) AS allocations_sum,
  i.paid_amount - COALESCE(SUM(a.amount), 0) AS mismatch
FROM public.invoices i
LEFT JOIN public.supplier_payment_allocations a ON a.invoice_id = i.id
WHERE i.invoice_type = 'purchase'
GROUP BY i.id, i.invoice_number, i.paid_amount
HAVING ABS(COALESCE(i.paid_amount, 0) - COALESCE(SUM(a.amount), 0)) > 0.01
ORDER BY ABS(i.paid_amount - COALESCE(SUM(a.amount), 0)) DESC
LIMIT 50;

-- ------------------------------------------------------------
-- SET1-M7) Formula mismatch: remaining != total - returned - paid
-- Description: Invoice remaining_amount should equal canonical formula
-- Impact: Data integrity violation
-- GAP-02: Canonical formula: remaining = total - returned - paid
-- ------------------------------------------------------------
SELECT 
  id AS invoice_id,
  invoice_number,
  total_amount,
  COALESCE(total_returned_amount, 0) AS total_returned_amount,
  COALESCE(paid_amount, 0) AS paid_amount,
  remaining_amount AS stored_remaining,
  (COALESCE(total_amount, 0) - COALESCE(total_returned_amount, 0) - COALESCE(paid_amount, 0)) AS computed_remaining,
  remaining_amount - (COALESCE(total_amount, 0) - COALESCE(total_returned_amount, 0) - COALESCE(paid_amount, 0)) AS formula_mismatch
FROM public.invoices
WHERE ABS(remaining_amount - (COALESCE(total_amount, 0) - COALESCE(total_returned_amount, 0) - COALESCE(paid_amount, 0))) > 0.01
ORDER BY ABS(remaining_amount - (COALESCE(total_amount, 0) - COALESCE(total_returned_amount, 0) - COALESCE(paid_amount, 0))) DESC;

-- ------------------------------------------------------------
-- SET1-M8) Payment workflows stuck in processing
-- Description: payment_voucher_atomic workflows stuck > 15 minutes
-- Impact: Potential deadlock or crash
-- GAP-06: Timeout increased to 15 minutes
-- ------------------------------------------------------------
SELECT 
  client_request_id,
  workflow_type,
  status,
  created_at,
  EXTRACT(EPOCH FROM (NOW() - created_at)) / 60 AS minutes_stuck
FROM public.pos_workflow_requests
WHERE workflow_type = 'payment_voucher_atomic'
  AND status = 'in_progress'
  AND created_at < NOW() - INTERVAL '15 minutes'
ORDER BY created_at ASC;

-- ############################################################
-- SECTION F: SET-HB HARD BLOCK MONITORING
-- ############################################################

-- ------------------------------------------------------------
-- HB-M1) Supplier payments without allocations (post-HB should = 0)
-- Description: After hard block, new supplier payments must have allocations
-- Note: Historical payments before SET-HB may exist without allocations
-- ------------------------------------------------------------
SELECT 
  COUNT(*) AS supplier_payments_no_allocations
FROM public.payments p
LEFT JOIN public.supplier_payment_allocations a ON a.payment_id = p.id
WHERE p.payment_type = 'payment'
  AND p.supplier_id IS NOT NULL
  AND p.status != 'voided'
GROUP BY p.id
HAVING COUNT(a.*) = 0;

-- ------------------------------------------------------------
-- HB-M2) Supplier payments posted without allocations (critical)
-- Description: Posted supplier payments without allocations - most critical
-- ------------------------------------------------------------
SELECT 
  p.id AS payment_id,
  p.payment_number,
  p.payment_date,
  p.amount,
  s.supplier_name,
  p.status,
  p.created_at
FROM public.payments p
LEFT JOIN public.supplier_payment_allocations a ON a.payment_id = p.id
LEFT JOIN public.suppliers s ON s.id = p.supplier_id
WHERE p.payment_type = 'payment'
  AND p.supplier_id IS NOT NULL
  AND p.status = 'posted'
GROUP BY p.id, s.supplier_name
HAVING COUNT(a.*) = 0
ORDER BY p.created_at DESC;

-- ------------------------------------------------------------
-- HB-M3) Customer receipts without allocations (expected/normal)
-- Description: Receipts are NOT required to have allocations
-- This count is expected to be > 0 and is normal
-- ------------------------------------------------------------
SELECT 
  COUNT(*) AS receipts_without_allocations_normal
FROM public.payments p
LEFT JOIN public.supplier_payment_allocations a ON a.payment_id = p.id
WHERE p.payment_type = 'receipt'
GROUP BY p.id
HAVING COUNT(a.*) = 0;
