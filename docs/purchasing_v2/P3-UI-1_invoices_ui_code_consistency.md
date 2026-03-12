# P3-UI-1: Purchase Invoices UI↔Code Consistency Audit

**Module**: Purchasing V2 — Purchase Invoices (General + Import)  
**Audit Date**: 2026-01-23  
**Status**: ✅ **PASS WITH BACKLOG**

---

## A) UI Contract Sheet

### Routes & Pages

| Route | Component | Permission | Purpose |
|-------|-----------|------------|---------|
| `/purchasing/invoices` | `PurchaseInvoicesPage.tsx` | `purchase_invoices` | List view with filters |
| `/purchasing/invoices/new` | `PurchaseInvoiceFormPage.tsx` | `purchase_invoices` | Create new invoice |
| `/purchasing/invoices/:id` | `PurchaseInvoiceFormPage.tsx` | `purchase_invoices` | Edit existing invoice |
| `/purchasing/invoices/:id/view` | `PurchaseInvoiceViewPage.tsx` | `purchase_invoices` | Read-only view + actions |
| `/purchasing/invoices/import` | `PurchaseInvoiceImportPage.tsx` | `purchase_invoices` | Excel bulk import |

**Evidence**: `src/App.tsx:243-247`, `src/modules/purchases/module.config.ts:22-26`

### Primary Actions

| Action | UI Element | Handler Location | Policy Gate |
|--------|------------|------------------|-------------|
| View | List row click / View button | `InvoiceActionsDropdown.tsx:handleView` | Always enabled |
| Create | "New Invoice" button | `PurchaseInvoiceFormPage.tsx:handleSave` | N/A (new) |
| Edit | Edit button / dropdown | `PurchaseInvoiceFormPage.tsx:handleSave` (update path) | `canEdit` policy check |
| Void | Dropdown "Cancel" | `InvoiceActionsDropdown.tsx:handleCancel` / `ViewPage:cancelMutation` | `canCancel` (NOT_IMPLEMENTED) |
| Print | Print button | `InvoiceActionsDropdown.tsx:handlePrint` | Always enabled |
| PDF | PDF button | `InvoiceActionsDropdown.tsx:handlePdf` | Always enabled |
| Email | Email button | `InvoiceActionsDropdown.tsx:handleEmail` | Requires supplier email |
| Pay | Pay button | `PaymentEntryDialog` integration | `canPay` policy check |
| Create Return | Return button | Navigation to return router | `canCreateReturn` policy check |
| View Journal | View JE button | Navigation to JE | `canViewJournal` (requires posted) |
| Duplicate | Duplicate button | `InvoiceActionsDropdown.tsx:handleDuplicate` | Always enabled |

### Form Fields (Create/Edit)

| Field | Required | Validation | Source |
|-------|----------|------------|--------|
| Supplier | Yes | UUID, active supplier | `SupplierSelect` → `searchSuppliersForSelect` |
| Branch | Yes | UUID, user's branch access | `BranchSelect` → `listBranchesForSelect` |
| Invoice Date | Yes | ISO date | Date picker |
| Due Date | No | ISO date ≥ invoice date | Date picker |
| Notes | No | Text | Textarea |
| Lines (min 1) | Yes | See line validation | `UnifiedInvoiceLineRow` |

### Line Fields

| Field | Required | Validation | Convention |
|-------|----------|------------|------------|
| Item (jewelry/cost/product) | Yes | UUID or new | Combobox selection |
| Description | No | Text | Auto-populated from item |
| Quantity | Yes | > 0 | Numeric input |
| Unit Price | Yes | ≥ 0 | Numeric input |
| Tax Rate | No | 0-100 (PERCENT) | Default 15% |
| Discount | No | ≥ 0 | Numeric input |
| Is Inclusive | No | Boolean | Checkbox |
| GL Account | Conditional | Required for cost items | Auto-resolved |

### States & Status Badges

| Status | Badge Color | Edit Allowed | Pay Allowed | Void Allowed |
|--------|-------------|--------------|-------------|--------------|
| `pending` | Yellow/Amber | ✅ Yes | ❌ No (not posted) | ❌ Not implemented |
| `partial` | Blue | ❌ No | ✅ Yes | ❌ Not implemented |
| `paid` | Green | ❌ No | ❌ No (no remaining) | ❌ Not implemented |
| `cancelled` | Red/Gray | ❌ No | ❌ No | ❌ No |

### Guardrails

