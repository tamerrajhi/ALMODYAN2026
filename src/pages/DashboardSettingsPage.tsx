import { useState, useEffect } from 'react';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { 
  Settings, 
  LayoutDashboard, 
  Package, 
  TrendingUp, 
  ShoppingCart, 
  ArrowRightLeft,
  Bell,
  Coins,
  Users,
  BarChart3,
  Save,
  RotateCcw,
  Building2,
  TrendingDown,
  DollarSign,
  Trophy,
  AlertTriangle
} from 'lucide-react';

interface DashboardSettings {
  showStatistics: boolean;
  showGoldPrices: boolean;
  showBranchSelector: boolean;
  showPendingRequests: boolean;
  showRecentBatches: boolean;
  showRecentSales: boolean;
  showRecentTransfers: boolean;
  showBranchStats: boolean;
  showQuickActions: boolean;
  // تقارير لوحة التحكم الجديدة
  showBranchDailyPerformance: boolean;
  showDailyGoldMovement: boolean;
  showSalesVsInventory: boolean;
  showLossProductivity: boolean;
  showProfitMargin: boolean;
  showBestSellingItems: boolean;
  showTopCustomers: boolean;
  showRisksAlerts: boolean;
}

const defaultSettings: DashboardSettings = {
  showStatistics: true,
  showGoldPrices: true,
  showBranchSelector: true,
  showPendingRequests: true,
  showRecentBatches: true,
  showRecentSales: true,
  showRecentTransfers: true,
  showBranchStats: true,
  showQuickActions: true,
  // تقارير لوحة التحكم
  showBranchDailyPerformance: true,
  showDailyGoldMovement: true,
  showSalesVsInventory: true,
  showLossProductivity: true,
  showProfitMargin: true,
  showBestSellingItems: true,
  showTopCustomers: true,
  showRisksAlerts: true,
};

const STORAGE_KEY = 'dashboard_settings';

