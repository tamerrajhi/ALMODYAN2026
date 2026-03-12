# Migration Inventory & Plan — Supabase → Neon/Express

Generated: 2026-02-06

---

## Gate-0 Evidence

```json
{
  "ok": true,
  "db": "heliumdb",
  "schema": "public",
  "server_version": "16.10",
  "invariants": {
    "invoices_supplier_invoice_no_column": true,
    "invoices_purchase_supp_inv_uq_index": true,
    "required_functions": {
      "required": [
        "purchase_invoice_create_atomic",
        "purchase_invoice_post_atomic",
        "purchase_invoice_void_atomic",
        "purchase_invoice_supp_inv_precheck",
        "import_purchase_batch_create_atomic",
        "import_jewelry_sets_upsert_atomic"
      ],
      "missing": [],
      "ok": true
    }
  }
}
```

- Badge: Visible in MainLayout header (all authenticated pages)
- Shows: `NEON | heliumdb | PG 16.10` (green)

---

## Inventory Summary

| Pattern | Files | Calls (approx) |
|---------|-------|-----------------|
| `supabase.from()` (single-line) | 12 | 35 |
| `supabase\n.from()` (multi-line) | 160 | 624 |
| `supabase.rpc()` | 38 | 82 |
| `supabase.functions.invoke()` | 13 | 31 |
| `supabase.auth` | 16 | 32 |
| Total unique files (excl. dataGateway/client) | **180** | **~804** |
| `VITE_SUPABASE_*` env refs | 4 | — |

---

## File Classification

### Category A — Auth-Only (keep temporarily)

These files use `supabase.auth` only — no data-plane calls.

| # | File | Auth Calls |
|---|------|-----------|
| 1 | `src/contexts/AuthContext.tsx` | 5 (+ 1 rpc for profile) |
| 2 | `src/pages/AuthPage.tsx` | 5 (+ 2 invoke for edge) |

> Note: AuthContext also has 1 rpc call and AuthPage has 2 edge function invokes, so these are actually **B+A** hybrid. Auth itself stays on Supabase for now, but the data calls need migration.

### Category C — Edge Functions Dependent

Files that call `supabase.functions.invoke()`:

| # | File | Invoke Calls | Also has from/rpc? | Decision |
|---|------|-------------|---------------------|----------|
| 1 | `src/components/health/EdgeFunctionTests.tsx` | 7 | No | Keep (health testing) |
| 2 | `src/components/health/SecurityTests.tsx` | 1 | Yes (rpc:1) | Migrate rpc, keep invoke |
| 3 | `src/domain/purchasing/purchasingWriteService.ts` | 1 | Yes (rpc:24) | Migrate all |
| 4 | `src/hooks/useZatcaSettings.ts` | 3 | No (from:4) | Migrate from, keep invoke |
| 5 | `src/hooks/useZatcaSubmit.ts` | 8 | No | Keep (ZATCA edge) |
| 6 | `src/pages/accounting/InvoicesPage.tsx` | 1 | Yes (from:3) | Migrate from, keep invoke |
| 7 | `src/pages/admin/TestDataSeederPage.tsx` | 1 | No | Keep (admin tool) |
| 8 | `src/pages/AuthPage.tsx` | 2 | Yes (from:2) | Auth stays, migrate from |
| 9 | `src/pages/BatchDetailPage.tsx` | 1 | Yes (from:5) | Migrate from, keep invoke |
| 10 | `src/pages/ImportPage.tsx` | 1 | Yes (from:4) | Migrate from, keep invoke |
| 11 | `src/pages/purchasing/PurchasingHealthCheckPage.tsx` | 1 | No (from:0) | Keep (health) |
| 12 | `src/pages/SystemHealthPage.tsx` | 1 | No | Keep (health) |
| 13 | `src/pages/UsersPage.tsx` | 3 | Yes (rpc:1, from:9) | Migrate from/rpc, keep invoke |

### Category B — Data-Plane (MUST migrate to dataGateway/Express)

#### B.1 Domain Services (2 files)

| # | File | from | rpc | Notes |
|---|------|------|-----|-------|
| 1 | `src/domain/purchasing/purchasingReadService.ts` | 69 | 0 | Heavy read service |
| 2 | `src/domain/purchasing/purchasingWriteService.ts` | 11 | 24 | Heavy write service + 1 invoke |

