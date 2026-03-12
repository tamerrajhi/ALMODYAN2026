import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, Download, RotateCcw, FileText, Loader2, Search, Calendar } from 'lucide-react';
import { format, subDays, startOfMonth, endOfMonth } from 'date-fns';
import { ar } from 'date-fns/locale';
import * as XLSX from 'xlsx';

interface PurchaseReturnsReportProps {
  onBack: () => void;
}

const PurchaseReturnsReport = ({ onBack }: PurchaseReturnsReportProps) => {
  const { language } = useLanguage();
  const [dateFrom, setDateFrom] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [selectedBranch, setSelectedBranch] = useState<string>('all');
  const [selectedSupplier, setSelectedSupplier] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: async () => {
      const res = await fetch('/api/active-branches', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch branches');
      return res.json();
    },
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-for-report'],
    queryFn: async () => {
      const res = await fetch('/api/suppliers', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch suppliers');
      return res.json();
    },
  });

  const { data: returns = [], isLoading } = useQuery({
    queryKey: ['purchase-returns-report', dateFrom, dateTo, selectedBranch, selectedSupplier],
    queryFn: async () => {
      const params = new URLSearchParams({ dateFrom, dateTo });
      if (selectedBranch !== 'all') params.set('branch', selectedBranch);
      if (selectedSupplier !== 'all') params.set('supplier', selectedSupplier);
      const res = await fetch(`/api/reports/purchase-returns?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch purchase returns report');
      const data = await res.json();
      return (data || []).map((item: any) => ({
        ...item,
        suppliers: item.supplier || { id: null, supplier_name: '-' },
        branches: item.branch || { id: null, branch_name: '-' },
      }));
    },
  });

  const filteredReturns = useMemo(() => {
    if (!searchQuery.trim()) return returns;
    const query = searchQuery.toLowerCase();
    return returns.filter((ret: any) =>
      ret.invoice_number?.toLowerCase().includes(query) ||
      ret.suppliers?.supplier_name?.toLowerCase().includes(query) ||
      ret.linked_invoice_id?.toLowerCase().includes(query)
    );
  }, [returns, searchQuery]);

  const summary = useMemo(() => {
    return {
      totalReturns: filteredReturns.length,
      totalAmount: filteredReturns.reduce((sum: number, r: any) => sum + (r.total_amount || 0), 0),
      totalTax: filteredReturns.reduce((sum: number, r: any) => sum + (r.tax_amount || 0), 0),
      pendingCount: filteredReturns.filter((r: any) => r.status === 'pending').length,
      completedCount: filteredReturns.filter((r: any) => r.status === 'completed' || r.status === 'approved').length,
      cancelledCount: filteredReturns.filter((r: any) => r.status === 'cancelled').length,
    };
  }, [filteredReturns]);

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString(language === 'ar' ? 'ar-SA' : 'en-SA', {
      style: 'currency',
      currency: 'SAR',
      minimumFractionDigits: 2,
    });
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      pending: { label: language === 'ar' ? 'معلق' : 'Pending', variant: 'secondary' },
      approved: { label: language === 'ar' ? 'معتمد' : 'Approved', variant: 'default' },
      completed: { label: language === 'ar' ? 'مكتمل' : 'Completed', variant: 'default' },
      cancelled: { label: language === 'ar' ? 'ملغي' : 'Cancelled', variant: 'destructive' },
    };
    const config = statusConfig[status] || statusConfig.pending;
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const handleExport = () => {
    const exportData = filteredReturns.map((ret: any) => ({
      [language === 'ar' ? 'رقم المرتجع' : 'Return No.']: ret.invoice_number,
      [language === 'ar' ? 'التاريخ' : 'Date']: format(new Date(ret.invoice_date), 'yyyy-MM-dd'),
      [language === 'ar' ? 'المورد' : 'Supplier']: ret.suppliers?.supplier_name || '-',
      [language === 'ar' ? 'الفرع' : 'Branch']: ret.branches?.branch_name || '-',
      [language === 'ar' ? 'الفاتورة الأصلية' : 'Original Invoice']: ret.linked_invoice_id || '-',
      [language === 'ar' ? 'المبلغ قبل الضريبة' : 'Amount Before Tax']: ret.subtotal || 0,
      [language === 'ar' ? 'الضريبة' : 'Tax']: ret.tax_amount || 0,
      [language === 'ar' ? 'الإجمالي' : 'Total']: ret.total_amount || 0,
      [language === 'ar' ? 'الحالة' : 'Status']: ret.status,
    }));

    exportData.push({
      [language === 'ar' ? 'رقم المرتجع' : 'Return No.']: language === 'ar' ? 'الإجمالي' : 'Total',
      [language === 'ar' ? 'التاريخ' : 'Date']: '',
      [language === 'ar' ? 'المورد' : 'Supplier']: '',
      [language === 'ar' ? 'الفرع' : 'Branch']: '',
      [language === 'ar' ? 'الفاتورة الأصلية' : 'Original Invoice']: '',
      [language === 'ar' ? 'المبلغ قبل الضريبة' : 'Amount Before Tax']: summary.totalAmount - summary.totalTax,
      [language === 'ar' ? 'الضريبة' : 'Tax']: summary.totalTax,
      [language === 'ar' ? 'الإجمالي' : 'Total']: summary.totalAmount,
      [language === 'ar' ? 'الحالة' : 'Status']: `${summary.totalReturns} ${language === 'ar' ? 'مرتجع' : 'returns'}`,
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, language === 'ar' ? 'مرتجعات المشتريات' : 'Purchase Returns');
    XLSX.writeFile(wb, `purchase-returns-report-${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <RotateCcw className="w-6 h-6 text-orange-500" />
              {language === 'ar' ? 'تقرير مرتجعات المشتريات' : 'Purchase Returns Report'}
            </h1>
            <p className="text-muted-foreground">
              {language === 'ar'
                ? 'تحليل شامل لمرتجعات المشتريات للموردين'
                : 'Comprehensive analysis of purchase returns to suppliers'}
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
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{language === 'ar' ? 'من تاريخ' : 'From Date'}</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{language === 'ar' ? 'إلى تاريخ' : 'To Date'}</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{language === 'ar' ? 'الفرع' : 'Branch'}</label>
              <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{language === 'ar' ? 'جميع الفروع' : 'All Branches'}</SelectItem>
                  {branches.map((branch: any) => (
                    <SelectItem key={branch.id} value={branch.id}>{branch.branch_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{language === 'ar' ? 'المورد' : 'Supplier'}</label>
              <Select value={selectedSupplier} onValueChange={setSelectedSupplier}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{language === 'ar' ? 'جميع الموردين' : 'All Suppliers'}</SelectItem>
                  {suppliers.map((supplier: any) => (
                    <SelectItem key={supplier.id} value={supplier.id}>{supplier.supplier_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{language === 'ar' ? 'بحث' : 'Search'}</label>
              <div className="relative">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder={language === 'ar' ? 'رقم المرتجع أو المورد...' : 'Return no. or supplier...'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="ps-10"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {language === 'ar' ? 'إجمالي المرتجعات' : 'Total Returns'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalReturns}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {language === 'ar' ? 'إجمالي القيمة' : 'Total Value'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600" dir="ltr">
              {formatCurrency(summary.totalAmount)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {language === 'ar' ? 'إجمالي الضريبة' : 'Total Tax'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600" dir="ltr">
              {formatCurrency(summary.totalTax)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {language === 'ar' ? 'معلقة' : 'Pending'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{summary.pendingCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {language === 'ar' ? 'مكتملة' : 'Completed'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{summary.completedCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Returns Table */}
      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : filteredReturns.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>{language === 'ar' ? 'لا توجد مرتجعات في هذه الفترة' : 'No returns found in this period'}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{language === 'ar' ? 'رقم المرتجع' : 'Return No.'}</TableHead>
                  <TableHead>{language === 'ar' ? 'التاريخ' : 'Date'}</TableHead>
                  <TableHead>{language === 'ar' ? 'المورد' : 'Supplier'}</TableHead>
                  <TableHead>{language === 'ar' ? 'الفرع' : 'Branch'}</TableHead>
                  <TableHead>{language === 'ar' ? 'الفاتورة الأصلية' : 'Original Invoice'}</TableHead>
                  <TableHead className="text-center">{language === 'ar' ? 'المبلغ' : 'Amount'}</TableHead>
                  <TableHead className="text-center">{language === 'ar' ? 'الضريبة' : 'Tax'}</TableHead>
                  <TableHead className="text-center">{language === 'ar' ? 'الإجمالي' : 'Total'}</TableHead>
                  <TableHead className="text-center">{language === 'ar' ? 'الحالة' : 'Status'}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredReturns.map((ret: any) => (
                  <TableRow key={ret.id}>
                    <TableCell className="font-medium">{ret.invoice_number}</TableCell>
                    <TableCell>
                      {format(new Date(ret.invoice_date), 'dd/MM/yyyy', {
                        locale: language === 'ar' ? ar : undefined,
                      })}
                    </TableCell>
                    <TableCell>{ret.suppliers?.supplier_name || '-'}</TableCell>
                    <TableCell>{ret.branches?.branch_name || '-'}</TableCell>
                    <TableCell className="text-primary font-medium">
                      {ret.linked_invoice_id ? ret.linked_invoice_id.substring(0, 8) + '...' : '-'}
                    </TableCell>
                    <TableCell className="text-center" dir="ltr">
                      {formatCurrency(ret.subtotal || 0)}
                    </TableCell>
                    <TableCell className="text-center text-blue-600" dir="ltr">
                      {formatCurrency(ret.tax_amount || 0)}
                    </TableCell>
                    <TableCell className="text-center font-medium text-orange-600" dir="ltr">
                      -{formatCurrency(ret.total_amount || 0)}
                    </TableCell>
                    <TableCell className="text-center">{getStatusBadge(ret.status)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default PurchaseReturnsReport;
