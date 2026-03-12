# Payment Voucher Go-Live Scope (PV-4)

**Module**: Purchasing Payment Vouchers  
**Version**: PV-4.2  
**Date**: 2026-01-17  
**Environment**: Production Ready  

---

## Atomicization Scope

Atomic lifecycle management applies **STRICTLY** to **Purchasing Payment Vouchers** only.

### Operations Covered

| Operation | RPC | Status |
|-----------|-----|--------|
| **Create** | `payment_voucher_atomic` | ✅ Live |
| **Update** | `payment_voucher_update_atomic` | ✅ Live |
| **Void/Delete** | `payment_voucher_void_atomic` | ✅ Live |

---

## Core Atomic RPCs

### Primary Lifecycle RPCs

1. **`public.payment_voucher_atomic(jsonb)`**
   - Creates new payment voucher + balanced journal entry
   - Server-side derivation via `derive_payment_voucher_lines`
   - Idempotency via `begin_workflow_request`

2. **`public.payment_voucher_update_atomic(jsonb)`**
   - Updates existing payment voucher
   - Reverses old JE, creates new JE
   - Handles unique constraint on `journal_entries.reference_id`

3. **`public.payment_voucher_void_atomic(jsonb)`**
   - Soft-deletes payment voucher (status → 'voided')
   - Creates reversal JE, marks original as `is_reversed=true`

### Supporting Functions

4. **`public.derive_payment_voucher_lines(jsonb)`**
   - Resolves accounts from `payment_account_settings`
   - Links party accounts (supplier/customer sub-ledger)
   - Returns balanced journal lines

5. **`public.reverse_journal_entry_atomic(uuid, ...)`**
   - Creates reversal JE with swapped debit/credit
   - Marks original JE as `is_reversed=true`
   - Clears `reference_id` to avoid unique constraint conflicts

---

## TypeScript Service Wrappers

All wrappers are **THIN** - no business logic, pure RPC delegation:

| Function | File | Description |
|----------|------|-------------|
| `createPaymentVoucher` | `purchasingWriteService.ts` | Calls `payment_voucher_atomic` |
| `updatePaymentVoucher` | `purchasingWriteService.ts` | Calls `payment_voucher_update_atomic` |
| `voidPaymentVoucher` | `purchasingWriteService.ts` | Calls `payment_voucher_void_atomic` |
| `deletePaymentVoucher` | `purchasingWriteService.ts` | Alias for `voidPaymentVoucher` |

---

## Out of Scope (NOT MODIFIED)

The following modules retain **legacy direct-write patterns** and are explicitly **OUT OF SCOPE** for PV-4:

### Sales Module
- `src/pages/sales/ReceiptVouchersPage.tsx` — Customer Receipts
- `src/pages/sales/CustomerReceiptsPage.tsx` — Legacy customer receipt handling
- `src/pages/sales/CreditNotesPage.tsx` — Credit note management

### Accounting Module
- `src/lib/accounting.ts` — Legacy JE creation helpers (non-atomic)
- `src/lib/production-accounting.ts` — Production cost JE creation

### Other Purchasing Functions
- `createSupplierPayment` — Legacy 1:N payment allocation (NOT atomic)
- `generatePaymentVoucherNumber` — Legacy helper (NOT used by atomic flows)

---

## Gate Verification Summary

| Gate | Description | Status |
|------|-------------|--------|
| G0 | Workflow types & RPC grants | ✅ PASS |
| G1 | Account mappings ready | ✅ PASS |
| G2 | Atomic CREATE runtime | ✅ PASS |
| G3 | Data integrity (JE linking) | ✅ PASS |
| G4 | Idempotency (cached/conflict) | ✅ PASS |
| G5 | UI/Service purge (PV files only) | ✅ PASS |
| G6 | Monitoring queries ready | ✅ PASS |

---

## Monitoring

See: [`supabase/sql/pv_go_live_monitoring.sql`](../supabase/sql/pv_go_live_monitoring.sql)

Contains 5 monitoring queries:
- M1: Posted payments missing JE link
- M2: Unbalanced posted journal entries
- M3: Duplicate payment numbers
- M4: Orphaned JE lines
- M5: Voided payments without reversal

---

## Go-Live Approval

**Decision**: ✅ **GO**

All PV-specific gates passed. Legacy patterns in other modules are documented and out of scope.
