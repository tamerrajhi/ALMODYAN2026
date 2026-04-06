import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation, Navigate, useSearchParams } from "react-router-dom";
import { Suspense, lazy, useEffect } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import { AuthProvider } from "./contexts/AuthContext";
import { LanguageProvider } from "./contexts/LanguageContext";
import { ModuleProvider } from "./core/contexts/ModuleContext";
import ProtectedRoute from "./components/auth/ProtectedRoute";
import ModuleAwareRoute from "./components/auth/ModuleAwareRoute";
import MainLayout from "./components/layout/MainLayout";
import POSLayout from "./components/pos/POSLayout";
import { Loader2 } from "lucide-react";

// Loading component for lazy loaded pages
const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <Loader2 className="w-8 h-8 animate-spin text-primary" />
  </div>
);

// TEMP: route change logger for debugging navigation issues
const RouteChangeLogger = () => {
  const location = useLocation();
  useEffect(() => {
    console.log('🧭 [Router] location changed:', {
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
    });
  }, [location.pathname, location.search, location.hash]);
  return null;
};

// Core Pages (always loaded)
import AuthPage from "./pages/AuthPage";
import NotFound from "./pages/NotFound";

// Dashboard Module (lazy loaded)
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const DashboardSettingsPage = lazy(() => import("./pages/DashboardSettingsPage"));

// POS Module (lazy loaded - completely separate app)
const POSPage = lazy(() => import("./pages/POSPage"));
const POSReportsPage = lazy(() => import("./pages/pos/POSReportsPage"));
const POSSettingsPage = lazy(() => import("./pages/pos/POSSettingsPage"));
const POSCustomersPage = lazy(() => import("./pages/pos/POSCustomersPage"));
const POSUsersPage = lazy(() => import("./pages/pos/POSUsersPage"));
const POSDashboardPage = lazy(() => import("./pages/pos/POSDashboardPage"));
const POSDashboardSettingsPage = lazy(() => import("./pages/pos/POSDashboardSettingsPage"));
import POSAdminGuard from "./components/pos/POSAdminGuard";

// Sales Module (lazy loaded)
const SalesHistoryPage = lazy(() => import("./pages/SalesHistoryPage"));
const ReturnsPage = lazy(() => import("./pages/ReturnsPage"));
const CustomersPage = lazy(() => import("./pages/CustomersPage"));
const SalesInvoicesPage = lazy(() => import("./pages/sales/SalesInvoicesPage"));
const CreateSalesInvoicePage = lazy(() => import("./pages/sales/CreateSalesInvoicePage"));
const SalesInvoiceViewPage = lazy(() => import("./pages/sales/SalesInvoiceViewPage"));
const CustomerReceiptsPage = lazy(() => import("./pages/sales/CustomerReceiptsPage"));
const CreditNotesPage = lazy(() => import("./pages/sales/CreditNotesPage"));
const ReceiptVouchersPage = lazy(() => import("./pages/sales/ReceiptVouchersPage"));
const SalesReturnsPage = lazy(() => import("./pages/sales/SalesReturnsPage"));
const SalesReturnsListPage = lazy(() => import("./pages/sales/SalesReturnsListPage"));
const SalesReturnFormPage = lazy(() => import("./pages/sales/SalesReturnFormPage"));
const SalesReturnViewPage = lazy(() => import("./pages/sales/SalesReturnViewPage"));
const POSReturnPage = lazy(() => import("./pages/POSReturnPage"));

