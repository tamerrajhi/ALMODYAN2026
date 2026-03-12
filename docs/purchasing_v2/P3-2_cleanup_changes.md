# P3-2 Cleanup Changes: Legacy Removal + PR→PO Bypass Remediation

**Completed**: 2026-01-22  
**Phase**: P3-2 (Post P3-1 Inventory)  
**Purpose**: Remove legacy code and eliminate direct-write bypasses

---

## P3-2A: PR→PO Bypass Fix ✅

### Problem
`PurchaseRequisitionsPage.tsx` contained direct writes to:
- `purchase_orders` (lines 266-282) - direct `.insert()`
- `purchase_order_items` (lines 291-301) - direct `.insert()`
- `purchase_requisitions` (lines 305-311) - direct `.update()`

This bypassed the V2 atomic RPC governance.

### Solution Applied
Replaced the entire `convertToPOMutation` with a call to `convert_pr_to_po_v2_atomic` RPC.

### Old Direct Write (REMOVED)
```typescript
// OLD - Direct writes to purchase_orders and purchase_order_items
const { data: newPO, error: poError } = await supabase
  .from('purchase_orders')
  .insert({
    po_number: poNumber,
    branch_id: requisition.branch_id,
    ...
  })
  .select()
  .single();

await supabase.from('purchase_order_items').insert(
  prItems.map((item: any) => ({
    po_id: newPO.id,
    ...
  }))
);
```

### New Atomic RPC (IMPLEMENTED)
```typescript
// NEW - Uses V2 atomic RPC
const { data: result, error: rpcError } = await supabase.rpc('convert_pr_to_po_v2_atomic', {
  p_payload: {
    client_request_id: clientRequestId,
    requisition_id: requisition.id,
    branch_id: requisition.branch_id,
    items,
    ...
  },
});
```

### Code Location
- **File**: `src/pages/purchasing/PurchaseRequisitionsPage.tsx`
- **Lines modified**: 258-320 (old lines 258-343)
- **RPC used**: `convert_pr_to_po_v2_atomic`

### Search Proof
After fix, search for direct writes:

| Keyword | File | Occurrences | Status |
|---------|------|-------------|--------|
| `.from('purchase_orders').insert` | PurchaseRequisitionsPage.tsx | **0** | ✅ CLEAN |
| `.from('purchase_order_items').insert` | PurchaseRequisitionsPage.tsx | **0** | ✅ CLEAN |

---

## P3-2B: Legacy Routes/Pages/Service Cleanup ✅

### 1) Module Config Update

**File**: `src/modules/purchases/module.config.ts`

| Item | Old Value | New Value |
|------|-----------|-----------|
| Route `/purchasing/returns` | `PurchaseReturnsPage` | `PurchaseReturnsListPage` |

### 2) Legacy Pages Deleted

| File | Status | Reason |
|------|--------|--------|
| `src/pages/purchasing/PurchaseReturnFormPage.tsx` | ✅ **DELETED** | Unreachable (route blocked by DeprecatedPurchasingPage) |
| `src/pages/purchasing/PurchaseReturnsPage.tsx` | ✅ **DELETED** | Replaced by PurchaseReturnsListPage |

### 3) Blocked Route Kept (Safety Barrier)

| Route | Component | Status | Reason |
|-------|-----------|--------|--------|
| `/purchasing/returns/:id` | `DeprecatedPurchasingPage` | ✅ **KEPT** | Provides redirect/warning to users hitting legacy URLs |

### 4) Blocked Service Functions Removed

**File**: `src/domain/purchasing/purchasingWriteService.ts`

| Function | Lines Removed | Replacement |
|----------|--------------|-------------|
| `createPurchaseReturnGeneral()` | 480-491 | `createPurchaseReturnGeneralAtomic()` |
| `createPurchaseReturnUnique()` | 498-509 | `createPurchaseReturnUniqueAtomic()` |
| `createSupplierPayment()` | 516-527 | `payment_voucher_atomic` RPC |
| `cancelPurchaseReturn()` | 544-555 | `voidPurchaseReturnAtomic()` |
| `cancelPurchaseInvoice()` | 566-577 | `purchase_invoice_void_atomic` RPC |

**Kept**: `deletePaymentVoucher()` - Still used, safely delegates to `voidPaymentVoucher()`

### 5) Remaining PR Direct Writes (Out of Scope)

The following direct writes in `PurchaseRequisitionsPage.tsx` remain for PR CRUD operations:
- Submit mutation (lines 190-196) - `.update()` on `purchase_requisitions`
- Delete mutation (line 239) - `.delete()` on `purchase_requisitions`

These are targeted for Stage-2B migration to `requisition_submit_v2_atomic` and related RPCs.

---

## Files Modified

| File | Action | Details |
|------|--------|---------|
| `src/pages/purchasing/PurchaseRequisitionsPage.tsx` | **MODIFIED** | PR→PO conversion now uses atomic RPC |
| `src/modules/purchases/module.config.ts` | **MODIFIED** | Returns route now points to V2 list page |
| `src/domain/purchasing/purchasingWriteService.ts` | **MODIFIED** | Removed 5 blocked legacy functions |

## Files Deleted

| File | Reason |
|------|--------|
| `src/pages/purchasing/PurchaseReturnFormPage.tsx` | Unreachable, legacy wrapper |
| `src/pages/purchasing/PurchaseReturnsPage.tsx` | Replaced by PurchaseReturnsListPage |

---

## Search Proof Summary

### Direct Write Search in PurchaseRequisitionsPage.tsx

| Pattern | Occurrences | Status |
|---------|-------------|--------|
| `.from('purchase_orders').insert` | **0** | ✅ |
| `.from('purchase_order_items').insert` | **0** | ✅ |
| `convert_pr_to_po_v2_atomic` | **1** | ✅ (new atomic call) |

### Import Check for Deleted Files

| Import Pattern | Occurrences | Status |
|----------------|-------------|--------|
| `PurchaseReturnFormPage` | **0** | ✅ |
| `PurchaseReturnsPage` (not ListPage) | **0** | ✅ |

---

## Gate P3-2 Acceptance ✅

- [x] **P3-2A PASS**: PR→PO bypass removed - uses `convert_pr_to_po_v2_atomic` RPC
- [x] **P3-2B PASS**: Legacy pages deleted safely
- [x] **P3-2B PASS**: Blocked service functions removed
- [x] **P3-2B PASS**: Module config updated to V2 list page
- [x] Build passes (no broken imports)
- [x] No direct DB writes remain in purchasing UI for PO flows
