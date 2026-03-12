import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  FileText, Building2, Package, ArrowRightLeft, Coins, ClipboardCheck, Receipt, 
  CreditCard, RotateCcw, Percent, Users, Wallet, ShoppingCart, Factory,
  Scale, UserCheck, Landmark, Calendar, Banknote, Play, Search, BarChart3,
  TrendingDown, DollarSign, Trophy, AlertTriangle, LayoutGrid, History
} from 'lucide-react';

// Existing reports
import BranchBalancesReport from '@/components/reports/BranchBalancesReport';
import TransferHistoryReport from '@/components/reports/TransferHistoryReport';
import GoldSalesReport from '@/components/reports/GoldSalesReport';
import InventoryCountStatisticsReport from '@/components/reports/InventoryCountStatisticsReport';
import ZReport from '@/components/reports/pos/ZReport';
import PaymentMethodsReport from '@/components/reports/pos/PaymentMethodsReport';
import ReturnsReport from '@/components/reports/pos/ReturnsReport';
import DiscountsReport from '@/components/reports/pos/DiscountsReport';
import EmployeePerformanceReport from '@/components/reports/pos/EmployeePerformanceReport';
import CashDrawerReport from '@/components/reports/pos/CashDrawerReport';

// New reports
import PurchaseOrdersReport from '@/components/reports/purchases/PurchaseOrdersReport';
import AttendanceReport from '@/components/reports/hr/AttendanceReport';
import PayrollReport from '@/components/reports/hr/PayrollReport';
import LeavesReport from '@/components/reports/hr/LeavesReport';
import TrialBalanceReport from '@/components/reports/financial/TrialBalanceReport';
import AdvancedTrialBalanceReport from '@/components/reports/financial/AdvancedTrialBalanceReport';
import CashVaultReport from '@/components/reports/vaults/CashVaultReport';
import GoldVaultReport from '@/components/reports/vaults/GoldVaultReport';
import CustomerBalancesReport from '@/components/reports/customers/CustomerBalancesReport';
import SupplierBalancesReport from '@/components/reports/customers/SupplierBalancesReport';
import PartyAccountStatement from '@/components/reports/PartyAccountStatement';
import WorkOrdersReport from '@/components/reports/production/WorkOrdersReport';

import ItemHistoryReport from '@/components/reports/purchases/ItemHistoryReport';
import ImportBatchesReport from '@/components/reports/purchases/ImportBatchesReport';
import NetPurchasesReport from '@/components/reports/purchases/NetPurchasesReport';
import PurchaseReturnsReport from '@/components/reports/purchases/PurchaseReturnsReport';
import NetSalesReport from '@/components/reports/pos/NetSalesReport';
import { useLanguage } from '@/contexts/LanguageContext';

// Dashboard reports
import BranchDailyPerformanceReport from '@/components/reports/dashboard/BranchDailyPerformanceReport';
import DailyGoldMovementReport from '@/components/reports/dashboard/DailyGoldMovementReport';
import SalesVsInventoryReport from '@/components/reports/dashboard/SalesVsInventoryReport';
import LossProductivityReport from '@/components/reports/dashboard/LossProductivityReport';
import ProfitMarginReport from '@/components/reports/dashboard/ProfitMarginReport';
import BestSellingItemsReport from '@/components/reports/dashboard/BestSellingItemsReport';
import TopCustomersReport from '@/components/reports/dashboard/TopCustomersReport';
import RisksAlertsReport from '@/components/reports/dashboard/RisksAlertsReport';

interface ReportDefinition {
  id: string;
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
  icon: React.ComponentType<{ className?: string }>;
  colorClass: string;
  category: string;
}

