import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowRight, Printer, FileSpreadsheet, Receipt, CreditCard, Banknote, RotateCcw, Percent, TrendingUp } from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { formatCurrency } from '@/lib/utils';
import * as XLSX from 'xlsx';
import * as apiClient from '@/lib/apiClient';

interface ZReportProps {
  onBack: () => void;
}

export default function ZReport({ onBack }: ZReportProps) {
  const [selectedBranch, setSelectedBranch] = useState<string>('all');
  const [reportDate, setReportDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const { data, error } = await apiClient.get<any[]>('/api/active-branches');
      if (error) throw new Error(error.message);
      return data || [];
    },
  });

  const { data: reportData, isLoading } = useQuery({
    queryKey: ['z-report', selectedBranch, reportDate],
    queryFn: async () => {
      const params = new URLSearchParams({ date: reportDate });
      if (selectedBranch !== 'all') {
        params.append('branch', selectedBranch);
      }
      const res = await fetch(`/api/reports/z-report?${params.toString()}`, { credentials: 'include' });
      if (res.status === 501) return { sales: [], returns: [], summary: { grossSales: 0, totalDiscounts: 0, totalSales: 0, totalReturns: 0, netSales: 0, cashSales: 0, cardSales: 0, splitSales: 0, totalTransactions: 0, returnTransactions: 0, totalItems: 0 } };
      if (!res.ok) throw new Error('Failed to fetch Z report');
      const data = await res.json();

      const sales = (data.sales || []).map((s: any) => ({
        id: s.id,
        sale_code: s.sale_code,
        invoice_number: s.invoice_number,
        sale_date: s.sale_date,
        payment_method: s.payment_method,
        total_amount: Number(s.total_amount) || 0,
        discount_amount: Number(s.discount_amount) || 0,
        final_amount: Number(s.final_amount) || 0,
        sold_by: s.sold_by,
        total_items: s.total_items || 0,
        customer: s.customer_name ? { full_name: s.customer_name } : null,
      }));

      const returns = (data.returns || []).map((r: any) => ({
        id: r.id,
        return_code: r.return_code,
        return_date: r.return_date,
        total_amount: Number(r.total_amount) || 0,
        processed_by: r.processed_by,
        customer: r.customer_name ? { full_name: r.customer_name } : null,
      }));

      const totalSales = sales.reduce((sum: number, s: any) => sum + (s.final_amount || 0), 0);
      const totalReturns = returns.reduce((sum: number, r: any) => sum + (r.total_amount || 0), 0);
      const totalDiscounts = sales.reduce((sum: number, s: any) => sum + (s.discount_amount || 0), 0);
      const grossSales = sales.reduce((sum: number, s: any) => sum + (s.total_amount || 0), 0);

      const cashSales = sales.filter((s: any) => s.payment_method === 'cash').reduce((sum: number, s: any) => sum + (s.final_amount || 0), 0);
      const cardSales = sales.filter((s: any) => s.payment_method === 'card').reduce((sum: number, s: any) => sum + (s.final_amount || 0), 0);
      const splitSales = sales.filter((s: any) => s.payment_method === 'split').reduce((sum: number, s: any) => sum + (s.final_amount || 0), 0);

      const totalTransactions = sales.length;
      const returnTransactions = returns.length;
      const totalItems = sales.reduce((sum: number, s: any) => sum + (s.total_items || 0), 0);

      const netSales = totalSales - totalReturns;

      return {
        sales,
        returns,
        summary: {
          grossSales,
          totalDiscounts,
          totalSales,
          totalReturns,
          netSales,
          cashSales,
          cardSales,
          splitSales,
          totalTransactions,
          returnTransactions,
          totalItems,
        },
      };
    },
  });

  const handleExportExcel = () => {
    if (!reportData) return;

    const salesData = reportData.sales.map((sale: any) => ({
      'رقم الفاتورة': sale.invoice_number || sale.sale_code,
      'الوقت': format(new Date(sale.sale_date), 'HH:mm', { locale: ar }),
      'العميل': sale.customer?.full_name || 'نقدي',
      'عدد القطع': sale.total_items,
      'المبلغ الإجمالي': sale.total_amount,
      'الخصم': sale.discount_amount,
      'المبلغ الصافي': sale.final_amount,
      'طريقة الدفع': sale.payment_method === 'cash' ? 'نقدي' : sale.payment_method === 'card' ? 'بطاقة' : 'مقسم',
      'البائع': sale.sold_by,
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(salesData);
    XLSX.utils.book_append_sheet(wb, ws, 'المبيعات');

    const summaryData = [
      { 'البيان': 'إجمالي المبيعات قبل الخصم', 'القيمة': reportData.summary.grossSales },
      { 'البيان': 'إجمالي الخصومات', 'القيمة': reportData.summary.totalDiscounts },
      { 'البيان': 'صافي المبيعات', 'القيمة': reportData.summary.totalSales },
      { 'البيان': 'إجمالي المرتجعات', 'القيمة': reportData.summary.totalReturns },
      { 'البيان': 'صافي اليوم', 'القيمة': reportData.summary.netSales },
      { 'البيان': 'المبيعات النقدية', 'القيمة': reportData.summary.cashSales },
      { 'البيان': 'مبيعات البطاقة', 'القيمة': reportData.summary.cardSales },
      { 'البيان': 'عدد العمليات', 'القيمة': reportData.summary.totalTransactions },
      { 'البيان': 'عدد المرتجعات', 'القيمة': reportData.summary.returnTransactions },
    ];
    const summaryWs = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, summaryWs, 'الملخص');

    XLSX.writeFile(wb, `Z-Report-${reportDate}.xlsx`);
  };

  const handlePrint = () => {
    window.print();
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
            <h1 className="text-2xl font-bold">تقرير Z - إغلاق الوردية</h1>
            <p className="text-muted-foreground">ملخص شامل لمبيعات اليوم</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="w-4 h-4 ml-2" />
            طباعة
          </Button>
          <Button variant="outline" onClick={handleExportExcel}>
            <FileSpreadsheet className="w-4 h-4 ml-2" />
            تصدير Excel
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
              <Label>التاريخ</Label>
              <Input
                type="date"
                value={reportDate}
                onChange={(e) => setReportDate(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="text-center py-8">جاري التحميل...</div>
      ) : reportData ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  إجمالي قبل الخصم
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-bold">{formatCurrency(reportData.summary.grossSales)}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Percent className="w-4 h-4" />
                  الخصومات
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-bold text-orange-600">{formatCurrency(reportData.summary.totalDiscounts)}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Receipt className="w-4 h-4" />
                  صافي المبيعات
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-bold text-green-600">{formatCurrency(reportData.summary.totalSales)}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <RotateCcw className="w-4 h-4" />
                  المرتجعات
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-bold text-red-600">{formatCurrency(reportData.summary.totalReturns)}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Banknote className="w-4 h-4" />
                  نقدي
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-bold">{formatCurrency(reportData.summary.cashSales)}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <CreditCard className="w-4 h-4" />
                  بطاقة
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-bold">{formatCurrency(reportData.summary.cardSales)}</p>
              </CardContent>
            </Card>
          </div>

          <Card className="bg-primary/5 border-primary/20">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg text-muted-foreground">صافي اليوم (المبيعات - المرتجعات)</p>
                  <p className="text-3xl font-bold text-primary">{formatCurrency(reportData.summary.netSales)}</p>
                </div>
                <div className="text-left">
                  <p className="text-sm text-muted-foreground">عدد العمليات: {reportData.summary.totalTransactions}</p>
                  <p className="text-sm text-muted-foreground">عدد القطع المباعة: {reportData.summary.totalItems}</p>
                  <p className="text-sm text-muted-foreground">عدد المرتجعات: {reportData.summary.returnTransactions}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>تفاصيل المبيعات</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>رقم الفاتورة</TableHead>
                    <TableHead>الوقت</TableHead>
                    <TableHead>العميل</TableHead>
                    <TableHead>عدد القطع</TableHead>
                    <TableHead>الإجمالي</TableHead>
                    <TableHead>الخصم</TableHead>
                    <TableHead>الصافي</TableHead>
                    <TableHead>طريقة الدفع</TableHead>
                    <TableHead>البائع</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reportData.sales.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-muted-foreground">
                        لا توجد مبيعات في هذا اليوم
                      </TableCell>
                    </TableRow>
                  ) : (
                    reportData.sales.map((sale: any) => (
                      <TableRow key={sale.id}>
                        <TableCell className="font-mono">{sale.invoice_number || sale.sale_code}</TableCell>
                        <TableCell>{format(new Date(sale.sale_date), 'HH:mm')}</TableCell>
                        <TableCell>{sale.customer?.full_name || 'نقدي'}</TableCell>
                        <TableCell>{sale.total_items}</TableCell>
                        <TableCell>{formatCurrency(sale.total_amount)}</TableCell>
                        <TableCell className="text-orange-600">{formatCurrency(sale.discount_amount)}</TableCell>
                        <TableCell className="font-semibold">{formatCurrency(sale.final_amount)}</TableCell>
                        <TableCell>
                          {sale.payment_method === 'cash' ? 'نقدي' : sale.payment_method === 'card' ? 'بطاقة' : 'مقسم'}
                        </TableCell>
                        <TableCell>{sale.sold_by}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {reportData.returns.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>المرتجعات</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>رقم المرتجع</TableHead>
                      <TableHead>الوقت</TableHead>
                      <TableHead>العميل</TableHead>
                      <TableHead>المبلغ</TableHead>
                      <TableHead>الموظف</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reportData.returns.map((ret: any) => (
                      <TableRow key={ret.id}>
                        <TableCell className="font-mono">{ret.return_code}</TableCell>
                        <TableCell>{format(new Date(ret.return_date), 'HH:mm')}</TableCell>
                        <TableCell>{ret.customer?.full_name || '-'}</TableCell>
                        <TableCell className="text-red-600">{formatCurrency(ret.total_amount)}</TableCell>
                        <TableCell>{ret.processed_by}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}
