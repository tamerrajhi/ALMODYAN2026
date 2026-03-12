# P4-7 — Credit Notes Hardening Gate

## Executive Summary

تم تطبيق Hardening كامل على Credit Notes (ERP + POS) لضمان:
- **RPC-Only Model**: لا direct writes من UI
- **Posted Lock**: منع تعديل الحقول المالية بعد ترحيل القيد
- **Void Mechanism**: إلغاء مع قيد عكسي
- **RLS Hardening**: سياسات branch-scoped مع WITH CHECK

---

## P4-7.0 Evidence Inventory

### Direct Writes Found (BEFORE)

| Table | Operation | File | Status |
|-------|-----------|------|--------|
| credit_notes | INSERT | CreditNotesPage.tsx:205-209 | ❌ CRITICAL |
| invoices | UPDATE | CreditNotesPage.tsx:223-229 | ❌ CRITICAL |
| journal_entries | INSERT | CreditNotesPage.tsx:247-262 | ❌ CRITICAL |
| credit_notes | INSERT | POSCreditNotePage.tsx:343-360 | ❌ CRITICAL |
| credit_note_items | INSERT | POSCreditNotePage.tsx:376-378 | ❌ CRITICAL |
| jewelry_items | UPDATE | POSCreditNotePage.tsx:383-393 | ❌ CRITICAL |
| customers | UPDATE | POSCreditNotePage.tsx:397-404 | ❌ CRITICAL |
| journal_entries | INSERT (via lib) | accounting.ts:289-303 | ❌ CRITICAL |

### RLS Issues Found (BEFORE)

| Table | Issue |
|-------|-------|
| credit_notes | UPDATE missing WITH CHECK |
| credit_notes | No DELETE policy |
| credit_note_items | All policies = TRUE (permissive) |

---

## P4-7.1 DB Hardening Applied

### Schema Changes
- Added: `voided_at`, `voided_by`, `void_reason` columns
- Updated: status constraint includes 'voided'

### Triggers Created
- `trg_credit_note_posted_lock`: Prevents financial field updates after JE posted
- `trg_credit_note_prevent_delete`: Admin-only delete at DB level

### RLS Policies Fixed
- credit_notes: UPDATE with WITH CHECK
- credit_notes: DELETE admin-only
- credit_note_items: Branch-scoped via parent FK (replaced TRUE)

### RPCs Created
- `void_credit_note_atomic(p_payload jsonb)`: Void with reversal JE + idempotency

---

## P4-7.2 UI Wiring

### CreditNotesPage.tsx (AFTER)
- Uses `complete_erp_credit_note_atomic` RPC
- Uses `void_credit_note_atomic` RPC
- clientRequestId for idempotency
- Error handling: OVER_CREDIT_NOT_ALLOWED, POSTED_LOCKED, ALREADY_VOIDED

### POSCreditNotePage.tsx (AFTER - P4-7.2B)
- Uses `complete_pos_credit_note_atomic` RPC (file:391-402)
- Uses `void_credit_note_atomic` RPC (file:512-523)
- clientRequestId for idempotency (generateClientId)
- Error mapping: BRANCH_MISMATCH, POSTED_LOCKED, ALREADY_VOIDED, ACCESS_DENIED
- Removed all direct writes:
  - credit_notes INSERT
  - credit_note_items INSERT
  - jewelry_items UPDATE
  - customers UPDATE
  - accounting.ts JE creation

---

## P4-7.3 Verification Gates

| Gate | Description | Status |
|------|-------------|--------|
| V1 | Direct Writes = 0 in CreditNotesPage | ✅ PASS |
| V2 | Direct Writes = 0 in POSCreditNotePage | ✅ PASS |
| V3 | Create via RPC works (both pages) | ✅ PASS |
| V4 | Void creates reversal JE | ✅ PASS |
| V5 | Idempotency via clientRequestId | ✅ PASS |
| V6 | RLS: No permissive TRUE on credit_note_items | ✅ PASS |
| V7 | Posted Lock trigger active | ✅ PASS |

---

## Artifacts

1. Migration: `20260124_p4_7_credit_notes_hardening.sql`
2. UI (ERP): `src/pages/sales/CreditNotesPage.tsx` (refactored)
3. UI (POS): `src/pages/POSCreditNotePage.tsx` (refactored - P4-7.2B)

---

## POSCreditNotePage Atomic Adoption (P4-7.2B)

### Direct Writes Eliminated

| Table | Operation | Before (Line) | After |
|-------|-----------|---------------|-------|
| credit_notes | INSERT | 343-360 | RPC complete_pos_credit_note_atomic |
| credit_note_items | INSERT | 376-378 | RPC (atomic) |
| jewelry_items | UPDATE | 383-393 | RPC (atomic) |
| customers | UPDATE | 397-404 | RPC (atomic) |
| journal_entries | INSERT | via accounting.ts | RPC (atomic) |

### New RPC Wiring

| Operation | RPC | File:Line |
|-----------|-----|-----------|
| Create | complete_pos_credit_note_atomic | POSCreditNotePage.tsx:391-402 |
| Void | void_credit_note_atomic | POSCreditNotePage.tsx:512-523 |

### Idempotency

- `clientRequestIdRef` initialized with `crypto.randomUUID()`
- Regenerated after each successful submission
- Prevents duplicate credit notes on double-submit

### Error Mapping

```typescript
const errorMap = {
  'BRANCH_REQUIRED': 'يجب تحديد الفرع',
  'CUSTOMER_REQUIRED': 'يجب تحديد العميل',
  'ITEMS_REQUIRED': 'يجب إضافة قطعة واحدة على الأقل',
  'ITEM_NOT_FOUND': 'القطعة غير موجودة',
  'ITEM_NOT_SOLD': 'القطعة غير مباعة - لا يمكن إرجاعها',
  'BRANCH_MISMATCH': 'القطعة تنتمي لفرع آخر',
  'ACCESS_DENIED': 'لا تملك صلاحية على هذا الفرع',
  'POSTED_LOCKED': 'لا يمكن تعديل مستند مرحّل',
  'ALREADY_VOIDED': 'هذا الإشعار ملغي مسبقاً',
};
```

---

## Gate Stamp

**P4-7 PASS — CLOSED (No Backlog for POS direct writes)**

Date: 2026-01-24
