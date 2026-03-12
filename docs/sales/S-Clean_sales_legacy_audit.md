# PHASE S-Clean — Sales Legacy Sweep (CHECK-ONLY AUDIT)

**Date**: 2026-01-24  
**Status**: ✅ COMPLETE (CHECK-ONLY - NO FIXES)  
**Scope**: Sales module end-to-end atomicity, RLS, and legacy detection

---

## Executive Summary (15 Key Findings)

1. ✅ **POS Sale** → Fully atomic via `complete_pos_sale_atomic` RPC (SECURITY DEFINER)
2. ✅ **POS Return** → Uses `quickProcessReturn()` workflow → Partially atomic (draft+post in workflow lib)
3. ✅ **ERP Sales Invoice** → Fully atomic via `complete_sales_invoice_atomic` RPC
4. ✅ **ERP Sales Return** → Fully atomic via `complete_erp_sales_return_atomic` RPC
5. ✅ **Customer Receipts** → Fully atomic via `create_customer_receipt_atomic` + `void_customer_receipt_atomic`
6. ✅ **ERP Credit Notes** → Fully atomic via `complete_erp_credit_note_atomic` + `void_credit_note_atomic`
7. ⚠️ **POS Credit Note** → Atomic via `complete_pos_credit_note_atomic` but limited usage
8. 🛑 **Receipt Vouchers Page** → BLOCKED (PV-3) - throws error, no functional save
9. 🔴 **CustomersPage.tsx** → LEGACY DIRECT WRITES for return creation (lines 169-256)
10. 🔴 **pos-return-workflow.ts** → LEGACY DIRECT WRITES in `postReturn()` (lines 363-446)
11. ✅ **Idempotency Guards** → `returns.client_request_id` + `atomic_workflow_requests` table
12. ✅ **JE Uniqueness** → `idx_journal_entries_unique_ref` prevents duplicate JEs
13. ⚠️ **RLS jewelry_items** → RISKY: `USING(true)` and `WITH CHECK(true)` on UPDATE
14. ⚠️ **RLS item_movements** → RISKY: `WITH CHECK(true)` on INSERT
15. ✅ **Anon grants** → Most atomic RPCs require `authenticated` only

---

## A) Sales Surface Map (Routes/Screens)

| Route | Page/Component | Purpose | Mutations? | Uses RPC? | Direct Writes? | Evidence |
|-------|----------------|---------|------------|-----------|----------------|----------|
| `/pos` | POSPage.tsx | POS terminal sales | Yes | ✅ `complete_pos_sale_atomic` | No | `src/pages/POSPage.tsx:436-438` |
| `/pos/return` | POSReturnPage.tsx | POS piece returns | Yes | Via workflow lib | Yes (workflow) | `src/pages/POSReturnPage.tsx:739-761` |
| `/pos/credit-note` | POSCreditNotePage.tsx | POS credit notes | Yes | ✅ `complete_pos_credit_note_atomic` | No | `src/pages/POSCreditNotePage.tsx` |
| `/sales-history` | SalesHistoryPage.tsx | View sales history | No (read-only) | N/A | No | `src/pages/SalesHistoryPage.tsx` |
| `/customers` | CustomersPage.tsx | Customer management + legacy returns | Yes | Partial | 🔴 **YES** | `src/pages/CustomersPage.tsx:169-256` |
| `/sales/invoices` | SalesInvoicesPage.tsx | Invoice listing | No (read-only) | N/A | No | `src/pages/sales/SalesInvoicesPage.tsx` |
| `/sales/invoices/new` | CreateSalesInvoicePage.tsx | Create/edit ERP invoice | Yes | ✅ `complete_sales_invoice_atomic` | No | `src/pages/sales/CreateSalesInvoicePage.tsx:341-343` |
| `/sales/invoices/:id` | CreateSalesInvoicePage.tsx | Edit ERP invoice | Yes | ✅ `complete_sales_invoice_atomic` | No | Same as above |
| `/sales/invoices/:id/view` | SalesInvoiceViewPage.tsx | View invoice | No (read-only) | N/A | No | `src/pages/sales/SalesInvoiceViewPage.tsx` |
| `/sales/returns` | SalesReturnsListPage.tsx | ERP returns listing | No (read-only) | N/A | No | `src/pages/sales/SalesReturnsListPage.tsx` |
| `/sales/returns/new` | SalesReturnFormPage.tsx | Create ERP return | Yes | ✅ `complete_erp_sales_return_atomic` | No | `src/pages/sales/SalesReturnFormPage.tsx` |
| `/sales/returns/:id/view` | SalesReturnViewPage.tsx | View ERP return + void | Yes | ✅ `void_erp_sales_return_atomic` | No | `src/pages/sales/SalesReturnViewPage.tsx` |
| `/sales/receipts` | CustomerReceiptsPage.tsx | Customer receipts | Yes | ✅ `create_customer_receipt_atomic`, `void_customer_receipt_atomic` | No | `src/pages/sales/CustomerReceiptsPage.tsx:225,289` |
| `/sales/credit-notes` | CreditNotesPage.tsx | ERP credit notes | Yes | ✅ `complete_erp_credit_note_atomic`, `void_credit_note_atomic` | No | `src/pages/sales/CreditNotesPage.tsx:222,281` |
| `/sales/receipt-vouchers` | ReceiptVouchersPage.tsx | Receipt vouchers | 🛑 BLOCKED | N/A | N/A | `src/pages/sales/ReceiptVouchersPage.tsx:220` (throws error) |

