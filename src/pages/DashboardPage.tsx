import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Upload, 
  History, 
  Package, 
  Layers,
  ArrowLeft,
  TrendingUp,
  Building2,
  ShoppingCart,
  Banknote,
  Scale,
  Users,
  ArrowRightLeft,
  Bell,
  Clock,
  CheckCircle,
  XCircle,
  Sparkles,
  Coins,
  BarChart3,
  TrendingDown,
  DollarSign,
  Trophy,
  AlertTriangle,
  Play,
  FileText
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import * as dataGateway from '@/lib/dataGateway';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { useUserBranches } from '@/hooks/useUserBranches';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDashboardSettings } from '@/pages/DashboardSettingsPage';

export default function DashboardPage() {
  const { user } = useAuth();
  const { t, isRTL } = useLanguage();
  const { userBranches, primaryBranch, isAdmin, isLoading: branchesLoading } = useUserBranches();
  const dashboardSettings = useDashboardSettings();
  
  // For non-admins with single branch, auto-select it
  const [selectedBranch, setSelectedBranch] = useState<string>('all');

  // Auto-select primary branch for non-admins
  useEffect(() => {
    if (!branchesLoading && !isAdmin && userBranches.length > 0) {
      // For non-admins, set to their primary branch or first branch
      const defaultBranch = primaryBranch?.branch_id || userBranches[0]?.branch_id;
      if (defaultBranch) {
        setSelectedBranch(defaultBranch);
      }
    }
  }, [branchesLoading, isAdmin, userBranches, primaryBranch]);

  // Use userBranches instead of fetching all branches
  const branches = userBranches.map(ub => ({
    id: ub.branch_id,
    branch_name: ub.branch_name,
    branch_code: ub.branch_code,
    branch_type: ub.branch_type,
  }));

  // Determine the selected branch type
  const selectedBranchType = selectedBranch === 'all' 
    ? 'mixed' 
    : branches.find(b => b.id === selectedBranch)?.branch_type || 'jewelry';
  
  // Check if user only has gold branches or only jewelry branches
  const hasOnlyGoldBranches = branches.every(b => b.branch_type === 'gold');
  const hasOnlyJewelryBranches = branches.every(b => b.branch_type === 'jewelry');
  const effectiveBranchType = selectedBranch === 'all' 
    ? (hasOnlyGoldBranches ? 'gold' : hasOnlyJewelryBranches ? 'jewelry' : 'mixed')
    : selectedBranchType;
  const { data: goldPrices } = useQuery({
    queryKey: ['dashboard-gold-prices'],
    queryFn: async () => {
      const res = await fetch('/api/dashboard/gold-prices-with-karats');
      const data = await res.json();
      const latestPrices = new Map();
      data?.forEach((price: any) => {
        if (!latestPrices.has(price.karat_id)) {
          latestPrices.set(price.karat_id, price);
        }
      });
      return Array.from(latestPrices.values()).sort(
        (a: any, b: any) => (b.gold_karats?.karat_value || 0) - (a.gold_karats?.karat_value || 0)
      );
    },
    enabled: effectiveBranchType === 'gold' || effectiveBranchType === 'mixed',
  });

  const hasGoldPrices = goldPrices && goldPrices.length > 0;


  // Get branch IDs filtered by type
  const goldBranchIds = branches.filter(b => b.branch_type === 'gold').map(b => b.id);
  const jewelryBranchIds = branches.filter(b => b.branch_type === 'jewelry').map(b => b.id);
  const relevantBranchIds = effectiveBranchType === 'gold' 
    ? goldBranchIds 
    : effectiveBranchType === 'jewelry' 
      ? jewelryBranchIds 
      : branches.map(b => b.id);

  const { data: stats } = useQuery({
    queryKey: ['dashboard-stats', effectiveBranchType, relevantBranchIds],
    queryFn: async () => {
      const branchIds = relevantBranchIds.length > 0 && effectiveBranchType !== 'mixed' 
        ? relevantBranchIds 
        : undefined;
      const { data, error } = await dataGateway.fetchDashboardStats(branchIds);
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: branches.length > 0,
  });

  const { data: branchStats } = useQuery({
    queryKey: ['branch-stats', selectedBranch],
    queryFn: async () => {
      const params = selectedBranch === 'all' ? '' : `?branch_id=${selectedBranch}`;
      const res = await fetch(`/api/dashboard/branch-stats${params}`);
      const data = await res.json();
      if (data.byBranch && typeof data.byBranch === 'object' && !(data.byBranch instanceof Map)) {
        data.byBranch = new Map(Object.entries(data.byBranch));
      }
      return data;
    },
  });

  const { data: recentBatches } = useQuery({
    queryKey: ['recent-batches'],
    queryFn: async () => {
      const res = await fetch('/api/purchase-batches?limit=5');
      const data = await res.json();
      return Array.isArray(data) ? data : (data?.data || []);
    },
  });

  const { data: recentSales } = useQuery({
    queryKey: ['recent-sales', effectiveBranchType, relevantBranchIds],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '10' });
      if (relevantBranchIds.length > 0 && effectiveBranchType !== 'mixed') {
        params.set('branch_ids', relevantBranchIds.join(','));
      }
      const res = await fetch(`/api/dashboard/recent-sales?${params}`);
      return await res.json() || [];
    },
    enabled: branches.length > 0,
  });

  const { data: recentTransfers = [] } = useQuery({
    queryKey: ['recent-transfers'],
    queryFn: async () => {
      const res = await fetch('/api/dashboard/recent-transfers');
      return await res.json() || [];
    },
  });

  const { data: pendingTransferRequests = [] } = useQuery({
    queryKey: ['pending-transfer-requests', isAdmin],
    queryFn: async () => {
      if (!user?.id) return [];
      const res = await fetch('/api/dashboard/pending-transfer-requests');
      const data = await res.json();
      return (data || []).map((r: any) => ({
        ...r,
        requester_name: r.requester_name || 'غير معروف',
        items_count: r.items_count || 0,
      }));
    },
  });

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      DRAFT: 'status-draft',
      VALIDATED: 'status-validated',
      IMPORTED: 'status-imported',
      FAILED: 'status-failed',
    };
    const labels: Record<string, string> = {
      DRAFT: t.batch.draft,
      VALIDATED: t.batch.validated,
      IMPORTED: t.batch.imported,
      FAILED: t.batch.failed,
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || ''}`}>
        {labels[status] || status}
      </span>
    );
  };

  const selectedBranchName = selectedBranch === 'all' 
    ? t.dashboard.allBranches 
    : branches.find(b => b.id === selectedBranch)?.branch_name || '';

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6 animate-fade-in">
        {/* Header */}
        <div className="page-header action-bar">
          <div>
            <h1 className="page-title">{t.dashboard.title}</h1>
            <p className="page-description">
              {isAdmin 
                ? t.dashboard.welcomeAdmin 
                : `${t.dashboard.welcomeUser} - ${primaryBranch?.branch_name || ''}`}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 w-full sm:w-auto">
            <Link to="/auth" className="w-full sm:w-auto">
              <Button variant="outline" className="gap-2 w-full sm:w-auto min-h-[44px] sm:min-h-0">
                <ShoppingCart className="w-4 h-4" />
                {t.dashboard.pointOfSale}
              </Button>
            </Link>
            {isAdmin && (
              <Link to="/import" className="w-full sm:w-auto">
                <Button className="bg-gradient-gold text-navy hover:opacity-90 shadow-gold w-full sm:w-auto min-h-[44px] sm:min-h-0">
                  <Upload className="w-4 h-4 ml-2" />
                  {t.dashboard.importNewItems}
                </Button>
              </Link>
            )}
          </div>
        </div>

        {/* Branch Selector - Show only for admins or users with multiple branches */}
        {(isAdmin || userBranches.length > 1) && (
          <Card className="mb-4 md:mb-6">
            <CardContent className="p-3 md:p-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4">
              <div className="flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm font-medium whitespace-nowrap">{t.dashboard.selectBranch}</span>
                </div>
                <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                  <SelectTrigger className="w-full sm:w-64">
                    <SelectValue placeholder={t.dashboard.allBranches} />
                  </SelectTrigger>
                  <SelectContent>
                    {isAdmin && <SelectItem value="all">{t.dashboard.allBranches}</SelectItem>}
                    {branches.map((branch) => (
                      <SelectItem key={branch.id} value={branch.id}>
                        {branch.branch_name} ({branch.branch_code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Transfer Requests Notifications */}
        {pendingTransferRequests.length > 0 && (
          <Card className="mb-4 md:mb-6 border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20">
            <CardHeader className="pb-2 md:pb-3 px-3 md:px-6 pt-3 md:pt-6">
              <CardTitle className="text-base md:text-lg flex flex-wrap items-center gap-2 text-amber-700 dark:text-amber-400">
                <Bell className="w-4 h-4 md:w-5 md:h-5 flex-shrink-0" />
                <span>{t.dashboard.pendingRequests}</span>
                <span className="bg-amber-500 text-white text-xs px-2 py-0.5 rounded-full">
                  {pendingTransferRequests.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 px-3 md:px-6 pb-3 md:pb-6">
              <div className="space-y-2 md:space-y-3">
                {pendingTransferRequests.map((request: any) => (
                  <div 
                    key={request.id} 
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-2.5 md:p-3 bg-background rounded-lg border gap-2 sm:gap-3"
                  >
                    <div className="flex items-center gap-2 md:gap-3">
                      <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center flex-shrink-0">
                        <Clock className="w-4 h-4 md:w-5 md:h-5 text-amber-600 dark:text-amber-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-xs md:text-sm truncate">
                          طلب نقل من {request.requester_name}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {request.from_branch?.branch_name || 'المخزن الرئيسي'} ← {request.to_branch?.branch_name}
                          {' • '}
                          {request.items_count} قطعة
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(request.requested_at).toLocaleDateString('ar-SA')}
                        </p>
                      </div>
                    </div>
                    <Link to="/transfer-requests" className="self-end sm:self-auto">
                      <Button size="sm" variant="outline" className="gap-1 min-h-[36px] text-xs md:text-sm">
                        <ArrowRightLeft className="w-3.5 h-3.5 md:w-4 md:h-4" />
                        عرض
                      </Button>
                    </Link>
                  </div>
                ))}
              </div>
              {pendingTransferRequests.length > 0 && (
                <div className="mt-2 md:mt-3 text-center">
                  <Link to="/transfer-requests">
                    <Button variant="link" className="text-amber-600 dark:text-amber-400 text-sm">
                      عرض جميع الطلبات
                      <ArrowLeft className="w-4 h-4 mr-1" />
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Gold Prices Card - Only for gold branches */}
        {(effectiveBranchType === 'gold' || effectiveBranchType === 'mixed') && (
          <Card className="mb-4 md:mb-6 border-amber-200 dark:border-amber-800 bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-amber-950/30 dark:to-amber-900/20">
            <CardHeader className="pb-2 md:pb-3 px-3 md:px-6 pt-3 md:pt-6">
              <CardTitle className="text-base md:text-lg flex items-center justify-between">
                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                  <Sparkles className="w-4 h-4 md:w-5 md:h-5" />
                  <span>أسعار الذهب الحالية</span>
                </div>
                <Link to="/gold/prices">
                  <Button variant="outline" size="sm" className="text-xs border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/50">
                    تعديل الأسعار
                  </Button>
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 px-3 md:px-6 pb-3 md:pb-6">
              {hasGoldPrices ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {goldPrices.map((price: any) => (
                    <div 
                      key={price.id} 
                      className="bg-white dark:bg-background rounded-lg p-3 border border-amber-200 dark:border-amber-800 text-center"
                    >
                      <div className="text-lg font-bold text-amber-600 dark:text-amber-400">
                        {price.gold_karats?.karat_name || `${price.gold_karats?.karat_value}K`}
                      </div>
                      <div className="text-xs text-muted-foreground mb-1">سعر الجرام</div>
                      <div className="text-sm font-semibold">{(Number(price.sell_price_per_gram) || 0).toLocaleString()} ر.س/جم</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-4">
                  <div className="flex items-center justify-center gap-2 text-amber-600 dark:text-amber-400 mb-2">
                    <Bell className="w-5 h-5" />
                    <span className="font-medium">لم يتم تسجيل أسعار الذهب بعد</span>
                  </div>
                  <Link to="/gold/prices">
                    <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white">
                      إضافة الأسعار
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Overall Stats - Hidden for gold branches */}
        {effectiveBranchType !== 'gold' && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 md:gap-4 mb-4 md:mb-6 auto-rows-fr">
            <Card className="card-hover border-0 shadow-md stat-card-flexible">
              <CardContent className="p-3 md:p-4 h-full">
                <div className="flex items-center justify-between gap-2 h-full">
                  <div className="flex-1">
                    <p className="stat-value-auto">{(stats?.totalItems ?? 0).toLocaleString()}</p>
                    <p className="stat-label">إجمالي القطع</p>
                  </div>
                  <Package className="w-6 h-6 md:w-8 md:h-8 text-primary/50 flex-shrink-0" />
                </div>
              </CardContent>
            </Card>

            {/* Sets - Only for jewelry branches */}
            <Card className="card-hover border-0 shadow-md stat-card-flexible">
              <CardContent className="p-3 md:p-4 h-full">
                <div className="flex items-center justify-between gap-2 h-full">
                  <div className="flex-1">
                    <p className="stat-value-auto">{(stats?.totalSets ?? 0).toLocaleString()}</p>
                    <p className="stat-label">الأطقم</p>
                  </div>
                  <Layers className="w-6 h-6 md:w-8 md:h-8 text-primary/50 flex-shrink-0" />
                </div>
              </CardContent>
            </Card>

            <Card className="card-hover border-0 shadow-md stat-card-flexible">
              <CardContent className="p-3 md:p-4 h-full">
                <div className="flex items-center justify-between gap-2 h-full">
                  <div className="flex-1">
                    <p className="stat-value-auto">{branches.length}</p>
                    <p className="stat-label">الفروع</p>
                  </div>
                  <Building2 className="w-6 h-6 md:w-8 md:h-8 text-primary/50 flex-shrink-0" />
                </div>
              </CardContent>
            </Card>

            <Card className="card-hover border-0 shadow-md stat-card-flexible">
              <CardContent className="p-3 md:p-4 h-full">
                <div className="flex items-center justify-between gap-2 h-full">
                  <div className="flex-1">
                    <p className="stat-value-auto">{(stats?.totalCustomers ?? 0).toLocaleString()}</p>
                    <p className="stat-label">العملاء</p>
                  </div>
                  <Users className="w-6 h-6 md:w-8 md:h-8 text-primary/50 flex-shrink-0" />
                </div>
              </CardContent>
            </Card>

            <Card className="card-hover border-0 shadow-md stat-card-flexible">
              <CardContent className="p-3 md:p-4 h-full">
                <div className="flex items-center justify-between gap-2 h-full">
                  <div className="flex-1">
                    <p className="stat-value-auto">{(stats?.totalSales ?? 0).toLocaleString()}</p>
                    <p className="stat-label">عمليات البيع</p>
                  </div>
                  <ShoppingCart className="w-6 h-6 md:w-8 md:h-8 text-primary/50 flex-shrink-0" />
                </div>
              </CardContent>
            </Card>

            <Card className="card-hover border-0 shadow-md stat-card-flexible">
              <CardContent className="p-3 md:p-4 h-full">
                <div className="flex items-center justify-between gap-2 h-full">
                  <div className="flex-1">
                    <p className="stat-value-auto">{formatCurrency(stats?.totalSalesAmount || 0)}</p>
                    <p className="stat-label">إجمالي المبيعات</p>
                  </div>
                  <Banknote className="w-6 h-6 md:w-8 md:h-8 text-primary/50 flex-shrink-0" />
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Branch Details or Branch Summary */}
        {selectedBranch === 'all' ? (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Building2 className="w-5 h-5" />
                ملخص الفروع
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>الفرع</th>
                      {effectiveBranchType === 'mixed' && <th>النوع</th>}
                      <th>عدد القطع</th>
                      {effectiveBranchType !== 'jewelry' && <th>وزن الذهب</th>}
                      <th>قيمة المخزون</th>
                      <th>عمليات البيع</th>
                      <th>قيمة المبيعات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {branches
                      .filter(branch => effectiveBranchType === 'mixed' || branch.branch_type === effectiveBranchType)
                      .map((branch) => {
                        const data = branchStats?.byBranch?.get(branch.id);
                        return (
                          <tr key={branch.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedBranch(branch.id)}>
                            <td className="font-medium">{branch.branch_name}</td>
                            {effectiveBranchType === 'mixed' && (
                              <td>
                                <span className={`px-2 py-1 rounded-full text-xs ${branch.branch_type === 'gold' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300' : 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300'}`}>
                                  {branch.branch_type === 'gold' ? 'ذهب' : 'مجوهرات'}
                                </span>
                              </td>
                            )}
                            <td>{formatNumber(data?.items || 0)}</td>
                            {effectiveBranchType !== 'jewelry' && <td>{(data?.g_weight || 0).toFixed(2)} g</td>}
                            <td>{formatCurrency(data?.cost || 0)}</td>
                            <td>{data?.sales_count || 0}</td>
                            <td>{formatCurrency(data?.sales_amount || 0)}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 md:gap-4 mb-6 auto-rows-fr">
            <Card className="bg-primary/5 border-primary/20 stat-card-flexible">
              <CardContent className="p-3 md:p-4 h-full">
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <Package className="w-5 h-5 md:w-6 md:h-6 mb-2 text-primary" />
                  <p className="stat-value-auto">{(branchStats?.selected?.totalItems ?? 0).toLocaleString()}</p>
                  <p className="stat-label">القطع في {selectedBranchName}</p>
                </div>
              </CardContent>
            </Card>

            {/* Gold Weight - Only for gold branches */}
            {selectedBranchType === 'gold' && (
              <Card className="bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 stat-card-flexible">
                <CardContent className="p-3 md:p-4 h-full">
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <Sparkles className="w-5 h-5 md:w-6 md:h-6 mb-2 text-amber-600 dark:text-amber-400" />
                    <p className="stat-value-auto">{(branchStats?.selected?.totalGWeight || 0).toFixed(2)}</p>
                    <p className="stat-label">وزن الذهب (جم)</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Diamond Weight - Only for jewelry branches */}
            {selectedBranchType === 'jewelry' && (
              <Card className="bg-primary/5 border-primary/20 stat-card-flexible">
                <CardContent className="p-3 md:p-4 h-full">
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <Scale className="w-5 h-5 md:w-6 md:h-6 mb-2 text-primary" />
                    <p className="stat-value-auto">{(branchStats?.selected?.totalGWeight || 0).toFixed(2)}</p>
                    <p className="stat-label">الوزن (جم)</p>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="bg-primary/5 border-primary/20 stat-card-flexible">
              <CardContent className="p-3 md:p-4 h-full">
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <Banknote className="w-5 h-5 md:w-6 md:h-6 mb-2 text-primary" />
                  <p className="stat-value-auto">{formatCurrency(branchStats?.selected?.totalCost || 0)}</p>
                  <p className="stat-label">قيمة المخزون</p>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-primary/5 border-primary/20 stat-card-flexible">
              <CardContent className="p-3 md:p-4 h-full">
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <TrendingUp className="w-5 h-5 md:w-6 md:h-6 mb-2 text-primary" />
                  <p className="stat-value-auto">{formatCurrency(branchStats?.selected?.totalTagPrice || 0)}</p>
                  <p className="stat-label">إجمالي سعر البيع</p>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-primary/5 border-primary/20 stat-card-flexible">
              <CardContent className="p-3 md:p-4 h-full">
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <ShoppingCart className="w-5 h-5 md:w-6 md:h-6 mb-2 text-primary" />
                  <p className="stat-value-auto">{branchStats?.selected?.totalSales || 0}</p>
                  <p className="stat-label">عمليات البيع</p>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-primary/5 border-primary/20 stat-card-flexible">
              <CardContent className="p-3 md:p-4 h-full">
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <Banknote className="w-5 h-5 md:w-6 md:h-6 mb-2 text-primary" />
                  <p className="stat-value-auto">{formatCurrency(branchStats?.selected?.totalSalesAmount || 0)}</p>
                  <p className="stat-label">قيمة المبيعات</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Link to="/sales/invoices" className="block">
            <Card className="card-hover border-2 border-dashed border-primary/30 bg-primary/5 cursor-pointer">
              <CardContent className="p-6 text-center">
                <div className="w-14 h-14 rounded-2xl bg-primary/20 mx-auto mb-3 flex items-center justify-center">
                  <FileText className="w-7 h-7 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-1">فواتير المبيعات</h3>
                <p className="text-muted-foreground text-sm">
                  عرض وإدارة فواتير المبيعات العامة
                </p>
              </CardContent>
            </Card>
          </Link>

          {isAdmin && (
            <Link to="/import" className="block">
              <Card className="card-hover border-2 border-dashed border-gold/30 bg-accent/30 cursor-pointer">
                <CardContent className="p-6 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-gold shadow-gold mx-auto mb-3 flex items-center justify-center">
                    <Upload className="w-7 h-7 text-navy" />
                  </div>
                  <h3 className="text-lg font-semibold mb-1">استيراد قطع</h3>
                  <p className="text-muted-foreground text-sm">
                    رفع ملف إكسل لاستيراد القطع
                  </p>
                </CardContent>
              </Card>
            </Link>
          )}

          <Link to="/customers" className="block">
            <Card className="card-hover border border-border bg-card cursor-pointer">
              <CardContent className="p-6 text-center">
                <div className="w-14 h-14 rounded-2xl bg-secondary mx-auto mb-3 flex items-center justify-center">
                  <Users className="w-7 h-7 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold mb-1">العملاء</h3>
                <p className="text-muted-foreground text-sm">
                  إدارة بيانات العملاء ونقاط الولاء
                </p>
              </CardContent>
            </Card>
          </Link>
        </div>

        {/* Recent Sales & Batches */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Recent Sales */}
          <Card className="border-0 shadow-md">
            <CardContent className="p-0">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <h2 className="text-lg font-semibold">
                  آخر المبيعات {effectiveBranchType === 'gold' ? '(الذهب)' : effectiveBranchType === 'jewelry' ? '(المجوهرات)' : ''}
                </h2>
                <Link to="/pos/invoices">
                  <Button variant="ghost" size="sm">
                    عرض الكل
                    <ArrowLeft className="w-4 h-4 mr-2" />
                  </Button>
                </Link>
              </div>
              {recentSales && recentSales.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>رقم الفاتورة</th>
                        <th>الفرع</th>
                        <th>القطع</th>
                        <th>المبلغ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentSales.slice(0, 5).map((sale: any) => (
                        <tr key={sale.id}>
                          <td className="font-mono text-sm">{sale.invoice_number || sale.sale_code}</td>
                          <td>{sale.branches?.branch_name || '-'}</td>
                          <td>{sale.total_items}</td>
                          <td className="font-medium">{(Number(sale.final_amount) || 0).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-8 text-center text-muted-foreground">
                  لا توجد مبيعات بعد
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Batches - Only for admins */}
          {isAdmin && (
            <Card className="border-0 shadow-md">
              <CardContent className="p-0">
                <div className="p-4 border-b border-border flex items-center justify-between">
                  <h2 className="text-lg font-semibold">آخر الدفعات</h2>
                  <Link to="/batches">
                    <Button variant="ghost" size="sm">
                      عرض الكل
                      <ArrowLeft className="w-4 h-4 mr-2" />
                    </Button>
                  </Link>
                </div>
                {recentBatches && recentBatches.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>رقم الدفعة</th>
                          <th>الحالة</th>
                          <th>القطع</th>
                          <th>التاريخ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recentBatches.map((batch) => (
                          <tr key={batch.id}>
                            <td className="font-mono text-sm">{batch.batch_no}</td>
                            <td>{getStatusBadge(batch.status || 'DRAFT')}</td>
                            <td>{batch.imported_rows} / {batch.total_rows}</td>
                            <td className="text-muted-foreground">
                              {new Date(batch.created_at).toLocaleDateString('ar-EG')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-8 text-center text-muted-foreground">
                    لا توجد دفعات بعد
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Recent Transfers - Hidden for gold branches */}
        {effectiveBranchType !== 'gold' && (
          <Card className="border-0 shadow-md">
            <CardContent className="p-0">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <ArrowRightLeft className="w-5 h-5 text-gold" />
                  آخر عمليات النقل
                </h2>
              </div>
              {recentTransfers && recentTransfers.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>من فرع</th>
                        <th>إلى فرع</th>
                        <th>عدد القطع</th>
                        <th>بواسطة</th>
                        <th>التاريخ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentTransfers.map((transfer: any) => (
                        <tr key={transfer.id}>
                          <td>{transfer.from_branch?.branch_name || 'غير محدد'}</td>
                          <td className="font-medium">{transfer.to_branch?.branch_name}</td>
                          <td>{transfer.items_count}</td>
                          <td className="text-muted-foreground">{transfer.transferred_by || '-'}</td>
                          <td className="text-muted-foreground">
                            {new Date(transfer.transfer_date).toLocaleDateString('ar-EG')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-8 text-center text-muted-foreground">
                  لا توجد عمليات نقل بعد
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Dashboard Reports Section */}
        {(dashboardSettings.showBranchDailyPerformance || 
          dashboardSettings.showDailyGoldMovement || 
          dashboardSettings.showSalesVsInventory || 
          dashboardSettings.showLossProductivity || 
          dashboardSettings.showProfitMargin || 
          dashboardSettings.showBestSellingItems || 
          dashboardSettings.showTopCustomers || 
          dashboardSettings.showRisksAlerts) && (
          <Card className="mt-6 border-0 shadow-md">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-lime-600" />
                {isRTL ? 'تقارير لوحة التحكم' : 'Dashboard Reports'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {dashboardSettings.showBranchDailyPerformance && (
                  <Link to="/reports?tab=dashboard&report=branch-daily-performance">
                    <Card className="card-hover border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 cursor-pointer h-full">
                      <CardContent className="p-4">
                        <div className="flex flex-col items-center text-center gap-2">
                          <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center">
                            <Building2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                          </div>
                          <h4 className="font-medium text-sm">{isRTL ? 'الأداء اليومي للفروع' : 'Branch Performance'}</h4>
                          <Button size="sm" variant="outline" className="w-full gap-1 text-xs mt-1">
                            <Play className="w-3 h-3" />
                            {isRTL ? 'عرض' : 'View'}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                )}

                {dashboardSettings.showDailyGoldMovement && (
                  <Link to="/reports?tab=dashboard&report=daily-gold-movement">
                    <Card className="card-hover border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 cursor-pointer h-full">
                      <CardContent className="p-4">
                        <div className="flex flex-col items-center text-center gap-2">
                          <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center">
                            <Coins className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                          </div>
                          <h4 className="font-medium text-sm">{isRTL ? 'حركة الذهب اليومية' : 'Daily Gold Movement'}</h4>
                          <Button size="sm" variant="outline" className="w-full gap-1 text-xs mt-1">
                            <Play className="w-3 h-3" />
                            {isRTL ? 'عرض' : 'View'}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                )}

                {dashboardSettings.showSalesVsInventory && (
                  <Link to="/reports?tab=dashboard&report=sales-vs-inventory">
                    <Card className="card-hover border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 cursor-pointer h-full">
                      <CardContent className="p-4">
                        <div className="flex flex-col items-center text-center gap-2">
                          <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center">
                            <BarChart3 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                          </div>
                          <h4 className="font-medium text-sm">{isRTL ? 'المبيعات vs المخزون' : 'Sales vs Inventory'}</h4>
                          <Button size="sm" variant="outline" className="w-full gap-1 text-xs mt-1">
                            <Play className="w-3 h-3" />
                            {isRTL ? 'عرض' : 'View'}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                )}

                {dashboardSettings.showLossProductivity && (
                  <Link to="/reports?tab=dashboard&report=loss-productivity">
                    <Card className="card-hover border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20 cursor-pointer h-full">
                      <CardContent className="p-4">
                        <div className="flex flex-col items-center text-center gap-2">
                          <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/50 flex items-center justify-center">
                            <TrendingDown className="w-5 h-5 text-red-600 dark:text-red-400" />
                          </div>
                          <h4 className="font-medium text-sm">{isRTL ? 'الفاقد والإنتاجية' : 'Loss & Productivity'}</h4>
                          <Button size="sm" variant="outline" className="w-full gap-1 text-xs mt-1">
                            <Play className="w-3 h-3" />
                            {isRTL ? 'عرض' : 'View'}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                )}

                {dashboardSettings.showProfitMargin && (
                  <Link to="/reports?tab=dashboard&report=profit-margin">
                    <Card className="card-hover border border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20 cursor-pointer h-full">
                      <CardContent className="p-4">
                        <div className="flex flex-col items-center text-center gap-2">
                          <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/50 flex items-center justify-center">
                            <DollarSign className="w-5 h-5 text-green-600 dark:text-green-400" />
                          </div>
                          <h4 className="font-medium text-sm">{isRTL ? 'هامش الربح' : 'Profit Margin'}</h4>
                          <Button size="sm" variant="outline" className="w-full gap-1 text-xs mt-1">
                            <Play className="w-3 h-3" />
                            {isRTL ? 'عرض' : 'View'}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                )}

                {dashboardSettings.showBestSellingItems && (
                  <Link to="/reports?tab=dashboard&report=best-selling-items">
                    <Card className="card-hover border border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-950/20 cursor-pointer h-full">
                      <CardContent className="p-4">
                        <div className="flex flex-col items-center text-center gap-2">
                          <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900/50 flex items-center justify-center">
                            <Trophy className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                          </div>
                          <h4 className="font-medium text-sm">{isRTL ? 'أفضل الأصناف مبيعاً' : 'Best Selling Items'}</h4>
                          <Button size="sm" variant="outline" className="w-full gap-1 text-xs mt-1">
                            <Play className="w-3 h-3" />
                            {isRTL ? 'عرض' : 'View'}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                )}

                {dashboardSettings.showTopCustomers && (
                  <Link to="/reports?tab=dashboard&report=top-customers">
                    <Card className="card-hover border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/20 cursor-pointer h-full">
                      <CardContent className="p-4">
                        <div className="flex flex-col items-center text-center gap-2">
                          <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center">
                            <Users className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                          </div>
                          <h4 className="font-medium text-sm">{isRTL ? 'أعلى العملاء شراءً' : 'Top Customers'}</h4>
                          <Button size="sm" variant="outline" className="w-full gap-1 text-xs mt-1">
                            <Play className="w-3 h-3" />
                            {isRTL ? 'عرض' : 'View'}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                )}

                {dashboardSettings.showRisksAlerts && (
                  <Link to="/reports?tab=dashboard&report=risks-alerts">
                    <Card className="card-hover border border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-950/20 cursor-pointer h-full">
                      <CardContent className="p-4">
                        <div className="flex flex-col items-center text-center gap-2">
                          <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900/50 flex items-center justify-center">
                            <AlertTriangle className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                          </div>
                          <h4 className="font-medium text-sm">{isRTL ? 'المخاطر والتنبيهات' : 'Risks & Alerts'}</h4>
                          <Button size="sm" variant="outline" className="w-full gap-1 text-xs mt-1">
                            <Play className="w-3 h-3" />
                            {isRTL ? 'عرض' : 'View'}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </MainLayout>
  );
}
