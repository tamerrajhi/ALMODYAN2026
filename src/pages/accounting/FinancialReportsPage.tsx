import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryTable } from '@/lib/dataGateway';
import * as apiClient from '@/lib/apiClient';
import MainLayout from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Download, FileSpreadsheet, TrendingUp, TrendingDown, Scale } from 'lucide-react';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';

type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_type: AccountType;
  current_balance: number;
}

interface JournalEntryLine {
  account_id: string;
  debit_amount: number;
  credit_amount: number;
  journal_entry: {
    entry_date: string;
    is_posted: boolean;
  };
}

const accountTypeLabels: Record<AccountType, string> = {
  asset: 'الأصول',
  liability: 'الخصوم',
  equity: 'حقوق الملكية',
  revenue: 'الإيرادات',
  expense: 'المصروفات',
};

export default function FinancialReportsPage() {
  const [startDate, setStartDate] = useState(format(new Date(new Date().getFullYear(), 0, 1), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [activeTab, setActiveTab] = useState('trial-balance');

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts-for-reports'],
    queryFn: async () => {
      const { data, error } = await queryTable<Account[]>('chart_of_accounts', {
        filters: [{ type: 'eq', column: 'is_active', value: true }],
        order: { column: 'account_code', ascending: true },
      });
      if (error) throw new Error(error.message);
      return data || [];
    },
  });

  const { data: journalLines = [] } = useQuery({
    queryKey: ['journal-lines-for-reports', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await apiClient.get<JournalEntryLine[]>('/api/journal-lines-with-entries', { start_date: startDate, end_date: endDate });
      if (error) throw new Error(error.message);
      return data || [];
    },
  });

  // Calculate balances for each account
  const accountBalances = accounts.map(account => {
    const lines = journalLines.filter(line => line.account_id === account.id);
    const totalDebit = lines.reduce((sum, line) => sum + (line.debit_amount || 0), 0);
    const totalCredit = lines.reduce((sum, line) => sum + (line.credit_amount || 0), 0);
    
    // For assets and expenses: debit increases, credit decreases
    // For liabilities, equity, and revenue: credit increases, debit decreases
    let balance = 0;
    if (account.account_type === 'asset' || account.account_type === 'expense') {
      balance = totalDebit - totalCredit;
    } else {
      balance = totalCredit - totalDebit;
    }

    return {
      ...account,
      totalDebit,
      totalCredit,
      balance,
    };
  }).filter(a => a.totalDebit > 0 || a.totalCredit > 0 || a.balance !== 0);

  // Trial Balance totals
  const trialBalanceTotals = accountBalances.reduce(
    (acc, account) => ({
      debit: acc.debit + account.totalDebit,
      credit: acc.credit + account.totalCredit,
    }),
    { debit: 0, credit: 0 }
  );

  // Income Statement data
  const revenueAccounts = accountBalances.filter(a => a.account_type === 'revenue');
  const expenseAccounts = accountBalances.filter(a => a.account_type === 'expense');
  const totalRevenue = revenueAccounts.reduce((sum, a) => sum + a.balance, 0);
  const totalExpenses = expenseAccounts.reduce((sum, a) => sum + a.balance, 0);
  const netIncome = totalRevenue - totalExpenses;

  // Balance Sheet data
  const assetAccounts = accountBalances.filter(a => a.account_type === 'asset');
  const liabilityAccounts = accountBalances.filter(a => a.account_type === 'liability');
  const equityAccounts = accountBalances.filter(a => a.account_type === 'equity');
  const totalAssets = assetAccounts.reduce((sum, a) => sum + a.balance, 0);
  const totalLiabilities = liabilityAccounts.reduce((sum, a) => sum + a.balance, 0);
  const totalEquity = equityAccounts.reduce((sum, a) => sum + a.balance, 0) + netIncome;

  const exportToExcel = (data: any[], filename: string) => {
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    XLSX.writeFile(wb, `${filename}.xlsx`);
  };

  const exportTrialBalance = () => {
    const data = accountBalances.map(a => ({
      'رقم الحساب': a.account_code,
      'اسم الحساب': a.account_name,
      'مدين': a.totalDebit,
      'دائن': a.totalCredit,
      'الرصيد': a.balance,
    }));
    exportToExcel(data, `ميزان_المراجعة_${startDate}_${endDate}`);
  };

  const exportIncomeStatement = () => {
    const data = [
      ...revenueAccounts.map(a => ({ النوع: 'إيراد', 'اسم الحساب': a.account_name, المبلغ: a.balance })),
      ...expenseAccounts.map(a => ({ النوع: 'مصروف', 'اسم الحساب': a.account_name, المبلغ: a.balance })),
      { النوع: 'صافي الربح/الخسارة', 'اسم الحساب': '', المبلغ: netIncome },
    ];
    exportToExcel(data, `قائمة_الدخل_${startDate}_${endDate}`);
  };

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-3xl font-bold">التقارير المالية</h1>
            <p className="text-muted-foreground">ميزان المراجعة وقائمة الدخل والميزانية</p>
          </div>
        </div>

        {/* Date Range */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="space-y-2">
                <Label>من تاريخ</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>إلى تاريخ</Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="trial-balance" className="gap-2">
              <Scale className="h-4 w-4" />
              ميزان المراجعة
            </TabsTrigger>
            <TabsTrigger value="income-statement" className="gap-2">
              <TrendingUp className="h-4 w-4" />
              قائمة الدخل
            </TabsTrigger>
            <TabsTrigger value="balance-sheet" className="gap-2">
              <FileSpreadsheet className="h-4 w-4" />
              الميزانية العمومية
            </TabsTrigger>
          </TabsList>

          {/* Trial Balance */}
          <TabsContent value="trial-balance" className="space-y-4">
            <div className="flex justify-end">
              <Button variant="outline" onClick={exportTrialBalance} className="gap-2">
                <Download className="h-4 w-4" />
                تصدير Excel
              </Button>
            </div>

            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>رقم الحساب</TableHead>
                    <TableHead>اسم الحساب</TableHead>
                    <TableHead className="text-left">مدين</TableHead>
                    <TableHead className="text-left">دائن</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accountBalances.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8">
                        لا توجد حركات في هذه الفترة
                      </TableCell>
                    </TableRow>
                  ) : (
                    <>
                      {accountBalances.map((account) => (
                        <TableRow key={account.id}>
                          <TableCell className="font-mono">{account.account_code}</TableCell>
                          <TableCell>{account.account_name}</TableCell>
                          <TableCell className="text-left font-mono">
                            {account.totalDebit > 0 ? account.totalDebit.toLocaleString() : '-'}
                          </TableCell>
                          <TableCell className="text-left font-mono">
                            {account.totalCredit > 0 ? account.totalCredit.toLocaleString() : '-'}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-muted/50 font-bold">
                        <TableCell colSpan={2}>الإجمالي</TableCell>
                        <TableCell className="text-left">{trialBalanceTotals.debit.toLocaleString()}</TableCell>
                        <TableCell className="text-left">{trialBalanceTotals.credit.toLocaleString()}</TableCell>
                      </TableRow>
                    </>
                  )}
                </TableBody>
              </Table>
            </div>

            {Math.abs(trialBalanceTotals.debit - trialBalanceTotals.credit) > 0.01 && (
              <p className="text-destructive text-center">
                تنبيه: ميزان المراجعة غير متوازن! الفرق: {Math.abs(trialBalanceTotals.debit - trialBalanceTotals.credit).toLocaleString()}
              </p>
            )}
            {Math.abs(trialBalanceTotals.debit - trialBalanceTotals.credit) <= 0.01 && accountBalances.length > 0 && (
              <p className="text-green-500 text-center">
                ✓ ميزان المراجعة متوازن
              </p>
            )}
          </TabsContent>

          {/* Income Statement */}
          <TabsContent value="income-statement" className="space-y-4">
            <div className="flex justify-end">
              <Button variant="outline" onClick={exportIncomeStatement} className="gap-2">
                <Download className="h-4 w-4" />
                تصدير Excel
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Revenue */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-green-500">
                    <TrendingUp className="h-5 w-5" />
                    الإيرادات
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableBody>
                      {revenueAccounts.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={2} className="text-center py-4">
                            لا توجد إيرادات
                          </TableCell>
                        </TableRow>
                      ) : (
                        <>
                          {revenueAccounts.map((account) => (
                            <TableRow key={account.id}>
                              <TableCell>{account.account_name}</TableCell>
                              <TableCell className="text-left font-mono text-green-500">
                                {account.balance.toLocaleString()}
                              </TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="bg-muted/50 font-bold">
                            <TableCell>إجمالي الإيرادات</TableCell>
                            <TableCell className="text-left text-green-500">
                              {totalRevenue.toLocaleString()}
                            </TableCell>
                          </TableRow>
                        </>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* Expenses */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-red-500">
                    <TrendingDown className="h-5 w-5" />
                    المصروفات
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableBody>
                      {expenseAccounts.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={2} className="text-center py-4">
                            لا توجد مصروفات
                          </TableCell>
                        </TableRow>
                      ) : (
                        <>
                          {expenseAccounts.map((account) => (
                            <TableRow key={account.id}>
                              <TableCell>{account.account_name}</TableCell>
                              <TableCell className="text-left font-mono text-red-500">
                                {account.balance.toLocaleString()}
                              </TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="bg-muted/50 font-bold">
                            <TableCell>إجمالي المصروفات</TableCell>
                            <TableCell className="text-left text-red-500">
                              {totalExpenses.toLocaleString()}
                            </TableCell>
                          </TableRow>
                        </>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>

            {/* Net Income */}
            <Card className={netIncome >= 0 ? 'border-green-500/50' : 'border-red-500/50'}>
              <CardContent className="py-6">
                <div className="flex items-center justify-between">
                  <span className="text-xl font-bold">
                    {netIncome >= 0 ? 'صافي الربح' : 'صافي الخسارة'}
                  </span>
                  <span className={`text-3xl font-bold ${netIncome >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {Math.abs(netIncome).toLocaleString()}
                  </span>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Balance Sheet */}
          <TabsContent value="balance-sheet" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Assets */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-blue-500">الأصول</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableBody>
                      {assetAccounts.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={2} className="text-center py-4">
                            لا توجد أصول
                          </TableCell>
                        </TableRow>
                      ) : (
                        <>
                          {assetAccounts.map((account) => (
                            <TableRow key={account.id}>
                              <TableCell>{account.account_name}</TableCell>
                              <TableCell className="text-left font-mono">
                                {account.balance.toLocaleString()}
                              </TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="bg-muted/50 font-bold">
                            <TableCell>إجمالي الأصول</TableCell>
                            <TableCell className="text-left text-blue-500">
                              {totalAssets.toLocaleString()}
                            </TableCell>
                          </TableRow>
                        </>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* Liabilities & Equity */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-purple-500">الخصوم وحقوق الملكية</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableBody>
                      {/* Liabilities */}
                      {liabilityAccounts.map((account) => (
                        <TableRow key={account.id}>
                          <TableCell>{account.account_name}</TableCell>
                          <TableCell className="text-left font-mono">
                            {account.balance.toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                      {liabilityAccounts.length > 0 && (
                        <TableRow className="bg-muted/30">
                          <TableCell className="font-medium">إجمالي الخصوم</TableCell>
                          <TableCell className="text-left">
                            {totalLiabilities.toLocaleString()}
                          </TableCell>
                        </TableRow>
                      )}
                      
                      {/* Equity */}
                      {equityAccounts.map((account) => (
                        <TableRow key={account.id}>
                          <TableCell>{account.account_name}</TableCell>
                          <TableCell className="text-left font-mono">
                            {account.balance.toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow>
                        <TableCell>صافي الربح (الخسارة)</TableCell>
                        <TableCell className={`text-left font-mono ${netIncome >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {netIncome.toLocaleString()}
                        </TableCell>
                      </TableRow>
                      <TableRow className="bg-muted/50 font-bold">
                        <TableCell>إجمالي الخصوم وحقوق الملكية</TableCell>
                        <TableCell className="text-left text-purple-500">
                          {(totalLiabilities + totalEquity).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>

            {/* Balance Check */}
            {Math.abs(totalAssets - (totalLiabilities + totalEquity)) > 0.01 && (
              <p className="text-destructive text-center">
                تنبيه: الميزانية غير متوازنة! الفرق: {Math.abs(totalAssets - (totalLiabilities + totalEquity)).toLocaleString()}
              </p>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