export default function DashboardSettingsPage() {
  const { t, isRTL } = useLanguage();
  const [settings, setSettings] = useState<DashboardSettings>(defaultSettings);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setSettings({ ...defaultSettings, ...JSON.parse(saved) });
      } catch {
        setSettings(defaultSettings);
      }
    }
  }, []);

  const handleToggle = (key: keyof DashboardSettings) => {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }));
    setHasChanges(true);
  };

  const handleSave = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    setHasChanges(false);
    toast.success(isRTL ? 'تم حفظ الإعدادات بنجاح' : 'Settings saved successfully');
  };

  const handleReset = () => {
    setSettings(defaultSettings);
    localStorage.removeItem(STORAGE_KEY);
    setHasChanges(false);
    toast.success(isRTL ? 'تم إعادة تعيين الإعدادات' : 'Settings reset to defaults');
  };

  const settingsGroups = [
    {
      title: isRTL ? 'الإحصائيات والأرقام' : 'Statistics & Numbers',
      items: [
        {
          key: 'showStatistics' as const,
          label: isRTL ? 'إظهار الإحصائيات الرئيسية' : 'Show Main Statistics',
          description: isRTL ? 'عرض إجمالي القطع، الطقومات، العملاء، والمبيعات' : 'Display total items, sets, customers, and sales',
          icon: BarChart3,
        },
        {
          key: 'showBranchStats' as const,
          label: isRTL ? 'إظهار إحصائيات الفروع' : 'Show Branch Statistics',
          description: isRTL ? 'عرض تفاصيل المخزون والمبيعات لكل فرع' : 'Display inventory and sales details per branch',
          icon: Package,
        },
      ],
    },
    {
      title: isRTL ? 'الذهب والأسعار' : 'Gold & Prices',
      items: [
        {
          key: 'showGoldPrices' as const,
          label: isRTL ? 'إظهار أسعار الذهب اليومية' : 'Show Daily Gold Prices',
          description: isRTL ? 'عرض أسعار الشراء والبيع لكل عيار' : 'Display buy and sell prices for each karat',
          icon: Coins,
        },
      ],
    },
    {
      title: isRTL ? 'التنبيهات والطلبات' : 'Notifications & Requests',
      items: [
        {
          key: 'showPendingRequests' as const,
          label: isRTL ? 'إظهار طلبات النقل المعلقة' : 'Show Pending Transfer Requests',
          description: isRTL ? 'عرض الطلبات التي تحتاج موافقة' : 'Display requests awaiting approval',
          icon: Bell,
        },
      ],
    },
    {
      title: isRTL ? 'الأنشطة الأخيرة' : 'Recent Activities',
      items: [
        {
          key: 'showRecentBatches' as const,
          label: isRTL ? 'إظهار آخر الدفعات' : 'Show Recent Batches',
          description: isRTL ? 'عرض آخر دفعات الاستيراد' : 'Display latest import batches',
          icon: Package,
        },
        {
          key: 'showRecentSales' as const,
          label: isRTL ? 'إظهار آخر المبيعات' : 'Show Recent Sales',
          description: isRTL ? 'عرض آخر عمليات البيع' : 'Display latest sales operations',
          icon: ShoppingCart,
        },
        {
          key: 'showRecentTransfers' as const,
          label: isRTL ? 'إظهار آخر التحويلات' : 'Show Recent Transfers',
          description: isRTL ? 'عرض آخر عمليات النقل بين الفروع' : 'Display latest branch transfers',
          icon: ArrowRightLeft,
        },
      ],
    },
    {
      title: isRTL ? 'عناصر التحكم' : 'Controls',
      items: [
        {
          key: 'showBranchSelector' as const,
          label: isRTL ? 'إظهار قائمة اختيار الفرع' : 'Show Branch Selector',
          description: isRTL ? 'عرض قائمة لتصفية البيانات حسب الفرع' : 'Display dropdown to filter data by branch',
          icon: LayoutDashboard,
        },
        {
          key: 'showQuickActions' as const,
          label: isRTL ? 'إظهار الإجراءات السريعة' : 'Show Quick Actions',
          description: isRTL ? 'عرض أزرار الوصول السريع' : 'Display quick access buttons',
          icon: TrendingUp,
        },
      ],
    },
    {
      title: isRTL ? 'تقارير لوحة التحكم' : 'Dashboard Reports',
      items: [
        {
          key: 'showBranchDailyPerformance' as const,
          label: isRTL ? 'الأداء اليومي للفروع' : 'Branch Daily Performance',
          description: isRTL ? 'ملخص أداء جميع الفروع يومياً' : 'Daily summary of all branch performance',
          icon: Building2,
        },
        {
          key: 'showDailyGoldMovement' as const,
          label: isRTL ? 'حركة الذهب اليومية' : 'Daily Gold Movement',
          description: isRTL ? 'حركة الذهب الداخل والخارج يومياً' : 'Daily gold inflow and outflow',
          icon: Coins,
        },
        {
          key: 'showSalesVsInventory' as const,
          label: isRTL ? 'المبيعات مقابل المخزون' : 'Sales vs Inventory',
          description: isRTL ? 'مقارنة بين المبيعات والمخزون المتاح' : 'Compare sales against available inventory',
          icon: BarChart3,
        },
        {
          key: 'showLossProductivity' as const,
          label: isRTL ? 'الفاقد والإنتاجية' : 'Loss & Productivity',
          description: isRTL ? 'تحليل نسب الفاقد ومعدلات الإنتاجية' : 'Analyze loss rates and productivity',
          icon: TrendingDown,
        },
        {
          key: 'showProfitMargin' as const,
          label: isRTL ? 'هامش الربح' : 'Profit Margin',
          description: isRTL ? 'هامش الربح يومي/أسبوعي/شهري' : 'Daily/weekly/monthly profit margin',
          icon: DollarSign,
        },
        {
          key: 'showBestSellingItems' as const,
          label: isRTL ? 'أفضل الأصناف مبيعاً' : 'Best Selling Items',
          description: isRTL ? 'ترتيب الأصناف حسب المبيعات' : 'Rank items by sales',
          icon: Trophy,
        },
        {
          key: 'showTopCustomers' as const,
          label: isRTL ? 'أعلى العملاء شراءً' : 'Top Customers',
          description: isRTL ? 'ترتيب العملاء حسب حجم المشتريات' : 'Rank customers by purchase volume',
          icon: Users,
        },
        {
          key: 'showRisksAlerts' as const,
          label: isRTL ? 'المخاطر والتنبيهات' : 'Risks & Alerts',
          description: isRTL ? 'التنبيهات والمخاطر التي تحتاج متابعة' : 'Alerts and risks requiring attention',
          icon: AlertTriangle,
        },
      ],
    },
  ];

  return (
    <MainLayout>
      <div className="animate-fade-in">
        {/* Header */}
        <div className="page-header action-bar">
          <div>
            <h1 className="page-title flex items-center gap-2">
              <Settings className="w-6 h-6" />
              {isRTL ? 'إعدادات الشاشة الرئيسية' : 'Dashboard Settings'}
            </h1>
            <p className="page-description">
              {isRTL 
                ? 'تخصيص العناصر المعروضة في الشاشة الرئيسية'
                : 'Customize the elements displayed on the dashboard'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              onClick={handleReset}
              className="gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              {isRTL ? 'إعادة تعيين' : 'Reset'}
            </Button>
            <Button 
              onClick={handleSave}
              disabled={!hasChanges}
              className="gap-2 bg-gradient-gold text-navy hover:opacity-90"
            >
              <Save className="w-4 h-4" />
              {isRTL ? 'حفظ الإعدادات' : 'Save Settings'}
            </Button>
          </div>
        </div>

        {/* Settings Groups */}
        <div className="grid gap-4 md:gap-6">
          {settingsGroups.map((group, groupIndex) => (
            <Card key={groupIndex}>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">{group.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {group.items.map((item) => (
                  <div 
                    key={item.key}
                    className="flex items-center justify-between p-3 rounded-lg border bg-muted/20 hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <item.icon className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <Label htmlFor={item.key} className="text-sm font-medium cursor-pointer">
                          {item.label}
                        </Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {item.description}
                        </p>
                      </div>
                    </div>
                    <Switch
                      id={item.key}
                      checked={settings[item.key]}
                      onCheckedChange={() => handleToggle(item.key)}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Preview Note */}
        <Card className="mt-6 border-dashed">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                <LayoutDashboard className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h4 className="font-medium text-sm">
                  {isRTL ? 'ملاحظة' : 'Note'}
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  {isRTL 
                    ? 'ستظهر التغييرات في الشاشة الرئيسية بعد حفظ الإعدادات والعودة إليها.'
                    : 'Changes will appear on the dashboard after saving settings and returning to it.'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}

export function useDashboardSettings(): DashboardSettings {
  const [settings, setSettings] = useState<DashboardSettings>(defaultSettings);
  
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setSettings({ ...defaultSettings, ...JSON.parse(saved) });
      } catch {
        setSettings(defaultSettings);
      }
    }
  }, []);
  
  return settings;
}
