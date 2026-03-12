import { useQuery } from '@tanstack/react-query';
import { queryTable } from '@/lib/dataGateway';
import * as apiClient from '@/lib/apiClient';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  Banknote,
  FileText,
  ArrowUpCircle,
  ArrowDownCircle,
  Scale,
  CreditCard,
  Building,
} from 'lucide-react';
import { format, subDays, startOfMonth, endOfMonth } from 'date-fns';
import { ar } from 'date-fns/locale';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/utils';

type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_type: AccountType;
  current_balance: number;
}

interface JournalEntry {
  id: string;
  entry_number: string;
  entry_date: string;
  description: string;
  total_debit: number;
  total_credit: number;
  is_posted: boolean;
  reference_type: string;
}

interface Payment {
  id: string;
  payment_number: string;
  payment_type: string;
  payment_date: string;
  amount: number;
}

interface Invoice {
  id: string;
  invoice_number: string;
  invoice_type: string;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  status: string;
}

const COLORS = ['#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444'];

const accountTypeLabels: Record<AccountType, string> = {
  asset: 'الأصول',
  liability: 'الخصوم',
  equity: 'حقوق الملكية',
  revenue: 'الإيرادات',
  expense: 'المصروفات',
};

export default function AccountingDashboard() {
  const today = new Date();
  const monthStart = startOfMonth(today);
  const monthEnd = endOfMonth(today);

  const { data: accounts = [] } = useQuery({
    queryKey: ['dashboard-accounts'],
    queryFn: async () => {
      const { data, error } = await queryTable<Account[]>('chart_of_accounts', {
        filters: [{ type: 'eq', column: 'is_active', value: true }],
        order: { column: 'account_code', ascending: true },
      });
      if (error) throw new Error(error.message);
      return data || [];
    },
  });

  const { data: recentEntries = [] } = useQuery({
    queryKey: ['dashboard-recent-entries'],
    queryFn: async () => {
      const { data, error } = await queryTable<JournalEntry[]>('journal_entries', {
        order: { column: 'created_at', ascending: false },
        limit: 5,
      });
      if (error) throw new Error(error.message);
      return data || [];
    },
  });

  const { data: recentPayments = [] } = useQuery({
    queryKey: ['dashboard-recent-payments'],
    queryFn: async () => {
      const { data, error } = await queryTable<Payment[]>('payments', {
        order: { column: 'created_at', ascending: false },
        limit: 10,
      });
      if (error) throw new Error(error.message);
      return data || [];
    },
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ['dashboard-invoices'],
    queryFn: async () => {
      const { data, error } = await queryTable<Invoice[]>('invoices', {
        order: { column: 'created_at', ascending: false },
      });
      if (error) throw new Error(error.message);
      return data || [];
    },
  });

  const { data: journalLines = [] } = useQuery({
    queryKey: ['dashboard-journal-lines'],
    queryFn: async () => {
      const { data, error } = await apiClient.get('/api/journal-lines-with-entries');
      if (error) throw new Error(error.message);
      return data || [];
    },
  });

  // Calculate account type summaries
  const accountTypeSummary = Object.keys(accountTypeLabels).map(type => {
    const typeAccounts = accounts.filter(a => a.account_type === type);
    const total = typeAccounts.reduce((sum, a) => {
      const lines = journalLines.filter((l: any) => l.account_id === a.id);
      const totalDebit = lines.reduce((s: number, l: any) => s + (l.debit_amount || 0), 0);
      const totalCredit = lines.reduce((s: number, l: any) => s + (l.credit_amount || 0), 0);
      
      if (type === 'asset' || type === 'expense') {
        return sum + (totalDebit - totalCredit);
      }
      return sum + (totalCredit - totalDebit);
    }, 0);

    return {
      name: accountTypeLabels[type as AccountType],
      value: Math.abs(total),
      type,
    };
  }).filter(item => item.value > 0);

  // Cash flow summary
  const receipts = recentPayments
    .filter(p => p.payment_type === 'receipt')
    .reduce((sum, p) => sum + p.amount, 0);
  
  const paymentsMade = recentPayments
    .filter(p => p.payment_type === 'payment')
    .reduce((sum, p) => sum + p.amount, 0);

  // Invoice stats
  const invoiceStats = {
    total: invoices.length,
    pending: invoices.filter(i => i.status === 'pending').length,
    partial: invoices.filter(i => i.status === 'partial').length,
    paid: invoices.filter(i => i.status === 'paid').length,
    totalAmount: invoices.reduce((sum, i) => sum + (i.total_amount || 0), 0),
    paidAmount: invoices.reduce((sum, i) => sum + (i.paid_amount || 0), 0),
    remainingAmount: invoices.reduce((sum, i) => sum + (i.remaining_amount || 0), 0),
  };

  // Monthly payment trends (last 7 days)
  const paymentTrends = Array.from({ length: 7 }, (_, i) => {
    const date = subDays(today, 6 - i);
    const dateStr = format(date, 'yyyy-MM-dd');
    
    const dayReceipts = recentPayments
      .filter(p => p.payment_type === 'receipt' && p.payment_date === dateStr)
      .reduce((sum, p) => sum + p.amount, 0);
    
    const dayPayments = recentPayments
      .filter(p => p.payment_type === 'payment' && p.payment_date === dateStr)
      .reduce((sum, p) => sum + p.amount, 0);

    return {
      date: format(date, 'EEE', { locale: ar }),
      قبض: dayReceipts,
      صرف: dayPayments,
    };
  });

  // Invoice status distribution
  const invoiceStatusData = [
    { name: 'معلقة', value: invoiceStats.pending, color: '#f59e0b' },
    { name: 'مدفوعة جزئياً', value: invoiceStats.partial, color: '#3b82f6' },
    { name: 'مدفوعة', value: invoiceStats.paid, color: '#10b981' },
  ].filter(item => item.value > 0);

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-3xl font-bold">لوحة التحكم المالية</h1>
            <p className="text-muted-foreground">نظرة عامة على الوضع المالي</p>
          </div>
          <div className="flex gap-2">
            <Link to="/accounting/journal-entries">
              <Button variant="outline" className="gap-2">
                <FileText className="h-4 w-4" />
                القيود اليومية
              </Button>
            </Link>
            <Link to="/accounting/financial-reports">
              <Button className="gap-2">
                <Scale className="h-4 w-4" />
                التقارير المالية
              </Button>
            </Link>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">إجمالي المقبوضات</CardTitle>
              <ArrowDownCircle className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-500">{receipts.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">آخر 10 عمليات</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">إجمالي المصروفات</CardTitle>
              <ArrowUpCircle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-500">{paymentsMade.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">آخر 10 عمليات</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">الفواتير المعلقة</CardTitle>
              <CreditCard className="h-4 w-4 text-yellow-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{invoiceStats.pending + invoiceStats.partial}</div>
              <p className="text-xs text-muted-foreground">
                بقيمة {invoiceStats.remainingAmount.toLocaleString()}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">صافي التدفق النقدي</CardTitle>
              <Wallet className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${receipts - paymentsMade >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {(receipts - paymentsMade).toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground">
                {receipts - paymentsMade >= 0 ? 'فائض' : 'عجز'}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Payment Trends Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">حركة القبض والصرف (آخر 7 أيام)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={paymentTrends}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" />
                  <YAxis stroke="hsl(var(--muted-foreground))" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                  />
                  <Legend />
                  <Bar dataKey="قبض" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="صرف" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Account Types Distribution */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">توزيع الحسابات حسب النوع</CardTitle>
            </CardHeader>
            <CardContent>
              {accountTypeSummary.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={accountTypeSummary}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {accountTypeSummary.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                      formatter={(value: number) => value.toLocaleString()}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                  لا توجد بيانات كافية
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Invoice Status & Recent Entries */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Invoice Status */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                حالة الفواتير
              </CardTitle>
            </CardHeader>
            <CardContent>
              {invoiceStatusData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={invoiceStatusData}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {invoiceStatusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                  لا توجد فواتير
                </div>
              )}
              <div className="mt-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span>إجمالي المبالغ</span>
                  <span className="font-bold">{invoiceStats.totalAmount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm text-green-500">
                  <span>المحصل</span>
                  <span className="font-bold">{invoiceStats.paidAmount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm text-yellow-500">
                  <span>المتبقي</span>
                  <span className="font-bold">{invoiceStats.remainingAmount.toLocaleString()}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Recent Journal Entries */}
          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText className="h-5 w-5" />
                آخر القيود اليومية
              </CardTitle>
              <Link to="/accounting/journal-entries">
                <Button variant="ghost" size="sm">عرض الكل</Button>
              </Link>
            </CardHeader>
            <CardContent>
              <div className="responsive-table-wrapper">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>رقم القيد</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>البيان</TableHead>
                    <TableHead className="text-left">المبلغ</TableHead>
                    <TableHead>الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentEntries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-4 text-muted-foreground">
                        لا توجد قيود
                      </TableCell>
                    </TableRow>
                  ) : (
                    recentEntries.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="font-mono text-sm">{entry.entry_number}</TableCell>
                        <TableCell>{format(new Date(entry.entry_date), 'MM/dd')}</TableCell>
                        <TableCell className="max-w-[150px] truncate">
                          {entry.description || '-'}
                        </TableCell>
                        <TableCell className="text-left font-mono">
                          {entry.total_debit?.toLocaleString()}
                        </TableCell>
                        <TableCell>
                          {entry.is_posted ? (
                            <Badge className="bg-green-500/20 text-green-400">مرحل</Badge>
                          ) : (
                            <Badge variant="outline">غير مرحل</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Quick Links */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Link to="/accounting/chart-of-accounts">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
              <CardContent className="flex items-center gap-4 py-6">
                <div className="p-3 rounded-lg bg-blue-500/20">
                  <Building className="h-6 w-6 text-blue-500" />
                </div>
                <div>
                  <p className="font-medium">دليل الحسابات</p>
                  <p className="text-sm text-muted-foreground">{accounts.length} حساب</p>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link to="/accounting/invoices">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
              <CardContent className="flex items-center gap-4 py-6">
                <div className="p-3 rounded-lg bg-purple-500/20">
                  <FileText className="h-6 w-6 text-purple-500" />
                </div>
                <div>
                  <p className="font-medium">الفواتير</p>
                  <p className="text-sm text-muted-foreground">{invoices.length} فاتورة</p>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link to="/accounting/payments">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
              <CardContent className="flex items-center gap-4 py-6">
                <div className="p-3 rounded-lg bg-green-500/20">
                  <Banknote className="h-6 w-6 text-green-500" />
                </div>
                <div>
                  <p className="font-medium">المدفوعات</p>
                  <p className="text-sm text-muted-foreground">قبض وصرف</p>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link to="/accounting/financial-reports">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
              <CardContent className="flex items-center gap-4 py-6">
                <div className="p-3 rounded-lg bg-amber-500/20">
                  <Scale className="h-6 w-6 text-amber-500" />
                </div>
                <div>
                  <p className="font-medium">التقارير المالية</p>
                  <p className="text-sm text-muted-foreground">ميزانية وقوائم</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>
    </MainLayout>
  );
}
