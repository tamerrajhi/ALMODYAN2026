import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { format } from 'date-fns';
import { Loader2, Building2, Download, PieChart } from 'lucide-react';
import { PieChart as RechartsPieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';

const COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#00C49F', '#FFBB28'];

interface CostCenterReportProps {
  branchId?: string;
}

export default function CostCenterReport({ branchId }: CostCenterReportProps) {
  const [startDate, setStartDate] = useState(format(new Date(new Date().setMonth(new Date().getMonth() - 1)), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const { data: costCenterData = [], isLoading } = useQuery({
    queryKey: ['cost-center-report', branchId, startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams({ startDate, endDate });
      if (branchId) params.set('branchId', branchId);
      const res = await fetch(`/api/reports/cost-center?${params}`, { credentials: 'include' });
      if (res.status === 501) return [];
      const data = await res.json();

      const grouped = (data || []).reduce((acc: any, wo: any) => {
        const centerId = wo.cost_center_id;
        const centerName = wo.cost_centers?.center_name || 'غير محدد';
        const centerCode = wo.cost_centers?.center_code || '-';

        if (!acc[centerId]) {
          acc[centerId] = {
            id: centerId,
            name: centerName,
            code: centerCode,
            ordersCount: 0,
            rawMaterialCost: 0,
            laborCost: 0,
            additionalCost: 0,
            totalCost: 0,
            completedOrders: 0,
            inProgressOrders: 0,
          };
        }

        const rawMaterialCost = (wo.actual_gold_cost || 0) + (wo.actual_gemstone_cost || 0) + (wo.actual_other_cost || 0);
        const laborCost = wo.work_order_labor?.reduce((sum: number, l: any) => sum + (l.total_cost || 0), 0) || 0;
        const additionalCost = wo.work_order_direct_costs?.reduce((sum: number, c: any) => sum + (c.amount || 0), 0) || 0;

        acc[centerId].ordersCount += 1;
        acc[centerId].rawMaterialCost += rawMaterialCost;
        acc[centerId].laborCost += laborCost;
        acc[centerId].additionalCost += additionalCost;
        acc[centerId].totalCost += rawMaterialCost + laborCost + additionalCost;
        
        if (wo.status === 'completed') acc[centerId].completedOrders += 1;
        if (wo.status === 'in_progress') acc[centerId].inProgressOrders += 1;

        return acc;
      }, {});

      return Object.values(grouped);
    },
  });

  const totalCost = (costCenterData as any[]).reduce((sum: number, cc: any) => sum + (cc.totalCost || 0), 0);
  const totalOrders = (costCenterData as any[]).reduce((sum: number, cc: any) => sum + (cc.ordersCount || 0), 0);

  const chartData = costCenterData.map((cc: any) => ({
    name: cc.name,
    value: cc.totalCost,
  }));

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            تقرير مراكز التكلفة
          </CardTitle>
          <CardDescription>تحليل تكاليف الإنتاج حسب مراكز التكلفة</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <div className="space-y-2">
              <Label>من تاريخ</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>إلى تاريخ</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">عدد مراكز التكلفة</p>
            <p className="text-2xl font-bold">{costCenterData.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">إجمالي أوامر الإنتاج</p>
            <p className="text-2xl font-bold">{totalOrders}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">إجمالي التكلفة</p>
            <p className="text-2xl font-bold text-primary">{totalCost.toLocaleString()} ر.س</p>
          </CardContent>
        </Card>
      </div>

      {/* Chart and Table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pie Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChart className="w-5 h-5" />
              توزيع التكاليف
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : chartData.length === 0 ? (
              <div className="flex items-center justify-center h-64 text-muted-foreground">
                لا توجد بيانات
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <RechartsPieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                    label={({ name, percent }: { name: string; percent: number }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                  >
                    {chartData.map((entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => value.toLocaleString() + ' ر.س'} />
                  <Legend />
                </RechartsPieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle>التفاصيل</CardTitle>
              <Button variant="outline" size="sm">
                <Download className="w-4 h-4 ml-2" />
                تصدير
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : costCenterData.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                لا توجد بيانات
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>مركز التكلفة</TableHead>
                    <TableHead className="text-center">الأوامر</TableHead>
                    <TableHead className="text-center">التكلفة</TableHead>
                    <TableHead className="text-center">النسبة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {costCenterData.map((cc: any) => (
                    <TableRow key={cc.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{cc.name}</p>
                          <p className="text-xs text-muted-foreground">{cc.code}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div>
                          <p>{cc.ordersCount}</p>
                          <p className="text-xs text-muted-foreground">
                            {cc.completedOrders} مكتمل | {cc.inProgressOrders} قيد التنفيذ
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="text-center font-medium">
                        {cc.totalCost.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-center">
                        {totalCost > 0 ? ((Number(cc.totalCost) / totalCost) * 100).toFixed(1) : 0}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