---

## B) Mutation Inventory (Code Evidence)

### 🟢 RPC-Only Paths (SAFE)

| File | Line Range | RPC Called | Table(s) Affected | Criticality |
|------|------------|------------|-------------------|-------------|
| POSPage.tsx | 436-438 | `complete_pos_sale_atomic` | sales, sale_items, jewelry_items, invoices, journal_entries | CRITICAL |
| CreateSalesInvoicePage.tsx | 341-343 | `complete_sales_invoice_atomic` | invoices, sales_invoice_items, journal_entries | CRITICAL |
| SalesReturnFormPage.tsx | (via RPC) | `complete_erp_sales_return_atomic` | invoices, jewelry_items, item_movements, journal_entries | CRITICAL |
| SalesReturnViewPage.tsx | (void action) | `void_erp_sales_return_atomic` | invoices, journal_entries | CRITICAL |
| CustomerReceiptsPage.tsx | 225-227 | `create_customer_receipt_atomic` | customer_receipts, invoices, journal_entries | HIGH |
| CustomerReceiptsPage.tsx | 289-291 | `void_customer_receipt_atomic` | customer_receipts, journal_entries | HIGH |
| CreditNotesPage.tsx | 222-224 | `complete_erp_credit_note_atomic` | credit_notes, credit_note_items, journal_entries | HIGH |
| CreditNotesPage.tsx | 281-283 | `void_credit_note_atomic` | credit_notes, journal_entries | HIGH |

### 🔴 LEGACY DIRECT WRITES (Requires Migration)

| File | Line Range | Table | Operation | Criticality | Route |
|------|------------|-------|-----------|-------------|-------|
| CustomersPage.tsx | 169-181 | returns | INSERT | 🔴 CRITICAL | `/customers` |
| CustomersPage.tsx | 186-195 | return_items | INSERT | 🔴 CRITICAL | `/customers` |
| CustomersPage.tsx | 197-206 | jewelry_items | UPDATE | 🔴 CRITICAL | `/customers` |
| CustomersPage.tsx | 209-218 | item_movements | INSERT | 🔴 CRITICAL | `/customers` |
| CustomersPage.tsx | 243-256 | invoices | INSERT | 🔴 CRITICAL | `/customers` |
| pos-return-workflow.ts | 214-227 | returns | UPDATE | HIGH | (library) |
| pos-return-workflow.ts | 239-247 | returns | UPDATE | HIGH | (library) |
| pos-return-workflow.ts | 265-274 | returns | UPDATE | HIGH | (library) |
| pos-return-workflow.ts | 363-373 | jewelry_items | UPDATE | 🔴 CRITICAL | (library) |
| pos-return-workflow.ts | 415-417 | item_movements | INSERT | 🔴 CRITICAL | (library) |
| pos-return-workflow.ts | 433-446 | customer_credits | INSERT | HIGH | (library) |

---

## C) RPC Catalog (DB Evidence)

### Atomic RPCs (Sales-Related) — SECURITY DEFINER