| Guardrail | Location | Block Condition |
|-----------|----------|-----------------|
| JE Posted Lock | `evaluateInvoicePolicy.ts:67-69` | `journalEntryId` exists → blocks edit |
| Status Lock | `evaluateInvoicePolicy.ts:64-72` | Status not `pending` → blocks edit |
| Branch Access | RPC `purchase_invoice_update_v2_atomic` | User not authorized for branch |
| Import Lines Lock | `evaluateInvoicePolicy.ts:73-78` | Import invoices → info message |
| Cancel Not Implemented | `evaluateInvoicePolicy.ts:83-89` | Always blocked until reversal available |

**Evidence**: `src/domain/purchasing/policy/evaluateInvoicePolicy.ts:54-89`

---

## B) Traceability Matrix

### CREATE Invoice

| Layer | Element | File:Line |
|-------|---------|-----------|
| UI Button | "Save" / "Save & Close" | `PurchaseInvoiceFormPage.tsx:674-678` |
| Handler | `handleSave()` | `PurchaseInvoiceFormPage.tsx:410-643` |
| Validation | Tax rate safeguard (percent check) | `PurchaseInvoiceFormPage.tsx:461-476` |
| Idempotency | `clientRequestIdRef.current = crypto.randomUUID()` | `PurchaseInvoiceFormPage.tsx:479-481` |
| Command Build | `AtomicCreatePurchaseInvoiceCommand` | `PurchaseInvoiceFormPage.tsx:579-597` |
| Service Call | `createPurchaseInvoiceAtomic(createCmd)` | `PurchaseInvoiceFormPage.tsx:599` |
| Service Function | `createPurchaseInvoiceAtomic()` | `purchasingWriteService.ts:2638-2651` |
| RPC | `purchase_invoice_create_atomic` | `supabase.rpc()` |
| DB Tables | `invoices`, `purchase_invoice_lines`, `journal_entries`, `journal_entry_lines` | Migration SQL |
| Guardrails | Idempotency (`begin_workflow_request`), JE creation mandatory | RPC logic |

### CREATE Invoice (Import Path)

| Layer | Element | File:Line |
|-------|---------|-----------|
| UI Button | "Save Invoice" | `PurchaseInvoiceImportPage.tsx:382-388` |
| Handler | `handleSave()` | `PurchaseInvoiceImportPage.tsx:281-355` |
| Excel Parse | `processExcelFile()` | `PurchaseInvoiceImportPage.tsx:113-190` |
| Validation | Row-by-row validation | `PurchaseInvoiceImportPage.tsx:143-175` |
| Idempotency | `clientRequestIdRef.current` | `PurchaseInvoiceImportPage.tsx:77-79` |
| Command Build | `AtomicCreatePurchaseInvoiceCommand` | `PurchaseInvoiceImportPage.tsx:302-328` |
| Service Call | `createPurchaseInvoiceAtomic(cmd)` | `PurchaseInvoiceImportPage.tsx:330` |
| Service Function | `createPurchaseInvoiceAtomic()` | `purchasingWriteService.ts:2638-2651` |
| RPC | `purchase_invoice_create_atomic` | Same as above |

### EDIT/UPDATE Invoice

| Layer | Element | File:Line |
|-------|---------|-----------|
| UI Button | "Save" (edit mode) | `PurchaseInvoiceFormPage.tsx:674-678` |
| Handler | `handleSave()` (update branch) | `PurchaseInvoiceFormPage.tsx:506-570` |
| Policy Check | `getInvoicePolicy()` | Not enforced in form (RPC enforces) |
| Command Build | `UpdatePurchaseInvoiceCommand` | `PurchaseInvoiceFormPage.tsx:508-524` |
| Service Call | `updatePurchaseInvoice(updateCmd)` | `PurchaseInvoiceFormPage.tsx:527` |
| Service Function | `updatePurchaseInvoice()` | `purchasingWriteService.ts:318-445` |
| RPC | `purchase_invoice_update_v2_atomic` | `purchasingWriteService.ts:378-381` |
| DB Tables | `invoices`, `purchase_invoice_lines` (replace pattern) | RPC logic |
| Guardrails | `STATUS_LOCKED`, `JE_POSTED`, `ACCESS_DENIED` | RPC error codes |
| Error Handling | Localized error messages | `PurchaseInvoiceFormPage.tsx:530-560` |

### VOID Invoice

