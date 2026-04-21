import { ReactNode, useState, useMemo, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useScreenPermissions } from '@/hooks/useScreenPermissions';
import { useIsMobile } from '@/hooks/use-mobile';
import { useUserBranches } from '@/hooks/useUserBranches';
import { useModules } from '@/core/contexts/ModuleContext';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import NotificationBell from '@/components/notifications/NotificationBell';
import DataBackendBadge from '@/components/system/DataBackendBadge';
import { Sidebar } from './Sidebar';
import {
  LayoutGrid,
  Upload,
  History,
  Gem,
  Building2,
  FileBarChart,
  ShoppingCart,
  Users,
  Menu,
  X,
  UserCog,
  RotateCcw,
  Truck,
  Calculator,
  BookOpen,
  FileText,
  Wallet,
  Scale,
  ArrowRightLeft,
  Shield,
  Sparkles,
  TrendingUp,
  Boxes,
  PackageSearch,
  Store,
  SlidersHorizontal,
  Database,
  Coins,
  FileSearch,
  Cog,
  HeartPulse,
  HardDrive,
  UsersRound,
  Calendar,
  DollarSign,
  Clock,
  Factory,
  Receipt,
  Vault,
  BarChart3,
  Package,
  FileCheck,
  Languages,
} from 'lucide-react';

interface MainLayoutProps {
  children: ReactNode;
}