| RPC Name | Idempotency Mechanism | Tables Written | UI Reference | Anon? | Auth? |
|----------|----------------------|----------------|--------------|-------|-------|
| `complete_pos_sale_atomic` | `client_request_id` + `atomic_workflow_requests` | sales, sale_items, jewelry_items, invoices, journal_entries, item_movements | POSPage.tsx:436 | YES | YES |
| `complete_sales_invoice_atomic` | `client_request_id` | invoices, sales_invoice_items, journal_entries | CreateSalesInvoicePage.tsx:341 | NO | YES |
| `complete_erp_sales_return_atomic` | `client_request_id` | invoices, sales_invoice_items, jewelry_items, item_movements, journal_entries | SalesReturnFormPage.tsx | NO | YES |
| `void_erp_sales_return_atomic` | Per-call | invoices, journal_entries | SalesReturnViewPage.tsx | NO | YES |
| `create_customer_receipt_atomic` | `client_request_id` | customer_receipts, invoices, journal_entries | CustomerReceiptsPage.tsx:225 | NO | YES |
| `void_customer_receipt_atomic` | Per-call | customer_receipts, journal_entries | CustomerReceiptsPage.tsx:289 | NO | YES |
| `complete_erp_credit_note_atomic` | `client_request_id` | credit_notes, credit_note_items, journal_entries | CreditNotesPage.tsx:222 | NO | YES |
| `void_credit_note_atomic` | Per-call | credit_notes, journal_entries | CreditNotesPage.tsx:281 | NO | YES |
| `complete_pos_credit_note_atomic` | `client_request_id` | credit_notes, credit_note_items, journal_entries, sale_items | POSCreditNotePage.tsx | NO | YES |
| `complete_pos_return_atomic` | `client_request_id` | returns, return_items, jewelry_items, item_movements, journal_entries | (Available but not used by POSReturnPage) | YES | YES |
| `void_sales_invoice_atomic` | Per-call | invoices, journal_entries | QuickActionsBar.tsx | NO | YES |

### Legacy/Partial RPCs

| RPC Name | Issue | Status |
|----------|-------|--------|
| `generate_return_code` | Helper only, not atomic | OK (helper) |
| `generate_invoice_number` | Helper only, not atomic | OK (helper) |
| `get_customer_credit_balance` | Read-only | OK |

---

## D) Accounting & Inventory Posting Map

### 1) POS Sale (`complete_pos_sale_atomic`)

| Step | Entity | Action | Account Mapping |
|------|--------|--------|-----------------|
| 1 | sales | INSERT header | — |
| 2 | sale_items | INSERT items | — |
| 3 | jewelry_items | UPDATE `sale_status='sold'`, `sold_at`, `sale_id` | — |
| 4 | item_movements | INSERT `SALE` | — |
| 5 | invoices | INSERT `invoice_type='sales'` | — |
| 6 | journal_entries | INSERT with lines | DR: Cash/Bank, CR: Sales Revenue + VAT |

**Guards**: `uq_sales_sale_code`, `ux_item_movements_sale_unique`, `idx_journal_entries_unique_ref`

### 2) POS Return (`quickProcessReturn` → workflow)

| Step | Entity | Action | Account Mapping |
|------|--------|--------|-----------------|
| 1 | returns | INSERT header with `client_request_id` | — |
| 2 | return_items | INSERT items | — |
| 3 | jewelry_items | UPDATE `sale_status='inspection'/'available'`, clear `sold_at`, `sale_id` | — |
| 4 | item_movements | INSERT `RETURN_FROM_SALE` | — |
| 5 | customer_credits | INSERT (if store_credit) | — |
| 6 | journal_entries | INSERT with lines | DR: Sales Returns, CR: Cash/Bank/Customer Credit |

**Guards**: `idx_returns_client_request_id_unique`, `uq_item_movements_ref`

**⚠️ Issue**: Uses library direct writes, not RPC. Consider migrating to `complete_pos_return_atomic`.

### 3) ERP Sales Invoice (`complete_sales_invoice_atomic`)

| Step | Entity | Action | Account Mapping |
|------|--------|--------|-----------------|
| 1 | invoices | INSERT/UPDATE header | — |
| 2 | sales_invoice_items | INSERT items | — |
| 3 | jewelry_items | UPDATE (if piece-based) | — |
| 4 | journal_entries | INSERT with lines | DR: Customer Receivable, CR: Sales Revenue + VAT |

**Guards**: `uq_invoices_invoice_number`, `idx_journal_entries_unique_ref`

### 4) ERP Sales Return (`complete_erp_sales_return_atomic`)

| Step | Entity | Action | Account Mapping |
|------|--------|--------|-----------------|
| 1 | invoices | INSERT `invoice_type='sales_return'` | — |
| 2 | sales_invoice_items | INSERT items | — |
| 3 | jewelry_items | UPDATE status | — |
| 4 | item_movements | INSERT `RETURN_FROM_SALE` | — |
| 5 | journal_entries | INSERT with lines | DR: Sales Returns, CR: Customer Receivable |

