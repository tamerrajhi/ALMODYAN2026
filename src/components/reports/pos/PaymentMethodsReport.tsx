import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowRight, FileSpreadsheet, Banknote, CreditCard, SplitSquareHorizontal, TrendingUp } from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency } from '@/lib/utils';
import * as XLSX from 'xlsx';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';

interface PaymentMethodsReportProps {
  onBack: () => void;
}

const COLORS = ['#22c55e', '#3b82f6', '#f59e0b'];

export default function PaymentMethodsReport({ onBack }: PaymentMethodsReportProps) {
  const [selectedBranch, setSelectedBranch] = useState<string>('all');
  const [startDate, setStartDate] = useState(format(new Date(new Date().setDate(1)), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const res = await fetch('/api/active-branches', { credentials: 'include' });
      if (!res.ok && res.status === 501) return [];
      return res.json();
    },
  });

  const { data: reportData, isLoading } = useQuery({
    queryKey: ['payment-methods-report', selectedBranch, startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams({ startDate, endDate });
      if (selectedBranch !== 'all') params.set('branch', selectedBranch);
      const res = await fetch(`/api/reports/payment-methods?${params}`, { credentials: 'include' });
      if (!res.ok && res.status === 501) return { sales: [], summary: { cash: { count: 0, total: 0, percentage: 0 }, card: { count: 0, total: 0, percentage: 0 }, split: { count: 0, total: 0, percentage: 0 }, grandTotal: 0 }, chartData: [], dailyData: [] };
      const sales = await res.json();

      const cashSales = sales?.filter((s: any) => s.payment_method === 'cash') || [];
      const cardSales = sales?.filter((s: any) => s.payment_method === 'card') || [];
      const splitSales = sales?.filter((s: any) => s.payment_method === 'split') || [];

      const cashTotal = cashSales.reduce((sum: number, s: any) => sum + (s.final_amount || 0), 0);
      const cardTotal = cardSales.reduce((sum: number, s: any) => sum + (s.final_amount || 0), 0);
      const splitTotal = splitSales.reduce((sum: number, s: any) => sum + (s.final_amount || 0), 0);
      const grandTotal = cashTotal + cardTotal + splitTotal;

      const dailyData: Record<string, { date: string; cash: number; card: number; split: number }> = {};
      sales?.forEach((sale: any) => {
        const dateKey = format(new Date(sale.sale_date), 'yyyy-MM-dd');
        if (!dailyData[dateKey]) {
          dailyData[dateKey] = { date: dateKey, cash: 0, card: 0, split: 0 };
        }
        if (sale.payment_method === 'cash') {
          dailyData[dateKey].cash += sale.final_amount || 0;
        } else if (sale.payment_method === 'card') {
          dailyData[dateKey].card += sale.final_amount || 0;
        } else if (sale.payment_method === 'split') {
          dailyData[dateKey].split += sale.final_amount || 0;
        }
      });

      return {
        sales: sales || [],
        summary: {
          cash: { count: cashSales.length, total: cashTotal, percentage: grandTotal > 0 ? (cashTotal / grandTotal) * 100 : 0 },
          card: { count: cardSales.length, total: cardTotal, percentage: grandTotal > 0 ? (cardTotal / grandTotal) * 100 : 0 },
          split: { count: splitSales.length, total: splitTotal, percentage: grandTotal > 0 ? (splitTotal / grandTotal) * 100 : 0 },
          grandTotal,
        },
        chartData: [
          { name: 'نقدي', value: cashTotal, count: cashSales.length },
          { name: 'بطاقة', value: cardTotal, count: cardSales.length },
          { name: 'مقسم', value: splitTotal, count: splitSales.length },
        ],
        dailyData: Object.values(dailyData).sort((a, b) => a.date.localeCompare(b.date)),
      };
    },
  });

  const handleExportExcel = () => {
    if (!reportData) return;

    const summaryData = [
      { 'طريقة الدفع': 'نقدي', 'عدد العمليات': reportData.summary.cash.count, 'الإجمالي': reportData.summary.cash.total, 'النسبة': `${reportData.summary.cash.percentage.toFixed(1)}%` },
      { 'طريقة الدفع': 'بطاقة', 'عدد العمليات': reportData.summary.card.count, 'الإجمالي': reportData.summary.card.total, 'النسبة': `${reportData.summary.card.percentage.toFixed(1)}%` },
      { 'طريقة الدفع': 'مقسم', 'عدد العمليات': reportData.summary.split.count, 'الإجمالي': reportData.summary.split.total, 'النسبة': `${reportData.summary.split.percentage.toFixed(1)}%` },
    ];

    const detailsData = reportData.sales.map((sale: any) => ({
      'رقم الفاتورة': sale.invoice_number || sale.sale_code,
      'التاريخ': format(new Date(sale.sale_date), 'yyyy-MM-dd HH:mm'),
      'الفرع': sale.branch?.branch_name || sale.branch_name || '-',
      'طريقة الدفع': sale.payment_method === 'cash' ? 'نقدي' : sale.payment_method === 'card' ? 'بطاقة' : 'مقسم',
      'المبلغ': sale.final_amount,
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryData), 'الملخص');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailsData), 'التفاصيل');
    XLSX.writeFile(wb, `تقرير-طرق-الدفع-${startDate}-${endDate}.xlsx`);
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
            <h1 className="text-2xl font-bold">تقرير طرق الدفع</h1>
            <p className="text-muted-foreground">تحليل المبيعات حسب طريقة الدفع</p>
          </div>
        </div>
        <Button variant="outline" onClick={handleExportExcel}>
          <FileSpreadsheet className="w-4 h-4 ml-2" />
          تصدير Excel
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>الفرع</Label>
              <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر الفرع" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">جميع الفروع</SelectItem>
                  {branches.map((branch: any) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.branch_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>من تاريخ</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>إلى تاريخ</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="text-center py-8">جاري التحميل...</div>
      ) : reportData ? (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Banknote className="w-4 h-4 text-green-600" />
                  نقدي
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-green-600">{formatCurrency(reportData.summary.cash.total)}</p>
                <p className="text-sm text-muted-foreground">{reportData.summary.cash.count} عملية ({reportData.summary.cash.percentage.toFixed(1)}%)</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-blue-600" />
                  بطاقة
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-blue-600">{formatCurrency(reportData.summary.card.total)}</p>
                <p className="text-sm text-muted-foreground">{reportData.summary.card.count} عملية ({reportData.summary.card.percentage.toFixed(1)}%)</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <SplitSquareHorizontal className="w-4 h-4 text-amber-600" />
                  مقسم
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-amber-600">{formatCurrency(reportData.summary.split.total)}</p>
                <p className="text-sm text-muted-foreground">{reportData.summary.split.count} عملية ({reportData.summary.split.percentage.toFixed(1)}%)</p>
              </CardContent>
            </Card>

            <Card className="bg-primary/5 border-primary/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  الإجمالي
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-primary">{formatCurrency(reportData.summary.grandTotal)}</p>
                <p className="text-sm text-muted-foreground">{reportData.sales.length} عملية</p>
              </CardContent>
            </Card>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>توزيع طرق الدفع</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={reportData.chartData.filter(d => d.value > 0)}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                      >
                        {reportData.chartData.map((_: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>التحليل اليومي</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={reportData.dailyData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tickFormatter={(date) => format(new Date(date), 'MM/dd')} />
                      <YAxis tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      <Legend />
                      <Bar dataKey="cash" name="نقدي" fill="#22c55e" stackId="a" />
                      <Bar dataKey="card" name="بطاقة" fill="#3b82f6" stackId="a" />
                      <Bar dataKey="split" name="مقسم" fill="#f59e0b" stackId="a" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Details Table */}
          <Card>
            <CardHeader>
              <CardTitle>تفاصيل العمليات (آخر 100 عملية)</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>رقم الفاتورة</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>الفرع</TableHead>
                    <TableHead>طريقة الدفع</TableHead>
                    <TableHead>المبلغ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reportData.sales.slice(0, 100).map((sale: any) => (
                    <TableRow key={sale.id}>
                      <TableCell className="font-mono">{sale.invoice_number || sale.sale_code}</TableCell>
                      <TableCell>{format(new Date(sale.sale_date), 'yyyy-MM-dd HH:mm')}</TableCell>
                      <TableCell>{sale.branch?.branch_name || sale.branch_name || '-'}</TableCell>
                      <TableCell>
                        <span className={`px-2 py-1 rounded text-xs ${
                          sale.payment_method === 'cash' ? 'bg-green-100 text-green-800' :
                          sale.payment_method === 'card' ? 'bg-blue-100 text-blue-800' :
                          'bg-amber-100 text-amber-800'
                        }`}>
                          {sale.payment_method === 'cash' ? 'نقدي' : sale.payment_method === 'card' ? 'بطاقة' : 'مقسم'}
                        </span>
                      </TableCell>
                      <TableCell className="font-semibold">{formatCurrency(sale.final_amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