// Menu sections will be built dynamically based on language
// Memoize menu sections structure - only changes with language
const getMenuSections = (t: any) => [
  {
    id: 'dashboard',
    label: t.menu.dashboard,
    icon: LayoutGrid,
    items: [
      { href: '/', label: t.menu.dashboardHome, icon: LayoutGrid },
      { href: '/dashboard-settings', label: t.menu.dashboardSettings, icon: SlidersHorizontal },
    ],
  },
  {
    id: 'purchases',
    label: t.nav.purchases,
    icon: PackageSearch,
    items: [
      { href: '/purchasing/invoices', label: t.menu.purchaseInvoices, icon: Receipt },
      { href: '/purchasing/payment-vouchers', label: t.menu.paymentVouchers || 'سندات الصرف', icon: Wallet },
      { href: '/purchasing/returns-hub', label: t.menu.purchaseReturns || 'المرتجعات', icon: RotateCcw },
      { href: '/batches', label: t.menu.batches, icon: Package },
      { href: '/purchasing/requisitions', label: t.menu.requisitions, icon: FileSearch },
      { href: '/purchasing/orders', label: t.menu.purchaseOrders, icon: FileText },
      { href: '/suppliers', label: t.menu.suppliers, icon: Truck },
      { href: '/import', label: t.menu.import || 'استيراد البيانات', icon: Upload },
      { href: '/imported-pieces', label: t.menu.importedPieces || 'قطع مستوردة للبيع', icon: Gem },
      { href: '/gold/import', label: 'استيراد الذهب', icon: Upload },
    ],
  },
  {
    id: 'sales',
    label: t.nav.sales,
    icon: Store,
    items: [
      { href: '/sales/invoices', label: 'فواتير المبيعات العامة', icon: FileText },
      { href: '/sales/returns?mode=erp', label: 'مرتجعات المبيعات العامة', icon: RotateCcw },
      { href: '/sales/receipts', label: t.menu.customerReceipts || 'سندات القبض', icon: Receipt },
      { href: '/customers', label: t.menu.customers, icon: Users },
    ],
  },
  {
    id: 'accounting',
    label: t.nav.accounting,
    icon: Receipt,
    items: [
      { href: '/accounting', label: t.menu.financialDashboard, icon: Calculator },
      { href: '/accounting/chart-of-accounts', label: t.menu.chartOfAccounts, icon: BookOpen },
      { href: '/accounting/journal-entries', label: t.menu.journalEntries, icon: FileText },
      { href: '/accounting/invoices', label: t.menu.invoices, icon: FileBarChart },
      { href: '/accounting/payments', label: t.menu.payments, icon: Wallet },
      { href: '/accounting/account-ledger', label: t.menu.accountLedger, icon: FileSearch },
      { href: '/accounting/financial-reports', label: t.menu.financialReports, icon: Scale },
      { href: '/accounting/health-check', label: t.menu.accountingHealthCheck, icon: HeartPulse },
    ],
  },
  {
    id: 'products',
    label: t.menu.productsAndCosts,
    icon: Package,
    href: '/products',
    items: [
      { href: '/products/costs', label: t.menu.costs || 'التكاليف', icon: DollarSign },
      { href: '/products/items', label: t.menu.products || 'المنتجات', icon: Package },
    ],
  },
  {
    id: 'inventory',
    label: t.nav.inventory,
    icon: Boxes,
    items: [
      { href: '/transfers', label: t.menu.transfers, icon: ArrowRightLeft },
      { href: '/transfer-requests', label: t.menu.transferRequests, icon: Truck },
      { href: '/inventory-counts', label: t.menu.inventoryCounts, icon: Boxes },
      { href: '/raw-materials', label: t.menu.rawMaterials, icon: Package },
      { href: '/inventory/item-movements', label: 'تاريخ حركة القطع', icon: History },
    ],
  },
  {
    id: 'production',
    label: t.nav.production,
    icon: Factory,
    items: [
      { href: '/production/wip', label: t.menu.productionWIP, icon: Calculator },
      { href: '/production/planning', label: t.menu.productionPlanning || 'تخطيط الإنتاج', icon: Boxes },
      { href: '/production/cost-centers', label: t.menu.costCenters || 'مراكز التكلفة', icon: Building2 },
      { href: '/production/loss-report', label: t.menu.productionLossReport || 'تقارير الفاقد والكفاءة', icon: FileBarChart },
      { href: '/finished-goods/factory', label: t.menu.finishedGoodsFactory, icon: Package },
      { href: '/finished-goods/showroom', label: t.menu.finishedGoodsShowroom, icon: Gem },
      { href: '/gemstones', label: t.menu.gemstones, icon: Gem },
      { href: '/gemstones/link', label: t.menu.linkGemstones, icon: Gem },
      { href: '/production/settings', label: t.menu.productionSettings || 'إعدادات الإنتاج', icon: Cog },
    ],
  },
  {
    id: 'vaults',
    label: t.nav.vaults || 'الخزائن',
    icon: Vault,
    items: [
      { href: '/gold/vault', label: t.menu.goldVault, icon: Coins },
      { href: '/cash-vault', label: t.menu.cashVault, icon: Wallet },
      { href: '/gold/scrap', label: t.menu.goldScrap || 'خردة الذهب', icon: Gem },
      { href: '/vaults/settlements', label: t.menu.dailySettlements || 'مطابقة نهاية اليوم', icon: Calculator },
    ],
  },
  {
    id: 'hr',
    label: t.nav.hr || 'الموارد البشرية',
    icon: UsersRound,
    items: [
      { href: '/hr/employees', label: t.menu.employees || 'إدارة الموظفين', icon: Users },
      { href: '/hr/attendance', label: t.menu.attendance || 'الحضور والانصراف', icon: Clock },
      { href: '/hr/leaves', label: t.menu.leaves || 'الإجازات', icon: Calendar },
      { href: '/hr/payroll', label: t.menu.payroll || 'الرواتب', icon: DollarSign },
    ],
  },
  {
    id: 'reports',
    label: t.nav.reports,
    icon: BarChart3,
    items: [
      { href: '/reports?tab=search', label: t.menu.reportsSearchCenter || 'مركز بحث التقارير', icon: FileSearch },
      { href: '/reports?tab=dashboard', label: t.menu.dashboardReports || 'تقارير لوحة التحكم', icon: LayoutGrid },
      { href: '/reports?tab=sales', label: t.menu.salesReports || 'تقارير المبيعات', icon: Receipt },
      { href: '/reports?tab=purchases', label: t.menu.purchaseReportsTab || 'تقارير المشتريات', icon: ShoppingCart },
      { href: '/reports?tab=hr', label: t.menu.hrReports || 'تقارير الموظفين', icon: UsersRound },
      { href: '/reports?tab=inventory', label: t.menu.inventoryReportsTab || 'تقارير المخزون', icon: Boxes },
      { href: '/reports?tab=production', label: t.menu.productionReports || 'تقارير الإنتاج', icon: Factory },
      { href: '/reports?tab=financial', label: t.menu.financialReportsTab || 'تقارير المالية', icon: Scale },
      { href: '/reports?tab=vaults', label: t.menu.vaultsReports || 'تقارير الصناديق', icon: Vault },
      { href: '/reports?tab=customers', label: t.menu.customersReports || 'تقارير العملاء/الموردين', icon: Users },
      { href: '/reports?tab=gold', label: t.menu.goldReports, icon: Coins },
      { href: '/audit-logs', label: t.menu.auditLogs, icon: FileSearch },
    ],
  },
  {
    id: 'settings',
    label: t.nav.settings,
    icon: SlidersHorizontal,
    items: [
      { href: '/settings', label: t.menu.systemSettings, icon: Cog },
      { href: '/settings/modules', label: 'إدارة الموديولات', icon: Boxes },
      { href: '/settings/payment-accounts', label: t.menu.paymentAccountSettings || 'إعدادات الحسابات النقدية', icon: Wallet },
      { href: '/settings/zatca', label: t.menu.zatcaSettings || 'إعدادات ZATCA', icon: FileCheck },
      { href: '/settings/zatca/logs', label: t.menu.zatcaLogs || 'سجل عمليات ZATCA', icon: FileSearch },
      { href: '/gold/karats', label: t.menu.karatManagement, icon: Sparkles },
      { href: '/gold/prices', label: t.menu.goldPrices, icon: TrendingUp },
      { href: '/branches', label: t.menu.branches, icon: Building2 },
      { href: '/users', label: t.menu.users, icon: UserCog },
      { href: '/roles', label: t.menu.roles, icon: Shield },
      { href: '/backup', label: t.menu.backup, icon: HardDrive, adminOnly: true },
    ],
  },
];