| Layer | Element | File:Line |
|-------|---------|-----------|
| UI Button | "Cancel" in dropdown/view | `InvoiceActionsDropdown.tsx:169` |
| Handler | `handleCancel()` | `InvoiceActionsDropdown.tsx:224-270` |
| Policy Check | `canCancel` (currently blocked) | `evaluateInvoicePolicy.ts:83-89` |
| Idempotency | `voidRequestIdRef.current` | `InvoiceActionsDropdown.tsx:45-47` |
| Command Build | `AtomicVoidPurchaseInvoiceCommand` | `InvoiceActionsDropdown.tsx:249-255` |
| Service Call | `voidPurchaseInvoiceAtomic(cmd)` | `InvoiceActionsDropdown.tsx:249` |
| Service Function | `voidPurchaseInvoiceAtomic()` | `purchasingWriteService.ts:2676-2689` |
| RPC | `purchase_invoice_void_atomic` | `supabase.rpc()` |
| Guardrails | Double-void blocked, reversal JE created | RPC logic |

**Note**: Void is currently **NOT_IMPLEMENTED** in policy (blocked until journal reversal is production-ready).

### VIEW Invoice

| Layer | Element | File:Line |
|-------|---------|-----------|
| UI Element | Row click / View button | `InvoiceActionsDropdown.tsx:handleView` |
| Handler | `navigate()` | `InvoiceActionsDropdown.tsx:68-71` |
| Page | `PurchaseInvoiceViewPage.tsx` | Full file |
| Read Service | `getPurchaseInvoice(id)` | `purchasingReadService.ts:539-566` |
| Policy | `getInvoicePolicy(invoice)` | `PurchaseInvoiceViewPage.tsx:75` |
| Action Rendering | `InvoiceActionRenderer` | `PurchaseInvoiceViewPage.tsx:401-418` |

### PRINT / PDF / EMAIL

| Action | Handler | File:Line | Notes |
|--------|---------|-----------|-------|
| Print | `handlePrint()` | `InvoiceActionsDropdown.tsx:89-108` | HTML generation + window.print() |
| PDF | `handlePdf()` | `InvoiceActionsDropdown.tsx:110-153` | jsPDF generation + download |
| Email | `handleEmail()` | `InvoiceActionsDropdown.tsx:181-216` | Edge function `send-invoice-email` |

---

## C) UX/Design Review Checklist

### Layout Correctness

| Item | Status | Evidence/Notes |
|------|--------|----------------|
| List page responsive grid | ✅ OK | Uses Table component with overflow scroll |
| Form page field alignment | ✅ OK | Consistent grid layout |
| View page sections | ✅ OK | Header + details + lines + totals |
| Mobile responsiveness | ⚠️ MED | Table horizontal scroll works but could be optimized |

### Form UX

| Item | Status | Evidence/Notes |
|------|--------|----------------|
| Required field indicators | ✅ OK | Visual indicators present |
| Auto-calculation of totals | ✅ OK | `useMemo` in form page |
| Tax inclusive toggle | ✅ OK | Checkbox per line |
| Add/remove line buttons | ✅ OK | Working correctly |
| Item combobox with search | ✅ OK | `UnifiedItemCombobox` component |

### Error Messaging

| Scenario | Status | Evidence |
|----------|--------|----------|
| Validation errors (client) | ✅ OK | Toast messages, localized |
| RPC errors (server) | ✅ OK | Error code handling: `JE_POSTED`, `STATUS_LOCKED`, `ACCESS_DENIED` |
| Tax rate fraction error | ✅ OK | Explicit safeguard: `PurchaseInvoiceFormPage.tsx:461-476` |
| Idempotency conflict | ✅ OK | Specific error message |
| Network/timeout errors | ⚠️ MED | Generic error message |

### Loading States

| Item | Status | Evidence |
|------|--------|----------|
| List loading | ✅ OK | Skeleton/spinner shown |
| Form submission | ✅ OK | `isSaving` state, button disabled |
| Dropdown action loading | ✅ OK | `loadingAction` state per action |

### Empty States

| Item | Status | Evidence |
|------|--------|----------|
| Empty invoice list | ✅ OK | "No invoices found" message |
| Empty lines | ⚠️ LOW | Could show placeholder row |

### Filters & Pagination

| Item | Status | Evidence |
|------|--------|----------|
| Status filter | ✅ OK | Dropdown select |
| Supplier filter | ✅ OK | Dropdown select |
| Branch filter | ✅ OK | Dropdown select |
| Date range filter | ✅ OK | Date pickers |
| Search | ✅ OK | Client-side text search |
| Pagination | ⚠️ MED | No server-side pagination (1000 row limit) |

### Badges (Locked/Posted)