#### B.2 Shared Libraries (7 files)

| # | File | from | rpc | auth | Notes |
|---|------|------|-----|------|-------|
| 1 | `src/lib/accounting-health-checks.ts` | 17 | 0 | 1 | Health checks |
| 2 | `src/lib/audit.ts` | 1 | 0 | 1 | Audit logging |
| 3 | `src/lib/branch-inventory-accounts.ts` | 11 | 0 | 0 | Branch inventory |
| 4 | `src/lib/pr-notifications.ts` | 2 | 0 | 0 | PR notifications |
| 5 | `src/lib/set-images-api.ts` | 1 | 0 | 4 | Image handling (edge) |
| 6 | `src/lib/transfer-accounting.ts` | 6 | 0 | 0 | Transfer accounting |
| 7 | `src/shared/registry/ModuleRegistry.ts` | 1 | 0 | 0 | Module registry |

#### B.3 Hooks (6 files)

| # | File | from | rpc | Notes |
|---|------|------|-----|-------|
| 1 | `src/hooks/useBranches.ts` | 1 | 0 | Branch data |
| 2 | `src/hooks/useItemMovements.ts` | 10 | 0 | Item movement queries |
| 3 | `src/hooks/useTransfersV2ReadModel.ts` | 5 | 0 | Transfer read model |
| 4 | `src/hooks/useTransfersV2.ts` | 6 | 0 | Transfer operations |
| 5 | `src/hooks/useZatcaSettings.ts` | 4 | 0 | ZATCA (+ 3 invoke) |
| 6 | `src/core/contexts/ModuleContext.tsx` | 0 | 1 | Module context rpc |

#### B.4 Components (82 files)

##### Accounting (4)
| # | File | from | rpc |
|---|------|------|-----|
| 1 | `src/components/accounting/health/HealthCheckRunsHistory.tsx` | 2 | 0 |
| 2 | `src/components/accounting/monitoring/DrillDownDialog.tsx` | 0 | 1 |
| 3 | `src/components/accounting/monitoring/DrillDownFilters.tsx` | 1 | 0 |
| 4 | `src/components/accounting/monitoring/HBLegacyCleanupDialog.tsx` | 1 | 3 |

##### Health/System (5)
| # | File | from | rpc | invoke |
|---|------|------|-----|--------|
| 1 | `src/components/health/AuthenticationTests.tsx` | 5 | 2 | 0 |
| 2 | `src/components/health/BackupExport.tsx` | 1 | 0 | 0 |
| 3 | `src/components/health/DatabaseTests.tsx` | 5 | 4 | 0 |
| 4 | `src/components/health/EdgeFunctionTests.tsx` | 0 | 0 | 7 |
| 5 | `src/components/health/PerformanceTests.tsx` | 23 | 0 | 0 |
| 6 | `src/components/health/SecurityTests.tsx` | 2 | 1 | 1 |

##### POS (6)
| # | File | from | rpc |
|---|------|------|-----|
| 1 | `src/components/pos/debug/POSDebugPanel.tsx` | 0 | 4 |
| 2 | `src/components/pos/PhoneCustomerSearch.tsx` | 1 | 0 |
| 3 | `src/components/pos/POSQuickCustomerDialog.tsx` | 0 | 1 |
| 4 | `src/components/pos/return/AllReturnsSection.tsx` | 4 | 0 |
| 5 | `src/components/pos/return/PreviousReturnsSection.tsx` | 4 | 0 |

##### Production (2)
| # | File | from | rpc |
|---|------|------|-----|
| 1 | `src/components/production/DirectCostsTab.tsx` | 1 | 0 |
| 2 | `src/components/production/PartialCompletionDialog.tsx` | 0 | 1 |

##### Products (4)
| # | File | from | rpc |
|---|------|------|-----|
| 1 | `src/components/products/CostEntryFormDialog.tsx` | 2 | 2 |
| 2 | `src/components/products/JewelryItemFormDialog.tsx` | 4 | 2 |
| 3 | `src/components/products/ProductCombobox.tsx` | 1 | 0 |
| 4 | `src/components/products/ProductFormDialog.tsx` | 3 | 2 |