export default function MainLayout({ children }: MainLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { t, language, setLanguage, isRTL } = useLanguage();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { isAdmin, isLoading: permissionsLoading, viewableScreenPaths } = useScreenPermissions();
  const { primaryBranch, userBranches } = useUserBranches();
  const { userHasModuleAccess, isLoading: modulesLoading } = useModules();
  const menuSections = useMemo(() => getMenuSections(t), [t]);

  // Determine if user is in a gold branch context
  const isGoldBranchContext = useMemo(() => {
    if (isAdmin) {
      const goldBranches = userBranches.filter(b => b.branch_type === 'gold');
      return goldBranches.length > 0 && goldBranches.length === userBranches.length;
    }
    return primaryBranch?.branch_type === 'gold';
  }, [isAdmin, primaryBranch, userBranches]);

  // Close sidebar on mobile when route changes
  useEffect(() => {
    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [location.pathname, location.search, isMobile]);

  // Set initial sidebar state based on screen size
  useEffect(() => {
    setSidebarOpen(!isMobile);
  }, [isMobile]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);
  const handleHeaderLanguageChange = (nextLanguage: 'ar' | 'en') => {
    if (nextLanguage !== language) {
      setLanguage(nextLanguage);
    }
  };

  const isLoadingState = permissionsLoading || modulesLoading;

  return (
    <div className="flex w-screen h-screen overflow-hidden bg-background" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Mobile Overlay */}
      {isMobile && sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Toggle Button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleSidebar}
        className={cn(
          'fixed top-3 md:top-4 z-[70] transition-all duration-300 h-10 w-10 md:h-9 md:w-9',
          isMobile 
            ? 'right-3' 
            : sidebarOpen ? 'right-[17rem]' : 'right-4'
        )}
      >
        {sidebarOpen ? (
          <X className="w-5 h-5 md:w-4 md:h-4" />
        ) : (
          <Menu className="w-5 h-5 md:w-4 md:h-4" />
        )}
      </Button>

      {/* Sidebar Component - Memoized */}
      <Sidebar
        menuSections={menuSections}
        isGoldBranchContext={isGoldBranchContext}
        isAdmin={isAdmin || false}
        viewableScreenPaths={viewableScreenPaths}
        userHasModuleAccess={userHasModuleAccess}
        onItemClick={() => isMobile && setSidebarOpen(false)}
        user={user}
        onSignOut={handleSignOut}
        isRTL={isRTL}
        t={t}
        isOpen={sidebarOpen}
        isLoading={isLoadingState}
      />

      {/* Main Content */}
      <main
        className={cn(
          'flex-1 min-w-0 h-screen flex flex-col transition-all duration-300',
          !isMobile && sidebarOpen ? 'mr-64' : 'mr-0'
        )}
      >
        {/* Top Header Bar with User Info */}
        <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b border-border px-4 md:px-6 lg:px-8 py-3 flex-shrink-0">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t.header.welcome}</span>
              <span className="font-semibold text-primary">
                {user?.user_metadata?.full_name || user?.user_metadata?.username || (isRTL ? 'مستخدم' : 'User')}
              </span>
              <span className="text-muted-foreground hidden sm:inline">|</span>
              <span className="text-xs text-muted-foreground hidden sm:inline">
                {isAdmin ? t.header.admin : t.header.user}
              </span>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <DataBackendBadge />
              <NotificationBell />
              <div
                className="flex items-center gap-1 rounded-full border border-border bg-background/80 p-1"
                aria-label={isRTL ? 'تغيير اللغة' : 'Change language'}
                data-testid="control-header-language"
              >
                <Languages className="h-3.5 w-3.5 text-muted-foreground mx-1" aria-hidden="true" />
                <Button
                  type="button"
                  variant={language === 'ar' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-7 rounded-full px-2 text-xs"
                  onClick={() => handleHeaderLanguageChange('ar')}
                  data-testid="button-header-language-ar"
                  aria-pressed={language === 'ar'}
                >
                  عربي
                </Button>
                <Button
                  type="button"
                  variant={language === 'en' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-7 rounded-full px-2 text-xs"
                  onClick={() => handleHeaderLanguageChange('en')}
                  data-testid="button-header-language-en"
                  aria-pressed={language === 'en'}
                >
                  EN
                </Button>
              </div>
              <div className="text-xs text-muted-foreground">
                {new Date().toLocaleDateString(isRTL ? 'ar-SA' : 'en-US', { 
                  weekday: 'long', 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Content Area - scrollable */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
