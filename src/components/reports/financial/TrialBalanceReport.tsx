import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowRight, Scale } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface TrialBalanceReportProps {
  onBack: () => void;
}

export default function TrialBalanceReport({ onBack }: TrialBalanceReportProps) {
  const { t, language } = useLanguage();

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['trial-balance-report'],
    queryFn: async () => {
      const res = await fetch('/api/reports/trial-balance', { credentials: 'include' });
      if (res.status === 501) return [];
      return res.json();
    }
  });

  const totalDebit = accounts?.reduce((sum, a) => {
    const balance = a.current_balance || 0;
    return sum + (balance > 0 ? balance : 0);
  }, 0) || 0;

  const totalCredit = accounts?.reduce((sum, a) => {
    const balance = a.current_balance || 0;
    return sum + (balance < 0 ? Math.abs(balance) : 0);
  }, 0) || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowRight className="w-5 h-5" />
          </Button>
          <div>
            <h2 className="text-xl font-bold">{language === 'ar' ? 'ميزان المراجعة' : 'Trial Balance'}</h2>
            <p className="text-muted-foreground text-sm">{language === 'ar' ? 'ملخص أرصدة الحسابات' : 'Summary of account balances'}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{language === 'ar' ? 'إجمالي المدين' : 'Total Debit'}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalDebit.toLocaleString()} {t.currency.sar}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{language === 'ar' ? 'إجمالي الدائن' : 'Total Credit'}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalCredit.toLocaleString()} {t.currency.sar}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Scale className="w-4 h-4" />
              {language === 'ar' ? 'الفرق' : 'Difference'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${Math.abs(totalDebit - totalCredit) < 0.01 ? 'text-green-600' : 'text-red-600'}`}>
              {Math.abs(totalDebit - totalCredit).toLocaleString()} {t.currency.sar}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{language === 'ar' ? 'رقم الحساب' : 'Account #'}</TableHead>
                <TableHead>{language === 'ar' ? 'اسم الحساب' : 'Account Name'}</TableHead>
                <TableHead>{language === 'ar' ? 'النوع' : 'Type'}</TableHead>
                <TableHead className="text-right">{language === 'ar' ? 'مدين' : 'Debit'}</TableHead>
                <TableHead className="text-right">{language === 'ar' ? 'دائن' : 'Credit'}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8">{t.common.loading}</TableCell>
                </TableRow>
              ) : accounts?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8">{t.common.noData}</TableCell>
                </TableRow>
              ) : (
                <>
                  {accounts?.filter(a => (a.current_balance || 0) !== 0).map((account) => {
                    const balance = account.current_balance || 0;
                    return (
                      <TableRow key={account.id}>
                        <TableCell className="font-medium">{account.account_code}</TableCell>
                        <TableCell>{language === 'ar' ? account.account_name : (account.account_name_en || account.account_name)}</TableCell>
                        <TableCell>{account.account_type}</TableCell>
                        <TableCell className="text-right">{balance > 0 ? balance.toLocaleString() : '-'}</TableCell>
                        <TableCell className="text-right">{balance < 0 ? Math.abs(balance).toLocaleString() : '-'}</TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="font-bold bg-muted/50">
                    <TableCell colSpan={3}>{language === 'ar' ? 'الإجمالي' : 'Total'}</TableCell>
                    <TableCell className="text-right">{totalDebit.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{totalCredit.toLocaleString()}</TableCell>
                  </TableRow>
                </>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