| Item | Status | Evidence |
|------|--------|----------|
| Status badges (pending/partial/paid/cancelled) | ✅ OK | Color-coded badges |
| Purchase type badge (general/import) | ✅ OK | Distinct styling |
| Posted indicator | ⚠️ LOW | Could add explicit "Posted" badge |

### Localization (AR/EN)

| Item | Status | Evidence |
|------|--------|----------|
| Labels and buttons | ✅ OK | `useLanguage()` context |
| Error messages | ✅ OK | Bilingual error handling |
| Number formatting | ✅ OK | `toLocaleString()` with locale |
| Date formatting | ✅ OK | `date-fns` with locale |
| RTL support | ✅ OK | `dir="rtl"` conditionally applied |
| Policy block reasons | ✅ OK | `messageAr` / `messageEn` in `invoicePolicyTypes.ts` |

---

## D) Findings

### BLOCKER Issues

**None identified.** ✅

### MEDIUM Priority Issues

| ID | Finding | Evidence | Fix Recommendation |
|----|---------|----------|-------------------|
| M1 | **Pagination missing** — List page loads all invoices (up to 1000 row limit). Large datasets will hit limit. | `purchasingReadService.ts:500-533` — no `.limit()` or pagination params | Add server-side pagination with `page`/`pageSize` params; implement infinite scroll or page controls in UI |
| M2 | **Network error handling generic** — Server errors beyond specific codes show generic message | `PurchaseInvoiceFormPage.tsx:558-560` | Add specific handling for common network errors (timeout, 500) |
| M3 | **Mobile table UX** — Line items table requires horizontal scroll on mobile | `UnifiedInvoiceLineRow.tsx` | Consider card-based layout for mobile or collapsible rows |

### LOW Priority Issues

| ID | Finding | Evidence | Fix Recommendation |
|----|---------|----------|-------------------|
| L1 | **Empty lines placeholder** — New invoice shows no visual hint when lines are empty | `PurchaseInvoiceFormPage.tsx` | Add placeholder row or empty state message |
| L2 | **Posted badge missing** — No explicit "Posted" indicator on list/view for posted invoices | `PurchaseInvoicesPage.tsx` | Add "Posted" chip/badge when `journal_entry_id` exists |
| L3 | **Import summary line visibility** — Import invoices show `IMPORT-SUMMARY` line which may confuse users | `rebuildImportSummary()` | Add visual distinction or tooltip explaining summary line |

---

## E) Static Checks

### Direct Writes Audit

**Critical User Paths — CLEAN ✅**

| Path | File | Method Used |
|------|------|-------------|
| Create (Manual) | `PurchaseInvoiceFormPage.tsx:599` | `createPurchaseInvoiceAtomic()` → RPC |
| Create (Import) | `PurchaseInvoiceImportPage.tsx:330` | `createPurchaseInvoiceAtomic()` → RPC |
| Update | `PurchaseInvoiceFormPage.tsx:527` | `updatePurchaseInvoice()` → RPC |
| Void | `InvoiceActionsDropdown.tsx:249` | `voidPurchaseInvoiceAtomic()` → RPC |

**Admin/Backlog Direct Writes — Documented**

| Function | File:Line | Classification |
|----------|-----------|----------------|
| `rebuildImportSummary()` | `purchasingWriteService.ts:540-573` | **BACKLOG** — Admin utility for import summary line |
| `seed-test-data` | Edge function | **TEST ONLY** — Cleanup function |

**Result**: ✅ **PASS** — Zero critical-path direct writes.

### Tax Rate Convention Verification

**End-to-End Consistency — VERIFIED ✅**

| Layer | Handling | Evidence |
|-------|----------|----------|
| UI Input | Percent (0-100), default 15 | `UnifiedInvoiceLineRow.tsx:51` — `taxRate = line.tax_rate \|\| 15` |
| UI Calculation | Divides by 100 for math | `UnifiedInvoiceLineRow.tsx:55-61` — `taxRate / 100` |
| Payload (Create) | Sends percent directly | `PurchaseInvoiceFormPage.tsx:590` — `tax_rate: line.tax_rate` |
| Payload (Update) | Sends percent directly | `purchasingWriteService.ts:363` — `tax_rate: line.taxRate` |
| Fraction Guard | Blocks values 0 < x < 1 | `PurchaseInvoiceFormPage.tsx:461-476` |
| RPC (Create) | Divides by 100 internally | RPC migration — `/100` in line calc |
| RPC (Update) | Divides by 100 internally | RPC logic |
| DB Storage | Stores as percent (15) | `purchase_invoice_lines.tax_rate` |