##### Purchasing (8)
| # | File | from | rpc |
|---|------|------|-----|
| 1 | `src/components/purchasing/monitoring/PurchasingDrillDownDialog.tsx` | 6 | 0 |
| 2 | `src/components/purchasing/monitoring/PurchasingDrillDownFilters.tsx` | 2 | 0 |
| 3 | `src/components/purchasing/POActivityLog.tsx` | 1 | 0 |
| 4 | `src/components/purchasing/POInvoicesTab.tsx` | 1 | 0 |
| 5 | `src/components/purchasing/POLinkedPRs.tsx` | 1 | 0 |
| 6 | `src/components/purchasing/PRApprovalHistoryView.tsx` | 1 | 0 |
| 7 | `src/components/purchasing/PRDetailsDialog.tsx` | 1 | 0 |
| 8 | `src/components/purchasing/returns/VoidReturnDialog.tsx` | 0 | 1 |

##### Reports (32)
| # | File | from |
|---|------|------|
| 1 | `src/components/reports/BranchBalancesReport.tsx` | 3 |
| 2 | `src/components/reports/customers/CustomerBalancesReport.tsx` | 1 |
| 3 | `src/components/reports/customers/SupplierBalancesReport.tsx` | 5 |
| 4 | `src/components/reports/dashboard/BestSellingItemsReport.tsx` | 1 |
| 5 | `src/components/reports/dashboard/BranchDailyPerformanceReport.tsx` | 3 |
| 6 | `src/components/reports/dashboard/DailyGoldMovementReport.tsx` | 1 |
| 7 | `src/components/reports/dashboard/LossProductivityReport.tsx` | 2 |
| 8 | `src/components/reports/dashboard/ProfitMarginReport.tsx` | 1 |
| 9 | `src/components/reports/dashboard/RisksAlertsReport.tsx` | 6 |
| 10 | `src/components/reports/dashboard/SalesVsInventoryReport.tsx` | 3 |
| 11 | `src/components/reports/dashboard/TopCustomersReport.tsx` | 1 |
| 12 | `src/components/reports/financial/AdvancedTrialBalanceReport.tsx` | 3 |
| 13 | `src/components/reports/financial/TrialBalanceReport.tsx` | 1 |
| 14 | `src/components/reports/GoldSalesReport.tsx` | 2 |
| 15 | `src/components/reports/hr/AttendanceReport.tsx` | 1 |
| 16 | `src/components/reports/hr/LeavesReport.tsx` | 1 |
| 17 | `src/components/reports/hr/PayrollReport.tsx` | 1 |
| 18 | `src/components/reports/InventoryCountStatisticsReport.tsx` | 2 |
| 19 | `src/components/reports/PartyAccountStatement.tsx` | 16 |
| 20 | `src/components/reports/pos/CashDrawerReport.tsx` | 4 |
| 21 | `src/components/reports/pos/DiscountsReport.tsx` | 3 |
| 22 | `src/components/reports/pos/EmployeePerformanceReport.tsx` | 3 |
| 23 | `src/components/reports/pos/NetSalesReport.tsx` | 3 |
| 24 | `src/components/reports/pos/PaymentMethodsReport.tsx` | 2 |
| 25 | `src/components/reports/pos/ReturnsReport.tsx` | 4 |
| 26 | `src/components/reports/pos/ZReport.tsx` | 3 |
| 27 | `src/components/reports/production/CostCenterReport.tsx` | 1 |
| 28 | `src/components/reports/production/ProductionCostReport.tsx` | 1 |
| 29 | `src/components/reports/production/ProductionScrapReport.tsx` | 2 |
| 30 | `src/components/reports/production/WorkOrdersReport.tsx` | 1 |
| 31 | `src/components/reports/purchases/* (7 files)` | 13 |
| 32 | `src/components/reports/TransferHistoryReport.tsx` | 1 |
| 33 | `src/components/reports/vaults/CashVaultReport.tsx` | 1 |
| 34 | `src/components/reports/vaults/GoldVaultReport.tsx` | 1 |

##### Sales (5)
| # | File | from | rpc |
|---|------|------|-----|
| 1 | `src/components/sales/CustomerCombobox.tsx` | 1 | 0 |
| 2 | `src/components/sales/invoice-view/AuditTrailCard.tsx` | 1 | 0 |
| 3 | `src/components/sales/invoice-view/QuickActionsBar.tsx` | 0 | 1 |
| 4 | `src/components/sales/ProductSearchCombobox.tsx` | 2 | 0 |
| 5 | `src/components/sales/QuickCustomerDialog.tsx` | 0 | 1 |