// Purchases Module (lazy loaded)
const BatchesPage = lazy(() => import("./pages/BatchesPage"));
const BatchDetailPage = lazy(() => import("./pages/BatchDetailPage"));
const ImportPage = lazy(() => import("./pages/ImportPage"));
const SuppliersPage = lazy(() => import("./pages/SuppliersPage"));
const PurchaseOrdersPage = lazy(() => import("./pages/purchasing/PurchaseOrdersPage"));
const PurchaseOrderDetailPage = lazy(() => import("./pages/purchasing/PurchaseOrderDetailPage"));
const ReceivePurchaseOrderPage = lazy(() => import("./pages/purchasing/ReceivePurchaseOrderPage"));
const PurchaseRequisitionsPage = lazy(() => import("./pages/purchasing/PurchaseRequisitionsPage"));
const PRApprovalThresholdsPage = lazy(() => import("./pages/purchasing/PRApprovalThresholdsPage"));
const PurchaseInvoicesPage = lazy(() => import("./pages/purchasing/PurchaseInvoicesPage"));
const PurchaseInvoiceFormPage = lazy(() => import("./pages/purchasing/PurchaseInvoiceFormPage"));
const PurchaseInvoiceViewPage = lazy(() => import("./pages/purchasing/PurchaseInvoiceViewPage"));
const PaymentVouchersPage = lazy(() => import("./pages/purchasing/PaymentVouchersPage"));
const ImportPaymentsPage = lazy(() => import("./pages/purchasing/ImportPaymentsPage"));
const PurchaseReturnsListPage = lazy(() => import("./pages/purchasing/PurchaseReturnsListPage"));
const PurchaseReturnRouterPage = lazy(() => import("./pages/purchasing/PurchaseReturnRouterPage"));
const PurchaseReturnViewPage = lazy(() => import("./pages/purchasing/PurchaseReturnViewPage"));
const ConvertPRToPOPage = lazy(() => import("./pages/purchasing/ConvertPRToPOPage"));
const DeprecatedPurchasingPage = lazy(() => import("./pages/purchasing/DeprecatedPurchasingPage"));
const PurchasingHealthCheckPage = lazy(() => import("./pages/purchasing/PurchasingHealthCheckPage"));
const PurchasingMonitoringPage = lazy(() => import("./pages/purchasing/PurchasingMonitoringPage"));
const ReturnsHubPage = lazy(() => import("./pages/purchasing/ReturnsHubPage"));
const ReturnsHubDetailsPage = lazy(() => import("./pages/purchasing/ReturnsHubDetailsPage"));
const ReturnsHubResolverPage = lazy(() => import("./pages/purchasing/ReturnsHubResolverPage"));

// Products Module (lazy loaded)
const ProductsPage = lazy(() => import("./pages/products/ProductsPage"));
const ImportedPiecesPage = lazy(() => import("./pages/products/ImportedPiecesPage"));

// Inventory Module (lazy loaded)
const TransfersCenterPage = lazy(() => import("./pages/TransfersCenterPage"));
const TransferRequestsPage = lazy(() => import("./pages/TransferRequestsPage"));
const ItemMovementsPage = lazy(() => import("./pages/inventory/ItemMovementsPage"));
const BranchesPage = lazy(() => import("./pages/BranchesPage"));
const RawMaterialsPage = lazy(() => import("./pages/inventory/RawMaterialsPage"));
const InventoryCountsPage = lazy(() => import("./pages/inventory/InventoryCountsPage"));
const InventoryCountDetailPage = lazy(() => import("./pages/inventory/InventoryCountDetailPage"));
const InventoryCountReportPage = lazy(() => import("./pages/inventory/InventoryCountReportPage"));
// Production Module (lazy loaded)
const WIPPage = lazy(() => import("./pages/production/WIPPage"));
const FinishedGoodsFactoryPage = lazy(() => import("./pages/production/FinishedGoodsFactoryPage"));
const FinishedGoodsShowroomPage = lazy(() => import("./pages/production/FinishedGoodsShowroomPage"));
const WorkOrderDetailsPage = lazy(() => import("./pages/production/WorkOrderDetailsPage"));
const ProductionPlanningPage = lazy(() => import("./pages/production/ProductionPlanningPage"));
const ProductionLossReportPage = lazy(() => import("./pages/production/ProductionLossReportPage"));
const ProductionSettingsPage = lazy(() => import("./pages/production/ProductionSettingsPage"));
const CostCentersPage = lazy(() => import("./pages/production/CostCentersPage"));

