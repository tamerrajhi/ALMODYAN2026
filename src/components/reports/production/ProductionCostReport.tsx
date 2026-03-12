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
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { Loader2, FileText, Download, TrendingUp, TrendingDown } from 'lucide-react';

interface ProductionCostReportProps {
  branchId?: string;
}

export default function ProductionCostReport({ branchId }: ProductionCostReportProps) {
  const [startDate, setStartDate] = useState(format(new Date(new Date().setMonth(new Date().getMonth() - 1)), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const { data: workOrders = [], isLoading } = useQuery({
    queryKey: ['production-cost-report', branchId, startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams({ startDate, endDate });
      if (branchId) params.set('branchId', branchId);
      const res = await fetch(`/api/reports/production-cost?${params}`, { credentials: 'include' });
      if (res.status === 501) return [];
      return res.json();
    },
  });

  const calculateTotals = (wo: any) => {
    const rawMaterialCost = (wo.actual_gold_cost || 0) + (wo.actual_gemstone_cost || 0) + (wo.actual_other_cost || 0);
    const laborCost = wo.work_order_labor?.reduce((sum: number, l: any) => sum + (l.total_cost || 0), 0) || 0;
    const additionalCost = wo.work_order_direct_costs?.reduce((sum: number, c: any) => sum + (c.amount || 0), 0) || 0;
    const totalCost = rawMaterialCost + laborCost + additionalCost;

    const estimatedTotal = (wo.estimated_gold_cost || 0) + (wo.estimated_labor_cost || 0) + 
                          (wo.estimated_gemstone_cost || 0) + (wo.estimated_other_cost || 0);
    
    const variance = totalCost - estimatedTotal;
    const variancePercent = estimatedTotal > 0 ? (variance / estimatedTotal) * 100 : 0;

    return { rawMaterialCost, laborCost, additionalCost, totalCost, estimatedTotal, variance, variancePercent };
  };

  const summaryTotals = workOrders.reduce((acc, wo) => {
    const totals = calculateTotals(wo);
    return {
      rawMaterialCost: acc.rawMaterialCost + totals.rawMaterialCost,
      laborCost: acc.laborCost + totals.laborCost,
      additionalCost: acc.additionalCost + totals.additionalCost,
      totalCost: acc.totalCost + totals.totalCost,
      estimatedTotal: acc.estimatedTotal + totals.estimatedTotal,
    };
  }, { rawMaterialCost: 0, laborCost: 0, additionalCost: 0, totalCost: 0, estimatedTotal: 0 });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending': return <Badge variant="secondary">قيد الانتظار</Badge>;
      case 'in_progress': return <Badge className="bg-blue-100 text-blue-800">قيد التنفيذ</Badge>;
      case 'completed': return <Badge className="bg-green-100 text-green-800">مكتمل</Badge>;
      case 'cancelled': return <Badge variant="destructive">ملغي</Badge>;
      default: return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            تقرير تكلفة الإنتاج
          </CardTitle>
          <CardDescription>تحليل تكاليف أوامر الإنتاج خلال الفترة المحددة</CardDescription>
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
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">تكلفة المواد الخام</p>
            <p className="text-2xl font-bold">{summaryTotals.rawMaterialCost.toLocaleString()} ر.س</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">تكلفة العمالة</p>
            <p className="text-2xl font-bold">{summaryTotals.laborCost.toLocaleString()} ر.س</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">تكاليف إضافية</p>
            <p className="text-2xl font-bold">{summaryTotals.additionalCost.toLocaleString()} ر.س</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">إجمالي التكلفة الفعلية</p>
            <p className="text-2xl font-bold text-primary">{summaryTotals.totalCost.toLocaleString()} ر.س</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">الفرق عن التقديري</p>
            <p className={`text-2xl font-bold ${summaryTotals.totalCost - summaryTotals.estimatedTotal > 0 ? 'text-destructive' : 'text-green-600'}`}>
              {(summaryTotals.totalCost - summaryTotals.estimatedTotal).toLocaleString()} ر.س
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>تفاصيل أوامر الإنتاج</CardTitle>
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
          ) : workOrders.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              لا توجد أوامر إنتاج في الفترة المحددة
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>رقم الأمر</TableHead>
                  <TableHead>الوصف</TableHead>
                  <TableHead>الفرع</TableHead>
                  <TableHead>مركز التكلفة</TableHead>
                  <TableHead className="text-center">المواد</TableHead>
                  <TableHead className="text-center">العمالة</TableHead>
                  <TableHead className="text-center">إضافية</TableHead>
                  <TableHead className="text-center">الإجمالي</TableHead>
                  <TableHead className="text-center">الانحراف</TableHead>
                  <TableHead>الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workOrders.map((wo: any) => {
                  const totals = calculateTotals(wo);
                  return (
                    <TableRow key={wo.id}>
                      <TableCell className="font-medium">{wo.order_number}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{wo.product_description}</TableCell>
                      <TableCell>{wo.branches?.branch_name || '-'}</TableCell>
                      <TableCell>{wo.cost_centers?.center_name || '-'}</TableCell>
                      <TableCell className="text-center">{totals.rawMaterialCost.toLocaleString()}</TableCell>
                      <TableCell className="text-center">{totals.laborCost.toLocaleString()}</TableCell>
                      <TableCell className="text-center">{totals.additionalCost.toLocaleString()}</TableCell>
                      <TableCell className="text-center font-medium">{totals.totalCost.toLocaleString()}</TableCell>
                      <TableCell className="text-center">
                        <span className={`flex items-center justify-center gap-1 ${totals.variance > 0 ? 'text-destructive' : 'text-green-600'}`}>
                          {totals.variance > 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                          {totals.variancePercent.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell>{getStatusBadge(wo.status)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