##### Other Components (8)
| # | File | from | rpc |
|---|------|------|-----|
| 1 | `src/components/BulkMoveDialog.tsx` | 2 | 0 |
| 2 | `src/components/modules/ModuleSettingsDialog.tsx` | 0 | 2 |
| 3 | `src/components/notifications/NotificationBell.tsx` | 1 | 0 |
| 4 | `src/components/SelectiveTransferDialog.tsx` | 5 | 0 |
| 5 | `src/components/settings/CompanySettingsForm.tsx` | 1 | 0 |
| 6 | `src/components/suppliers/SupplierDocuments.tsx` | 1 | 0 |
| 7 | `src/components/suppliers/SupplierViewDialog.tsx` | 2 | 0 |
| 8 | `src/components/transfers/TransferDetailsDialog.tsx` | 1 | 0 |
| 9 | `src/components/transfers/TransferReceipt.tsx` | 1 | 0 |

#### B.5 Pages (75 files)

##### Accounting (7)
| # | File | from | rpc | invoke |
|---|------|------|-----|--------|
| 1 | `src/pages/accounting/AccountingDashboard.tsx` | 5 | 0 | 0 |
| 2 | `src/pages/accounting/AccountLedgerPage.tsx` | 9 | 0 | 0 |
| 3 | `src/pages/accounting/ChartOfAccountsPage.tsx` | 3 | 0 | 0 |
| 4 | `src/pages/accounting/FinancialReportsPage.tsx` | 2 | 0 | 0 |
| 5 | `src/pages/accounting/InvoicesPage.tsx` | 4 | 0 | 1 |
| 6 | `src/pages/accounting/JournalEntriesPage.tsx` | 10 | 1 | 0 |
| 7 | `src/pages/accounting/PaymentsPage.tsx` | 5 | 0 | 0 |
| 8 | `src/pages/accounting/AccountingMonitoringPage.tsx` | 0 | 0 | 0 |

##### Admin/System (4)
| # | File | from | rpc | invoke |
|---|------|------|-----|--------|
| 1 | `src/pages/admin/TestDataSeederPage.tsx` | 0 | 0 | 1 |
| 2 | `src/pages/AuditLogsPage.tsx` | 2 | 0 | 0 |
| 3 | `src/pages/ModuleManagementPage.tsx` | 2 | 0 | 0 |
| 4 | `src/pages/SystemHealthPage.tsx` | 0 | 0 | 1 |

##### Purchasing (9)
| # | File | from | rpc | invoke |
|---|------|------|-----|--------|
| 1 | `src/pages/purchasing/PRApprovalThresholdsPage.tsx` | 1 | 0 | 0 |
| 2 | `src/pages/purchasing/PurchaseRequisitionsPage.tsx` | 8 | 2 | 0 |
| 3 | `src/pages/purchasing/PurchaseReturnsListPage.tsx` | 1 | 0 | 0 |
| 4 | `src/pages/purchasing/PurchasingHealthCheckPage.tsx` | 0 | 0 | 1 |
| 5 | `src/pages/purchasing/PurchasingMonitoringPage.tsx` | 6 | 0 | 0 |
| 6 | `src/pages/purchasing/ReturnsHubDetailsPage.tsx` | 9 | 0 | 0 |
| 7 | `src/pages/purchasing/ReturnsHubPage.tsx` | 3 | 0 | 0 |
| 8 | `src/pages/purchasing/ReturnsHubResolverPage.tsx` | 2 | 0 | 0 |
| 9 | `src/pages/purchasing/UnifiedPurchaseDocumentPage.tsx` | 15 | 4 | 0 |

