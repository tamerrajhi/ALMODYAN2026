# P2-0 Evidence Mapping: PO/Receiving Routes & UnifiedPurchaseDocumentPage Audit

**Created:** 2026-01-22  
**Purpose:** Document the exact current state of PO/Receiving routes and UnifiedPurchaseDocumentPage before V2 cutover  
**Status:** ✅ Discovery Complete — Ready for P2-1 Implementation

---

## Table of Contents

1. [Route Evidence Mapping](#1-route-evidence-mapping)
2. [Service/Hook Usage Details](#2-servicehook-usage-details)
3. [RPC/Query Inventory](#3-rpcquery-inventory)
4. [V2 Target Mapping](#4-v2-target-mapping)
5. [UnifiedPurchaseDocumentPage Audit](#5-unifiedpurchasedocumentpage-audit)
6. [Required Fixes Before Cutover](#6-required-fixes-before-cutover)

---

## 1. Route Evidence Mapping

| Route | Router Registration | Page/Component | Services/Hooks | RPCs/Queries | Tables Touched | Legacy Risk | V2 Target RPC | Wiring Gap |
|-------|---------------------|----------------|----------------|--------------|----------------|-------------|---------------|------------|
| `/purchasing/orders` | `src/App.tsx:240` | `src/pages/purchasing/PurchaseOrdersPage.tsx` | `purchasingReadService.listPurchaseOrders`, `purchasingReadService.getPurchaseOrderForCreateForm`, `purchasingWriteService.createPurchaseOrder`, `purchasingWriteService.approvePurchaseOrder` | `generate_po_number` (RPC), direct table queries | `purchase_orders`, `suppliers`, `branches` | **YES - High** | `purchase_order_create_v2_atomic`, `purchase_order_approve_v2_atomic` | Both `createPurchaseOrder` and `approvePurchaseOrder` use direct DB writes; need atomic RPC wrappers |
| `/purchasing/orders/:id` | `src/App.tsx:241` | `src/pages/purchasing/PurchaseOrderDetailPage.tsx` | `purchasingReadService.getPurchaseOrderDetail`, `purchasingWriteService.addPOItem`, `purchasingWriteService.duplicatePOItem`, `purchasingWriteService.deletePOItem`, `purchasingWriteService.submitPOForApproval`, `purchasingWriteService.approvePurchaseOrder`, `purchasingWriteService.sendPOToSupplier` | `generate_po_number` (indirect), direct table operations | `purchase_orders`, `purchase_order_items`, `po_pr_links`, `gold_karats`, `gemstone_types`, `raw_materials`, `suppliers`, `branches` | **YES - High** | `purchase_order_update_v2_atomic` (for item add/edit/delete + status changes) | All item CRUD uses direct INSERT/UPDATE/DELETE; need atomic RPC that handles items + totals transactionally |
| `/purchasing/receive/:id` | `src/App.tsx:242` | `src/pages/purchasing/ReceivePurchaseOrderPage.tsx` | `purchasingReadService.getPOForReceive`, `purchasingWriteService.receivePOItems` | Direct multi-table operations | `purchase_orders`, `purchase_order_items`, `goods_receipt_notes`, `goods_receipt_items`, `gold_vault_transactions`, `gemstone_inventory`, `gemstone_transactions`, `audit_log` | **YES - Critical** | `purchase_order_receive_v2_atomic` | `receivePOItems` is complex multi-table logic (gold vault + gemstone inventory + GRN creation); needs encapsulation in atomic RPC |

---

## 2. Service/Hook Usage Details

### `/purchasing/orders` (PurchaseOrdersPage.tsx)

| Function | File Location | Type | What It Does | Tables |
|----------|---------------|------|--------------|--------|
| `listPurchaseOrders` | `purchasingReadService.ts:1755-1791` | Read | Fetches PO list with supplier/branch joins | `purchase_orders`, `suppliers`, `branches` |
| `getPurchaseOrderForCreateForm` | `purchasingReadService.ts:1796-1823` | Read | Fetches dropdown data for create form | `suppliers`, `branches` |
| `createPurchaseOrder` | `purchasingWriteService.ts:1303-1331` | **Write (LEGACY)** | Direct insert into `purchase_orders` | `purchase_orders` |
| `approvePurchaseOrder` | `purchasingWriteService.ts:1336-1354` | **Write (LEGACY)** | Direct status update | `purchase_orders` |

### `/purchasing/orders/:id` (PurchaseOrderDetailPage.tsx)

| Function | File Location | Type | What It Does | Tables |
|----------|---------------|------|--------------|--------|
| `getPurchaseOrderDetail` | `purchasingReadService.ts:1622-1741` | Read | Parallel fetch of PO header, items, linked PRs, dropdowns | `purchase_orders`, `purchase_order_items`, `po_pr_links`, `gold_karats`, `gemstone_types`, `raw_materials`, `suppliers`, `branches` |
| `addPOItem` | `purchasingWriteService.ts:1384-1430` | **Write (LEGACY)** | Direct insert item + manual total update | `purchase_order_items`, `purchase_orders` |
| `duplicatePOItem` | `purchasingWriteService.ts:1459-1497` | **Write (LEGACY)** | Direct insert copy + manual total update | `purchase_order_items`, `purchase_orders` |
| `deletePOItem` | `purchasingWriteService.ts:1519-1545` | **Write (LEGACY)** | Direct delete + manual total subtraction | `purchase_order_items`, `purchase_orders` |
| `submitPOForApproval` | `purchasingWriteService.ts:1560-1584` | **Write (LEGACY)** | Direct status update to 'pending' | `purchase_orders`, `audit_log` |
| `approvePurchaseOrder` | `purchasingWriteService.ts:1336-1354` | **Write (LEGACY)** | Direct status update to 'approved' | `purchase_orders` |
| `sendPOToSupplier` | `purchasingWriteService.ts:1590-1614` | **Write (LEGACY)** | Direct update `sent_to_supplier` flag | `purchase_orders`, `audit_log` |

### `/purchasing/receive/:id` (ReceivePurchaseOrderPage.tsx)

| Function | File Location | Type | What It Does | Tables |
|----------|---------------|------|--------------|--------|
| `getPOForReceive` | `purchasingReadService.ts:1870-1950` | Read | Fetches PO header, items with receive status, gold vaults | `purchase_orders`, `purchase_order_items`, `gold_vaults`, `suppliers`, `branches`, `gold_karats`, `gemstone_types` |
| `receivePOItems` | `purchasingWriteService.ts:1675-1854` | **Write (LEGACY - CRITICAL)** | Complex multi-table receiving logic | `goods_receipt_notes`, `goods_receipt_items`, `purchase_order_items`, `purchase_orders`, `gold_vault_transactions`, `gemstone_inventory`, `gemstone_transactions`, `audit_log` |

---

## 3. RPC/Query Inventory

### Current RPCs Used

| RPC Name | Where Called | Purpose | Atomic? |
|----------|--------------|---------|---------|
| `generate_po_number` | `purchasingWriteService.createPurchaseOrder` | Generates next PO number | Yes (sequence) |
| N/A for item operations | — | No atomic RPC for PO item CRUD | — |
| N/A for receiving | — | No atomic RPC for GRN creation | — |

### V2 Atomic RPCs Required (Do Not Exist Yet)

| Target RPC Name | Purpose | Tables to Encapsulate |
|-----------------|---------|----------------------|
| `purchase_order_create_v2_atomic` | Create PO with number generation | `purchase_orders`, `atomic_workflow_requests` |
| `purchase_order_update_v2_atomic` | Update PO (items, status, send to supplier) | `purchase_orders`, `purchase_order_items` |
| `purchase_order_approve_v2_atomic` | Approve PO with audit | `purchase_orders`, `audit_log` |
| `purchase_order_receive_v2_atomic` | Atomic GRN creation with inventory effects | `goods_receipt_notes`, `goods_receipt_items`, `purchase_order_items`, `purchase_orders`, `gold_vault_transactions`, `gemstone_inventory`, `gemstone_transactions`, `audit_log` |

### Existing V2 Pattern RPCs (Reference)

These atomic RPCs exist and can be used as templates:

| RPC Name | Purpose |
|----------|---------|
| `purchase_invoice_create_atomic` | Invoice creation with JE |
| `purchase_invoice_post_atomic` | Invoice posting |
| `payment_voucher_atomic` | Payment creation with allocations |
| `requisition_upsert_v2_atomic` | PR create/update |
| `convert_prs_to_pos_atomic` | PR → PO conversion |

---

## 4. V2 Target Mapping

### Current State vs V2 Target

| Capability | Current Implementation | V2 Target | Gap Analysis |
|------------|----------------------|-----------|--------------|
| Create PO | Direct `INSERT` + RPC for number | `purchase_order_create_v2_atomic` | Need new RPC encapsulating number gen + insert + idempotency |
| Add/Edit/Delete PO Items | Direct `INSERT/UPDATE/DELETE` + manual total calc | `purchase_order_update_v2_atomic` | Need RPC handling items + totals atomically |
| Submit PO | Direct status update | Same RPC with `action: 'submit'` | Include in update RPC |
| Approve PO | Direct status update | `purchase_order_approve_v2_atomic` | Need new RPC with audit |
| Send to Supplier | Direct flag update | Same RPC with `action: 'send'` | Include in update RPC |
| Receive PO (GRN) | Complex multi-table client-side logic | `purchase_order_receive_v2_atomic` | **CRITICAL** - Most complex; needs full encapsulation |

---

## 5. UnifiedPurchaseDocumentPage Audit

### Route Registration

| Route | Registration Location | Page File | documentType Prop |
|-------|----------------------|-----------|-------------------|
| `/purchasing/invoices/new` | `src/App.tsx:244` | `src/pages/purchasing/PurchaseInvoiceFormPage.tsx` | `PURCHASE_INVOICE` |
| `/purchasing/invoices/:id` | `src/App.tsx:247` | `src/pages/purchasing/PurchaseInvoiceFormPage.tsx` | `PURCHASE_INVOICE` |
| `/purchasing/returns/:id` (OLD - now redirects) | `src/App.tsx:252` → `DeprecatedPurchasingPage` | N/A (blocked) | N/A |

### Entry Points (Navigation to UnifiedPurchaseDocumentPage)

| Entry Point | Source File | Destination | Context |
|-------------|-------------|-------------|---------|
| "New Invoice" button | `PurchaseInvoicesPage.tsx` | `/purchasing/invoices/new` | Invoice list page |
| Row click / Edit | `PurchaseInvoicesPage.tsx` | `/purchasing/invoices/:id` | Invoice list page |
| "Create Invoice from PO" button | `PurchaseOrderDetailPage.tsx:302-308` | `/purchasing/invoices/new?po=${id}` | PO detail page |

### Usage Confirmation

✅ **UnifiedPurchaseDocumentPage is ONLY used for:**
- Purchase Invoice creation (`documentType="PURCHASE_INVOICE"`)
- Purchase Invoice editing (`documentType="PURCHASE_INVOICE"`)

❌ **NOT used for PO or Receiving** — Confirmed by:
- PO routes use `PurchaseOrdersPage.tsx` and `PurchaseOrderDetailPage.tsx`
- Receiving uses `ReceivePurchaseOrderPage.tsx`

⚠️ **Legacy Return Path (Now Blocked):**
- `PurchaseReturnFormPage.tsx` wraps `UnifiedPurchaseDocumentPage` with `documentType="PURCHASE_RETURN"`
- Route `/purchasing/returns/:id` now redirects to `DeprecatedPurchasingPage` (blocked in P2-1)
- Return creation uses separate V2 pages: `PurchaseReturnGeneralPage`, `PurchaseReturnUniquePage`, `PurchaseReturnRouterPage`

### Legacy Risk Assessment

| Aspect | Risk Level | Evidence |
|--------|------------|----------|
| Invoice Create/Edit | **Low** | Uses `createPurchaseInvoiceAtomic` and V2 pattern |
| Return via this page | **Blocked** | Route redirects to deprecated page |
| PO/Receiving | **N/A** | Not used for PO/Receiving at all |

---

## 6. Required Fixes Before Cutover

### Phase 1: Create V2 Atomic RPCs (Database Migration)

1. **`purchase_order_create_v2_atomic`**
   - Input: supplier_id, branch_id, order_type, expected_delivery_date, notes, client_request_id
   - Logic: Generate PO number → Insert header → Return po_id, po_number
   - Tables: `purchase_orders`, `atomic_workflow_requests`

2. **`purchase_order_update_v2_atomic`**
   - Input: po_id, action ('add_item' | 'update_item' | 'delete_item' | 'submit' | 'send'), item_data?, client_request_id
   - Logic: Switch on action, handle items + recalculate totals atomically
   - Tables: `purchase_orders`, `purchase_order_items`

3. **`purchase_order_approve_v2_atomic`**
   - Input: po_id, approved_by, client_request_id
   - Logic: Validate status → Update to 'approved' → Write audit log
   - Tables: `purchase_orders`, `audit_log`, `atomic_workflow_requests`

4. **`purchase_order_receive_v2_atomic`** (Most Complex)
   - Input: po_id, items[], vault_id, general_notes, received_by, client_request_id
   - Logic: 
     - Generate GRN number
     - Create `goods_receipt_notes` header
     - For each item: create `goods_receipt_items`, update `purchase_order_items` received quantities
     - For gold items: create `gold_vault_transactions`
     - For gemstones: update `gemstone_inventory`, create `gemstone_transactions`
     - Update PO status if fully received
     - Write audit log
   - Tables: ALL inventory + audit tables

### Phase 2: Wire Service Layer to V2 RPCs

1. **Update `purchasingWriteService.ts`:**
   - Replace `createPurchaseOrder` body with RPC call
   - Replace `addPOItem`, `duplicatePOItem`, `deletePOItem` with unified RPC call
   - Replace `approvePurchaseOrder`, `submitPOForApproval`, `sendPOToSupplier` with RPC calls
   - Replace `receivePOItems` with RPC call

2. **No UI changes required** — Service layer abstraction means pages continue to work

### Phase 3: Deprecate Direct Write Functions

1. Mark legacy functions as `@deprecated`
2. Add runtime warnings or blocks
3. Remove after V2 confirmation

---

## Summary Checklist

| Item | Status | Evidence |
|------|--------|----------|
| All 3 PO routes mapped | ✅ | See Section 1 |
| All services/hooks identified | ✅ | See Section 2 |
| All RPCs/queries documented | ✅ | See Section 3 |
| Tables touched identified | ✅ | See Sections 1-2 |
| Legacy risk assessed | ✅ | All 3 routes marked HIGH/CRITICAL |
| V2 target RPCs named | ✅ | See Section 4 |
| Wiring gaps documented | ✅ | See Section 4 |
| UnifiedPurchaseDocumentPage audited | ✅ | See Section 5 |
| Required fixes listed | ✅ | See Section 6 |

---

**Next Step:** P2-1 Implementation — Create V2 atomic RPCs and wire service layer
