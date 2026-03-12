export interface DashboardWidget {
  key: string;
  title: string;
  enabled: boolean;
}

export const dashboardWidgets: DashboardWidget[] = [
  { key: "today_kpis", title: "ملخص اليوم", enabled: true },
  { key: "profit_snapshot", title: "الأرباح", enabled: true },
  { key: "top_sellers", title: "أفضل البائعين", enabled: true },
  { key: "top_branches", title: "أفضل الفروع", enabled: true },
  { key: "inventory_valuation", title: "تقييم المخزون", enabled: true },
  { key: "inventory_aging", title: "عمر المخزون", enabled: true },
  { key: "reconciliation", title: "الفروقات", enabled: true },
];
