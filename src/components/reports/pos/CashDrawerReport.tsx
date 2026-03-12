import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowRight, FileSpreadsheet, Printer, Wallet, ArrowUpRight, ArrowDownRight, Scale, AlertTriangle, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency } from '@/lib/utils';
import * as XLSX from 'xlsx';

interface CashDrawerReportProps {
  onBack: () => void;
}

export default function CashDrawerReport({ onBack }: CashDrawerReportProps) {
  const [selectedBranch, setSelectedBranch] = useState<string>('all');
  const [reportDate, setReportDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [openingBalance, setOpeningBalance] = useState<number>(0);
  const [actualCash, setActualCash] = useState<number>(0);

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const res = await fetch('/api/active-branches', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return await res.json();
    },
  });

  const { data: reportData, isLoading } = useQuery({
    queryKey: ['cash-drawer-report', selectedBranch, reportDate],
    queryFn: async () => {
      const params = new URLSearchParams({ date: reportDate, branch: selectedBranch });
      const res = await fetch(`/api/reports/cash-drawer?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      const { sales, returns, payments } = await res.json();
      
      const cashSalesTotal = sales?.reduce((sum: number, s: any) => sum + (parseFloat(s.total_amount) || 0), 0) || 0;
      const splitCashTotal = 0;
      const totalCashIn = cashSalesTotal + splitCashTotal;
      const cashRefunds = returns?.reduce((sum: number, r: any) => sum + (parseFloat(r.total_amount) || 0), 0) || 0;
      const cashReceipts = payments?.filter((p: any) => p.payment_type === 'receipt')
        .reduce((sum: number, p: any) => sum + (parseFloat(p.amount) || 0), 0) || 0;
      const cashPayouts = payments?.filter((p: any) => p.payment_type === 'payment')
        .reduce((sum: number, p: any) => sum + (parseFloat(p.amount) || 0), 0) || 0;
      const totalCashOut = cashRefunds + cashPayouts;
      const netCashMovement = totalCashIn + cashReceipts - totalCashOut;

      const transactions: Array<{
        time: string;
        type: 'in' | 'out';
        category: string;
        reference: string;
        amount: number;
        person: string;
      }> = [];

      sales?.forEach((sale: any) => {
        transactions.push({
          time: format(new Date(sale.sale_date), 'HH:mm'),
          type: 'in',
          category: 'مبيعات نقدية',
          reference: sale.invoice_number || sale.sale_code || '',
          amount: parseFloat(sale.total_amount) || 0,
          person: sale.created_by || '-',
        });
      });

      returns?.forEach((ret: any) => {
        transactions.push({
          time: format(new Date(ret.return_date), 'HH:mm'),
          type: 'out',
          category: 'مرتجعات',
          reference: ret.return_code || '',
          amount: parseFloat(ret.total_amount) || 0,
          person: ret.processed_by || '-',
        });
      });

      payments?.forEach((pay: any) => {
        transactions.push({
          time: '00:00',
          type: pay.payment_type === 'receipt' ? 'in' : 'out',
          category: pay.payment_type === 'receipt' ? 'تحصيل' : 'صرف',
          reference: pay.payment_number || '',
          amount: parseFloat(pay.amount) || 0,
          person: '-',
        });
      });

      transactions.sort((a, b) => a.time.localeCompare(b.time));

      return {
        transactions,
        summary: {
          cashSalesTotal,
          splitCashTotal,
          totalCashIn,
          cashRefunds,
          cashReceipts,
          cashPayouts,
          totalCashOut,
          netCashMovement,
          transactionCount: transactions.length,
        },
      };
    },
  });

  const expectedCash = openingBalance + (reportData?.summary.netCashMovement || 0);
  const variance = actualCash - expectedCash;
  const isBalanced = Math.abs(variance) < 1;

  const handleExportExcel = () => {
    if (!reportData) return;

    const transactionsData = reportData.transactions.map((t: any) => ({
      'الوقت': t.time,
      'النوع': t.type === 'in' ? 'وارد' : 'صادر',
      'البيان': t.category,
      'المرجع': t.reference,
      'المبلغ': t.amount,
      'الموظف': t.person,
    }));

    const summaryData = [
      { 'البيان': 'رصيد افتتاحي', 'المبلغ': openingBalance },
      { 'البيان': 'المبيعات النقدية', 'المبلغ': reportData.summary.cashSalesTotal },
      { 'البيان': 'نقدي من مبيعات مقسمة', 'المبلغ': reportData.summary.splitCashTotal },
      { 'البيان': 'التحصيلات', 'المبلغ': reportData.summary.cashReceipts },
      { 'البيان': 'إجمالي الوارد', 'المبلغ': reportData.summary.totalCashIn + reportData.summary.cashReceipts },
      { 'البيان': 'المرتجعات', 'المبلغ': reportData.summary.cashRefunds },
      { 'البيان': 'المصروفات', 'المبلغ': reportData.summary.cashPayouts },
      { 'البيان': 'إجمالي الصادر', 'المبلغ': reportData.summary.totalCashOut },
      { 'البيان': 'الرصيد المتوقع', 'المبلغ': expectedCash },
      { 'البيان': 'الرصيد الفعلي', 'المبلغ': actualCash },
      { 'البيان': 'الفرق', 'المبلغ': variance },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(transactionsData), 'الحركات');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryData), 'الملخص');
    XLSX.writeFile(wb, `تقرير-مطابقة-الخزينة-${reportDate}.xlsx`);
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
            <h1 className="text-2xl font-bold">تقرير مطابقة الخزينة</h1>
            <p className="text-muted-foreground">مطابقة الرصيد النقدي الفعلي مع المتوقع</p>
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

      {/* Filters & Inputs */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>الفرع</Label>
              <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر الفرع" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">جميع الفروع</SelectItem>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.branch_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>التاريخ</Label>
              <Input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>الرصيد الافتتاحي</Label>
              <Input
                type="number"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(parseFloat(e.target.value) || 0)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-2">
              <Label>النقد الفعلي</Label>
              <Input
                type="number"
                value={actualCash}
                onChange={(e) => setActualCash(parseFloat(e.target.value) || 0)}
                placeholder="0.00"
              />
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
                  <Wallet className="w-4 h-4" />
                  الرصيد الافتتاحي
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatCurrency(openingBalance)}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <ArrowUpRight className="w-4 h-4 text-green-600" />
                  إجمالي الوارد
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-green-600">
                  {formatCurrency(reportData.summary.totalCashIn + reportData.summary.cashReceipts)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <ArrowDownRight className="w-4 h-4 text-red-600" />
                  إجمالي الصادر
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-red-600">{formatCurrency(reportData.summary.totalCashOut)}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Scale className="w-4 h-4" />
                  الرصيد المتوقع
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-primary">{formatCurrency(expectedCash)}</p>
              </CardContent>
            </Card>
          </div>

          {/* Reconciliation Result */}
          <Card className={isBalanced ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800' : 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800'}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  {isBalanced ? (
                    <CheckCircle className="w-12 h-12 text-green-600" />
                  ) : (
                    <AlertTriangle className="w-12 h-12 text-red-600" />
                  )}
                  <div>
                    <p className="text-lg font-semibold">
                      {isBalanced ? 'الخزينة متطابقة' : 'يوجد فرق في الخزينة'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      الرصيد الفعلي: {formatCurrency(actualCash)} | المتوقع: {formatCurrency(expectedCash)}
                    </p>
                  </div>
                </div>
                <div className="text-left">
                  <p className="text-sm text-muted-foreground">الفرق</p>
                  <p className={`text-3xl font-bold ${variance > 0 ? 'text-green-600' : variance < 0 ? 'text-red-600' : ''}`}>
                    {variance > 0 ? '+' : ''}{formatCurrency(variance)}
                  </p>
                  {!isBalanced && (
                    <p className="text-sm text-muted-foreground">
                      {variance > 0 ? '(زيادة)' : '(عجز)'}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Cash Flow Summary */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-green-700 dark:text-green-400 flex items-center gap-2">
                  <ArrowUpRight className="w-5 h-5" />
                  الوارد
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <span>المبيعات النقدية</span>
                  <span className="font-semibold">{formatCurrency(reportData.summary.cashSalesTotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span>نقدي من مبيعات مقسمة</span>
                  <span className="font-semibold">{formatCurrency(reportData.summary.splitCashTotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span>تحصيلات</span>
                  <span className="font-semibold">{formatCurrency(reportData.summary.cashReceipts)}</span>
                </div>
                <div className="border-t pt-2 flex justify-between font-bold">
                  <span>الإجمالي</span>
                  <span className="text-green-600">
                    {formatCurrency(reportData.summary.totalCashIn + reportData.summary.cashReceipts)}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-red-700 dark:text-red-400 flex items-center gap-2">
                  <ArrowDownRight className="w-5 h-5" />
                  الصادر
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <span>المرتجعات</span>
                  <span className="font-semibold">{formatCurrency(reportData.summary.cashRefunds)}</span>
                </div>
                <div className="flex justify-between">
                  <span>المصروفات</span>
                  <span className="font-semibold">{formatCurrency(reportData.summary.cashPayouts)}</span>
                </div>
                <div className="border-t pt-2 flex justify-between font-bold">
                  <span>الإجمالي</span>
                  <span className="text-red-600">{formatCurrency(reportData.summary.totalCashOut)}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Transactions Table */}
          <Card>
            <CardHeader>
              <CardTitle>تفاصيل الحركات النقدية</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الوقت</TableHead>
                    <TableHead>النوع</TableHead>
                    <TableHead>البيان</TableHead>
                    <TableHead>المرجع</TableHead>
                    <TableHead>المبلغ</TableHead>
                    <TableHead>الموظف</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reportData.transactions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                        لا توجد حركات نقدية في هذا اليوم
                      </TableCell>
                    </TableRow>
                  ) : (
                    reportData.transactions.map((t: any, index: number) => (
                      <TableRow key={index}>
                        <TableCell>{t.time}</TableCell>
                        <TableCell>
                          <span className={`px-2 py-1 rounded text-xs ${
                            t.type === 'in' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {t.type === 'in' ? 'وارد' : 'صادر'}
                          </span>
                        </TableCell>
                        <TableCell>{t.category}</TableCell>
                        <TableCell className="font-mono">{t.reference}</TableCell>
                        <TableCell className={`font-semibold ${t.type === 'in' ? 'text-green-600' : 'text-red-600'}`}>
                          {t.type === 'in' ? '+' : '-'}{formatCurrency(t.amount)}
                        </TableCell>
                        <TableCell>{t.person}</TableCell>
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
