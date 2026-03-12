import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowRight, TrendingDown, TrendingUp, BarChart3, Package, AlertTriangle, CheckCircle } from 'lucide-react';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, Legend } from 'recharts';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { ar } from 'date-fns/locale';

interface InventoryCountStatisticsReportProps {
  onBack: () => void;
}

export default function InventoryCountStatisticsReport({ onBack }: InventoryCountStatisticsReportProps) {
  const [period, setPeriod] = useState('6');
  const [branchFilter, setBranchFilter] = useState<string>('all');

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const res = await fetch('/api/active-branches', { credentials: 'include' });
      if (!res.ok && res.status === 501) return [];
      if (!res.ok) return [];
      return await res.json();
    },
  });

  const { data: counts, isLoading } = useQuery({
    queryKey: ['inventory-count-statistics', period, branchFilter],
    queryFn: async () => {
      const res = await fetch('/api/reports/inventory-count-stats', { credentials: 'include' });
      if (!res.ok && res.status === 501) return [];
      if (!res.ok) return [];
      const data = await res.json();
      return (data as any[]).map(row => ({
        ...row,
        branches: row.branches || (row.branch_name ? { branch_name: row.branch_name } : null),
      }));
    },
  });

  const statistics = counts ? {
    totalCounts: counts.length,
    approvedCounts: counts.filter((c: any) => c.status === 'approved').length,
    totalShortage: counts.reduce((sum: number, c: any) => sum + (c.total_shortage || 0), 0),
    totalOverage: counts.reduce((sum: number, c: any) => sum + (c.total_overage || 0), 0),
    totalShortageValue: counts.reduce((sum: number, c: any) => sum + (c.shortage_value || 0), 0),
    totalOverageValue: counts.reduce((sum: number, c: any) => sum + (c.overage_value || 0), 0),
    totalWeightDiff: counts.reduce((sum: number, c: any) => sum + (c.total_weight_diff || 0), 0),
  } : null;

  const monthlyTrends = counts ? (() => {
    const months: Record<string, { month: string; shortage: number; overage: number; shortageValue: number; overageValue: number }> = {};
    
    counts.forEach((count: any) => {
      const monthKey = format(new Date(count.start_date), 'yyyy-MM');
      const monthLabel = format(new Date(count.start_date), 'MMM yyyy', { locale: ar });
      
      if (!months[monthKey]) {
        months[monthKey] = { month: monthLabel, shortage: 0, overage: 0, shortageValue: 0, overageValue: 0 };
      }
      
      months[monthKey].shortage += count.total_shortage || 0;
      months[monthKey].overage += count.total_overage || 0;
      months[monthKey].shortageValue += count.shortage_value || 0;
      months[monthKey].overageValue += count.overage_value || 0;
    });

    return Object.values(months);
  })() : [];

  const branchComparison = counts ? (() => {
    const branchData: Record<string, { name: string; shortage: number; overage: number; counts: number }> = {};
    
    counts.forEach((count: any) => {
      const branchName = (count.branches as any)?.branch_name || 'غير محدد';
      
      if (!branchData[branchName]) {
        branchData[branchName] = { name: branchName, shortage: 0, overage: 0, counts: 0 };
      }
      
      branchData[branchName].shortage += count.total_shortage || 0;
      branchData[branchName].overage += count.total_overage || 0;
      branchData[branchName].counts += 1;
    });

    return Object.values(branchData);
  })() : [];

  const statusDistribution = counts ? (() => {
    const statuses: Record<string, number> = { open: 0, counting: 0, reviewing: 0, approved: 0 };
    counts.forEach((count: any) => {
      statuses[count.status] = (statuses[count.status] || 0) + 1;
    });
    return [
      { name: 'مفتوح', value: statuses.open, color: 'hsl(var(--muted-foreground))' },
      { name: 'قيد العد', value: statuses.counting, color: 'hsl(var(--primary))' },
      { name: 'قيد المراجعة', value: statuses.reviewing, color: 'hsl(var(--warning))' },
      { name: 'معتمد', value: statuses.approved, color: 'hsl(var(--success))' },
    ].filter(s => s.value > 0);
  })() : [];

  const chartConfig = {
    shortage: { label: 'عجز', color: 'hsl(var(--destructive))' },
    overage: { label: 'زيادة', color: 'hsl(var(--success))' },
    shortageValue: { label: 'قيمة العجز', color: 'hsl(var(--destructive))' },
    overageValue: { label: 'قيمة الزيادة', color: 'hsl(var(--success))' },
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={onBack}>
            <ArrowRight className="w-4 h-4 ml-2" />
            رجوع
          </Button>
          <div>
            <h1 className="text-2xl font-bold">إحصائيات عمليات الجرد</h1>
            <p className="text-muted-foreground">تحليل اتجاهات العجز والزيادة بمرور الوقت</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Select value={branchFilter} onValueChange={setBranchFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="جميع الفروع" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">جميع الفروع</SelectItem>
              {branches?.map((branch: any) => (
                <SelectItem key={branch.id} value={branch.id}>{branch.branch_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3">آخر 3 أشهر</SelectItem>
              <SelectItem value="6">آخر 6 أشهر</SelectItem>
              <SelectItem value="12">آخر 12 شهر</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12">جاري التحميل...</div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">إجمالي عمليات الجرد</CardTitle>
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{statistics?.totalCounts || 0}</div>
                <p className="text-xs text-muted-foreground">
                  {statistics?.approvedCounts || 0} معتمد
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">إجمالي العجز</CardTitle>
                <TrendingDown className="h-4 w-4 text-destructive" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-destructive">{statistics?.totalShortage || 0} قطعة</div>
                <p className="text-xs text-muted-foreground">
                  {(statistics?.totalShortageValue || 0).toLocaleString()} ر.س
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">إجمالي الزيادة</CardTitle>
                <TrendingUp className="h-4 w-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">{statistics?.totalOverage || 0} قطعة</div>
                <p className="text-xs text-muted-foreground">
                  {(statistics?.totalOverageValue || 0).toLocaleString()} ر.س
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">صافي الفرق</CardTitle>
                <Package className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${
                  (statistics?.totalShortageValue || 0) > (statistics?.totalOverageValue || 0) 
                    ? 'text-destructive' 
                    : 'text-green-600'
                }`}>
                  {((statistics?.totalOverageValue || 0) - (statistics?.totalShortageValue || 0)).toLocaleString()} ر.س
                </div>
                <p className="text-xs text-muted-foreground">
                  {statistics?.totalWeightDiff || 0} اختلاف وزن
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">اتجاه العجز والزيادة (بالقطع)</CardTitle>
              </CardHeader>
              <CardContent>
                {monthlyTrends.length > 0 ? (
                  <ChartContainer config={chartConfig} className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={monthlyTrends}>
                        <XAxis dataKey="month" fontSize={12} />
                        <YAxis fontSize={12} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Bar dataKey="shortage" name="عجز" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="overage" name="زيادة" fill="hsl(142 76% 36%)" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartContainer>
                ) : (
                  <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                    لا توجد بيانات كافية
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">اتجاه القيمة المالية للفروقات</CardTitle>
              </CardHeader>
              <CardContent>
                {monthlyTrends.length > 0 ? (
                  <ChartContainer config={chartConfig} className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={monthlyTrends}>
                        <XAxis dataKey="month" fontSize={12} />
                        <YAxis fontSize={12} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Line 
                          type="monotone" 
                          dataKey="shortageValue" 
                          name="قيمة العجز" 
                          stroke="hsl(var(--destructive))" 
                          strokeWidth={2}
                          dot={{ fill: 'hsl(var(--destructive))' }}
                        />
                        <Line 
                          type="monotone" 
                          dataKey="overageValue" 
                          name="قيمة الزيادة" 
                          stroke="hsl(142 76% 36%)" 
                          strokeWidth={2}
                          dot={{ fill: 'hsl(142 76% 36%)' }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </ChartContainer>
                ) : (
                  <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                    لا توجد بيانات كافية
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">مقارنة الفروع</CardTitle>
              </CardHeader>
              <CardContent>
                {branchComparison.length > 0 ? (
                  <ChartContainer config={chartConfig} className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={branchComparison} layout="vertical">
                        <XAxis type="number" fontSize={12} />
                        <YAxis type="category" dataKey="name" fontSize={12} width={100} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Bar dataKey="shortage" name="عجز" fill="hsl(var(--destructive))" radius={[0, 4, 4, 0]} />
                        <Bar dataKey="overage" name="زيادة" fill="hsl(142 76% 36%)" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartContainer>
                ) : (
                  <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                    لا توجد بيانات كافية
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">توزيع حالات الجرد</CardTitle>
              </CardHeader>
              <CardContent>
                {statusDistribution.length > 0 ? (
                  <ChartContainer config={chartConfig} className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={statusDistribution}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          paddingAngle={2}
                          dataKey="value"
                          label={({ name, value }) => `${name}: ${value}`}
                        >
                          {statusDistribution.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </ChartContainer>
                ) : (
                  <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                    لا توجد بيانات كافية
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">آخر عمليات الجرد</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-right p-2 font-medium">رقم الجرد</th>
                      <th className="text-right p-2 font-medium">الفرع</th>
                      <th className="text-right p-2 font-medium">التاريخ</th>
                      <th className="text-right p-2 font-medium">الحالة</th>
                      <th className="text-right p-2 font-medium">العجز</th>
                      <th className="text-right p-2 font-medium">الزيادة</th>
                      <th className="text-right p-2 font-medium">قيمة العجز</th>
                    </tr>
                  </thead>
                  <tbody>
                    {counts?.slice(-10).reverse().map((count: any) => (
                      <tr key={count.id} className="border-b hover:bg-muted/50">
                        <td className="p-2 font-mono">{count.count_number}</td>
                        <td className="p-2">{(count.branches as any)?.branch_name || '-'}</td>
                        <td className="p-2">{format(new Date(count.start_date), 'yyyy/MM/dd')}</td>
                        <td className="p-2">
                          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
                            count.status === 'approved' 
                              ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                              : count.status === 'reviewing'
                              ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                              : 'bg-muted text-muted-foreground'
                          }`}>
                            {count.status === 'approved' && <CheckCircle className="w-3 h-3" />}
                            {count.status === 'reviewing' && <AlertTriangle className="w-3 h-3" />}
                            {count.status === 'open' && 'مفتوح'}
                            {count.status === 'counting' && 'قيد العد'}
                            {count.status === 'reviewing' && 'قيد المراجعة'}
                            {count.status === 'approved' && 'معتمد'}
                          </span>
                        </td>
                        <td className="p-2 text-destructive">{count.total_shortage || 0}</td>
                        <td className="p-2 text-green-600">{count.total_overage || 0}</td>
                        <td className="p-2">{(count.shortage_value || 0).toLocaleString()} ر.س</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
