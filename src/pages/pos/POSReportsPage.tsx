import { useState, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import POSLayout from "@/components/pos/POSLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, BarChart3, Download, Users, Building2, Package, Clock, AlertTriangle, CreditCard, ShoppingCart, TrendingUp } from "lucide-react";

type DateRange = { start: string; end: string; label: string };

function todayISO() { return new Date().toISOString().slice(0, 10); }
function daysAgoISO(n: number) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); }
function monthStartISO() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); }

const QUICK_RANGES: DateRange[] = [
  { start: todayISO(), end: todayISO(), label: "اليوم" },
  { start: daysAgoISO(7), end: todayISO(), label: "آخر 7 أيام" },
  { start: monthStartISO(), end: todayISO(), label: "هذا الشهر" },
];

const TABS = [
  { key: "seller_net_profit", label: "أرباح البائعين", icon: Users },
  { key: "branch_net_profit", label: "أرباح الفروع", icon: Building2 },
  { key: "inventory_valuation", label: "تقييم المخزون", icon: Package },
  { key: "inventory_aging", label: "عمر المخزون", icon: Clock },
  { key: "returns_summary", label: "ملخص المرتجعات", icon: AlertTriangle },
  { key: "reconciliation", label: "مطابقة الفواتير", icon: AlertTriangle },
  { key: "payment_mix", label: "توزيع الدفعات", icon: CreditCard },
  { key: "sold_items_margin", label: "هوامش القطع المباعة", icon: ShoppingCart },
];

