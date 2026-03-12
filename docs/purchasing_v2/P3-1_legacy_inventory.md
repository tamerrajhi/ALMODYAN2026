# P3-1 Legacy Inventory: Purchasing Module Post-Cutover Audit

**Generated**: 2026-01-22  
**Phase**: P3-1 (Post P2-1 Cutover)  
**Purpose**: Exhaustive inventory of legacy routes, pages, components, and service functions

---

## A) Legacy Routes (Still Registered)

| Route Path | Router Registration | Destination Component | Status | V2 Replacement |
|------------|--------------------|-----------------------|--------|----------------|
| `/purchasing/returns/:id` | `src/App.tsx:252` | `DeprecatedPurchasingPage` | ✅ **BLOCKED** | `/purchasing/returns/:id/view` (read-only) |
| `/purchasing/orders` | `src/App.tsx:240` | `PurchaseOrdersPage` | ✅ **V2 ACTIVE** | N/A - Already V2 (atomic RPCs) |
| `/purchasing/orders/:id` | `src/App.tsx:241` | `PurchaseOrderDetailPage` | ✅ **V2 ACTIVE** | N/A - Already V2 (atomic RPCs) |
| `/purchasing/receive/:id` | `src/App.tsx:242` | `ReceivePurchaseOrderPage` | ✅ **V2 ACTIVE** | N/A - Already V2 (atomic RPCs) |
| `/purchasing/invoices` | `src/App.tsx:243` | `PurchaseInvoicesPage` | ✅ **V2 ACTIVE** | N/A - Already V2 (atomic RPCs) |
| `/purchasing/invoices/:id` | `src/App.tsx:247` | `PurchaseInvoiceFormPage` | ✅ **V2 ACTIVE** | N/A - Already V2 (atomic RPCs) |
| `/purchasing/returns` | `src/App.tsx:250` | `PurchaseReturnsListPage` | ✅ **V2 ACTIVE** | N/A - Already V2 |
| `/purchasing/returns/new` | `src/App.tsx:251` | `PurchaseReturnRouterPage` | ✅ **V2 ACTIVE** | N/A - Routes to V2 pages |
| `/purchasing/returns/:id/view` | `src/App.tsx:253` | `PurchaseReturnViewPage` | ✅ **V2 ACTIVE** | N/A - Read-only view |

### Search Evidence
- **Keywords**: `/purchasing/`, `Route path=`, `DeprecatedPurchasingPage`
- **Files searched**: `src/App.tsx`, `src/modules/purchases/module.config.ts`
- **Finding**: Only `/purchasing/returns/:id` is blocked; all other routes are V2-active

---

## B) Legacy Pages/Components

| File Path | Used By | Purpose | Status | Evidence |
|-----------|---------|---------|--------|----------|
| `src/pages/purchasing/DeprecatedPurchasingPage.tsx` | `src/App.tsx:252` | Blocks legacy return edit route, redirects to view | ✅ **KEEP** (Blocker Page) | Active redirection mechanism |
| `src/pages/purchasing/PurchaseReturnFormPage.tsx` | None (route blocked) | Wrapper for `UnifiedPurchaseDocumentPage` with `PURCHASE_RETURN` | ⚠️ **TO REMOVE** | Route `/purchasing/returns/:id` now points to `DeprecatedPurchasingPage` |
| `src/pages/purchasing/PurchaseReturnsPage.tsx` | Sidebar (legacy) | Old returns list with warning banner | ⚠️ **TO REMOVE** | Replaced by `PurchaseReturnsListPage`; shows deprecation warning at line 241-251 |
| `src/pages/purchasing/UnifiedPurchaseDocumentPage.tsx` | `PurchaseInvoiceFormPage`, ~~`PurchaseReturnFormPage`~~ | Unified form for invoices/returns | ✅ **KEEP** (V2 Invoices) | Only active for `documentType="PURCHASE_INVOICE"` |
| `src/components/purchasing/PRDetailsDialog.tsx` | `PurchaseRequisitionsPage` | PR detail dialog | ✅ **KEEP** | Used in active requisitions flow |
| `src/components/purchasing/PRFormDialog.tsx` | `PurchaseRequisitionsPage` | PR create/edit form | ⚠️ **REFACTOR** | Uses legacy direct writes |
| `src/components/purchasing/PRApprovalDialog.tsx` | `PurchaseRequisitionsPage` | PR approval dialog | ⚠️ **REFACTOR** | Uses legacy direct writes |

