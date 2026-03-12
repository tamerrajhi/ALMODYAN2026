import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowRight, Download, TrendingUp, ShoppingBag, RotateCcw, Calculator } from 'lucide-react';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import { useLanguage } from '@/contexts/LanguageContext';

interface NetSalesReportProps {
  onBack: () => void;
}

export default function NetSalesReport({ onBack }: NetSalesReportProps) {
  const { language } = useLanguage();
  const [dateFrom, setDateFrom] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [selectedBranch, setSelectedBranch] = useState<string>('all');

  const { data: branches } = useQuery({
    queryKey: ['branches-for-report'],
    queryFn: async () => {
      const res = await fetch('/api/active-branches', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch branches');
      return res.json();
    },
  });

  const { data: reportResult, isLoading } = useQuery({
    queryKey: ['net-sales-report', dateFrom, dateTo, selectedBranch],
    queryFn: async () => {
      const params = new URLSearchParams({ startDate: dateFrom, endDate: dateTo });
      if (selectedBranch !== 'all') params.set('branch', selectedBranch);
      const res = await fetch(`/api/reports/net-sales?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch net sales report');
      const data = await res.json();
      const mapInvoice = (item: any) => ({
        ...item,
        branch: { branch_name: item.branch_name || '-' },
        customer: { full_name: item.customer_name || null },
      });
      return {
        sales: (data.sales_invoices || []).map(mapInvoice),
        returns: (data.return_invoices || []).map(mapInvoice),
      };
    },
  });

  const sales = reportResult?.sales;
  const returns = reportResult?.returns;

  const totalSales = sales?.reduce((sum: number, s: any) => sum + (s.total_amount || 0), 0) || 0;
  const totalReturns = returns?.reduce((sum: number, r: any) => sum + (r.total_amount || 0), 0) || 0;
  const netSales = totalSales - totalReturns;

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString(language === 'ar' ? 'ar-SA' : 'en-SA', {
      style: 'currency',
      currency: 'SAR',
      minimumFractionDigits: 2,
    });
  };

  const handleExport = () => {
    const salesData = (sales || []).map((s: any) => ({
      'النوع': 'فاتورة مبيعات',
      'الرقم': s.invoice_number,
      'التاريخ': format(new Date(s.invoice_date), 'yyyy-MM-dd'),
      'العميل': (s.customer as any)?.full_name || 'عميل نقدي',
      'الفرع': (s.branch as any)?.branch_name || '-',
      'المبلغ': s.total_amount,
    }));

    const returnData = (returns || []).map((r: any) => ({
      'النوع': 'مرتجع مبيعات',
      'الرقم': r.invoice_number,
      'التاريخ': format(new Date(r.invoice_date), 'yyyy-MM-dd'),
      'العميل': (r.customer as any)?.full_name || 'عميل نقدي',
      'الفرع': (r.branch as any)?.branch_name || '-',
      'المبلغ': -(r.total_amount || 0),
    }));

    const allData = [...salesData, ...returnData];
    allData.push({
      'النوع': '',
      'الرقم': '',
      'التاريخ': '',
      'العميل': '',
      'الفرع': 'صافي المبيعات',
      'المبلغ': netSales,
    });

    const ws = XLSX.utils.json_to_sheet(allData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'صافي المبيعات');
    XLSX.writeFile(wb, `net-sales-${dateFrom}-to-${dateTo}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowRight className="w-5 h-5" />
          </Button>
          <div>
            <h2 className="text-xl font-bold">
              {language === 'ar' ? 'تقرير صافي المبيعات' : 'Net Sales Report'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {language === 'ar' ? 'المبيعات - المرتجعات = صافي المبيعات' : 'Sales - Returns = Net Sales'}
            </p>
          </div>
        </div>
        <Button onClick={handleExport} variant="outline" className="gap-2">
          <Download className="w-4 h-4" />
          {language === 'ar' ? 'تصدير Excel' : 'Export Excel'}
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>{language === 'ar' ? 'من تاريخ' : 'From Date'}</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{language === 'ar' ? 'إلى تاريخ' : 'To Date'}</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{language === 'ar' ? 'الفرع' : 'Branch'}</Label>
              <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{language === 'ar' ? 'جميع الفروع' : 'All Branches'}</SelectItem>
                  {branches?.map((branch: any) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.branch_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-green-100">
                <ShoppingBag className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {language === 'ar' ? 'إجمالي المبيعات' : 'Total Sales'}
                </p>
                <p className="text-2xl font-bold text-green-600" dir="ltr">
                  {formatCurrency(totalSales)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {sales?.length || 0} {language === 'ar' ? 'فاتورة' : 'invoices'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-red-100">
                <RotateCcw className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {language === 'ar' ? 'إجمالي المرتجعات' : 'Total Returns'}
                </p>
                <p className="text-2xl font-bold text-red-600" dir="ltr">
                  -{formatCurrency(totalReturns)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {returns?.length || 0} {language === 'ar' ? 'مرتجع' : 'returns'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-primary/10 to-primary/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-primary/20">
                <Calculator className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {language === 'ar' ? 'صافي المبيعات' : 'Net Sales'}
                </p>
                <p className="text-2xl font-bold text-primary" dir="ltr">
                  {formatCurrency(netSales)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sales Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-green-600" />
            {language === 'ar' ? 'فواتير المبيعات' : 'Sales Invoices'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              {language === 'ar' ? 'جاري التحميل...' : 'Loading...'}
            </div>
          ) : !sales?.length ? (
            <div className="text-center py-8 text-muted-foreground">
              {language === 'ar' ? 'لا توجد فواتير في هذه الفترة' : 'No invoices in this period'}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{language === 'ar' ? 'رقم الفاتورة' : 'Invoice #'}</TableHead>
                  <TableHead>{language === 'ar' ? 'التاريخ' : 'Date'}</TableHead>
                  <TableHead>{language === 'ar' ? 'العميل' : 'Customer'}</TableHead>
                  <TableHead>{language === 'ar' ? 'الفرع' : 'Branch'}</TableHead>
                  <TableHead className="text-end">{language === 'ar' ? 'المبلغ' : 'Amount'}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.map((s: any) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.invoice_number}</TableCell>
                    <TableCell>{format(new Date(s.invoice_date), 'yyyy-MM-dd')}</TableCell>
                    <TableCell>{(s.customer as any)?.full_name || 'عميل نقدي'}</TableCell>
                    <TableCell>{(s.branch as any)?.branch_name || '-'}</TableCell>
                    <TableCell className="text-end font-medium" dir="ltr">
                      {formatCurrency(s.total_amount || 0)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Returns Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-red-600" />
            {language === 'ar' ? 'مرتجعات المبيعات' : 'Sales Returns'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              {language === 'ar' ? 'جاري التحميل...' : 'Loading...'}
            </div>
          ) : !returns?.length ? (
            <div className="text-center py-8 text-muted-foreground">
              {language === 'ar' ? 'لا توجد مرتجعات في هذه الفترة' : 'No returns in this period'}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{language === 'ar' ? 'رقم المرتجع' : 'Return #'}</TableHead>
                  <TableHead>{language === 'ar' ? 'التاريخ' : 'Date'}</TableHead>
                  <TableHead>{language === 'ar' ? 'العميل' : 'Customer'}</TableHead>
                  <TableHead>{language === 'ar' ? 'الفرع' : 'Branch'}</TableHead>
                  <TableHead className="text-end">{language === 'ar' ? 'المبلغ' : 'Amount'}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {returns.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.invoice_number}</TableCell>
                    <TableCell>{format(new Date(r.invoice_date), 'yyyy-MM-dd')}</TableCell>
                    <TableCell>{(r.customer as any)?.full_name || 'عميل نقدي'}</TableCell>
                    <TableCell>{(r.branch as any)?.branch_name || '-'}</TableCell>
                    <TableCell className="text-end font-medium text-red-600" dir="ltr">
                      -{formatCurrency(r.total_amount || 0)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