**Guards**: `uq_invoices_invoice_number`, `idx_journal_entries_unique_ref`

### 5) Customer Receipt (`create_customer_receipt_atomic`)

| Step | Entity | Action | Account Mapping |
|------|--------|--------|-----------------|
| 1 | customer_receipts | INSERT | — |
| 2 | invoices | UPDATE `paid_amount`, `remaining_amount` | — |
| 3 | journal_entries | INSERT with lines | DR: Cash/Bank, CR: Customer Receivable |

**Guards**: `customer_receipts_receipt_number_key`, `idx_journal_entries_unique_ref`

### 6) Void/Cancel Paths

| Flow | RPC | Reversal JE? |
|------|-----|--------------|
| Void Sales Invoice | `void_sales_invoice_atomic` | ✅ Yes |
| Void ERP Return | `void_erp_sales_return_atomic` | ✅ Yes |
| Void Customer Receipt | `void_customer_receipt_atomic` | ✅ Yes |
| Void Credit Note | `void_credit_note_atomic` | ✅ Yes |

---

## E) RLS & Permissions Audit

### RLS Status by Table

| Table | RLS Enabled | Policy Count | Risk Flags |
|-------|-------------|--------------|------------|
| invoices | ✅ | 4 | OK |
| sales_invoice_items | ✅ | 4 | OK |
| returns | ✅ | 4 | OK |
| return_items | ✅ | 2+ | OK |
| jewelry_items | ✅ | 3 | ⚠️ `USING(true)` on SELECT, `WITH CHECK(true)` on UPDATE |
| item_movements | ✅ | 2 | ⚠️ `WITH CHECK(true)` on INSERT |
| journal_entries | ✅ | 4 | OK (accounting permission check) |
| journal_entry_lines | ✅ | 4 | OK |
| customer_receipts | ✅ | 4 | OK |
| credit_notes | ✅ | 4 | OK |
| credit_note_items | ✅ | 4 | OK |
| sales | ✅ | 4 | OK |
| sale_items | ✅ | 4 | OK |

### Risky Policies (Detail)

```sql
-- jewelry_items: Overly permissive
SELECT: USING(true)  -- Anyone authenticated can see ALL items
UPDATE: USING(true) WITH CHECK(true)  -- Anyone can update ANY item

-- item_movements: Overly permissive INSERT
INSERT: WITH CHECK(true)  -- Anyone can insert movements
```

### Function Execute Grants

| RPC | anon | authenticated |
|-----|------|---------------|
| complete_pos_sale_atomic | YES | YES |
| complete_sales_invoice_atomic | NO | YES |
| complete_erp_sales_return_atomic | NO | YES |
| create_customer_receipt_atomic | NO | YES |
| void_customer_receipt_atomic | NO | YES |
| complete_erp_credit_note_atomic | NO | YES |
| void_credit_note_atomic | NO | YES |
| complete_pos_return_atomic | YES | YES |

⚠️ **Security Note**: `complete_pos_sale_atomic` and `complete_pos_return_atomic` allow `anon` execution. Consider restricting to `authenticated` only.

---

## F) Legacy Detection Verdict + Cleanup Target List

### Legacy Scorecard

| Metric | Value | Status |
|--------|-------|--------|
| % Flows RPC-Only | **85%** (11/13 active flows) | ✅ Good |
| # Direct Writes in Critical Paths | **11** (across 2 files) | 🔴 Needs Migration |
| # Legacy RPCs | **0** (all RPCs are atomic) | ✅ Excellent |
| # Risky RLS Policies | **3** (jewelry_items SELECT/UPDATE, item_movements INSERT) | ⚠️ Medium Risk |
| Anon Function Grants | **2** (complete_pos_sale_atomic, complete_pos_return_atomic) | ⚠️ Review |

### Cleanup Target List (NO EXECUTION - Proposal Only)

#### 1. Pages/Routes — Legacy Candidates

| Target | Current State | Proposed Action | Priority |
|--------|---------------|-----------------|----------|
| `CustomersPage.tsx:152-274` | Direct writes for returns | Migrate to `complete_pos_return_atomic` or dedicated RPC | 🔴 P1 |
| `ReceiptVouchersPage.tsx` | BLOCKED (PV-3) | Complete PV-3 implementation | ⚠️ P2 |

#### 2. Library Files — Legacy Candidates