const allReports: ReportDefinition[] = [
  // Sales Reports
  { id: 'net-sales', titleAr: 'صافي المبيعات', titleEn: 'Net Sales', descriptionAr: 'المبيعات - المرتجعات = صافي المبيعات', descriptionEn: 'Sales - Returns = Net Sales', icon: Receipt, colorClass: 'bg-emerald-500/10 text-emerald-600 border-emerald-200', category: 'sales' },
  { id: 'z-report', titleAr: 'تقرير Z', titleEn: 'Z Report', descriptionAr: 'ملخص شامل لمبيعات ومرتجعات اليوم', descriptionEn: 'Comprehensive summary of daily sales and returns', icon: Receipt, colorClass: 'bg-emerald-500/10 text-emerald-600 border-emerald-200', category: 'sales' },
  { id: 'payment-methods', titleAr: 'طرق الدفع', titleEn: 'Payment Methods', descriptionAr: 'تحليل المبيعات حسب طريقة الدفع', descriptionEn: 'Sales analysis by payment method', icon: CreditCard, colorClass: 'bg-emerald-500/10 text-emerald-600 border-emerald-200', category: 'sales' },
  { id: 'returns-report', titleAr: 'تقرير المرتجعات', titleEn: 'Returns Report', descriptionAr: 'تحليل عمليات الإرجاع وأسبابها', descriptionEn: 'Analysis of return operations and reasons', icon: RotateCcw, colorClass: 'bg-emerald-500/10 text-emerald-600 border-emerald-200', category: 'sales' },
  { id: 'discounts-report', titleAr: 'تقرير الخصومات', titleEn: 'Discounts Report', descriptionAr: 'تحليل الخصومات المقدمة', descriptionEn: 'Analysis of discounts', icon: Percent, colorClass: 'bg-emerald-500/10 text-emerald-600 border-emerald-200', category: 'sales' },
  { id: 'employee-performance', titleAr: 'أداء البائعين', titleEn: 'Employee Performance', descriptionAr: 'مقارنة أداء فريق المبيعات', descriptionEn: 'Compare sales team performance', icon: Users, colorClass: 'bg-emerald-500/10 text-emerald-600 border-emerald-200', category: 'sales' },
  { id: 'cash-drawer', titleAr: 'درج النقدية', titleEn: 'Cash Drawer', descriptionAr: 'مطابقة الرصيد النقدي', descriptionEn: 'Match cash balance', icon: Wallet, colorClass: 'bg-emerald-500/10 text-emerald-600 border-emerald-200', category: 'sales' },
  
  // Purchase Reports
  { id: 'net-purchases', titleAr: 'صافي المشتريات', titleEn: 'Net Purchases', descriptionAr: 'المشتريات - المرتجعات = صافي المشتريات', descriptionEn: 'Purchases - Returns = Net Purchases', icon: ShoppingCart, colorClass: 'bg-purple-500/10 text-purple-600 border-purple-200', category: 'purchases' },
  { id: 'purchase-returns', titleAr: 'تقرير مرتجعات المشتريات', titleEn: 'Purchase Returns Report', descriptionAr: 'تحليل مفصل لمرتجعات المشتريات للموردين', descriptionEn: 'Detailed analysis of purchase returns to suppliers', icon: RotateCcw, colorClass: 'bg-purple-500/10 text-purple-600 border-purple-200', category: 'purchases' },
  { id: 'purchase-orders', titleAr: 'تقرير أوامر الشراء', titleEn: 'Purchase Orders Report', descriptionAr: 'تحليل أوامر الشراء والموردين', descriptionEn: 'Purchase orders and suppliers analysis', icon: ShoppingCart, colorClass: 'bg-purple-500/10 text-purple-600 border-purple-200', category: 'purchases' },
  { id: 'open-purchase-orders', titleAr: 'أوامر الشراء المفتوحة', titleEn: 'Open Purchase Orders', descriptionAr: 'الأوامر غير المكتملة ومتابعة الاستلام', descriptionEn: 'Incomplete orders and receipt tracking', icon: Package, colorClass: 'bg-purple-500/10 text-purple-600 border-purple-200', category: 'purchases' },
  { id: 'po-receipt-comparison', titleAr: 'مقارنة PO vs GRN vs Invoice', titleEn: 'PO vs GRN vs Invoice', descriptionAr: 'مقارنة الكميات المطلوبة والمستلمة والمفوترة', descriptionEn: 'Compare ordered, received, and invoiced', icon: BarChart3, colorClass: 'bg-purple-500/10 text-purple-600 border-purple-200', category: 'purchases' },
  { id: 'receipt-tracking', titleAr: 'متابعة الاستلام', titleEn: 'Receipt Tracking', descriptionAr: 'سجل مستندات الاستلام GRN', descriptionEn: 'GRN documents history', icon: ClipboardCheck, colorClass: 'bg-purple-500/10 text-purple-600 border-purple-200', category: 'purchases' },
  { id: 'item-history', titleAr: 'تاريخ حركة القطع', titleEn: 'Item History', descriptionAr: 'تتبع جميع حركات القطع من الاستيراد حتى البيع', descriptionEn: 'Track all item movements from import to sale', icon: History, colorClass: 'bg-purple-500/10 text-purple-600 border-purple-200', category: 'purchases' },
  { id: 'import-batches', titleAr: 'دفعات الاستيراد', titleEn: 'Import Batches', descriptionAr: 'عرض وإدارة جميع دفعات الاستيراد', descriptionEn: 'View and manage all import batches', icon: Package, colorClass: 'bg-purple-500/10 text-purple-600 border-purple-200', category: 'purchases' },
  
  // HR Reports
  { id: 'attendance-report', titleAr: 'تقرير الحضور والانصراف', titleEn: 'Attendance Report', descriptionAr: 'تحليل حضور الموظفين', descriptionEn: 'Employee attendance analysis', icon: Calendar, colorClass: 'bg-sky-500/10 text-sky-600 border-sky-200', category: 'hr' },
  { id: 'leaves-report', titleAr: 'تقرير الإجازات', titleEn: 'Leaves Report', descriptionAr: 'تحليل طلبات الإجازات', descriptionEn: 'Leave requests analysis', icon: Calendar, colorClass: 'bg-sky-500/10 text-sky-600 border-sky-200', category: 'hr' },
  { id: 'payroll-report', titleAr: 'تقرير الرواتب', titleEn: 'Payroll Report', descriptionAr: 'ملخص رواتب الموظفين', descriptionEn: 'Employee salary summary', icon: Banknote, colorClass: 'bg-sky-500/10 text-sky-600 border-sky-200', category: 'hr' },
  
  // Inventory Reports
  { id: 'branch-balances', titleAr: 'أرصدة الفروع', titleEn: 'Branch Balances', descriptionAr: 'عرض القطع الموجودة في كل فرع', descriptionEn: 'View items in each branch', icon: Building2, colorClass: 'bg-orange-500/10 text-orange-600 border-orange-200', category: 'inventory' },
  { id: 'transfer-history', titleAr: 'سجل التحويلات', titleEn: 'Transfer History', descriptionAr: 'عرض جميع عمليات النقل بين الفروع', descriptionEn: 'View all transfers between branches', icon: ArrowRightLeft, colorClass: 'bg-orange-500/10 text-orange-600 border-orange-200', category: 'inventory' },
  { id: 'inventory-count-stats', titleAr: 'إحصائيات جرد المخزون', titleEn: 'Inventory Count Statistics', descriptionAr: 'تحليل اتجاهات العجز والزيادة', descriptionEn: 'Analyze shortage and surplus trends', icon: ClipboardCheck, colorClass: 'bg-orange-500/10 text-orange-600 border-orange-200', category: 'inventory' },
  
  // Production Reports
  { id: 'work-orders', titleAr: 'تقرير أوامر العمل', titleEn: 'Work Orders Report', descriptionAr: 'تحليل أوامر الإنتاج', descriptionEn: 'Production orders analysis', icon: Factory, colorClass: 'bg-cyan-500/10 text-cyan-600 border-cyan-200', category: 'production' },
  
  // Financial Reports
  { id: 'advanced-trial-balance', titleAr: 'ميزان المراجعة', titleEn: 'Advanced Trial Balance', descriptionAr: 'ميزان مراجعة شامل مع أرصدة أول وآخر المدة والحركة', descriptionEn: 'Comprehensive trial balance with opening, closing and movement', icon: Scale, colorClass: 'bg-rose-500/10 text-rose-600 border-rose-200', category: 'financial' },
  
  // Vault Reports
  { id: 'cash-vault-report', titleAr: 'تقرير حركة الصناديق', titleEn: 'Cash Vault Report', descriptionAr: 'حركة الإيداع والسحب من الصناديق', descriptionEn: 'Deposit and withdrawal movements', icon: Landmark, colorClass: 'bg-yellow-500/10 text-yellow-600 border-yellow-200', category: 'vaults' },
  { id: 'gold-vault-report', titleAr: 'تقرير حركة خزائن الذهب', titleEn: 'Gold Vault Report', descriptionAr: 'حركة الإيداع والسحب من خزائن الذهب', descriptionEn: 'Gold deposit and withdrawal movements', icon: Coins, colorClass: 'bg-yellow-500/10 text-yellow-600 border-yellow-200', category: 'vaults' },
  
  // Customer/Supplier Reports
  { id: 'customer-balances', titleAr: 'تقرير أرصدة العملاء', titleEn: 'Customer Balances Report', descriptionAr: 'ملخص مشتريات ونقاط العملاء', descriptionEn: 'Customer purchases and points summary', icon: UserCheck, colorClass: 'bg-indigo-500/10 text-indigo-600 border-indigo-200', category: 'customers' },
  { id: 'supplier-balances', titleAr: 'تقرير الموردين', titleEn: 'Suppliers Report', descriptionAr: 'ملخص بيانات الموردين والقطع', descriptionEn: 'Supplier data and items summary', icon: Package, colorClass: 'bg-indigo-500/10 text-indigo-600 border-indigo-200', category: 'customers' },
  { id: 'party-account-statement', titleAr: 'كشف حساب العملاء/الموردين', titleEn: 'Account Statement', descriptionAr: 'كشف حساب تفصيلي مع رصيد أول وآخر المدة', descriptionEn: 'Detailed account statement with opening and closing balance', icon: FileText, colorClass: 'bg-indigo-500/10 text-indigo-600 border-indigo-200', category: 'customers' },
  
  // Gold Reports
  { id: 'gold-sales', titleAr: 'تقرير مبيعات الذهب', titleEn: 'Gold Sales Report', descriptionAr: 'تقرير مبيعات الذهب اليومية مع تحليل حسب العيار', descriptionEn: 'Daily gold sales report with karat analysis', icon: Coins, colorClass: 'bg-amber-500/10 text-amber-600 border-amber-200', category: 'gold' },
  
  // Dashboard Reports
  { id: 'branch-daily-performance', titleAr: 'الأداء اليومي للفروع', titleEn: 'Branch Daily Performance', descriptionAr: 'ملخص أداء الفروع اليومي', descriptionEn: 'Daily branch performance summary', icon: Building2, colorClass: 'bg-blue-500/10 text-blue-600 border-blue-200', category: 'dashboard' },
  { id: 'daily-gold-movement', titleAr: 'حركة الذهب اليومية', titleEn: 'Daily Gold Movement', descriptionAr: 'حركات الدخول والخروج اليومية للذهب', descriptionEn: 'Daily gold in/out movements', icon: Coins, colorClass: 'bg-amber-500/10 text-amber-600 border-amber-200', category: 'dashboard' },
  { id: 'sales-vs-inventory', titleAr: 'المبيعات مقابل المخزون', titleEn: 'Sales vs Inventory', descriptionAr: 'مقارنة بصرية بين المبيعات والمخزون', descriptionEn: 'Visual comparison of sales vs inventory', icon: BarChart3, colorClass: 'bg-emerald-500/10 text-emerald-600 border-emerald-200', category: 'dashboard' },
  { id: 'loss-productivity', titleAr: 'الفاقد والإنتاجية', titleEn: 'Loss & Productivity', descriptionAr: 'نسب الفاقد وكفاءة الإنتاج', descriptionEn: 'Loss rates and production efficiency', icon: TrendingDown, colorClass: 'bg-red-500/10 text-red-600 border-red-200', category: 'dashboard' },
  { id: 'profit-margin', titleAr: 'هامش الربح', titleEn: 'Profit Margin', descriptionAr: 'تحليل هامش الربح يومي/أسبوعي/شهري', descriptionEn: 'Daily/weekly/monthly profit margin analysis', icon: DollarSign, colorClass: 'bg-green-500/10 text-green-600 border-green-200', category: 'dashboard' },
  { id: 'best-selling-items', titleAr: 'أفضل الأصناف مبيعاً', titleEn: 'Best Selling Items', descriptionAr: 'ترتيب الأصناف حسب المبيعات', descriptionEn: 'Items ranked by sales', icon: Trophy, colorClass: 'bg-purple-500/10 text-purple-600 border-purple-200', category: 'dashboard' },
  { id: 'top-customers', titleAr: 'أعلى العملاء شراءً', titleEn: 'Top Customers', descriptionAr: 'ترتيب العملاء حسب حجم المشتريات', descriptionEn: 'Customers ranked by purchase volume', icon: Users, colorClass: 'bg-indigo-500/10 text-indigo-600 border-indigo-200', category: 'dashboard' },
  { id: 'risks-alerts', titleAr: 'المخاطر والتنبيهات', titleEn: 'Risks & Alerts', descriptionAr: 'التنبيهات والمخاطر النشطة', descriptionEn: 'Active alerts and risks', icon: AlertTriangle, colorClass: 'bg-orange-500/10 text-orange-600 border-orange-200', category: 'dashboard' },
];