### Search Evidence
- **Keywords**: `UnifiedPurchaseDocumentPage`, `PURCHASE_RETURN`, `PurchaseReturnFormPage`, `DeprecatedPurchasingPage`
- **Finding**: `PurchaseReturnFormPage` exists but is unreachable due to route redirection

---

## C) Legacy Service/Helper Functions

### Blocked Functions (Return DEPRECATED Error)

| File Path | Function Name | Original Purpose | Current Status | Recommended Action |
|-----------|---------------|------------------|----------------|-------------------|
| `purchasingWriteService.ts:480-491` | `createPurchaseReturnGeneral()` | Create general return | ❌ **BLOCKED** | **REMOVE** - Returns `DEPRECATED` error |
| `purchasingWriteService.ts:498-509` | `createPurchaseReturnUnique()` | Create unique item return | ❌ **BLOCKED** | **REMOVE** - Returns `DEPRECATED` error |
| `purchasingWriteService.ts:516-527` | `createSupplierPayment()` | Create supplier payment | ❌ **BLOCKED** | **REMOVE** - Replaced by `payment_voucher_atomic` RPC |
| `purchasingWriteService.ts:544-555` | `cancelPurchaseReturn()` | Cancel/void return | ❌ **BLOCKED** | **REMOVE** - Replaced by `voidPurchaseReturnAtomic()` |
| `purchasingWriteService.ts:566-577` | `cancelPurchaseInvoice()` | Cancel/void invoice | ❌ **BLOCKED** | **REMOVE** - Replaced by `purchase_invoice_void_atomic` RPC |
| `purchasingWriteService.ts:2538-2555` | `deletePaymentVoucher()` | Delete payment voucher | ⚠️ **DEPRECATED** | **KEEP** - Internally calls `voidPaymentVoucher()` |

### V2 Migrated Functions (Now Use Atomic RPCs)

| File Path | Function Name | Target RPC | Status |
|-----------|---------------|------------|--------|
| `purchasingWriteService.ts:1304-1343` | `createPurchaseOrder()` | `purchase_order_create_v2_atomic` | ✅ **V2 ACTIVE** |
| `purchasingWriteService.ts:1349-1385` | `approvePurchaseOrder()` | `purchase_order_update_v2_atomic` (action='approve') | ✅ **V2 ACTIVE** |
| `purchasingWriteService.ts:1416-1465` | `addPOItem()` | `purchase_order_update_v2_atomic` (action='add_item') | ✅ **V2 ACTIVE** |
| `purchasingWriteService.ts:1495-1521` | `duplicatePOItem()` | Uses `addPOItem()` internally | ✅ **V2 ACTIVE** |
| `purchasingWriteService.ts:1544-1580` | `deletePOItem()` | `purchase_order_update_v2_atomic` (action='delete_item') | ✅ **V2 ACTIVE** |
| `purchasingWriteService.ts:1596-1631` | `submitPOForApproval()` | `purchase_order_update_v2_atomic` (action='submit') | ✅ **V2 ACTIVE** |
| `purchasingWriteService.ts:1647-1682` | `sendPOToSupplier()` | `purchase_order_update_v2_atomic` (action='send') | ✅ **V2 ACTIVE** |
| `purchasingWriteService.ts:1732-1801` | `receivePOItems()` | `purchase_order_receive_v2_atomic` | ✅ **V2 ACTIVE** |

### Legacy Functions (Still Use Direct DB Writes)

| File Path | Function Name | Tables Touched | Status | Recommended Action |
|-----------|---------------|----------------|--------|-------------------|
| `purchasingWriteService.ts:847-1010` | `upsertPurchaseRequisition()` | `purchase_requisitions`, `purchase_requisition_items` | ⚠️ **LEGACY RISK** | Migrate to atomic RPC (Stage 2B) |
| `purchasingWriteService.ts:1041-1124` | `approvePurchaseRequisition()` | `purchase_requisitions`, `pr_approval_history` | ⚠️ **LEGACY RISK** | Migrate to atomic RPC (Stage 2B) |
| `purchasingWriteService.ts:588-653` | `rebuildImportSummary()` | `import_batch_items`, `import_batches` | ⚠️ **LEGACY** | Keep for now (import flow) |
| `purchasingWriteService.ts:1159-1242` | `processImportPayment()` | Multiple payment tables | ⚠️ **LEGACY** | Keep for now (import flow) |
| `purchasingWriteService.ts:748-795` | `quickCreateSupplier()` | `suppliers` | ⚠️ **LEGACY** | Low priority, keep |