**Result**: ✅ **PASS** — Tax convention consistently applied.

---

## F) Runtime Proof Scenarios

### Smoke Scenario 1: Create General Invoice

**Steps**:
1. Navigate to `/purchasing/invoices/new`
2. Select supplier, branch, date
3. Add 2 lines: 1 cost item, 1 product item
4. Set tax_rate = 15 on both, one inclusive, one exclusive
5. Save

**Verification Queries**:
```sql
-- Check invoice created
SELECT id, invoice_number, status, total_amount, journal_entry_id
FROM invoices
WHERE invoice_number = '<created_number>';

-- Check lines with tax_rate = 15 (percent)
SELECT id, product_code, quantity, unit_price, tax_rate, tax_amount, total_amount
FROM purchase_invoice_lines
WHERE invoice_id = '<invoice_id>'
ORDER BY line_number;

-- Check JE balanced
SELECT 
  je.id,
  je.journal_number,
  SUM(jel.debit_amount) as total_debit,
  SUM(jel.credit_amount) as total_credit
FROM journal_entries je
JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
WHERE je.id = '<journal_entry_id>'
GROUP BY je.id, je.journal_number;
-- Expect: total_debit = total_credit
```

### Smoke Scenario 2: Update Invoice (Pending Status)

**Steps**:
1. Open existing pending invoice in edit mode
2. Change a line's unit price
3. Save

**Verification Queries**:
```sql
-- Check updated totals
SELECT subtotal, tax_amount, total_amount, updated_at
FROM invoices
WHERE id = '<invoice_id>';

-- Confirm lines replaced
SELECT COUNT(*) as line_count FROM purchase_invoice_lines WHERE invoice_id = '<invoice_id>';
```

### Smoke Scenario 3: Import Invoice from Excel

**Steps**:
1. Navigate to `/purchasing/invoices/import`
2. Download template
3. Fill with 5 rows (valid item codes, qty, price)
4. Upload and save

**Verification Queries**:
```sql
-- Check invoice created with import type
SELECT id, invoice_number, purchase_type, total_amount, journal_entry_id
FROM invoices
WHERE invoice_number = '<import_number>';

-- Check 5 lines created
SELECT COUNT(*) FROM purchase_invoice_lines WHERE invoice_id = '<invoice_id>';

-- Check JE exists and balanced
SELECT 
  SUM(debit_amount) = SUM(credit_amount) as balanced
FROM journal_entry_lines
WHERE journal_entry_id = '<je_id>';
```

---

## G) Summary & Gate Stamp

### Gates Summary

| Gate | Status | Notes |
|------|--------|-------|
| A) UI Contract Sheet | ✅ PASS | All routes, actions, fields documented |
| B) Traceability Matrix | ✅ PASS | Full Create/Edit/Void/View/Print wiring traced |
| C) UX/Design Review | ✅ PASS | 3 MED, 3 LOW issues identified |
| D) Findings | ✅ PASS | Zero blockers |
| E) Static Checks | ✅ PASS | Zero critical direct writes, tax convention verified |
| F) Runtime Proof | ✅ DEFINED | 3 scenarios with queries documented |

### Backlog Items (Non-Blocking)

| Priority | ID | Description |
|----------|-----|-------------|
| MED | M1 | Add server-side pagination for invoice list |
| MED | M2 | Improve network error handling specificity |
| MED | M3 | Mobile-optimize line items table |
| LOW | L1 | Add empty lines placeholder |
| LOW | L2 | Add "Posted" badge to list/view |
| LOW | L3 | Clarify import summary line visually |

---

## Gate Stamp

```
╔═══════════════════════════════════════════════════════════════════╗
║  P3-UI-1: Purchase Invoices UI↔Code Consistency Audit             ║
║                                                                    ║
║  Status: ✅ PASS WITH BACKLOG                                      ║
║  Date: 2026-01-23                                                  ║
║  Time: UTC+3                                                       ║
║                                                                    ║
║  Blockers: 0                                                       ║
║  Medium Priority: 3 (pagination, error handling, mobile UX)        ║
║  Low Priority: 3 (empty state, badges, import summary)             ║
║                                                                    ║
║  Critical Path Direct Writes: 0                                    ║
║  Tax Convention: ✅ Verified (Percent-Storage)                     ║
║  Idempotency: ✅ Verified (client_request_id pattern)              ║
║                                                                    ║
║  SCREEN 1: CLOSED                                                  ║
╚═══════════════════════════════════════════════════════════════════╝
```

---

*Next Screen: P3-UI-2 Purchase Returns*
