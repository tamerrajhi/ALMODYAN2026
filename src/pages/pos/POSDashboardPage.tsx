import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import POSLayout from "@/components/pos/POSLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ShoppingCart, TrendingUp, Users, Building2, Package,
  Clock, AlertTriangle, ArrowLeft, CalendarDays, Loader2,
} from "lucide-react";
import { dashboardWidgets } from "@/config/posDashboard";

type DateRange = { start: string; end: string; label: string };

function todayISO() { return new Date().toISOString().slice(0, 10); }
function daysAgoISO(n: number) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); }
function monthStartISO() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); }

const QUICK_RANGES: DateRange[] = [
  { start: todayISO(), end: todayISO(), label: "اليوم" },
  { start: daysAgoISO(7), end: todayISO(), label: "آخر 7 أيام" },
  { start: monthStartISO(), end: todayISO(), label: "هذا الشهر" },
];

function fmt(n: number | string | null | undefined): string {
  const v = typeof n === 'string' ? parseFloat(n) : (n ?? 0);
  return v.toLocaleString('ar-SA', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function useDashboardQuery<T>(key: string, endpoint: string, dateRange: DateRange, extra?: Record<string, string>) {
  const params = new URLSearchParams({ start: dateRange.start, end: dateRange.end, ...extra });
  return useQuery<T>({
    queryKey: ['pos-dashboard', key, dateRange.start, dateRange.end, extra],
    queryFn: async () => {
      const res = await fetch(`/api/pos/admin/dashboard/${endpoint}?${params}`, { credentials: 'include' });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error?.message || 'خطأ في تحميل البيانات');
      return json.data;
    },
  });
}

function KPICard({ label, value, icon: Icon, color }: { label: string; value: string; icon: any; color: string }) {
  return (
    <div className={`flex items-center gap-3 p-4 rounded-xl border bg-gradient-to-br ${color}`}>
      <div className="p-2.5 rounded-lg bg-white/80 dark:bg-gray-800/80 shadow-sm">
        <Icon className="h-5 w-5 text-gray-700 dark:text-gray-200" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">{label}</p>
        <p className="text-lg font-bold text-gray-900 dark:text-white truncate" data-testid={`kpi-${label}`}>{value}</p>
      </div>
    </div>
  );
}

function TodayKPIs({ dateRange }: { dateRange: DateRange }) {
  const { data, isLoading } = useDashboardQuery<any>('today-kpis', 'today-kpis', dateRange);
  if (isLoading) return <WidgetSkeleton />;
  if (!data) return null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      <KPICard label="عدد المبيعات" value={fmt(data.sales_count)} icon={ShoppingCart} color="from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border-blue-200 dark:border-blue-800" />
      <KPICard label="الإيرادات" value={fmt(data.revenue) + ' ر.س'} icon={TrendingUp} color="from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border-green-200 dark:border-green-800" />
      <KPICard label="الضريبة" value={fmt(data.tax) + ' ر.س'} icon={CalendarDays} color="from-amber-50 to-yellow-50 dark:from-amber-900/20 dark:to-yellow-900/20 border-amber-200 dark:border-amber-800" />
      <KPICard label="الخصومات" value={fmt(data.discounts) + ' ر.س'} icon={ArrowLeft} color="from-orange-50 to-red-50 dark:from-orange-900/20 dark:to-red-900/20 border-orange-200 dark:border-orange-800" />
      <KPICard label="صافي المبيعات" value={fmt(data.net_sales) + ' ر.س'} icon={TrendingUp} color="from-teal-50 to-cyan-50 dark:from-teal-900/20 dark:to-cyan-900/20 border-teal-200 dark:border-teal-800" />
      <KPICard label="المرتجعات" value={fmt(data.returns_amount) + ' ر.س'} icon={ArrowLeft} color="from-red-50 to-rose-50 dark:from-red-900/20 dark:to-rose-900/20 border-red-200 dark:border-red-800" />
    </div>
  );
}