// Accounting Module (lazy loaded)
const AccountingDashboard = lazy(() => import("./pages/accounting/AccountingDashboard"));
const ChartOfAccountsPage = lazy(() => import("./pages/accounting/ChartOfAccountsPage"));
const JournalEntriesPage = lazy(() => import("./pages/accounting/JournalEntriesPage"));
const InvoicesPage = lazy(() => import("./pages/accounting/InvoicesPage"));
const PaymentsPage = lazy(() => import("./pages/accounting/PaymentsPage"));
const FinancialReportsPage = lazy(() => import("./pages/accounting/FinancialReportsPage"));
const AccountLedgerPage = lazy(() => import("./pages/accounting/AccountLedgerPage"));
const AccountingHealthCheckPage = lazy(() => import("./pages/accounting/AccountingHealthCheckPage"));
const AccountingMonitoringPage = lazy(() => import("./pages/accounting/AccountingMonitoringPage"));

// Vaults Module (lazy loaded)
const GoldImportPage = lazy(() => import("./pages/gold/GoldImportPage"));
const GoldPricesPage = lazy(() => import("./pages/gold/GoldPricesPage"));
const GoldKaratsPage = lazy(() => import("./pages/gold/GoldKaratsPage"));
const GoldScrapPage = lazy(() => import("./pages/gold/GoldScrapPage"));
const GoldVaultPage = lazy(() => import("./pages/gold/GoldVaultPage"));
const CashVaultPage = lazy(() => import("./pages/CashVaultPage"));
const DailySettlementsPage = lazy(() => import("./pages/vaults/DailySettlementsPage"));
const GemstonesPage = lazy(() => import("./pages/gemstones/GemstonesPage"));
const LinkGemstoneToProduct = lazy(() => import("./pages/gemstones/LinkGemstoneToProduct"));

// HR Module (lazy loaded)
const EmployeesPage = lazy(() => import("./pages/hr/EmployeesPage"));
const PayrollPage = lazy(() => import("./pages/hr/PayrollPage"));
const AttendancePage = lazy(() => import("./pages/hr/AttendancePage"));
const LeavesPage = lazy(() => import("./pages/hr/LeavesPage"));

// Reports Module (lazy loaded)
const ReportsPage = lazy(() => import("./pages/ReportsPage"));
const AuditLogsPage = lazy(() => import("./pages/AuditLogsPage"));

// Settings Module (lazy loaded)
const SystemSettingsPage = lazy(() => import("./pages/SystemSettingsPage"));
const UsersPage = lazy(() => import("./pages/UsersPage"));
const RolesPage = lazy(() => import("./pages/RolesPage"));
const BackupPage = lazy(() => import("./pages/BackupPage"));
const ModuleManagementPage = lazy(() => import("./pages/ModuleManagementPage"));
const TestDataSeederPage = lazy(() => import("./pages/admin/TestDataSeederPage"));
const PaymentAccountSettingsPage = lazy(() => import("./pages/settings/PaymentAccountSettingsPage"));
const DepartmentsPage = lazy(() => import("./pages/settings/DepartmentsPage"));
const ZatcaSettingsPage = lazy(() => import("./pages/settings/ZatcaSettingsPage"));
const ZatcaLogsPage = lazy(() => import("./pages/settings/ZatcaLogsPage"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});

const PosReturnsRedirect = () => {
  const [searchParams] = useSearchParams();
  const mode = searchParams.get('mode');
  if (mode === 'pos') return <Navigate to="/pos/returns" replace />;
  return <SalesReturnsListPage />;
};