##### Sales (12)
| # | File | from | rpc |
|---|------|------|-----|
| 1 | `src/pages/sales/CreateSalesInvoicePage.tsx` | 7 | 1 |
| 2 | `src/pages/sales/CreditNotesPage.tsx` | 7 | 2 |
| 3 | `src/pages/sales/CustomerReceiptsPage.tsx` | 6 | 2 |
| 4 | `src/pages/sales/ReceiptVouchersPage.tsx` | 4 | 0 |
| 5 | `src/pages/sales/SalesInvoicesPage.tsx` | 5 | 0 |
| 6 | `src/pages/sales/SalesInvoiceViewPage.tsx` | 3 | 0 |
| 7 | `src/pages/sales/SalesReturnFormPage.tsx` | 9 | 2 |
| 8 | `src/pages/sales/SalesReturnsListPage.tsx` | 1 | 0 |
| 9 | `src/pages/sales/SalesReturnsPage.tsx` | 4 | 1 |
| 10 | `src/pages/sales/SalesReturnViewPage.tsx` | 3 | 1 |
| 11 | `src/pages/SalesHistoryPage.tsx` | 3 | 0 |
| 12 | `src/pages/ReturnsPage.tsx` | 5 | 1 |

##### POS (3)
| # | File | from | rpc |
|---|------|------|-----|
| 1 | `src/pages/POSPage.tsx` | 9 | 0 |
| 2 | `src/pages/POSCreditNotePage.tsx` | 9 | 2 |
| 3 | `src/pages/POSReturnPage.tsx` | 9 | 2 |

##### Inventory (5)
| # | File | from |
|---|------|------|
| 1 | `src/pages/inventory/InventoryCountDetailPage.tsx` | 5 |
| 2 | `src/pages/inventory/InventoryCountReportPage.tsx` | 4 |
| 3 | `src/pages/inventory/InventoryCountsPage.tsx` | 1 |
| 4 | `src/pages/inventory/ItemMovementsPage.tsx` | 2 |
| 5 | `src/pages/inventory/RawMaterialsPage.tsx` | 5 |

##### Production (8)
| # | File | from | rpc |
|---|------|------|-----|
| 1 | `src/pages/production/CostCentersPage.tsx` | 3 | 0 |
| 2 | `src/pages/production/FinishedGoodsFactoryPage.tsx` | 5 | 1 |
| 3 | `src/pages/production/FinishedGoodsShowroomPage.tsx` | 2 | 0 |
| 4 | `src/pages/production/ProductionLossReportPage.tsx` | 6 | 0 |
| 5 | `src/pages/production/ProductionPlanningPage.tsx` | 4 | 0 |
| 6 | `src/pages/production/ProductionSettingsPage.tsx` | 3 | 0 |
| 7 | `src/pages/production/WIPPage.tsx` | 8 | 0 |
| 8 | `src/pages/production/WorkOrderDetailsPage.tsx` | 9 | 0 |

##### Gold/Gemstones (6)
| # | File | from |
|---|------|------|
| 1 | `src/pages/gemstones/GemstonesPage.tsx` | 4 |
| 2 | `src/pages/gemstones/LinkGemstoneToProduct.tsx` | 3 |
| 3 | `src/pages/gold/GoldKaratsPage.tsx` | 1 |
| 4 | `src/pages/gold/GoldPricesPage.tsx` | 4 |
| 5 | `src/pages/gold/GoldScrapPage.tsx` | 3 |
| 6 | `src/pages/gold/GoldVaultPage.tsx` | 4 |

##### HR (4)
| # | File | from | rpc |
|---|------|------|-----|
| 1 | `src/pages/hr/AttendancePage.tsx` | 3 | 0 |
| 2 | `src/pages/hr/EmployeesPage.tsx` | 5 | 1 |
| 3 | `src/pages/hr/LeavesPage.tsx` | 2 | 0 |
| 4 | `src/pages/hr/PayrollPage.tsx` | 3 | 0 |