| Target | Current State | Proposed Action | Priority |
|--------|---------------|-----------------|----------|
| `pos-return-workflow.ts:postReturn()` | Direct writes to jewelry_items, item_movements, customer_credits | Migrate to `complete_pos_return_atomic` | 🔴 P1 |
| `pos-return-workflow.ts:submitReturnForApproval()` | Direct update | Keep (approval workflow) or migrate | ⚠️ P3 |
| `pos-return-workflow.ts:approveReturn()` | Direct update | Keep or migrate | ⚠️ P3 |
| `pos-return-workflow.ts:rejectReturn()` | Direct update | Keep or migrate | ⚠️ P3 |

#### 3. RPCs — Legacy Candidates

| Target | Issue | Proposed Action | Priority |
|--------|-------|-----------------|----------|
| None | All RPCs are atomic | N/A | ✅ |

#### 4. RLS Policies — Tightening Candidates

| Target | Current | Proposed | Priority |
|--------|---------|----------|----------|
| `jewelry_items` SELECT | `USING(true)` | `USING(branch_id = ANY(get_user_branches(auth.uid())))` | ⚠️ P2 |
| `jewelry_items` UPDATE | `USING(true) WITH CHECK(true)` | Branch-scoped + RPC-only writes | 🔴 P1 |
| `item_movements` INSERT | `WITH CHECK(true)` | RPC-only writes (revoke direct) | ⚠️ P2 |

#### 5. Function Grants — Restriction Candidates

| Target | Current | Proposed | Priority |
|--------|---------|----------|----------|
| `complete_pos_sale_atomic` | anon+authenticated | authenticated only | ⚠️ P2 |
| `complete_pos_return_atomic` | anon+authenticated | authenticated only | ⚠️ P2 |

### Data Drift Checks Required

```sql
-- Check 1: Returns without client_request_id (idempotency bypass)
SELECT COUNT(*) FROM returns WHERE client_request_id IS NULL AND created_at > NOW() - INTERVAL '30 days';

-- Check 2: Orphan JEs (no reference linkage)
SELECT COUNT(*) FROM journal_entries WHERE reference_id IS NULL AND reference_type LIKE '%sale%';

-- Check 3: Items with inconsistent sale_status vs sold_at
SELECT COUNT(*) FROM jewelry_items 
WHERE (sale_status = 'sold' AND sold_at IS NULL) 
   OR (sale_status IN ('available', 'inspection') AND sold_at IS NOT NULL);

-- Check 4: Duplicate movements per item/reference
SELECT item_id, reference_type, reference_id, movement_type, COUNT(*)
FROM item_movements
GROUP BY item_id, reference_type, reference_id, movement_type
HAVING COUNT(*) > 1;
```

---

## Appendices

### SQL Queries Used

```sql
-- RPC catalog
SELECT p.proname, pg_get_function_arguments(p.oid), 
       CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' AND p.proname LIKE '%sale%';

-- RLS policies
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies WHERE schemaname = 'public' AND tablename IN (...);

-- Unique indexes
SELECT i.relname, pg_get_indexdef(i.oid)
FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
WHERE x.indisunique;

-- Function grants
SELECT proname, has_function_privilege('authenticated', p.oid, 'EXECUTE')
FROM pg_proc p WHERE pronamespace = 'public'::regnamespace;
```

### Key File References

| File | Critical Lines |
|------|----------------|
| src/pages/POSPage.tsx | 406-512 (atomic sale) |
| src/pages/POSReturnPage.tsx | 699-802 (workflow call) |
| src/pages/sales/CreateSalesInvoicePage.tsx | 278-404 (atomic save) |
| src/pages/sales/CustomerReceiptsPage.tsx | 193-331 (atomic save/void) |
| src/pages/sales/CreditNotesPage.tsx | 184-325 (atomic save/void) |
| src/pages/CustomersPage.tsx | 152-274 (🔴 LEGACY) |
| src/lib/pos-return-workflow.ts | 287-570 (🔴 LEGACY postReturn) |

---

## Gate Status

| Gate | Status | Evidence |
|------|--------|----------|
| A: Routes/Screens Map | ✅ PASS | 15 routes documented |
| B: Direct Writes Inventory | ✅ PASS | 11 legacy writes identified |
| C: RPC Catalog | ✅ PASS | 11 atomic RPCs catalogued |
| D: Posting Map | ✅ PASS | 6 scenarios documented |
| E: RLS/Permissions | ✅ PASS | 3 risky policies flagged |
| F: Verdict + Cleanup Targets | ✅ PASS | Scorecard + proposals ready |

---

**AUDIT COMPLETE** — NO FIXES EXECUTED

Next Phase: P4-2 Migration (implement cleanup targets)