// Redirect component for old item history paths
const ItemMovementsRedirect = () => {
  const [searchParams] = useSearchParams();
  const itemCode = searchParams.get('item_code');
  const itemId = searchParams.get('item_id');
  
  let redirectUrl = '/inventory/item-movements';
  if (itemCode) {
    redirectUrl += `?item_code=${encodeURIComponent(itemCode)}`;
  } else if (itemId) {
    redirectUrl += `?item_id=${encodeURIComponent(itemId)}`;
  }
  
  return <Navigate to={redirectUrl} replace />;
};

// Feature flag-controlled Returns default page
import { RETURNS_HUB_ENABLED } from '@/config/features/returns-hub.config';

const ReturnsDefaultPage = RETURNS_HUB_ENABLED 
  ? lazy(() => import("./pages/purchasing/ReturnsHubPage"))
  : lazy(() => import("./pages/purchasing/PurchaseReturnsListPage"));

// Helper component for module-protected routes
const ModuleRoute = ({ 
  moduleId, 
  children 
}: { 
  moduleId: string; 
  children: React.ReactNode;
}) => (
  <ProtectedRoute>
    <ModuleAwareRoute moduleId={moduleId}>
      <Suspense fallback={<PageLoader />}>
        {children}
      </Suspense>
    </ModuleAwareRoute>
  </ProtectedRoute>
);