##### Other Pages (17)
| # | File | from | rpc |
|---|------|------|-----|
| 1 | `src/pages/BatchDetailPage.tsx` | 6 | 0 |
| 2 | `src/pages/BatchesPage.tsx` | 1 | 0 |
| 3 | `src/pages/BranchesPage.tsx` | 1 | 0 |
| 4 | `src/pages/CashVaultPage.tsx` | 4 | 0 |
| 5 | `src/pages/CustomersPage.tsx` | 6 | 2 |
| 6 | `src/pages/DashboardPage.tsx` | 12 | 0 |
| 7 | `src/pages/ImportPage.tsx` | 5 | 0 |
| 8 | `src/pages/ItemHistoryPage.tsx` | 1 | 0 |
| 9 | `src/pages/BarcodeLabelsPage.tsx` | 1 | 0 |
| 10 | `src/pages/products/ImportedPiecesPage.tsx` | 2 | 0 |
| 11 | `src/pages/products/ProductsPage.tsx` | 4 | 2 |
| 12 | `src/pages/RolesPage.tsx` | 6 | 1 |
| 13 | `src/pages/SerialTrackingPage.tsx` | 6 | 0 |
| 14 | `src/pages/settings/DepartmentsPage.tsx` | 4 | 0 |
| 15 | `src/pages/settings/PaymentAccountSettingsPage.tsx` | 3 | 0 |
| 16 | `src/pages/settings/ZatcaLogsPage.tsx` | 1 | 0 |
| 17 | `src/pages/TransferRequestsPage.tsx` | 10 | 2 |
| 18 | `src/pages/TransfersCenterPage.tsx` | 1 | 0 |
| 19 | `src/pages/UsersPage.tsx` | 10 | 1 |
| 20 | `src/pages/vaults/DailySettlementsPage.tsx` | 10 | 0 |

#### B.6 Other (2 files)

| # | File | Notes |
|---|------|-------|
| 1 | `src/types/transfer.dto.ts` | Import type only from supabase/types |
| 2 | `src/shared/registry/ModuleRegistry.ts` | 1 from call |

---

## Migration Plan (NO EXECUTION)

### Strategy

Each `supabase.from()` call is replaced with `dataGateway.queryTable()` or a specific `dataGateway.*` function.
Each `supabase.rpc()` call is replaced with `dataGateway.rpc()` which proxies through `/api/rpc/:fnName`.
`supabase.functions.invoke()` calls stay on Supabase until Edge Functions are ported.
`supabase.auth` calls stay on Supabase until session-based auth is implemented.

### Batch 1 — Foundation (Shared Libs + Hooks) — ~13 files

**Priority**: Highest. These are imported by many pages/components.

**Files**:
1. `src/lib/audit.ts` (1 from, 1 auth)
2. `src/lib/pr-notifications.ts` (2 from)
3. `src/lib/branch-inventory-accounts.ts` (11 from)
4. `src/lib/transfer-accounting.ts` (6 from)
5. `src/lib/accounting-health-checks.ts` (17 from, 1 auth)
6. `src/shared/registry/ModuleRegistry.ts` (1 from)
7. `src/hooks/useBranches.ts` (1 from)
8. `src/hooks/useItemMovements.ts` (10 from)
9. `src/hooks/useTransfersV2ReadModel.ts` (5 from)
10. `src/hooks/useTransfersV2.ts` (6 from)
11. `src/hooks/useZatcaSettings.ts` (4 from, keep 3 invoke)
12. `src/core/contexts/ModuleContext.tsx` (1 rpc)
13. `src/types/transfer.dto.ts` (type import only)

**New Endpoints needed**:
- `GET /api/audit-logs` (paginated, filtered)
- `GET /api/notifications` (filtered by user)
- `GET /api/branch-inventory-accounts/:branchId`
- `GET /api/item-movements` (paginated, filtered)
- Most tables already have endpoints; verify coverage

**RPC Allowlist additions**: Check if any new RPCs needed for hooks

**Gate Test**: After batch — verify DashboardPage loads, TransfersCenterPage loads, branches dropdown works

---

### Batch 2 — Domain Services — 2 files (HEAVY)

**Files**:
1. `src/domain/purchasing/purchasingReadService.ts` (69 from)
2. `src/domain/purchasing/purchasingWriteService.ts` (11 from, 24 rpc, 1 invoke)

**New Endpoints needed**:
- Multiple purchasing-specific query endpoints with complex JOINs
- Verify all 24 RPCs are in allowlist
- May need batch query endpoints for performance

**Gate Test**: Purchasing pages load, PO creation works, invoice posting works

---

### Batch 3 — Critical Pages — ~25 files

