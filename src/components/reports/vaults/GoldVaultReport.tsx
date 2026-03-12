import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowRight, Coins, TrendingUp, TrendingDown } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import ReportFilters from '../ReportFilters';

interface GoldVaultReportProps {
  onBack: () => void;
}

export default function GoldVaultReport({ onBack }: GoldVaultReportProps) {
  const { t, language } = useLanguage();
  const dateLocale = language === 'ar' ? ar : enUS;
  const [dateFrom, setDateFrom] = useState<Date>();
  const [dateTo, setDateTo] = useState<Date>();

  const { data: transactions, isLoading } = useQuery({
    queryKey: ['gold-vault-report', dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFrom) params.set('dateFrom', format(dateFrom, 'yyyy-MM-dd'));
      if (dateTo) params.set('dateTo', format(dateTo, 'yyyy-MM-dd'));
      const res = await fetch(`/api/reports/gold-vault-report?${params}`, { credentials: 'include' });
      if (res.status === 501) return [];
      return res.json();
    }
  });

  const totalIn = transactions?.filter(t => t.transaction_type === 'in' || t.transaction_type === 'deposit').reduce((sum, t) => sum + (t.weight_grams || 0), 0) || 0;
  const totalOut = transactions?.filter(t => t.transaction_type === 'out' || t.transaction_type === 'withdrawal').reduce((sum, t) => sum + (t.weight_grams || 0), 0) || 0;
  const netBalance = totalIn - totalOut;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowRight className="w-5 h-5" />
          </Button>
          <div>
            <h2 className="text-xl font-bold">{language === 'ar' ? 'تقرير حركة خزائن الذهب' : 'Gold Vault Report'}</h2>
            <p className="text-muted-foreground text-sm">{language === 'ar' ? 'حركة الإيداع والسحب من خزائن الذهب' : 'Gold deposit and withdrawal movements'}</p>
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
              {language === 'ar' ? 'إجمالي الوارد' : 'Total In'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{totalIn.toFixed(2)} {t.common.gram}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-red-600" />
              {language === 'ar' ? 'إجمالي الصادر' : 'Total Out'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{totalOut.toFixed(2)} {t.common.gram}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Coins className="w-4 h-4" />
              {language === 'ar' ? 'صافي الحركة' : 'Net Movement'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${netBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {netBalance.toFixed(2)} {t.common.gram}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{language === 'ar' ? 'الخزينة' : 'Vault'}</TableHead>
                <TableHead>{language === 'ar' ? 'التاريخ' : 'Date'}</TableHead>
                <TableHead>{language === 'ar' ? 'النوع' : 'Type'}</TableHead>
                <TableHead>{language === 'ar' ? 'العيار' : 'Karat'}</TableHead>
                <TableHead className="text-right">{language === 'ar' ? 'الوزن (جرام)' : 'Weight (g)'}</TableHead>
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
                    <TableCell className="font-medium">{tx.vault_id?.slice(0, 8) || '-'}</TableCell>
                    <TableCell>{format(new Date(tx.transaction_date), 'PP', { locale: dateLocale })}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        tx.transaction_type === 'in' || tx.transaction_type === 'deposit'
                          ? 'bg-green-100 text-green-700' 
                          : 'bg-red-100 text-red-700'
                      }`}>
                        {tx.transaction_type}
                      </span>
                    </TableCell>
                    <TableCell>{tx.gold_karats?.karat_name || tx.gold_type || '-'}</TableCell>
                    <TableCell className={`text-right font-medium ${
                      tx.transaction_type === 'in' || tx.transaction_type === 'deposit' ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {(tx.transaction_type === 'in' || tx.transaction_type === 'deposit' ? '+' : '-')}{(tx.weight_grams || 0).toFixed(2)}
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
