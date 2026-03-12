import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowRight, Wallet, TrendingUp, TrendingDown } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import ReportFilters from '../ReportFilters';

interface CashVaultReportProps {
  onBack: () => void;
}

export default function CashVaultReport({ onBack }: CashVaultReportProps) {
  const { t, language } = useLanguage();
  const dateLocale = language === 'ar' ? ar : enUS;
  const [dateFrom, setDateFrom] = useState<Date>();
  const [dateTo, setDateTo] = useState<Date>();

  const { data: transactions, isLoading } = useQuery({
    queryKey: ['cash-vault-report', dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFrom) params.set('dateFrom', format(dateFrom, 'yyyy-MM-dd'));
      if (dateTo) params.set('dateTo', format(dateTo, 'yyyy-MM-dd'));
      const res = await fetch(`/api/reports/cash-vault-report?${params}`, { credentials: 'include' });
      if (res.status === 501) return [];
      return res.json();
    }
  });

  const totalIn = transactions?.filter(t => t.transaction_type === 'deposit' || t.transaction_type === 'in').reduce((sum, t) => sum + (t.amount || 0), 0) || 0;
  const totalOut = transactions?.filter(t => t.transaction_type === 'withdrawal' || t.transaction_type === 'out').reduce((sum, t) => sum + (t.amount || 0), 0) || 0;
  const netBalance = totalIn - totalOut;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowRight className="w-5 h-5" />
          </Button>
          <div>
            <h2 className="text-xl font-bold">{language === 'ar' ? 'تقرير حركة الصناديق' : 'Cash Vault Report'}</h2>
            <p className="text-muted-foreground text-sm">{language === 'ar' ? 'حركة الإيداع والسحب من الصناديق' : 'Deposit and withdrawal movements'}</p>
          </div>
        </div>
      </div>

      <ReportFilters
        showBranchFilter={false}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onReset={() => { setDateFrom(undefined); setDateTo(undefined); }}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-green-600" />
              {language === 'ar' ? 'إجمالي الإيداعات' : 'Total Deposits'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{totalIn.toLocaleString()} {t.currency.sar}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-red-600" />
              {language === 'ar' ? 'إجمالي السحوبات' : 'Total Withdrawals'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{totalOut.toLocaleString()} {t.currency.sar}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Wallet className="w-4 h-4" />
              {language === 'ar' ? 'صافي الحركة' : 'Net Movement'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${netBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {netBalance.toLocaleString()} {t.currency.sar}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{language === 'ar' ? 'الصندوق' : 'Vault'}</TableHead>
                <TableHead>{language === 'ar' ? 'التاريخ' : 'Date'}</TableHead>
                <TableHead>{language === 'ar' ? 'النوع' : 'Type'}</TableHead>
                <TableHead>{language === 'ar' ? 'طريقة الدفع' : 'Payment Method'}</TableHead>
                <TableHead className="text-right">{language === 'ar' ? 'المبلغ' : 'Amount'}</TableHead>
                <TableHead>{language === 'ar' ? 'ملاحظات' : 'Notes'}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">{t.common.loading}</TableCell>
                </TableRow>
              ) : transactions?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">{t.common.noData}</TableCell>
                </TableRow>
              ) : (
                transactions?.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell className="font-medium">{tx.cash_vaults?.vault_name || '-'}</TableCell>
                    <TableCell>{format(new Date(tx.transaction_date), 'PP', { locale: dateLocale })}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        tx.transaction_type === 'deposit' || tx.transaction_type === 'in' 
                          ? 'bg-green-100 text-green-700' 
                          : 'bg-red-100 text-red-700'
                      }`}>
                        {tx.transaction_type}
                      </span>
                    </TableCell>
                    <TableCell>{tx.payment_method || '-'}</TableCell>
                    <TableCell className={`text-right font-medium ${
                      tx.transaction_type === 'deposit' || tx.transaction_type === 'in' ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {(tx.transaction_type === 'deposit' || tx.transaction_type === 'in' ? '+' : '-')}{(tx.amount || 0).toLocaleString()}
                    </TableCell>
                    <TableCell className="max-w-32 truncate">{tx.notes || '-'}</TableCell>
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