const categoryTitles: Record<string, { ar: string; en: string }> = {
  search: { ar: 'مركز بحث التقارير', en: 'Reports Search Center' },
  dashboard: { ar: 'تقارير لوحة التحكم', en: 'Dashboard Reports' },
  sales: { ar: 'تقارير المبيعات', en: 'Sales Reports' },
  purchases: { ar: 'تقارير المشتريات', en: 'Purchase Reports' },
  hr: { ar: 'تقارير الموظفين', en: 'HR Reports' },
  inventory: { ar: 'تقارير المخزون', en: 'Inventory Reports' },
  production: { ar: 'تقارير الإنتاج', en: 'Production Reports' },
  financial: { ar: 'تقارير المالية', en: 'Financial Reports' },
  vaults: { ar: 'تقارير الصناديق', en: 'Vault Reports' },
  customers: { ar: 'تقارير العملاء والموردين', en: 'Customers & Suppliers Reports' },
  gold: { ar: 'تقارير الذهب', en: 'Gold Reports' },
};

export default function ReportsPage() {
  const { language } = useLanguage();
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'sales';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [activeReport, setActiveReport] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && categoryTitles[tab]) {
      setActiveTab(tab);
      setActiveReport(null);
      setSearchQuery('');
    }
  }, [searchParams]);

  const getReportsByCategory = (category: string) => {
    return allReports.filter(r => r.category === category);
  };

  // Filter all reports based on search query
  const filteredReports = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    return allReports.filter(report => 
      report.titleAr.toLowerCase().includes(query) ||
      report.titleEn.toLowerCase().includes(query) ||
      report.descriptionAr.toLowerCase().includes(query) ||
      report.descriptionEn.toLowerCase().includes(query)
    );
  }, [searchQuery]);

  const renderReportContent = () => {
    switch (activeReport) {
      // Sales
      case 'net-sales': return <NetSalesReport onBack={() => setActiveReport(null)} />;
      case 'z-report': return <ZReport onBack={() => setActiveReport(null)} />;
      case 'payment-methods': return <PaymentMethodsReport onBack={() => setActiveReport(null)} />;
      case 'returns-report': return <ReturnsReport onBack={() => setActiveReport(null)} />;
      case 'discounts-report': return <DiscountsReport onBack={() => setActiveReport(null)} />;
      case 'employee-performance': return <EmployeePerformanceReport onBack={() => setActiveReport(null)} />;
      case 'cash-drawer': return <CashDrawerReport onBack={() => setActiveReport(null)} />;
      
      // Purchases
      case 'net-purchases': return <NetPurchasesReport onBack={() => setActiveReport(null)} />;
      case 'purchase-returns': return <PurchaseReturnsReport onBack={() => setActiveReport(null)} />;
      case 'purchase-orders': return <PurchaseOrdersReport onBack={() => setActiveReport(null)} />;
      case 'item-history': return <ItemHistoryReport onBack={() => setActiveReport(null)} />;
      case 'import-batches': return <ImportBatchesReport onBack={() => setActiveReport(null)} />;
      
      // HR
      case 'attendance-report': return <AttendanceReport onBack={() => setActiveReport(null)} />;
      case 'leaves-report': return <LeavesReport onBack={() => setActiveReport(null)} />;
      case 'payroll-report': return <PayrollReport onBack={() => setActiveReport(null)} />;
      
      // Inventory
      case 'branch-balances': return <BranchBalancesReport />;
      case 'transfer-history': return <TransferHistoryReport />;
      case 'inventory-count-stats': return <InventoryCountStatisticsReport onBack={() => setActiveReport(null)} />;
      
      // Production
      case 'work-orders': return <WorkOrdersReport onBack={() => setActiveReport(null)} />;
      
      // Financial
      case 'advanced-trial-balance': return <AdvancedTrialBalanceReport onBack={() => setActiveReport(null)} />;
      
      // Vaults
      case 'cash-vault-report': return <CashVaultReport onBack={() => setActiveReport(null)} />;
      case 'gold-vault-report': return <GoldVaultReport onBack={() => setActiveReport(null)} />;
      
      // Customers
      case 'customer-balances': return <CustomerBalancesReport onBack={() => setActiveReport(null)} />;
      case 'supplier-balances': return <SupplierBalancesReport onBack={() => setActiveReport(null)} />;
      case 'party-account-statement': return <PartyAccountStatement onBack={() => setActiveReport(null)} />;
      
      // Gold
      case 'gold-sales': return <GoldSalesReport onBack={() => setActiveReport(null)} />;
      
      // Dashboard
      case 'branch-daily-performance': return <BranchDailyPerformanceReport onBack={() => setActiveReport(null)} />;
      case 'daily-gold-movement': return <DailyGoldMovementReport onBack={() => setActiveReport(null)} />;
      case 'sales-vs-inventory': return <SalesVsInventoryReport onBack={() => setActiveReport(null)} />;
      case 'loss-productivity': return <LossProductivityReport onBack={() => setActiveReport(null)} />;
      case 'profit-margin': return <ProfitMarginReport onBack={() => setActiveReport(null)} />;
      case 'best-selling-items': return <BestSellingItemsReport onBack={() => setActiveReport(null)} />;
      case 'top-customers': return <TopCustomersReport onBack={() => setActiveReport(null)} />;
      case 'risks-alerts': return <RisksAlertsReport onBack={() => setActiveReport(null)} />;
      
      default: return null;
    }
  };

  const reports = getReportsByCategory(activeTab);
  const categoryTitle = categoryTitles[activeTab] || { ar: 'التقارير', en: 'Reports' };

  if (activeReport) {
    return (
      <MainLayout>
        {renderReportContent()}
      </MainLayout>
    );
  }

  // Show search page when tab is 'search'
  if (activeTab === 'search' && !activeReport) {
    return (
      <MainLayout>
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Search Header */}
          <div className="text-center space-y-4">
            <div className="inline-flex p-4 rounded-full bg-lime-500/10">
              <Search className="w-12 h-12 text-lime-600" />
            </div>
            <h1 className="text-3xl font-bold text-foreground">
              {language === 'ar' ? 'مركز بحث التقارير' : 'Reports Search Center'}
            </h1>
            <p className="text-muted-foreground text-lg">
              {language === 'ar' 
                ? 'ابحث في جميع تقارير النظام بسهولة' 
                : 'Search all system reports easily'}
            </p>
          </div>

          {/* Search Input */}
          <div className="relative">
            <Search className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              type="text"
              placeholder={language === 'ar' ? 'اكتب اسم التقرير للبحث...' : 'Type report name to search...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pr-12 h-14 text-lg"
              autoFocus
            />
          </div>

          {/* Search Results */}
          {searchQuery.trim() && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {language === 'ar' 
                  ? `تم العثور على ${filteredReports.length} تقرير` 
                  : `Found ${filteredReports.length} reports`}
              </p>

              {filteredReports.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {filteredReports.map((report) => {
                    const Icon = report.icon;
                    return (
                      <Card 
                        key={report.id} 
                        className={`group hover:shadow-lg transition-all duration-300 border-2 hover:scale-[1.02] cursor-pointer ${report.colorClass.split(' ')[2]}`}
                        onClick={() => setActiveReport(report.id)}
                      >
                        <CardHeader className="pb-3">
                          <div className="flex items-start gap-4">
                            <div className={`p-3 rounded-xl ${report.colorClass.split(' ').slice(0, 2).join(' ')}`}>
                              <Icon className="w-6 h-6" />
                            </div>
                            <div className="flex-1">
                              <CardTitle className="text-lg font-semibold">
                                {language === 'ar' ? report.titleAr : report.titleEn}
                              </CardTitle>
                              <CardDescription className="mt-1 text-sm">
                                {language === 'ar' ? report.descriptionAr : report.descriptionEn}
                              </CardDescription>
                              <span className="text-xs text-muted-foreground mt-2 block">
                                {language === 'ar' 
                                  ? categoryTitles[report.category]?.ar 
                                  : categoryTitles[report.category]?.en}
                              </span>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <Button 
                            className="w-full gap-2 group-hover:bg-primary group-hover:text-primary-foreground transition-colors"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveReport(report.id);
                            }}
                          >
                            <Play className="w-4 h-4" />
                            {language === 'ar' ? 'تشغيل التقرير' : 'Run Report'}
                          </Button>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-12">
                  <FileText className="w-16 h-16 mx-auto text-muted-foreground/50" />
                  <h3 className="mt-4 text-lg font-medium text-muted-foreground">
                    {language === 'ar' ? 'لا توجد نتائج مطابقة' : 'No matching results'}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {language === 'ar' ? 'جرب كلمات بحث مختلفة' : 'Try different search terms'}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Initial State - No Search Query */}
          {!searchQuery.trim() && (
            <div className="text-center py-12">
              <FileText className="w-16 h-16 mx-auto text-muted-foreground/30" />
              <h3 className="mt-4 text-lg font-medium text-muted-foreground">
                {language === 'ar' ? 'ابدأ بكتابة اسم التقرير' : 'Start typing a report name'}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                {language === 'ar' 
                  ? `يمكنك البحث في ${allReports.length} تقرير متاح` 
                  : `You can search through ${allReports.length} available reports`}
              </p>
            </div>
          )}
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {language === 'ar' ? categoryTitle.ar : categoryTitle.en}
          </h1>
          <p className="text-muted-foreground mt-1">
            {language === 'ar' 
              ? `${reports.length} تقرير متاح في هذا القسم` 
              : `${reports.length} reports available in this section`}
          </p>
        </div>

        {/* Report Cards Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {reports.map((report) => {
            const Icon = report.icon;
            return (
              <Card 
                key={report.id} 
                className={`group hover:shadow-lg transition-all duration-300 border-2 hover:scale-[1.02] cursor-pointer ${report.colorClass.split(' ')[2]}`}
                onClick={() => setActiveReport(report.id)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start gap-4">
                    <div className={`p-3 rounded-xl ${report.colorClass.split(' ').slice(0, 2).join(' ')}`}>
                      <Icon className="w-6 h-6" />
                    </div>
                    <div className="flex-1">
                      <CardTitle className="text-lg font-semibold">
                        {language === 'ar' ? report.titleAr : report.titleEn}
                      </CardTitle>
                      <CardDescription className="mt-1 text-sm">
                        {language === 'ar' ? report.descriptionAr : report.descriptionEn}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <Button 
                    className="w-full gap-2 group-hover:bg-primary group-hover:text-primary-foreground transition-colors"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveReport(report.id);
                    }}
                  >
                    <Play className="w-4 h-4" />
                    {language === 'ar' ? 'تشغيل التقرير' : 'Run Report'}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Empty State */}
        {reports.length === 0 && (
          <div className="text-center py-12">
            <FileText className="w-16 h-16 mx-auto text-muted-foreground/50" />
            <h3 className="mt-4 text-lg font-medium text-muted-foreground">
              {language === 'ar' ? 'لا توجد تقارير في هذا القسم' : 'No reports in this section'}
            </h3>
          </div>
        )}
      </div>
    </MainLayout>
  );
}