const POSRoute = ({ children }: { children: React.ReactNode }) => (
  <Suspense fallback={<PageLoader />}>
    {children}
  </Suspense>
);

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <AuthProvider>
          <ModuleProvider>
            <TooltipProvider>
              <Toaster />
              <Sonner />
              <BrowserRouter
                future={{
                  v7_startTransition: true,
                  v7_relativeSplatPath: true,
                }}
              >
                <RouteChangeLogger />
                <Routes>
                  {/* Auth Route */}
                  <Route path="/auth" element={<AuthPage />} />
                  
                  {/* Dashboard Module Routes */}
                  <Route path="/" element={<ModuleRoute moduleId="dashboard"><DashboardPage /></ModuleRoute>} />
                  <Route path="/dashboard-settings" element={<ModuleRoute moduleId="dashboard"><DashboardSettingsPage /></ModuleRoute>} />
                  
                  {/* POS App Routes (completely separate from ERP) */}
                  <Route path="/pos" element={<POSRoute><POSPage /></POSRoute>} />
                  <Route path="/pos/invoices" element={<POSRoute><POSLayout><SalesInvoicesPage sourceMode="pos" /></POSLayout></POSRoute>} />
                  <Route path="/pos/invoices/:id/view" element={<POSRoute><POSLayout><SalesInvoiceViewPage /></POSLayout></POSRoute>} />
                  <Route path="/pos/returns" element={<POSRoute><POSLayout><SalesReturnsListPage mode="pos" /></POSLayout></POSRoute>} />
                  <Route path="/pos/returns/:id/view" element={<POSRoute><POSLayout><SalesReturnViewPage /></POSLayout></POSRoute>} />
                  <Route path="/pos/return" element={<POSRoute><POSReturnPage /></POSRoute>} />
                  <Route path="/pos/customers" element={<POSRoute><POSCustomersPage /></POSRoute>} />
                  <Route path="/pos/pos-dashboard" element={<POSRoute><POSAdminGuard><POSDashboardPage /></POSAdminGuard></POSRoute>} />
                  <Route path="/pos/reports" element={<POSRoute><POSAdminGuard><POSReportsPage /></POSAdminGuard></POSRoute>} />
                  <Route path="/pos/settings" element={<POSRoute><POSAdminGuard><POSSettingsPage /></POSAdminGuard></POSRoute>} />
                  <Route path="/pos/settings/users" element={<POSRoute><POSAdminGuard><POSUsersPage /></POSAdminGuard></POSRoute>} />
                  <Route path="/pos/settings/dashboard" element={<POSRoute><POSAdminGuard><POSDashboardSettingsPage /></POSAdminGuard></POSRoute>} />
                  
                  {/* Legacy POS redirects -> new /pos/* paths */}
                  <Route path="/sales/pos-invoices" element={<Navigate to="/pos/invoices" replace />} />
                  <Route path="/sales-history" element={<Navigate to="/pos/invoices" replace />} />
                  <Route path="/pos/credit-note" element={<Navigate to="/pos/returns" replace />} />
                  <Route path="/returns" element={<Navigate to="/pos/returns" replace />} />
                  
                  {/* Sales Module Routes (ERP only) */}
                  <Route path="/customers" element={<ModuleRoute moduleId="sales"><CustomersPage /></ModuleRoute>} />
                  <Route path="/sales/invoices" element={<ModuleRoute moduleId="sales"><MainLayout><SalesInvoicesPage sourceMode="erp" /></MainLayout></ModuleRoute>} />
                  <Route path="/sales/invoices/new" element={<ModuleRoute moduleId="sales"><CreateSalesInvoicePage /></ModuleRoute>} />
                  <Route path="/sales/invoices/:id/view" element={<ModuleRoute moduleId="sales"><MainLayout><SalesInvoiceViewPage /></MainLayout></ModuleRoute>} />
                  <Route path="/sales/invoices/:id" element={<ModuleRoute moduleId="sales"><CreateSalesInvoicePage /></ModuleRoute>} />
                  <Route path="/sales/receipts" element={<ModuleRoute moduleId="sales"><CustomerReceiptsPage /></ModuleRoute>} />
                  <Route path="/sales/credit-notes" element={<Navigate to="/sales/returns?mode=erp" replace />} />
                  <Route path="/sales/receipt-vouchers" element={<ModuleRoute moduleId="sales"><ReceiptVouchersPage /></ModuleRoute>} />
                  
                  {/* ERP Sales Returns Routes */}
                  <Route path="/sales/returns" element={<Suspense fallback={<PageLoader />}><MainLayout><PosReturnsRedirect /></MainLayout></Suspense>} />
                  <Route path="/sales/returns/new" element={<ModuleRoute moduleId="sales"><SalesReturnFormPage /></ModuleRoute>} />
                  <Route path="/sales/returns/:id/view" element={<ModuleRoute moduleId="sales"><MainLayout><SalesReturnViewPage /></MainLayout></ModuleRoute>} />
                  <Route path="/sales/returns/:id" element={<ModuleRoute moduleId="sales"><SalesReturnFormPage /></ModuleRoute>} />
                  
                  {/* Purchases Module Routes */}
                  <Route path="/import" element={<ModuleRoute moduleId="purchases"><ImportPage /></ModuleRoute>} />
                  <Route path="/imported-pieces" element={<ModuleRoute moduleId="purchases"><ImportedPiecesPage /></ModuleRoute>} />
                  <Route path="/batches" element={<ModuleRoute moduleId="purchases"><BatchesPage /></ModuleRoute>} />
                  <Route path="/batches/:id" element={<ModuleRoute moduleId="purchases"><BatchDetailPage /></ModuleRoute>} />
                  <Route path="/suppliers" element={<ModuleRoute moduleId="purchases"><SuppliersPage /></ModuleRoute>} />
                  <Route path="/purchasing/requisitions" element={<ModuleRoute moduleId="purchases"><PurchaseRequisitionsPage /></ModuleRoute>} />
                  <Route path="/purchasing/requisitions/convert/:id" element={<ModuleRoute moduleId="purchases"><ConvertPRToPOPage /></ModuleRoute>} />
                  <Route path="/purchasing/requisitions/convert" element={<ModuleRoute moduleId="purchases"><ConvertPRToPOPage /></ModuleRoute>} />
                  <Route path="/purchasing/requisitions/thresholds" element={<ModuleRoute moduleId="purchases"><PRApprovalThresholdsPage /></ModuleRoute>} />
                  <Route path="/purchasing/orders" element={<ModuleRoute moduleId="purchases"><PurchaseOrdersPage /></ModuleRoute>} />
                  <Route path="/purchasing/orders/:id" element={<ModuleRoute moduleId="purchases"><PurchaseOrderDetailPage /></ModuleRoute>} />
                  <Route path="/purchasing/receive/:id" element={<ModuleRoute moduleId="purchases"><ReceivePurchaseOrderPage /></ModuleRoute>} />
                  <Route path="/purchasing/invoices" element={<ModuleRoute moduleId="purchases"><PurchaseInvoicesPage /></ModuleRoute>} />
                  <Route path="/purchasing/invoices/new" element={<ModuleRoute moduleId="purchases"><PurchaseInvoiceFormPage /></ModuleRoute>} />
                  <Route path="/purchasing/invoices/:id/view" element={<ModuleRoute moduleId="purchases"><PurchaseInvoiceViewPage /></ModuleRoute>} />
                  <Route path="/purchasing/invoices/:id" element={<ModuleRoute moduleId="purchases"><PurchaseInvoiceFormPage /></ModuleRoute>} />
                  <Route path="/purchasing/payment-vouchers" element={<ModuleRoute moduleId="purchases"><PaymentVouchersPage /></ModuleRoute>} />
                  <Route path="/purchasing/import-payments" element={<ModuleRoute moduleId="purchases"><ImportPaymentsPage /></ModuleRoute>} />
                  <Route path="/purchasing/returns-hub" element={<ModuleRoute moduleId="purchases"><ReturnsHubPage /></ModuleRoute>} />
                  <Route path="/purchasing/returns-hub/:return_type/:canonical_id" element={<ModuleRoute moduleId="purchases"><ReturnsHubDetailsPage /></ModuleRoute>} />
                  {/* Resolver route - determines return type and redirects to Hub detail */}
                  <Route path="/purchasing/returns-hub/r/:id" element={<ModuleRoute moduleId="purchases"><ReturnsHubResolverPage /></ModuleRoute>} />
                  {/* Legacy route - redirect to Returns Hub */}
                  <Route path="/purchasing/returns-legacy" element={<Navigate to="/purchasing/returns-hub" replace />} />
                  {/* Default returns route - controlled by RETURNS_HUB_ENABLED flag */}
                  <Route path="/purchasing/returns" element={<ModuleRoute moduleId="purchases"><ReturnsDefaultPage /></ModuleRoute>} />
                  <Route path="/purchasing/returns/new" element={<ModuleRoute moduleId="purchases"><PurchaseReturnRouterPage /></ModuleRoute>} />
                  <Route path="/purchasing/returns/:id" element={<ModuleRoute moduleId="purchases"><DeprecatedPurchasingPage /></ModuleRoute>} />
                  <Route path="/purchasing/returns/:id/view" element={<ModuleRoute moduleId="purchases"><PurchaseReturnViewPage /></ModuleRoute>} />
                  <Route path="/purchasing/health-check" element={<ModuleRoute moduleId="purchases"><PurchasingHealthCheckPage /></ModuleRoute>} />
                  <Route path="/purchasing/monitoring" element={<ModuleRoute moduleId="purchases"><PurchasingMonitoringPage /></ModuleRoute>} />
                  
                  {/* Products Module Routes */}
                  <Route path="/products" element={<ModuleRoute moduleId="products"><ProductsPage /></ModuleRoute>} />
                  <Route path="/products/costs" element={<ModuleRoute moduleId="products"><ProductsPage /></ModuleRoute>} />
                  <Route path="/products/items" element={<ModuleRoute moduleId="products"><ProductsPage /></ModuleRoute>} />

                  {/* Inventory Module Routes */}
                  <Route path="/transfers" element={<ModuleRoute moduleId="inventory"><TransfersCenterPage /></ModuleRoute>} />
                  <Route path="/transfer-requests" element={<ModuleRoute moduleId="inventory"><TransferRequestsPage /></ModuleRoute>} />
                  <Route path="/inventory/item-movements" element={<ModuleRoute moduleId="inventory"><ItemMovementsPage /></ModuleRoute>} />
                  {/* Redirects for old item history paths */}
                  <Route path="/item-history" element={<ProtectedRoute><Suspense fallback={<PageLoader />}><ItemMovementsRedirect /></Suspense></ProtectedRoute>} />
                  <Route path="/serial-tracking" element={<ProtectedRoute><Suspense fallback={<PageLoader />}><ItemMovementsRedirect /></Suspense></ProtectedRoute>} />
                  <Route path="/branches" element={<ModuleRoute moduleId="settings"><BranchesPage /></ModuleRoute>} />
                  <Route path="/raw-materials" element={<ModuleRoute moduleId="inventory"><RawMaterialsPage /></ModuleRoute>} />
                  <Route path="/inventory-counts" element={<ModuleRoute moduleId="inventory"><InventoryCountsPage /></ModuleRoute>} />
                  <Route path="/inventory-counts/:id" element={<ModuleRoute moduleId="inventory"><InventoryCountDetailPage /></ModuleRoute>} />
                  <Route path="/inventory-counts/:id/report" element={<ModuleRoute moduleId="inventory"><InventoryCountReportPage /></ModuleRoute>} />
                  
                  {/* Production Module Routes */}
                  <Route path="/production/wip" element={<ModuleRoute moduleId="production"><WIPPage /></ModuleRoute>} />
                  <Route path="/production/planning" element={<ModuleRoute moduleId="production"><ProductionPlanningPage /></ModuleRoute>} />
                  <Route path="/production/loss-report" element={<ModuleRoute moduleId="production"><ProductionLossReportPage /></ModuleRoute>} />
                  <Route path="/production/work-orders/:id" element={<ModuleRoute moduleId="production"><WorkOrderDetailsPage /></ModuleRoute>} />
                  <Route path="/production/settings" element={<ModuleRoute moduleId="production"><ProductionSettingsPage /></ModuleRoute>} />
                  <Route path="/production/cost-centers" element={<ModuleRoute moduleId="production"><CostCentersPage /></ModuleRoute>} />
                  <Route path="/finished-goods/factory" element={<ModuleRoute moduleId="production"><FinishedGoodsFactoryPage /></ModuleRoute>} />
                  <Route path="/finished-goods/showroom" element={<ModuleRoute moduleId="production"><FinishedGoodsShowroomPage /></ModuleRoute>} />
                  
                  {/* Accounting Module Routes */}
                  <Route path="/accounting" element={<ModuleRoute moduleId="accounting"><AccountingDashboard /></ModuleRoute>} />
                  <Route path="/accounting/chart-of-accounts" element={<ModuleRoute moduleId="accounting"><ChartOfAccountsPage /></ModuleRoute>} />
                  <Route path="/accounting/journal-entries" element={<ModuleRoute moduleId="accounting"><JournalEntriesPage /></ModuleRoute>} />
                  <Route path="/accounting/invoices" element={<ModuleRoute moduleId="accounting"><InvoicesPage /></ModuleRoute>} />
                  <Route path="/accounting/payments" element={<ModuleRoute moduleId="accounting"><PaymentsPage /></ModuleRoute>} />
                  <Route path="/accounting/financial-reports" element={<ModuleRoute moduleId="accounting"><FinancialReportsPage /></ModuleRoute>} />
                  <Route path="/accounting/account-ledger" element={<ModuleRoute moduleId="accounting"><AccountLedgerPage /></ModuleRoute>} />
                  <Route path="/accounting/health-check" element={<ModuleRoute moduleId="accounting"><AccountingHealthCheckPage /></ModuleRoute>} />
                  <Route path="/accounting/monitoring" element={<ModuleRoute moduleId="accounting"><AccountingMonitoringPage /></ModuleRoute>} />
                  
                  {/* Vaults Module Routes */}
                  <Route path="/gold/import" element={<ModuleRoute moduleId="vaults"><GoldImportPage /></ModuleRoute>} />
                  <Route path="/gold/karats" element={<ModuleRoute moduleId="vaults"><GoldKaratsPage /></ModuleRoute>} />
                  <Route path="/gold/prices" element={<ModuleRoute moduleId="vaults"><GoldPricesPage /></ModuleRoute>} />
                  <Route path="/gold/scrap" element={<ModuleRoute moduleId="vaults"><GoldScrapPage /></ModuleRoute>} />
                  <Route path="/gold/vault" element={<ModuleRoute moduleId="vaults"><GoldVaultPage /></ModuleRoute>} />
                  <Route path="/cash-vault" element={<ModuleRoute moduleId="vaults"><CashVaultPage /></ModuleRoute>} />
                  <Route path="/vaults/settlements" element={<ModuleRoute moduleId="vaults"><DailySettlementsPage /></ModuleRoute>} />
                  <Route path="/gemstones" element={<ModuleRoute moduleId="production"><GemstonesPage /></ModuleRoute>} />
                  <Route path="/gemstones/link" element={<ModuleRoute moduleId="production"><LinkGemstoneToProduct /></ModuleRoute>} />
                  
                  {/* HR Module Routes */}
                  <Route path="/hr/employees" element={<ModuleRoute moduleId="hr"><EmployeesPage /></ModuleRoute>} />
                  <Route path="/hr/payroll" element={<ModuleRoute moduleId="hr"><PayrollPage /></ModuleRoute>} />
                  <Route path="/hr/attendance" element={<ModuleRoute moduleId="hr"><AttendancePage /></ModuleRoute>} />
                  <Route path="/hr/leaves" element={<ModuleRoute moduleId="hr"><LeavesPage /></ModuleRoute>} />
                  
                  {/* Reports Module Routes */}
                  <Route path="/reports" element={<ModuleRoute moduleId="reports"><ReportsPage /></ModuleRoute>} />
                  <Route path="/audit-logs" element={<ModuleRoute moduleId="reports"><AuditLogsPage /></ModuleRoute>} />
                  
                  {/* Settings Module Routes */}
                  <Route path="/settings" element={<ModuleRoute moduleId="settings"><SystemSettingsPage /></ModuleRoute>} />
                  <Route path="/settings/modules" element={<ModuleRoute moduleId="settings"><ModuleManagementPage /></ModuleRoute>} />
                  <Route path="/settings/payment-accounts" element={<ModuleRoute moduleId="settings"><PaymentAccountSettingsPage /></ModuleRoute>} />
                  <Route path="/settings/departments" element={<ModuleRoute moduleId="settings"><DepartmentsPage /></ModuleRoute>} />
                  <Route path="/users" element={<ModuleRoute moduleId="settings"><UsersPage /></ModuleRoute>} />
                  <Route path="/roles" element={<ModuleRoute moduleId="settings"><RolesPage /></ModuleRoute>} />
                  <Route path="/backup" element={<ModuleRoute moduleId="settings"><BackupPage /></ModuleRoute>} />
                  <Route path="/admin/test-data" element={<ModuleRoute moduleId="settings"><TestDataSeederPage /></ModuleRoute>} />
                  <Route path="/settings/zatca" element={<ModuleRoute moduleId="settings"><ZatcaSettingsPage /></ModuleRoute>} />
                  <Route path="/settings/zatca/logs" element={<ModuleRoute moduleId="settings"><ZatcaLogsPage /></ModuleRoute>} />
                  
                  {/* Catch all */}
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </BrowserRouter>
            </TooltipProvider>
          </ModuleProvider>
        </AuthProvider>
      </LanguageProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
