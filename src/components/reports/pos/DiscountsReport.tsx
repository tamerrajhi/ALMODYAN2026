import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowRight, FileSpreadsheet, Percent, TrendingDown, Receipt, Users } from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency } from '@/lib/utils';
import * as XLSX from 'xlsx';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

interface DiscountsReportProps {
  onBack: () => void;
}

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6'];

export default function DiscountsReport({ onBack }: DiscountsReportProps) {
  const [selectedBranch, setSelectedBranch] = useState<string>('all');
  const [startDate, setStartDate] = useState(format(new Date(new Date().setDate(1)), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const res = await fetch('/api/active-branches', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch branches');
      return res.json();
    },
  });

  const { data: reportData, isLoading } = useQuery({
    queryKey: ['discounts-report', selectedBranch, startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams({ startDate, endDate });
      if (selectedBranch !== 'all') params.set('branch', selectedBranch);
      const res = await fetch(`/api/reports/discounts?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch discounts report');
      const { sales: salesWithDiscount = [], summary: apiSummary = {} } = await res.json();

      const totalGrossSales = apiSummary.total_amount || 0;
      const totalDiscounts = apiSummary.discount_amount || 0;
      const totalNetSales = apiSummary.final_amount || 0;
      const discountRate = totalGrossSales > 0 ? (totalDiscounts / totalGrossSales) * 100 : 0;
      const salesWithDiscountCount = salesWithDiscount.length;
      const totalSalesCount = totalGrossSales > 0 ? Math.round(totalGrossSales / ((totalGrossSales / Math.max(salesWithDiscountCount, 1)))) : salesWithDiscountCount;
      const discountUsageRate = totalSalesCount > 0 ? (salesWithDiscountCount / totalSalesCount) * 100 : 0;

      const sellerBreakdown: Record<string, { name: string; count: number; total: number; discountGiven: number }> = {};
      salesWithDiscount.forEach((sale: any) => {
        const seller = sale.sold_by || 'غير محدد';
        if (!sellerBreakdown[seller]) {
          sellerBreakdown[seller] = { name: seller, count: 0, total: 0, discountGiven: 0 };
        }
        sellerBreakdown[seller].count += 1;
        sellerBreakdown[seller].total += sale.final_amount || 0;
        sellerBreakdown[seller].discountGiven += sale.discount_amount || 0;
      });

      const ranges = [
        { label: '0-5%', min: 0, max: 5, count: 0, total: 0 },
        { label: '5-10%', min: 5, max: 10, count: 0, total: 0 },
        { label: '10-15%', min: 10, max: 15, count: 0, total: 0 },
        { label: '15-20%', min: 15, max: 20, count: 0, total: 0 },
        { label: '20%+', min: 20, max: 100, count: 0, total: 0 },
      ];

      salesWithDiscount.forEach((sale: any) => {
        const discountPercent = sale.total_amount > 0 ? (sale.discount_amount / sale.total_amount) * 100 : 0;
        for (const range of ranges) {
          if (discountPercent >= range.min && discountPercent < range.max) {
            range.count += 1;
            range.total += sale.discount_amount || 0;
            break;
          }
        }
      });

      return {
        sales: salesWithDiscount,
        summary: {
          totalGrossSales,
          totalDiscounts,
          totalNetSales,
          discountRate,
          salesWithDiscountCount,
          totalSalesCount,
          discountUsageRate,
          avgDiscount: salesWithDiscountCount > 0 ? totalDiscounts / salesWithDiscountCount : 0,
        },
        sellerBreakdown: Object.values(sellerBreakdown).sort((a, b) => b.discountGiven - a.discountGiven),
        rangeData: ranges,
      };
    },
  });

  const handleExportExcel = () => {
    if (!reportData) return;

    const salesData = reportData.sales.map((sale: any) => ({
      'رقم الفاتورة': sale.invoice_number || sale.sale_code,
      'التاريخ': format(new Date(sale.sale_date), 'yyyy-MM-dd HH:mm'),
      'العميل': sale.customer?.full_name || 'نقدي',
      'الفرع': sale.branch?.branch_name || '-',
      'المبلغ قبل الخصم': sale.total_amount,
      'الخصم': sale.discount_amount,
      'نسبة الخصم': ((sale.discount_amount / sale.total_amount) * 100).toFixed(2) + '%',
      'المبلغ بعد الخصم': sale.final_amount,
      'البائع': sale.sold_by,
    }));

    const sellerData = reportData.sellerBreakdown.map((s: any) => ({
      'البائع': s.name,
      'عدد العمليات': s.count,
      'إجمالي الخصومات': s.discountGiven,
      'إجمالي المبيعات': s.total,
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(salesData), 'المبيعات');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sellerData), 'حسب البائع');
    XLSX.writeFile(wb, `تقرير-الخصومات-${startDate}-${endDate}.xlsx`);
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
            <h1 className="text-2xl font-bold">تقرير الخصومات</h1>
            <p className="text-muted-foreground">تحليل الخصومات المقدمة على المبيعات</p>
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <TrendingDown className="w-4 h-4 text-orange-600" />
                  إجمالي الخصومات
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-orange-600">{formatCurrency(reportData.summary.totalDiscounts)}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Percent className="w-4 h-4" />
                  نسبة الخصم الإجمالية
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{reportData.summary.discountRate.toFixed(2)}%</p>
                <p className="text-xs text-muted-foreground">من إجمالي المبيعات</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Receipt className="w-4 h-4" />
                  فواتير بخصم
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{reportData.summary.salesWithDiscountCount}</p>
                <p className="text-xs text-muted-foreground">
                  {reportData.summary.discountUsageRate.toFixed(1)}% من الفواتير
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  متوسط الخصم
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatCurrency(reportData.summary.avgDiscount)}</p>
                <p className="text-xs text-muted-foreground">لكل فاتورة</p>
              </CardContent>
            </Card>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>الخصومات حسب البائع</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={reportData.sellerBreakdown} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" tickFormatter={(value) => formatCurrency(value)} />
                      <YAxis type="category" dataKey="name" width={100} />
                      <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      <Bar dataKey="discountGiven" fill="#f97316" name="الخصومات" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>توزيع نسب الخصم</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={reportData.rangeData.filter(r => r.count > 0)}
                        dataKey="count"
                        nameKey="label"
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                      >
                        {reportData.rangeData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Top Discounts Table */}
          <Card>
            <CardHeader>
              <CardTitle>أعلى الخصومات</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>رقم الفاتورة</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>العميل</TableHead>
                    <TableHead>الفرع</TableHead>
                    <TableHead>المبلغ الأصلي</TableHead>
                    <TableHead>الخصم</TableHead>
                    <TableHead>نسبة الخصم</TableHead>
                    <TableHead>الصافي</TableHead>
                    <TableHead>البائع</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reportData.sales.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-muted-foreground">
                        لا توجد خصومات في هذه الفترة
                      </TableCell>
                    </TableRow>
                  ) : (
                    reportData.sales.slice(0, 50).map((sale: any) => (
                      <TableRow key={sale.id}>
                        <TableCell className="font-mono">{sale.invoice_number || sale.sale_code}</TableCell>
                        <TableCell>{format(new Date(sale.sale_date), 'yyyy-MM-dd')}</TableCell>
                        <TableCell>{sale.customer?.full_name || 'نقدي'}</TableCell>
                        <TableCell>{sale.branch?.branch_name || '-'}</TableCell>
                        <TableCell>{formatCurrency(sale.total_amount)}</TableCell>
                        <TableCell className="text-orange-600 font-semibold">{formatCurrency(sale.discount_amount)}</TableCell>
                        <TableCell>
                          <span className={`px-2 py-1 rounded text-xs ${
                            (sale.discount_amount / sale.total_amount) * 100 > 15 ? 'bg-red-100 text-red-800' : 'bg-orange-100 text-orange-800'
                          }`}>
                            {((sale.discount_amount / sale.total_amount) * 100).toFixed(1)}%
                          </span>
                        </TableCell>
                        <TableCell className="font-semibold">{formatCurrency(sale.final_amount)}</TableCell>
                        <TableCell>{sale.sold_by}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