function fmt(n: number | string | null | undefined): string {
  const v = typeof n === "string" ? parseFloat(n) : (n ?? 0);
  return v.toLocaleString("ar-SA", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function exportCSV(headers: string[], rows: any[][], filename: string) {
  const bom = "\uFEFF";
  const csv = bom + [headers.join(","), ...rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function useReportQuery<T>(endpoint: string, dateRange: DateRange, extra?: Record<string, string>, skipDates?: boolean) {
  const params = new URLSearchParams(skipDates ? {} : { start: dateRange.start, end: dateRange.end });
  if (extra) Object.entries(extra).forEach(([k, v]) => { if (v) params.set(k, v); });
  return useQuery<T>({
    queryKey: ["pos-report", endpoint, dateRange.start, dateRange.end, extra],
    queryFn: async () => {
      const res = await fetch(`/api/pos/admin/reports/${endpoint}?${params}`, { credentials: "include" });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error?.message || "خطأ");
      return json.data;
    },
  });
}

function LoadingState() {
  return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /><span className="mr-2 text-sm text-gray-400">جاري التحميل...</span></div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="flex flex-col items-center justify-center py-10 text-gray-400"><Package className="h-8 w-8 mb-2 opacity-50" /><p className="text-sm">{text}</p></div>;
}

function SellerNetProfitTab({ dateRange, filters }: { dateRange: DateRange; filters: Record<string, string> }) {
  const { data, isLoading } = useReportQuery<any>("seller-net-profit", dateRange, filters);
  if (isLoading) return <LoadingState />;
  const sellers = data?.sellers || [];
  if (sellers.length === 0) return <EmptyState text="لا توجد بيانات مبيعات" />;
  return (
    <div>
      <div className="flex justify-end mb-3">
        <Button variant="outline" size="sm" data-testid="button-export-seller" onClick={() => exportCSV(
          ["البائع", "عدد المبيعات", "الإيرادات", "التكلفة", "إجمالي الربح", "مرتجعات", "صافي الربح", "هامش %"],
          sellers.map((s: any) => [s.seller_name, s.sale_count, s.revenue, s.cogs, s.gross_profit, s.return_amount, s.net_profit, s.gp_percent]),
          `seller-profit-${dateRange.start}.csv`
        )}>
          <Download className="h-4 w-4 ml-1" /> تصدير CSV
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="table-seller-profit">
          <thead><tr className="border-b text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50">
            <th className="text-right py-2.5 px-3 font-medium">البائع</th>
            <th className="text-right py-2.5 px-3 font-medium">عدد المبيعات</th>
            <th className="text-right py-2.5 px-3 font-medium">الإيرادات</th>
            <th className="text-right py-2.5 px-3 font-medium">التكلفة</th>
            <th className="text-right py-2.5 px-3 font-medium">المرتجعات</th>
            <th className="text-right py-2.5 px-3 font-medium">صافي الربح</th>
            <th className="text-right py-2.5 px-3 font-medium">هامش %</th>
          </tr></thead>
          <tbody>
            {sellers.map((s: any, i: number) => (
              <tr key={s.seller_id} className="border-b last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50" data-testid={`row-seller-${i}`}>
                <td className="py-2.5 px-3 font-medium">{s.seller_name}</td>
                <td className="py-2.5 px-3">{s.sale_count}</td>
                <td className="py-2.5 px-3">{fmt(s.revenue)} ر.س</td>
                <td className="py-2.5 px-3">{fmt(s.cogs)} ر.س</td>
                <td className="py-2.5 px-3 text-red-500">{fmt(s.return_amount)} ر.س</td>
                <td className="py-2.5 px-3 font-semibold text-emerald-600 dark:text-emerald-400">{fmt(s.net_profit)} ر.س</td>
                <td className="py-2.5 px-3">{s.gp_percent}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BranchNetProfitTab({ dateRange, filters }: { dateRange: DateRange; filters: Record<string, string> }) {
  const { data, isLoading } = useReportQuery<any>("branch-net-profit", dateRange, filters);
  if (isLoading) return <LoadingState />;
  const branches = data?.branches || [];
  if (branches.length === 0) return <EmptyState text="لا توجد بيانات مبيعات" />;
  return (
    <div>
      <div className="flex justify-end mb-3">
        <Button variant="outline" size="sm" data-testid="button-export-branch" onClick={() => exportCSV(
          ["الفرع", "عدد المبيعات", "الإيرادات", "التكلفة", "المرتجعات", "صافي الربح", "هامش %"],
          branches.map((b: any) => [b.branch_name, b.sale_count, b.revenue, b.cogs, b.return_amount, b.net_profit, b.gp_percent]),
          `branch-profit-${dateRange.start}.csv`
        )}>
          <Download className="h-4 w-4 ml-1" /> تصدير CSV
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="table-branch-profit">
          <thead><tr className="border-b text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50">
            <th className="text-right py-2.5 px-3 font-medium">الفرع</th>
            <th className="text-right py-2.5 px-3 font-medium">عدد المبيعات</th>
            <th className="text-right py-2.5 px-3 font-medium">الإيرادات</th>
            <th className="text-right py-2.5 px-3 font-medium">التكلفة</th>
            <th className="text-right py-2.5 px-3 font-medium">المرتجعات</th>
            <th className="text-right py-2.5 px-3 font-medium">صافي الربح</th>
            <th className="text-right py-2.5 px-3 font-medium">هامش %</th>
          </tr></thead>
          <tbody>
            {branches.map((b: any, i: number) => (
              <tr key={b.branch_id} className="border-b last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50" data-testid={`row-branch-${i}`}>
                <td className="py-2.5 px-3 font-medium">{b.branch_name}</td>
                <td className="py-2.5 px-3">{b.sale_count}</td>
                <td className="py-2.5 px-3">{fmt(b.revenue)} ر.س</td>
                <td className="py-2.5 px-3">{fmt(b.cogs)} ر.س</td>
                <td className="py-2.5 px-3 text-red-500">{fmt(b.return_amount)} ر.س</td>
                <td className="py-2.5 px-3 font-semibold text-emerald-600 dark:text-emerald-400">{fmt(b.net_profit)} ر.س</td>
                <td className="py-2.5 px-3">{b.gp_percent}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InventoryValuationTab({ filters }: { filters: Record<string, string> }) {
  const { data, isLoading } = useReportQuery<any>("inventory-valuation", QUICK_RANGES[0], filters, true);
  if (isLoading) return <LoadingState />;
  const branches = data?.branches || [];
  const totals = data?.totals;
  if (branches.length === 0) return <EmptyState text="لا يوجد مخزون" />;
  return (
    <div>
      <div className="flex justify-end mb-3">
        <Button variant="outline" size="sm" data-testid="button-export-inventory" onClick={() => exportCSV(
          ["الفرع", "عدد القطع", "قيمة التكلفة", "قيمة البيع", "هامش محتمل", "نسبة الهامش %"],
          branches.map((b: any) => [b.branch_name, b.item_count, b.total_cost_value, b.total_tag_value, b.potential_margin, b.margin_pct]),
          `inventory-valuation.csv`
        )}>
          <Download className="h-4 w-4 ml-1" /> تصدير CSV
        </Button>
      </div>
      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-center">
            <p className="text-xs text-gray-500">إجمالي القطع</p>
            <p className="text-lg font-bold">{fmt(totals.item_count)}</p>
          </div>
          <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800/30 border border-gray-200 dark:border-gray-700 text-center">
            <p className="text-xs text-gray-500">إجمالي التكلفة</p>
            <p className="text-lg font-bold">{fmt(totals.total_cost_value)} ر.س</p>
          </div>
          <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-center">
            <p className="text-xs text-gray-500">إجمالي سعر البيع</p>
            <p className="text-lg font-bold">{fmt(totals.total_tag_value)} ر.س</p>
          </div>
          <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-center">
            <p className="text-xs text-gray-500">هامش محتمل</p>
            <p className="text-lg font-bold text-emerald-600">{fmt(totals.potential_margin)} ر.س</p>
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="table-inventory-valuation">
          <thead><tr className="border-b text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50">
            <th className="text-right py-2.5 px-3 font-medium">الفرع</th>
            <th className="text-right py-2.5 px-3 font-medium">عدد القطع</th>
            <th className="text-right py-2.5 px-3 font-medium">قيمة التكلفة</th>
            <th className="text-right py-2.5 px-3 font-medium">قيمة البيع</th>
            <th className="text-right py-2.5 px-3 font-medium">هامش محتمل</th>
            <th className="text-right py-2.5 px-3 font-medium">نسبة %</th>
          </tr></thead>
          <tbody>
            {branches.map((b: any) => (
              <tr key={b.branch_id} className="border-b last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <td className="py-2.5 px-3 font-medium">{b.branch_name}</td>
                <td className="py-2.5 px-3">{fmt(b.item_count)}</td>
                <td className="py-2.5 px-3">{fmt(b.total_cost_value)} ر.س</td>
                <td className="py-2.5 px-3">{fmt(b.total_tag_value)} ر.س</td>
                <td className="py-2.5 px-3 text-emerald-600 dark:text-emerald-400 font-semibold">{fmt(b.potential_margin)} ر.س</td>
                <td className="py-2.5 px-3">{b.margin_pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InventoryAgingTab({ filters }: { filters: Record<string, string> }) {
  const { data, isLoading } = useReportQuery<any>("inventory-aging", QUICK_RANGES[0], filters, true);
  if (isLoading) return <LoadingState />;
  const branches = data?.branches || [];
  const totals = data?.totals;
  if (branches.length === 0) return <EmptyState text="لا يوجد مخزون" />;
  const buckets = totals ? [
    { label: "0-30 يوم", value: totals.age_0_30, color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
    { label: "31-60 يوم", value: totals.age_31_60, color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300" },
    { label: "61-90 يوم", value: totals.age_61_90, color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300" },
    { label: "+90 يوم", value: totals.age_over_90, color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
  ] : [];
  return (
    <div>
      <div className="flex justify-end mb-3">
        <Button variant="outline" size="sm" data-testid="button-export-aging" onClick={() => exportCSV(
          ["الفرع", "0-30 يوم", "31-60 يوم", "61-90 يوم", "+90 يوم", "إجمالي", "تكلفة إجمالية", "تكلفة راكد +90"],
          branches.map((b: any) => [b.branch_name, b.age_0_30, b.age_31_60, b.age_61_90, b.age_over_90, b.total_in_stock, b.total_cost, b.aging_cost_over_90]),
          `inventory-aging.csv`
        )}>
          <Download className="h-4 w-4 ml-1" /> تصدير CSV
        </Button>
      </div>
      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {buckets.map(b => (
            <div key={b.label} className={`rounded-lg p-3 text-center ${b.color}`}>
              <p className="text-2xl font-bold">{fmt(b.value)}</p>
              <p className="text-xs mt-1">{b.label}</p>
            </div>
          ))}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="table-inventory-aging">
          <thead><tr className="border-b text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50">
            <th className="text-right py-2.5 px-3 font-medium">الفرع</th>
            <th className="text-right py-2.5 px-3 font-medium">0-30 يوم</th>
            <th className="text-right py-2.5 px-3 font-medium">31-60 يوم</th>
            <th className="text-right py-2.5 px-3 font-medium">61-90 يوم</th>
            <th className="text-right py-2.5 px-3 font-medium">+90 يوم</th>
            <th className="text-right py-2.5 px-3 font-medium">إجمالي</th>
            <th className="text-right py-2.5 px-3 font-medium">تكلفة راكد</th>
          </tr></thead>
          <tbody>
            {branches.map((b: any) => (
              <tr key={b.branch_id} className="border-b last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <td className="py-2.5 px-3 font-medium">{b.branch_name}</td>
                <td className="py-2.5 px-3 text-green-600">{fmt(b.age_0_30)}</td>
                <td className="py-2.5 px-3 text-yellow-600">{fmt(b.age_31_60)}</td>
                <td className="py-2.5 px-3 text-orange-600">{fmt(b.age_61_90)}</td>
                <td className="py-2.5 px-3 text-red-600 font-semibold">{fmt(b.age_over_90)}</td>
                <td className="py-2.5 px-3 font-semibold">{fmt(b.total_in_stock)}</td>
                <td className="py-2.5 px-3 text-red-500">{fmt(b.aging_cost_over_90)} ر.س</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReturnsSummaryTab({ dateRange, filters }: { dateRange: DateRange; filters: Record<string, string> }) {
  const { data, isLoading } = useReportQuery<any>("returns-summary", dateRange, filters);
  if (isLoading) return <LoadingState />;
  const rows = data?.rows || [];
  const topReasons = data?.top_reasons || [];
  if (rows.length === 0) return <EmptyState text="لا توجد مرتجعات في هذه الفترة" />;
  return (
    <div>
      <div className="flex justify-end mb-3">
        <Button variant="outline" size="sm" data-testid="button-export-returns" onClick={() => exportCSV(
          ["البائع", "الفرع", "عدد المرتجعات", "مبلغ المرتجعات", "تكلفة المرتجعات"],
          rows.map((r: any) => [r.seller_name, r.branch_name, r.return_count, r.return_amount, r.return_cost]),
          `returns-summary-${dateRange.start}.csv`
        )}>
          <Download className="h-4 w-4 ml-1" /> تصدير CSV
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="table-returns-summary">
          <thead><tr className="border-b text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50">
            <th className="text-right py-2.5 px-3 font-medium">البائع</th>
            <th className="text-right py-2.5 px-3 font-medium">الفرع</th>
            <th className="text-right py-2.5 px-3 font-medium">عدد المرتجعات</th>
            <th className="text-right py-2.5 px-3 font-medium">مبلغ المرتجعات</th>
            <th className="text-right py-2.5 px-3 font-medium">تكلفة المرتجعات</th>
          </tr></thead>
          <tbody>
            {rows.map((r: any, i: number) => (
              <tr key={i} className="border-b last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50" data-testid={`row-return-${i}`}>
                <td className="py-2.5 px-3 font-medium">{r.seller_name}</td>
                <td className="py-2.5 px-3">{r.branch_name}</td>
                <td className="py-2.5 px-3">{r.return_count}</td>
                <td className="py-2.5 px-3 text-red-500">{fmt(r.return_amount)} ر.س</td>
                <td className="py-2.5 px-3">{fmt(r.return_cost)} ر.س</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {topReasons.length > 0 && (
        <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-800/30 rounded-lg">
          <p className="text-sm font-semibold mb-2">أكثر أسباب الإرجاع</p>
          <div className="flex flex-wrap gap-2">
            {topReasons.map((r: any) => (
              <span key={r.reason} className="px-3 py-1 bg-white dark:bg-gray-700 rounded-full text-xs border">{r.reason} ({r.count})</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ReconciliationTab({ dateRange, filters }: { dateRange: DateRange; filters: Record<string, string> }) {
  const { data, isLoading } = useReportQuery<any>("reconciliation", dateRange, filters);
  if (isLoading) return <LoadingState />;
  const rows = data?.rows || [];
  if (rows.length === 0) return <EmptyState text="لا توجد فروقات — كل الفواتير مسددة ✓" />;
  return (
    <div>
      <div className="flex justify-end mb-3">
        <Button variant="outline" size="sm" data-testid="button-export-reconciliation" onClick={() => exportCSV(
          ["الفاتورة", "التاريخ", "الفرع", "البائع", "مبلغ الفاتورة", "المدفوع", "الفرق"],
          rows.map((r: any) => [r.invoice_number, r.invoice_date, r.branch_name, r.seller_name, r.invoice_total, r.paid_total, r.delta]),
          `reconciliation-${dateRange.start}.csv`
        )}>
          <Download className="h-4 w-4 ml-1" /> تصدير CSV
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="table-reconciliation">
          <thead><tr className="border-b text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50">
            <th className="text-right py-2.5 px-3 font-medium">الفاتورة</th>
            <th className="text-right py-2.5 px-3 font-medium">الفرع</th>
            <th className="text-right py-2.5 px-3 font-medium">البائع</th>
            <th className="text-right py-2.5 px-3 font-medium">مبلغ الفاتورة</th>
            <th className="text-right py-2.5 px-3 font-medium">المدفوع</th>
            <th className="text-right py-2.5 px-3 font-medium">الفرق</th>
          </tr></thead>
          <tbody>
            {rows.map((r: any) => (
              <tr key={r.invoice_id} className="border-b last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <td className="py-2.5 px-3 font-medium">{r.invoice_number}</td>
                <td className="py-2.5 px-3">{r.branch_name}</td>
                <td className="py-2.5 px-3">{r.seller_name || "-"}</td>
                <td className="py-2.5 px-3">{fmt(r.invoice_total)} ر.س</td>
                <td className="py-2.5 px-3">{fmt(r.paid_total)} ر.س</td>
                <td className="py-2.5 px-3 font-semibold text-red-600 dark:text-red-400">{fmt(r.delta)} ر.س</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PaymentMixTab({ dateRange, filters }: { dateRange: DateRange; filters: Record<string, string> }) {
  const { data, isLoading } = useReportQuery<any>("payment-mix", dateRange, filters);
  if (isLoading) return <LoadingState />;
  const rows = data?.rows || [];
  if (rows.length === 0) return <EmptyState text="لا توجد دفعات في هذه الفترة" />;
  return (
    <div>
      <div className="flex justify-end mb-3">
        <Button variant="outline" size="sm" data-testid="button-export-payments" onClick={() => exportCSV(
          ["طريقة الدفع", "العدد", "الإجمالي", "النسبة %"],
          rows.map((r: any) => [r.payment_method, r.count, r.total, r.pct]),
          `payment-mix-${dateRange.start}.csv`
        )}>
          <Download className="h-4 w-4 ml-1" /> تصدير CSV
        </Button>
      </div>
      {data?.grand_total > 0 && (
        <div className="mb-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-center">
          <p className="text-xs text-gray-500">إجمالي المدفوعات</p>
          <p className="text-xl font-bold">{fmt(data.grand_total)} ر.س</p>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="table-payment-mix">
          <thead><tr className="border-b text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50">
            <th className="text-right py-2.5 px-3 font-medium">طريقة الدفع</th>
            <th className="text-right py-2.5 px-3 font-medium">العدد</th>
            <th className="text-right py-2.5 px-3 font-medium">الإجمالي</th>
            <th className="text-right py-2.5 px-3 font-medium">النسبة %</th>
          </tr></thead>
          <tbody>
            {rows.map((r: any, i: number) => (
              <tr key={i} className="border-b last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <td className="py-2.5 px-3 font-medium">{r.payment_method}</td>
                <td className="py-2.5 px-3">{r.count}</td>
                <td className="py-2.5 px-3">{fmt(r.total)} ر.س</td>
                <td className="py-2.5 px-3">{r.pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SoldItemsMarginTab({ dateRange, filters }: { dateRange: DateRange; filters: Record<string, string> }) {
  const { data, isLoading } = useReportQuery<any>("sold-items-margin", dateRange, filters);
  if (isLoading) return <LoadingState />;
  const rows = data?.rows || [];
  if (rows.length === 0) return <EmptyState text="لا توجد قطع مباعة في هذه الفترة" />;
  return (
    <div>
      <div className="flex justify-end mb-3">
        <Button variant="outline" size="sm" data-testid="button-export-items" onClick={() => exportCSV(
          ["الرقم التسلسلي", "الموديل", "الفاتورة", "التاريخ", "الفرع", "البائع", "سعر البيع", "التكلفة", "الهامش", "هامش %"],
          rows.map((r: any) => [r.serial_no, r.model, r.invoice_number, r.sale_date, r.branch_name, r.seller_name, r.sale_price, r.cost, r.margin, r.margin_pct]),
          `sold-items-${dateRange.start}.csv`
        )}>
          <Download className="h-4 w-4 ml-1" /> تصدير CSV
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="table-sold-items">
          <thead><tr className="border-b text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50">
            <th className="text-right py-2.5 px-3 font-medium">الرقم التسلسلي</th>
            <th className="text-right py-2.5 px-3 font-medium">الموديل</th>
            <th className="text-right py-2.5 px-3 font-medium">الفاتورة</th>
            <th className="text-right py-2.5 px-3 font-medium">الفرع</th>
            <th className="text-right py-2.5 px-3 font-medium">البائع</th>
            <th className="text-right py-2.5 px-3 font-medium">سعر البيع</th>
            <th className="text-right py-2.5 px-3 font-medium">التكلفة</th>
            <th className="text-right py-2.5 px-3 font-medium">الهامش</th>
            <th className="text-right py-2.5 px-3 font-medium">%</th>
          </tr></thead>
          <tbody>
            {rows.map((r: any, i: number) => (
              <tr key={i} className="border-b last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50" data-testid={`row-item-${i}`}>
                <td className="py-2.5 px-3 font-mono text-xs">{r.serial_no}</td>
                <td className="py-2.5 px-3 text-xs">{r.model || "-"}</td>
                <td className="py-2.5 px-3 text-xs">{r.invoice_number}</td>
                <td className="py-2.5 px-3">{r.branch_name}</td>
                <td className="py-2.5 px-3">{r.seller_name || "-"}</td>
                <td className="py-2.5 px-3">{fmt(r.sale_price)} ر.س</td>
                <td className="py-2.5 px-3">{fmt(r.cost)} ر.س</td>
                <td className={`py-2.5 px-3 font-semibold ${parseFloat(r.margin) >= 0 ? "text-emerald-600" : "text-red-600"}`}>{fmt(r.margin)} ر.س</td>
                <td className="py-2.5 px-3">{r.margin_pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function POSReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initTab = searchParams.get("tab") || "seller_net_profit";
  const initStart = searchParams.get("start") || todayISO();
  const initEnd = searchParams.get("end") || todayISO();
  const initBranch = searchParams.get("branch_id") || "";
  const initSeller = searchParams.get("seller_id") || "";

  const [activeTab, setActiveTab] = useState(initTab);
  const [dateRange, setDateRange] = useState<DateRange>({
    start: initStart,
    end: initEnd,
    label: QUICK_RANGES.find(r => r.start === initStart && r.end === initEnd)?.label || "مخصص",
  });
  const [customStart, setCustomStart] = useState(initStart);
  const [customEnd, setCustomEnd] = useState(initEnd);
  const [branchId, setBranchId] = useState(initBranch);
  const [sellerId, setSellerId] = useState(initSeller);

  const { data: branchList } = useQuery<any[]>({
    queryKey: ["pos-admin-branches"],
    queryFn: async () => {
      const res = await fetch("/api/pos/admin/branches", { credentials: "include" });
      const json = await res.json();
      const d = json.data;
      return Array.isArray(d) ? d : (d?.branches || []);
    },
  });

  const { data: sellerList } = useQuery<any[]>({
    queryKey: ["pos-admin-profiles"],
    queryFn: async () => {
      const res = await fetch("/api/pos/admin/profiles-active", { credentials: "include" });
      const json = await res.json();
      return json.data?.profiles || json.data || [];
    },
  });

  const filters = useMemo(() => {
    const f: Record<string, string> = {};
    if (branchId) f.branch_id = branchId;
    if (sellerId) f.seller_id = sellerId;
    return f;
  }, [branchId, sellerId]);

  const switchTab = useCallback((tab: string) => {
    setActiveTab(tab);
    const p = new URLSearchParams();
    p.set("tab", tab);
    p.set("start", dateRange.start);
    p.set("end", dateRange.end);
    if (branchId) p.set("branch_id", branchId);
    if (sellerId) p.set("seller_id", sellerId);
    setSearchParams(p, { replace: true });
  }, [dateRange, branchId, sellerId, setSearchParams]);

  const applyQuickRange = (r: DateRange) => {
    setDateRange(r);
    setCustomStart(r.start);
    setCustomEnd(r.end);
  };

  const applyCustomRange = () => {
    if (customStart && customEnd) {
      setDateRange({ start: customStart, end: customEnd, label: "مخصص" });
    }
  };

  const needsDates = !["inventory_valuation", "inventory_aging"].includes(activeTab);

  const renderTab = () => {
    switch (activeTab) {
      case "seller_net_profit": return <SellerNetProfitTab dateRange={dateRange} filters={filters} />;
      case "branch_net_profit": return <BranchNetProfitTab dateRange={dateRange} filters={filters} />;
      case "inventory_valuation": return <InventoryValuationTab filters={filters} />;
      case "inventory_aging": return <InventoryAgingTab filters={filters} />;
      case "returns_summary": return <ReturnsSummaryTab dateRange={dateRange} filters={filters} />;
      case "reconciliation": return <ReconciliationTab dateRange={dateRange} filters={filters} />;
      case "payment_mix": return <PaymentMixTab dateRange={dateRange} filters={filters} />;
      case "sold_items_margin": return <SoldItemsMarginTab dateRange={dateRange} filters={filters} />;
      default: return null;
    }
  };

  return (
    <POSLayout>
      <div className="rtl-mode content-full-width page-container space-y-4 p-4 md:p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2" data-testid="text-reports-title">
            <BarChart3 className="h-6 w-6 text-primary" />
            مركز التقارير
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2 p-3 bg-gray-50 dark:bg-gray-800/30 rounded-lg border">
          {needsDates && (
            <>
              {QUICK_RANGES.map(r => (
                <Button key={r.label} variant={dateRange.label === r.label ? "default" : "outline"} size="sm" onClick={() => applyQuickRange(r)} data-testid={`button-range-${r.label}`}>
                  {r.label}
                </Button>
              ))}
              <div className="flex items-center gap-1">
                <Input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="w-36 h-8 text-sm" data-testid="input-report-start" />
                <Input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="w-36 h-8 text-sm" data-testid="input-report-end" />
                <Button size="sm" variant="outline" onClick={applyCustomRange} data-testid="button-apply-range">تطبيق</Button>
              </div>
              <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />
            </>
          )}
          <Select value={branchId || "__all__"} onValueChange={v => setBranchId(v === "__all__" ? "" : v)}>
            <SelectTrigger className="w-44 h-8 text-sm" data-testid="select-branch-filter">
              <SelectValue placeholder="كل الفروع" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">كل الفروع</SelectItem>
              {(branchList || []).map((b: any) => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sellerId || "__all__"} onValueChange={v => setSellerId(v === "__all__" ? "" : v)}>
            <SelectTrigger className="w-44 h-8 text-sm" data-testid="select-seller-filter">
              <SelectValue placeholder="كل البائعين" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">كل البائعين</SelectItem>
              {(sellerList || []).map((s: any) => (
                <SelectItem key={s.id} value={s.id}>{s.full_name || s.username}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap gap-1.5 overflow-x-auto pb-1">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <Button
                key={tab.key}
                variant={isActive ? "default" : "ghost"}
                size="sm"
                className={`text-xs ${isActive ? "" : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"}`}
                onClick={() => switchTab(tab.key)}
                data-testid={`tab-${tab.key}`}
              >
                <Icon className="h-3.5 w-3.5 ml-1" />
                {tab.label}
              </Button>
            );
          })}
        </div>

        <Card data-testid="card-report-content">
          <CardHeader className="py-3 px-4 border-b bg-gray-50/50 dark:bg-gray-800/30">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              {(() => { const t = TABS.find(t => t.key === activeTab); const Icon = t?.icon || BarChart3; return <><Icon className="h-5 w-5 text-primary" />{t?.label || ""}</>; })()}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            {renderTab()}
          </CardContent>
        </Card>
      </div>
    </POSLayout>
  );
}