### Search Evidence
- **Keywords**: `@deprecated`, `DEPRECATED`, `throw new Error`, `.insert(`, `.update(`, `.delete(`
- **Files searched**: `src/domain/purchasing/purchasingWriteService.ts`
- **Finding**: 5 blocked functions, 8 V2-migrated functions, 5 legacy functions with direct writes

---

## D) Legacy RPCs/Wrappers/Old Queries

### Direct Writes in UI Components (Legacy Risk)

| File Path | Line Range | Operation | Tables | Status |
|-----------|------------|-----------|--------|--------|
| `PurchaseRequisitionsPage.tsx:190-196` | `.update()` | `purchase_requisitions` | ⚠️ **LEGACY** | Should use atomic RPC |
| `PurchaseRequisitionsPage.tsx:239` | `.delete()` | `purchase_requisitions` | ⚠️ **LEGACY** | Should use atomic RPC |
| `PurchaseRequisitionsPage.tsx:266-282` | `.insert()` | `purchase_orders` | ⚠️ **LEGACY BYPASS** | PR→PO conversion bypasses V2 RPCs |
| `PurchaseRequisitionsPage.tsx:291-301` | `.insert()` | `purchase_order_items` | ⚠️ **LEGACY BYPASS** | PR→PO conversion bypasses V2 RPCs |
| `PurchaseRequisitionsPage.tsx:305-311` | `.update()` | `purchase_requisitions` | ⚠️ **LEGACY** | Should use atomic RPC |

### PO/Receiving Direct Write Status

**Reference**: `docs/purchasing_v2/P2-1_cutover_log.md`

| Table | Direct Writes in Service Layer | Direct Writes in UI | Status |
|-------|-------------------------------|---------------------|--------|
| `purchase_orders` | **0** | **1** (PR→PO conversion) | ⚠️ UI bypass exists |
| `purchase_order_items` | **0** | **1** (PR→PO conversion) | ⚠️ UI bypass exists |
| `goods_receipt_notes` | **0** | **0** | ✅ **CLEAN** |
| `goods_receipt_items` | **0** | **0** | ✅ **CLEAN** |
| `purchase_requisitions` | **3** functions | **3** locations | ⚠️ **LEGACY RISK** |
| `purchase_requisition_items` | **2** functions | **0** | ⚠️ **LEGACY RISK** |

### Search Evidence
- **Keywords**: `.from('purchase_orders').insert`, `.from('purchase_order_items').insert`, `.from('goods_receipt`)
- **Files searched**: All `src/pages/purchasing/*.tsx`, `src/domain/purchasing/*.ts`
- **Finding**: 
  - PO/Receiving tables: **No direct writes in service layer** ✅
  - PR→PO conversion in `PurchaseRequisitionsPage.tsx` **bypasses V2 RPCs** ⚠️

---

## Summary

### Cleanup Candidates

| Category | Item | Action | Priority |
|----------|------|--------|----------|
| **Route** | `/purchasing/returns/:id` | Already blocked ✅ | Done |
| **Page** | `PurchaseReturnFormPage.tsx` | Remove file | Low |
| **Page** | `PurchaseReturnsPage.tsx` | Remove after sidebar update | Medium |
| **Service** | 5 deprecated functions | Remove from service | Low |
| **UI Direct Write** | PR→PO conversion | Refactor to use V2 atomic RPC | **High** |
| **Service** | PR functions | Migrate to atomic RPC | Medium |

### Confirmed V2 Compliance

| Flow | Status | Evidence |
|------|--------|----------|
| Purchase Order Create | ✅ V2 | `purchase_order_create_v2_atomic` |
| Purchase Order Update | ✅ V2 | `purchase_order_update_v2_atomic` |
| Purchase Order Receive | ✅ V2 | `purchase_order_receive_v2_atomic` |
| Purchase Invoice | ✅ V2 | `purchase_invoice_post_atomic`, etc. |
| Purchase Return | ✅ V2 | `purchase_return_general_atomic`, etc. |
| Payment Voucher | ✅ V2 | `payment_voucher_atomic` |

---

## Gate P3-1 Acceptance ✅

- [x] All legacy routes documented with status
- [x] All legacy pages/components inventoried with usage evidence
- [x] All legacy service functions catalogued with recommended actions
- [x] All direct write locations identified with table mapping
- [x] PO/Receiving confirmed no direct writes (P2-1 reference)
- [x] Legacy bypass in PR→PO conversion identified as remediation target
