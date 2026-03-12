import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowRight, Building, Wallet, RotateCcw, Receipt, Download } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import * as XLSX from 'xlsx';

interface SupplierBalancesReportProps {
  onBack: () => void;
}

interface SupplierWithBalance {
  id: string;
  supplier_ref: string | null;
  supplier_name: string;
  total_purchases: number;
  total_returns: number;
  total_payments: number;
  balance: number;
  items_count: number;
}

export default function SupplierBalancesReport({ onBack }: SupplierBalancesReportProps) {
  const { t, language } = useLanguage();

  // Fetch suppliers with calculated balances
  const { data: suppliersWithBalances, isLoading } = useQuery({
    queryKey: ['supplier-balances-report-enhanced'],
    queryFn: async () => {
      const res = await fetch('/api/reports/supplier-balances', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch supplier balances');
      return await res.json() as SupplierWithBalance[];
    }
  });

  const totalSuppliers = suppliersWithBalances?.length || 0;
  const totalBalance = suppliersWithBalances?.reduce((sum, s) => sum + s.balance, 0) || 0;
  const totalPurchases = suppliersWithBalances?.reduce((sum, s) => sum + s.total_purchases, 0) || 0;
  const totalReturns = suppliersWithBalances?.reduce((sum, s) => sum + s.total_returns, 0) || 0;

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString(language === 'ar' ? 'ar-SA' : 'en-SA', {
      style: 'currency',
      currency: 'SAR',
      minimumFractionDigits: 2,
    });
  };

  const handleExport = () => {
    const data = (suppliersWithBalances || []).map(s => ({
      'كود المورد': s.supplier_ref || '-',
      'اسم المورد': s.supplier_name,
      'إجمالي المشتريات': s.total_purchases,
      'المرتجعات': s.total_returns,
      'المدفوعات': s.total_payments,
      'الرصيد': s.balance,
      'عدد القطع': s.items_count,
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'أرصدة الموردين');
    XLSX.writeFile(wb, `supplier-balances-${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowRight className="w-5 h-5" />
          </Button>
          <div>
            <h2 className="text-xl font-bold">{language === 'ar' ? 'تقرير أرصدة الموردين' : 'Supplier Balances Report'}</h2>
            <p className="text-muted-foreground text-sm">
              {language === 'ar' ? 'المشتريات - المرتجعات - المدفوعات = الرصيد' : 'Purchases - Returns - Payments = Balance'}
            </p>
          </div>
        </div>
        <Button onClick={handleExport} variant="outline" className="gap-2">
          <Download className="w-4 h-4" />
          {language === 'ar' ? 'تصدير Excel' : 'Export Excel'}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Building className="w-4 h-4" />
              {language === 'ar' ? 'إجمالي الموردين' : 'Total Suppliers'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalSuppliers}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Receipt className="w-4 h-4 text-blue-500" />
              {language === 'ar' ? 'إجمالي المشتريات' : 'Total Purchases'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600" dir="ltr">{formatCurrency(totalPurchases)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-orange-500" />
              {language === 'ar' ? 'إجمالي المرتجعات' : 'Total Returns'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600" dir="ltr">-{formatCurrency(totalReturns)}</div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-primary/10 to-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Wallet className="w-4 h-4" />
              {language === 'ar' ? 'إجمالي المستحق' : 'Total Payable'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary" dir="ltr">{formatCurrency(totalBalance)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{language === 'ar' ? 'كود المورد' : 'Supplier Code'}</TableHead>
                <TableHead>{language === 'ar' ? 'اسم المورد' : 'Supplier Name'}</TableHead>
                <TableHead className="text-end">{language === 'ar' ? 'المشتريات' : 'Purchases'}</TableHead>
                <TableHead className="text-end">{language === 'ar' ? 'المرتجعات' : 'Returns'}</TableHead>
                <TableHead className="text-end">{language === 'ar' ? 'المدفوعات' : 'Payments'}</TableHead>
                <TableHead className="text-end">{language === 'ar' ? 'الرصيد' : 'Balance'}</TableHead>
                <TableHead className="text-center">{language === 'ar' ? 'القطع' : 'Items'}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">{t.common.loading}</TableCell>
                </TableRow>
              ) : suppliersWithBalances?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">{t.common.noData}</TableCell>
                </TableRow>
              ) : (
                suppliersWithBalances?.map((supplier) => (
                  <TableRow key={supplier.id}>
                    <TableCell className="font-medium">{supplier.supplier_ref || '-'}</TableCell>
                    <TableCell>{supplier.supplier_name}</TableCell>
                    <TableCell className="text-end" dir="ltr">{formatCurrency(supplier.total_purchases)}</TableCell>
                    <TableCell className="text-end text-orange-600" dir="ltr">
                      {supplier.total_returns > 0 ? `-${formatCurrency(supplier.total_returns)}` : '-'}
                    </TableCell>
                    <TableCell className="text-end text-green-600" dir="ltr">
                      {supplier.total_payments > 0 ? formatCurrency(supplier.total_payments) : '-'}
                    </TableCell>
                    <TableCell className={`text-end font-bold ${supplier.balance > 0 ? 'text-destructive' : 'text-green-600'}`} dir="ltr">
                      {formatCurrency(supplier.balance)}
                    </TableCell>
                    <TableCell className="text-center">{supplier.items_count}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}