**Files** (priority order):
1. `src/pages/DashboardPage.tsx` (12 from)
2. `src/pages/ImportPage.tsx` (5 from, keep invoke)
3. `src/pages/purchasing/UnifiedPurchaseDocumentPage.tsx` (15 from, 4 rpc)
4. `src/pages/accounting/JournalEntriesPage.tsx` (10 from, 1 rpc)
5. `src/pages/accounting/AccountLedgerPage.tsx` (9 from)
6. `src/pages/POSPage.tsx` (9 from)
7. `src/pages/POSCreditNotePage.tsx` (9 from, 2 rpc)
8. `src/pages/POSReturnPage.tsx` (9 from, 2 rpc)
9. `src/pages/vaults/DailySettlementsPage.tsx` (10 from)
10. `src/pages/UsersPage.tsx` (10 from, 1 rpc, keep 3 invoke)
11. `src/pages/TransferRequestsPage.tsx` (10 from, 2 rpc)
12. `src/pages/sales/SalesReturnFormPage.tsx` (9 from, 2 rpc)
13. `src/pages/production/WorkOrderDetailsPage.tsx` (9 from)
14. `src/pages/production/WIPPage.tsx` (8 from)
15. `src/pages/purchasing/PurchaseRequisitionsPage.tsx` (8 from, 2 rpc)
16. Remaining accounting pages (5)
17. Remaining sales pages (8)
18. Remaining purchasing pages (5)

**New Endpoints needed**:
- Dashboard aggregation endpoints
- POS transaction endpoints
- Transfer management endpoints
- Work order detail queries

**Gate Test**: Dashboard loads with real data, POS page functional, Journal Entries page loads

---

### Batch 4 — Reports Components — ~34 files

**Files**: All `src/components/reports/**` files

Pattern: Most reports follow a similar pattern — `supabase.from('table').select('*').filter()`. These can be batch-migrated using `dataGateway.queryTable()`.

**New Endpoints needed**:
- Generic table query endpoint already exists via `queryTable`
- Complex report-specific endpoints for JOINs/aggregations

**Gate Test**: Financial reports page loads, POS Z-Report renders, Party Account Statement works

---

### Batch 5 — Remaining Components — ~48 files

**Files**: All remaining `src/components/**` files not in Batch 4

Groups:
- POS components (5 files)
- Product components (4 files)  
- Purchasing components (8 files)
- Sales components (5 files)
- Other dialogs (8 files)
- Health/system (6 files — partial, keep edge invoke)
- Accounting monitoring (4 files)
- Production (2 files)

**Gate Test**: Product creation dialog works, Supplier view loads, Transfer dialogs function

---

### Batch 6 — Remaining Pages — ~50 files

**Files**: All remaining `src/pages/**` files not in Batch 3

Groups:
- HR pages (4 files)
- Gold/Gemstone pages (6 files)
- Inventory pages (5 files)
- Production pages (6 files)
- Settings pages (3 files)
- Other pages (remaining)

**Gate Test**: Full navigation test — all sidebar links load without errors

---

### Edge Functions — Separate Decision

| File | Function | Decision |
|------|----------|----------|
| `src/hooks/useZatcaSubmit.ts` | ZATCA submission | Keep on Supabase OR port to Express |
| `src/pages/accounting/InvoicesPage.tsx` | ZATCA validate | Keep on Supabase OR port to Express |
| `src/components/health/EdgeFunctionTests.tsx` | Health tests | Keep as-is |
| `src/pages/admin/TestDataSeederPage.tsx` | Test data | Keep as-is |
| `src/pages/BatchDetailPage.tsx` | Batch processing | Evaluate |
| `src/pages/ImportPage.tsx` | Import processing | Evaluate |
| `src/pages/UsersPage.tsx` | User management | Evaluate |
| `src/pages/AuthPage.tsx` | Auth | Keep on Supabase |

---

## VITE_SUPABASE Environment Variables

| File | Variable | Action |
|------|----------|--------|
| `src/integrations/supabase/client.ts` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Keep (auth client) |
| `src/lib/set-images-api.ts` | `VITE_SUPABASE_URL` | Keep (edge function) |
| `src/pages/BatchDetailPage.tsx` | `VITE_SUPABASE_URL` | Migrate when edge ported |
| `src/pages/ImportPage.tsx` | `VITE_SUPABASE_URL` | Migrate when edge ported |

---

## Summary Counts

| Category | Files | Calls |
|----------|-------|-------|
| A (Auth-only) | 2 | ~12 |
| B (Data-plane, MUST migrate) | ~175 | ~780 |
| C (Edge Functions) | 13 | ~31 |
| Infrastructure (dataGateway, client) | 3 | N/A |
| **Total** | **~180** | **~804** |
