# P4-8 — ERP Sales Invoice Hardening Gate

**Date:** 2026-01-24  
**Status:** ✅ PASS — CLOSED

---

## Executive Summary

Successfully migrated ERP Sales Invoice flows to RPC-Only control model:
- ✅ Fixed critical RLS vulnerabilities on `sales_invoice_items` (removed 4× permissive TRUE)
- ✅ Added void columns to `invoices` table
- ✅ Created stronger Posted Lock trigger (JE-based)
- ✅ Created `void_sales_invoice_atomic` RPC with reversal JE support
- ✅ Refactored `CreateSalesInvoicePage.tsx` to use `complete_sales_invoice_atomic` (0 direct writes)
- ✅ Added Void button with reason dialog in `QuickActionsBar.tsx`

---

## Gate Results

### GATE 1: RLS Fix (sales_invoice_items)

| Before | After |
|--------|-------|
| SELECT: `TRUE` | SELECT: branch-scoped via invoice FK |
| INSERT: `TRUE` | INSERT: WITH CHECK branch-scoped |
| UPDATE: `TRUE` (no WITH CHECK) | UPDATE: USING + WITH CHECK branch-scoped |
| DELETE: `TRUE` | DELETE: Admin-only |

**Verdict:** ✅ PASS — 0 permissive TRUE remaining

### GATE 2: Void Columns

| Column | Type | Added |
|--------|------|-------|
| `voided_at` | timestamptz | ✅ |
| `voided_by` | uuid | ✅ |
| `void_reason` | text | ✅ |

**Verdict:** ✅ PASS

### GATE 3: Posted Lock Trigger

- Trigger: `trg_invoices_posted_lock`
- Function: `invoices_posted_lock()`
- Blocks: Financial field changes when JE is_posted=true
- Allows: status→'voided', payment updates, ZATCA updates

**Verdict:** ✅ PASS

### GATE 4: Void RPC

- RPC: `void_sales_invoice_atomic(p_payload jsonb)`
- Security: DEFINER
- Idempotency: via `begin_workflow_request`
- Reversal JE: Created with swapped lines
- Inventory: Restores jewelry_items to available

**Verdict:** ✅ PASS

### GATE 5: UI Wiring (CreateSalesInvoicePage)

| Check | Result |
|-------|--------|
| Direct writes to `invoices` | 0 |
| Direct writes to `sales_invoice_items` | 0 |
| Direct writes to `jewelry_items` | 0 |
| Direct writes to `finished_goods_movements` | 0 |
| Direct writes to `customers` | 0 |
| Direct writes to `journal_entries` | 0 |
| RPC call present | ✅ `complete_sales_invoice_atomic` at line 341 |
| Idempotency | ✅ `clientRequestIdRef` at line 87 |

**Verdict:** ✅ PASS — Direct Writes = 0

### GATE 6: Void Button

- Location: `QuickActionsBar.tsx`
- Visibility: Shows for non-draft, non-voided invoices
- Dialog: Requires void reason
- RPC: `void_sales_invoice_atomic`
- Feedback: Shows reversal JE number on success

**Verdict:** ✅ PASS

---

## Artifacts

1. **Migration SQL:** `docs/sales/migration_artifacts/20260124_p4_8_erp_sales_invoice_hardening.sql`
2. **UI (Create/Edit):** `src/pages/sales/CreateSalesInvoicePage.tsx` (refactored)
3. **UI (Actions):** `src/components/sales/invoice-view/QuickActionsBar.tsx` (void added)

---

## Verification SQL

```sql
-- V1: RLS policies (should be 4, no TRUE)
SELECT policyname, cmd, LEFT(qual::text, 60) 
FROM pg_policies WHERE tablename = 'sales_invoice_items';

-- V2: Void columns exist
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'invoices' AND column_name LIKE 'void%';

-- V3: Triggers
SELECT tgname FROM pg_trigger 
WHERE tgrelid = 'public.invoices'::regclass 
AND tgname = 'trg_invoices_posted_lock';

-- V4: RPC exists
SELECT routine_name, security_type 
FROM information_schema.routines 
WHERE routine_name = 'void_sales_invoice_atomic';

-- V5: JE balance check
SELECT je.id, SUM(debit_amount) as d, SUM(credit_amount) as c
FROM journal_entry_lines jel 
JOIN journal_entries je ON je.id = jel.journal_entry_id
WHERE je.reference_type IN ('sales_invoice', 'sales_invoice_void')
GROUP BY je.id HAVING SUM(debit_amount) != SUM(credit_amount);
```

---

## Gate Stamp

```
╔═══════════════════════════════════════════════════════════╗
║  P4-8 PASS — CLOSED                                       ║
║  ERP Sales Invoice Hardening Complete                     ║
║  Direct Writes: 0 | RLS: Fixed | Void: Implemented        ║
║  Date: 2026-01-24                                         ║
╚═══════════════════════════════════════════════════════════╝
```