function ProfitSnapshot({ dateRange }: { dateRange: DateRange }) {
  const { data, isLoading } = useDashboardQuery<any>('profit-snapshot', 'profit-snapshot', dateRange);
  if (isLoading) return <WidgetSkeleton />;
  if (!data) return null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <KPICard label="الإيرادات" value={fmt(data.revenue) + ' ر.س'} icon={TrendingUp} color="from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 border-blue-200 dark:border-blue-800" />
      <KPICard label="تكلفة البضاعة" value={fmt(data.cogs) + ' ر.س'} icon={Package} color="from-gray-50 to-gray-100 dark:from-gray-900/20 dark:to-gray-800/20 border-gray-200 dark:border-gray-700" />
      <KPICard label="صافي الربح" value={fmt(data.net_profit) + ' ر.س'} icon={TrendingUp} color="from-emerald-50 to-green-100 dark:from-emerald-900/20 dark:to-green-800/20 border-emerald-200 dark:border-emerald-800" />
      <KPICard label="هامش الربح" value={data.gp_percent + '%'} icon={TrendingUp} color="from-purple-50 to-violet-100 dark:from-purple-900/20 dark:to-violet-800/20 border-purple-200 dark:border-purple-800" />
    </div>
  );
}

function TopSellers({ dateRange }: { dateRange: DateRange }) {
  const { data, isLoading } = useDashboardQuery<any>('top-sellers', 'top-sellers', dateRange);
  if (isLoading) return <WidgetSkeleton />;
  const sellers = data?.sellers || [];
  if (sellers.length === 0) return <EmptyState text="لا توجد بيانات مبيعات" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="table-top-sellers">
        <thead><tr className="border-b text-gray-500 dark:text-gray-400">
          <th className="text-right py-2 px-3 font-medium">البائع</th>
          <th className="text-right py-2 px-3 font-medium">الإيرادات</th>
          <th className="text-right py-2 px-3 font-medium">التكلفة</th>
          <th className="text-right py-2 px-3 font-medium">صافي الربح</th>
        </tr></thead>
        <tbody>
          {sellers.map((s: any, i: number) => (
            <tr key={s.seller_id} className="border-b last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50" data-testid={`row-seller-${i}`}>
              <td className="py-2.5 px-3 font-medium">{s.seller_name}</td>
              <td className="py-2.5 px-3">{fmt(s.revenue)} ر.س</td>
              <td className="py-2.5 px-3">{fmt(s.cogs)} ر.س</td>
              <td className="py-2.5 px-3 font-semibold text-emerald-600 dark:text-emerald-400">{fmt(s.net_profit)} ر.س</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TopBranches({ dateRange }: { dateRange: DateRange }) {
  const { data, isLoading } = useDashboardQuery<any>('top-branches', 'top-branches', dateRange);
  if (isLoading) return <WidgetSkeleton />;
  const branches = data?.branches || [];
  if (branches.length === 0) return <EmptyState text="لا توجد بيانات مبيعات" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="table-top-branches">
        <thead><tr className="border-b text-gray-500 dark:text-gray-400">
          <th className="text-right py-2 px-3 font-medium">الفرع</th>
          <th className="text-right py-2 px-3 font-medium">الإيرادات</th>
          <th className="text-right py-2 px-3 font-medium">التكلفة</th>
          <th className="text-right py-2 px-3 font-medium">صافي الربح</th>
        </tr></thead>
        <tbody>
          {branches.map((b: any, i: number) => (
            <tr key={b.branch_id} className="border-b last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50" data-testid={`row-branch-${i}`}>
              <td className="py-2.5 px-3 font-medium">{b.branch_name}</td>
              <td className="py-2.5 px-3">{fmt(b.revenue)} ر.س</td>
              <td className="py-2.5 px-3">{fmt(b.cogs)} ر.س</td>
              <td className="py-2.5 px-3 font-semibold text-emerald-600 dark:text-emerald-400">{fmt(b.net_profit)} ر.س</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InventoryValuation() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ['pos-dashboard', 'inventory-valuation'],
    queryFn: async () => {
      const res = await fetch('/api/pos/admin/dashboard/inventory-valuation', { credentials: 'include' });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error?.message || 'خطأ');
      return json.data;
    },
  });
  if (isLoading) return <WidgetSkeleton />;
  const branches = data?.branches || [];
  if (branches.length === 0) return <EmptyState text="لا يوجد مخزون" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="table-inventory-valuation">
        <thead><tr className="border-b text-gray-500 dark:text-gray-400">
          <th className="text-right py-2 px-3 font-medium">الفرع</th>
          <th className="text-right py-2 px-3 font-medium">عدد القطع</th>
          <th className="text-right py-2 px-3 font-medium">قيمة التكلفة</th>
          <th className="text-right py-2 px-3 font-medium">قيمة البيع</th>
          <th className="text-right py-2 px-3 font-medium">هامش محتمل</th>
        </tr></thead>
        <tbody>
          {branches.map((b: any) => (
            <tr key={b.branch_id} className="border-b last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50">
              <td className="py-2.5 px-3 font-medium">{b.branch_name}</td>
              <td className="py-2.5 px-3">{fmt(b.item_count)}</td>
              <td className="py-2.5 px-3">{fmt(b.total_cost_value)} ر.س</td>
              <td className="py-2.5 px-3">{fmt(b.total_tag_value)} ر.س</td>
              <td className="py-2.5 px-3 font-semibold text-emerald-600 dark:text-emerald-400">{fmt(b.potential_margin)} ر.س</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InventoryAging() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ['pos-dashboard', 'inventory-aging'],
    queryFn: async () => {
      const res = await fetch('/api/pos/admin/dashboard/inventory-aging', { credentials: 'include' });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error?.message || 'خطأ');
      return json.data;
    },
  });
  if (isLoading) return <WidgetSkeleton />;
  if (!data) return null;
  const buckets = [
    { label: '0-30 يوم', value: data.age_0_30, color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
    { label: '31-60 يوم', value: data.age_31_60, color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' },
    { label: '61-90 يوم', value: data.age_61_90, color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300' },
    { label: 'أكثر من 90 يوم', value: data.age_over_90, color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {buckets.map(b => (
          <div key={b.label} className={`rounded-lg p-3 text-center ${b.color}`} data-testid={`aging-${b.label}`}>
            <p className="text-2xl font-bold">{fmt(b.value)}</p>
            <p className="text-xs mt-1">{b.label}</p>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <span>إجمالي في المخزون: <strong>{fmt(data.total_in_stock)}</strong></span>
        <span>|</span>
        <span>قيمة التكلفة: <strong>{fmt(data.total_cost)} ر.س</strong></span>
        {parseFloat(data.aging_cost_over_90) > 0 && (
          <>
            <span>|</span>
            <span className="text-red-500">تكلفة الراكد (+90 يوم): <strong>{fmt(data.aging_cost_over_90)} ر.س</strong></span>
          </>
        )}
      </div>
    </div>
  );
}

function Reconciliation({ dateRange }: { dateRange: DateRange }) {
  const { data, isLoading } = useDashboardQuery<any>('reconciliation', 'reconciliation', dateRange);
  if (isLoading) return <WidgetSkeleton />;
  const rows = data?.rows || [];
  if (rows.length === 0) return <EmptyState text="لا توجد فروقات — كل الفواتير مسددة" icon={<Badge variant="outline" className="text-green-600 border-green-300">متطابق</Badge>} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="table-reconciliation">
        <thead><tr className="border-b text-gray-500 dark:text-gray-400">
          <th className="text-right py-2 px-3 font-medium">الفاتورة</th>
          <th className="text-right py-2 px-3 font-medium">الفرع</th>
          <th className="text-right py-2 px-3 font-medium">البائع</th>
          <th className="text-right py-2 px-3 font-medium">مبلغ الفاتورة</th>
          <th className="text-right py-2 px-3 font-medium">المدفوع</th>
          <th className="text-right py-2 px-3 font-medium">الفرق</th>
        </tr></thead>
        <tbody>
          {rows.map((r: any) => (
            <tr key={r.invoice_id} className="border-b last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50">
              <td className="py-2.5 px-3 font-medium">{r.invoice_number}</td>
              <td className="py-2.5 px-3">{r.branch_name}</td>
              <td className="py-2.5 px-3">{r.seller_name || '-'}</td>
              <td className="py-2.5 px-3">{fmt(r.invoice_total)} ر.س</td>
              <td className="py-2.5 px-3">{fmt(r.paid_total)} ر.س</td>
              <td className="py-2.5 px-3 font-semibold text-red-600 dark:text-red-400">{fmt(r.delta)} ر.س</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WidgetSkeleton() {
  return (
    <div className="flex items-center justify-center py-8">
      <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      <span className="mr-2 text-sm text-gray-400">جاري التحميل...</span>
    </div>
  );
}

function EmptyState({ text, icon }: { text: string; icon?: any }) {
  return (
    <div className="flex flex-col items-center justify-center py-6 text-gray-400">
      {icon || <Package className="h-8 w-8 mb-2 opacity-50" />}
      <p className="text-sm">{text}</p>
    </div>
  );
}

const WIDGET_ICONS: Record<string, any> = {
  today_kpis: ShoppingCart,
  profit_snapshot: TrendingUp,
  top_sellers: Users,
  top_branches: Building2,
  inventory_valuation: Package,
  inventory_aging: Clock,
  reconciliation: AlertTriangle,
};

const WIDGET_REPORT_TAB: Record<string, string> = {
  today_kpis: 'seller_net_profit',
  profit_snapshot: 'seller_net_profit',
  top_sellers: 'seller_net_profit',
  top_branches: 'branch_net_profit',
  inventory_valuation: 'inventory_valuation',
  inventory_aging: 'inventory_aging',
  reconciliation: 'reconciliation',
};

const WIDGET_COLORS: Record<string, string> = {
  today_kpis: 'text-blue-600 dark:text-blue-400',
  profit_snapshot: 'text-emerald-600 dark:text-emerald-400',
  top_sellers: 'text-purple-600 dark:text-purple-400',
  top_branches: 'text-indigo-600 dark:text-indigo-400',
  inventory_valuation: 'text-teal-600 dark:text-teal-400',
  inventory_aging: 'text-amber-600 dark:text-amber-400',
  reconciliation: 'text-red-600 dark:text-red-400',
};

export default function POSDashboardPage() {
  const navigate = useNavigate();
  const [dateRange, setDateRange] = useState<DateRange>(QUICK_RANGES[0]);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const { data: widgetConfig } = useQuery<{ widgets: Record<string, boolean> }>({
    queryKey: ["pos-dashboard-widget-config"],
    queryFn: async () => {
      const res = await fetch("/api/pos/admin/settings/dashboard", { credentials: "include" });
      const json = await res.json();
      if (!res.ok || json.error) return { widgets: Object.fromEntries(dashboardWidgets.map(w => [w.key, true])) };
      return json.data;
    },
  });

  const enabledWidgets = useMemo(() => {
    if (!widgetConfig?.widgets) return dashboardWidgets;
    return dashboardWidgets.filter(w => widgetConfig.widgets[w.key] !== false);
  }, [widgetConfig]);

  const applyCustomRange = () => {
    if (customStart && customEnd) {
      setDateRange({ start: customStart, end: customEnd, label: 'مخصص' });
    }
  };

  const renderWidget = (key: string) => {
    switch (key) {
      case 'today_kpis': return <TodayKPIs dateRange={dateRange} />;
      case 'profit_snapshot': return <ProfitSnapshot dateRange={dateRange} />;
      case 'top_sellers': return <TopSellers dateRange={dateRange} />;
      case 'top_branches': return <TopBranches dateRange={dateRange} />;
      case 'inventory_valuation': return <InventoryValuation />;
      case 'inventory_aging': return <InventoryAging />;
      case 'reconciliation': return <Reconciliation dateRange={dateRange} />;
      default: return null;
    }
  };

  return (
    <POSLayout>
      <div className="rtl-mode content-full-width page-container space-y-6 p-4 md:p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white" data-testid="text-dashboard-title">لوحة التحكم</h1>
          <div className="flex flex-wrap items-center gap-2">
            {QUICK_RANGES.map(r => (
              <Button
                key={r.label}
                variant={dateRange.label === r.label ? "default" : "outline"}
                size="sm"
                onClick={() => setDateRange(r)}
                data-testid={`button-range-${r.label}`}
              >
                {r.label}
              </Button>
            ))}
            <div className="flex items-center gap-1">
              <Input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="w-36 h-8 text-sm" data-testid="input-custom-start" />
              <Input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="w-36 h-8 text-sm" data-testid="input-custom-end" />
              <Button size="sm" variant="outline" onClick={applyCustomRange} data-testid="button-apply-custom">تطبيق</Button>
            </div>
          </div>
        </div>

        {enabledWidgets.map(widget => {
          const Icon = WIDGET_ICONS[widget.key] || Package;
          const iconColor = WIDGET_COLORS[widget.key] || 'text-gray-600';
          return (
            <Card key={widget.key} className="overflow-hidden" data-testid={`card-widget-${widget.key}`}>
              <CardHeader className="flex flex-row items-center justify-between py-3 px-4 border-b bg-gray-50/50 dark:bg-gray-800/30">
                <div className="flex items-center gap-2">
                  <Icon className={`h-5 w-5 ${iconColor}`} />
                  <CardTitle className="text-base font-semibold">{widget.title}</CardTitle>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-gray-500 hover:text-gray-700"
                  onClick={() => {
                    const tab = WIDGET_REPORT_TAB[widget.key] || 'seller_net_profit';
                    const params = new URLSearchParams({ tab, start: dateRange.start, end: dateRange.end });
                    navigate(`/pos/reports?${params}`);
                  }}
                  data-testid={`link-details-${widget.key}`}
                >
                  تفاصيل
                </Button>
              </CardHeader>
              <CardContent className="p-4">
                {renderWidget(widget.key)}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </POSLayout>
  );
}
