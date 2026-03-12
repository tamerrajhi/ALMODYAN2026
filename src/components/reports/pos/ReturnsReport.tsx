import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ArrowRight, FileSpreadsheet, RotateCcw, TrendingDown, Package, AlertTriangle, User, Wallet } from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { formatCurrency } from '@/lib/utils';
import * as XLSX from 'xlsx';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, Legend } from 'recharts';

interface ReturnsReportProps {
  onBack: () => void;
}

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899'];

export default function ReturnsReport({ onBack }: ReturnsReportProps) {
  const [selectedBranch, setSelectedBranch] = useState<string>('all');
  const [selectedUser, setSelectedUser] = useState<string>('all');
  const [startDate, setStartDate] = useState(format(new Date(new Date().setDate(1)), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const res = await fetch('/api/active-branches', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return await res.json();
    },
  });

  const { data: users = [] } = useQuery({
    queryKey: ['return-users'],
    queryFn: async () => {
      const res = await fetch('/api/return-users', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return await res.json() as string[];
    },
  });

  const { data: reportData, isLoading } = useQuery({
    queryKey: ['returns-report', selectedBranch, selectedUser, startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams({ startDate: `${startDate}T00:00:00`, endDate: `${endDate}T23:59:59` });
      if (selectedBranch !== 'all') params.set('branch', selectedBranch);
      if (selectedUser !== 'all') params.set('user', selectedUser);
      const res = await fetch(`/api/reports/returns?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      const returns = data.returns || [];
      const totalSales = data.total_sales || 0;
      
      const totalReturns = returns.reduce((sum: number, r: any) => sum + (parseFloat(r.total_amount) || 0), 0);
      const totalItems = returns.reduce((sum: number, r: any) => sum + (r.return_items?.length || 0), 0);
      const returnRate = totalSales > 0 ? (totalReturns / totalSales) * 100 : 0;

      const reasonBreakdown: Record<string, { count: number; total: number }> = {};
      returns.forEach((ret: any) => {
        const reason = ret.reason || 'غير محدد';
        if (!reasonBreakdown[reason]) reasonBreakdown[reason] = { count: 0, total: 0 };
        reasonBreakdown[reason].count += 1;
        reasonBreakdown[reason].total += parseFloat(ret.total_amount) || 0;
      });

      const refundMethodBreakdown: Record<string, { count: number; total: number }> = {};
      returns.forEach((ret: any) => {
        const method = ret.refund_method || 'cash';
        const methodLabel = method === 'cash' ? 'نقداً' : method === 'card' ? 'بطاقة' : 'رصيد عميل';
        if (!refundMethodBreakdown[methodLabel]) refundMethodBreakdown[methodLabel] = { count: 0, total: 0 };
        refundMethodBreakdown[methodLabel].count += 1;
        refundMethodBreakdown[methodLabel].total += parseFloat(ret.total_amount) || 0;
      });

      const userBreakdown: Record<string, { count: number; total: number }> = {};
      returns.forEach((ret: any) => {
        const user = ret.processed_by || 'غير محدد';
        if (!userBreakdown[user]) userBreakdown[user] = { count: 0, total: 0 };
        userBreakdown[user].count += 1;
        userBreakdown[user].total += parseFloat(ret.total_amount) || 0;
      });

      const dailyData: Record<string, { date: string; count: number; total: number }> = {};
      returns.forEach((ret: any) => {
        const dateKey = format(new Date(ret.return_date), 'yyyy-MM-dd');
        if (!dailyData[dateKey]) dailyData[dateKey] = { date: dateKey, count: 0, total: 0 };
        dailyData[dateKey].count += 1;
        dailyData[dateKey].total += parseFloat(ret.total_amount) || 0;
      });

      return {
        returns,
        summary: {
          totalReturns,
          totalItems,
          returnCount: returns.length,
          returnRate,
          totalSales,
          avgReturnValue: returns.length ? totalReturns / returns.length : 0,
        },
        reasonBreakdown: Object.entries(reasonBreakdown).map(([reason, data]) => ({ reason, ...data })),
        refundMethodBreakdown: Object.entries(refundMethodBreakdown).map(([method, data]) => ({ method, ...data })),
        userBreakdown: Object.entries(userBreakdown).map(([user, data]) => ({ user, ...data })),
        dailyData: Object.values(dailyData).sort((a, b) => a.date.localeCompare(b.date)),
      };
    },
  });

  const handleExportExcel = () => {
    if (!reportData) return;

    const returnsData = reportData.returns.map((ret: any) => ({
      'رقم المرتجع': ret.return_code,
      'التاريخ': format(new Date(ret.return_date), 'yyyy-MM-dd HH:mm'),
      'رقم فاتورة البيع': ret.sale?.invoice_number || ret.sale?.sale_code || '-',
      'العميل': ret.customer?.full_name || 'نقدي',
      'الفرع': ret.branch?.branch_name || '-',
      'السبب': ret.reason || '-',
      'طريقة الاسترداد': ret.refund_method === 'cash' ? 'نقداً' : ret.refund_method === 'card' ? 'بطاقة' : 'رصيد عميل',
      'نوع المرتجع': ret.return_type === 'full' ? 'كلي' : 'جزئي',
      'عدد القطع': ret.return_items?.length || 0,
      'قبل الضريبة': ret.subtotal_before_tax || 0,
      'الضريبة': ret.tax_amount || 0,
      'الإجمالي': ret.total_amount,
      'الموظف': ret.processed_by,
      'يحتاج موافقة': ret.requires_approval ? 'نعم' : 'لا',
      'موافق عليه من': ret.approved_by || '-',
      'ملاحظات': ret.notes || '-',
    }));

    const reasonData = reportData.reasonBreakdown.map((r: any) => ({
      'السبب': r.reason,
      'عدد المرتجعات': r.count,
      'الإجمالي': r.total,
    }));

    const methodData = reportData.refundMethodBreakdown.map((r: any) => ({
      'طريقة الاسترداد': r.method,
      'عدد المرتجعات': r.count,
      'الإجمالي': r.total,
    }));

    const userData = reportData.userBreakdown.map((r: any) => ({
      'الموظف': r.user,
      'عدد المرتجعات': r.count,
      'الإجمالي': r.total,
    }));

    const summaryData = [{
      'إجمالي المرتجعات': reportData.summary.totalReturns,
      'عدد عمليات الإرجاع': reportData.summary.returnCount,
      'عدد القطع المرتجعة': reportData.summary.totalItems,
      'نسبة الإرجاع': `${reportData.summary.returnRate.toFixed(2)}%`,
      'إجمالي المبيعات': reportData.summary.totalSales,
      'متوسط قيمة المرتجع': reportData.summary.avgReturnValue,
    }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryData), 'الملخص');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(returnsData), 'المرتجعات');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(reasonData), 'حسب السبب');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(methodData), 'حسب طريقة الاسترداد');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(userData), 'حسب الموظف');
    XLSX.writeFile(wb, `تقرير-المرتجعات-${startDate}-${endDate}.xlsx`);
  };

  const getRefundMethodBadge = (method: string) => {
    switch (method) {
      case 'cash':
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">نقداً</Badge>;
      case 'card':
        return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">بطاقة</Badge>;
      case 'store_credit':
        return <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">رصيد عميل</Badge>;
      default:
        return <Badge variant="outline">{method}</Badge>;
    }
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
            <h1 className="text-2xl font-bold">تقرير المرتجعات</h1>
            <p className="text-muted-foreground">تحليل عمليات الإرجاع وأسبابها وطرق الاسترداد</p>
          </div>
        </div>
        <Button variant="outline" onClick={handleExportExcel}>
          <FileSpreadsheet className="w-4 h-4 ml-2" />
          تصدير Excel
        </Button>
      </div>

      {/* Filters */}
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
              <Label>الموظف</Label>
              <Select value={selectedUser} onValueChange={setSelectedUser}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر الموظف" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">جميع الموظفين</SelectItem>
                  {users.map((user) => (
                    <SelectItem key={user} value={user}>
                      {user}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>من تاريخ</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>إلى تاريخ</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="text-center py-8">جاري التحميل...</div>
      ) : reportData ? (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <TrendingDown className="w-4 h-4 text-red-600" />
                  إجمالي المرتجعات
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-red-600">{formatCurrency(reportData.summary.totalReturns)}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <RotateCcw className="w-4 h-4" />
                  عدد عمليات الإرجاع
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{reportData.summary.returnCount}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Package className="w-4 h-4" />
                  القطع المرتجعة
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{reportData.summary.totalItems}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Wallet className="w-4 h-4" />
                  متوسط قيمة المرتجع
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatCurrency(reportData.summary.avgReturnValue)}</p>
              </CardContent>
            </Card>

            <Card className={reportData.summary.returnRate > 5 ? 'bg-red-50 border-red-200 dark:bg-red-900/20' : ''}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  نسبة الإرجاع
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-2xl font-bold ${reportData.summary.returnRate > 5 ? 'text-red-600' : 'text-green-600'}`}>
                  {reportData.summary.returnRate.toFixed(2)}%
                </p>
                <p className="text-xs text-muted-foreground">من إجمالي المبيعات</p>
              </CardContent>
            </Card>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>أسباب الإرجاع</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={reportData.reasonBreakdown} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" tickFormatter={(value) => formatCurrency(value)} />
                      <YAxis type="category" dataKey="reason" width={120} />
                      <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      <Bar dataKey="total" fill="#ef4444" name="المبلغ" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>طرق الاسترداد</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={reportData.refundMethodBreakdown}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="total"
                        nameKey="method"
                        label={({ method, percent }) => `${method} (${(percent * 100).toFixed(0)}%)`}
                      >
                        {reportData.refundMethodBreakdown.map((entry: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="w-4 h-4" />
                  المرتجعات حسب الموظف
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={reportData.userBreakdown} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" tickFormatter={(value) => formatCurrency(value)} />
                      <YAxis type="category" dataKey="user" width={100} />
                      <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      <Bar dataKey="total" fill="#3b82f6" name="المبلغ" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Daily Trend */}
          <Card>
            <CardHeader>
              <CardTitle>اتجاه المرتجعات اليومي</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={reportData.dailyData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={(date) => format(new Date(date), 'MM/dd')} />
                    <YAxis yAxisId="left" tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`} />
                    <YAxis yAxisId="right" orientation="right" />
                    <Tooltip 
                      formatter={(value: number, name: string) => [
                        name === 'total' ? formatCurrency(value) : value,
                        name === 'total' ? 'المبلغ' : 'العدد'
                      ]}
                    />
                    <Legend formatter={(value) => value === 'total' ? 'المبلغ' : 'العدد'} />
                    <Line yAxisId="left" type="monotone" dataKey="total" stroke="#ef4444" name="total" strokeWidth={2} />
                    <Line yAxisId="right" type="monotone" dataKey="count" stroke="#3b82f6" name="count" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Returns Table */}
          <Card>
            <CardHeader>
              <CardTitle>تفاصيل المرتجعات</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>رقم المرتجع</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>فاتورة البيع</TableHead>
                    <TableHead>العميل</TableHead>
                    <TableHead>الفرع</TableHead>
                    <TableHead>السبب</TableHead>
                    <TableHead>طريقة الاسترداد</TableHead>
                    <TableHead>عدد القطع</TableHead>
                    <TableHead>المبلغ</TableHead>
                    <TableHead>الموظف</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reportData.returns.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center text-muted-foreground">
                        لا توجد مرتجعات في هذه الفترة
                      </TableCell>
                    </TableRow>
                  ) : (
                    reportData.returns.map((ret: any) => (
                      <TableRow key={ret.id}>
                        <TableCell className="font-mono text-red-600 font-medium">{ret.return_code}</TableCell>
                        <TableCell>{format(new Date(ret.return_date), 'yyyy-MM-dd HH:mm')}</TableCell>
                        <TableCell className="font-mono">{ret.sale?.invoice_number || ret.sale?.sale_code || '-'}</TableCell>
                        <TableCell>{ret.customer?.full_name || 'نقدي'}</TableCell>
                        <TableCell>{ret.branch?.branch_name || '-'}</TableCell>
                        <TableCell>{ret.reason || '-'}</TableCell>
                        <TableCell>{getRefundMethodBadge(ret.refund_method)}</TableCell>
                        <TableCell>{ret.return_items?.length || 0}</TableCell>
                        <TableCell className="font-semibold text-red-600">{formatCurrency(ret.total_amount)}</TableCell>
                        <TableCell>{ret.processed_by}</TableCell>
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