import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowRight, FileSpreadsheet, Users, TrendingUp, Medal, Target, Award } from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency } from '@/lib/utils';
import * as XLSX from 'xlsx';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend } from 'recharts';

interface EmployeePerformanceReportProps {
  onBack: () => void;
}

export default function EmployeePerformanceReport({ onBack }: EmployeePerformanceReportProps) {
  const [selectedBranch, setSelectedBranch] = useState<string>('all');
  const [startDate, setStartDate] = useState(format(new Date(new Date().setDate(1)), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const res = await fetch('/api/active-branches', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch branches');
      return res.json();
    },
  });

  const { data: reportData, isLoading } = useQuery({
    queryKey: ['employee-performance-report', selectedBranch, startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams({ startDate, endDate });
      if (selectedBranch !== 'all') params.set('branch', selectedBranch);
      const res = await fetch(`/api/reports/employee-performance?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch employee performance report');
      const { sales = [], returns = [] } = await res.json();

      const employeeStats: Record<string, {
        name: string;
        salesCount: number;
        totalSales: number;
        totalItems: number;
        totalDiscount: number;
        returnCount: number;
        returnAmount: number;
        avgSale: number;
        avgItems: number;
      }> = {};

      sales.forEach((sale: any) => {
        const seller = sale.sold_by || 'غير محدد';
        if (!employeeStats[seller]) {
          employeeStats[seller] = {
            name: seller,
            salesCount: 0,
            totalSales: 0,
            totalItems: 0,
            totalDiscount: 0,
            returnCount: 0,
            returnAmount: 0,
            avgSale: 0,
            avgItems: 0,
          };
        }
        employeeStats[seller].salesCount += 1;
        employeeStats[seller].totalSales += sale.final_amount || 0;
        employeeStats[seller].totalItems += sale.total_items || 0;
        employeeStats[seller].totalDiscount += sale.discount_amount || 0;
      });

      returns.forEach((ret: any) => {
        const processor = ret.processed_by || 'غير محدد';
        if (employeeStats[processor]) {
          employeeStats[processor].returnCount += 1;
          employeeStats[processor].returnAmount += ret.total_amount || 0;
        }
      });

      const employeeData = Object.values(employeeStats)
        .map(emp => ({
          ...emp,
          avgSale: emp.salesCount > 0 ? emp.totalSales / emp.salesCount : 0,
          avgItems: emp.salesCount > 0 ? emp.totalItems / emp.salesCount : 0,
          netSales: emp.totalSales - emp.returnAmount,
          discountRate: emp.totalSales > 0 ? (emp.totalDiscount / (emp.totalSales + emp.totalDiscount)) * 100 : 0,
          returnRate: emp.totalSales > 0 ? (emp.returnAmount / emp.totalSales) * 100 : 0,
        }))
        .sort((a, b) => b.totalSales - a.totalSales);

      const topPerformer = employeeData[0];
      const totalTeamSales = employeeData.reduce((sum, e) => sum + e.totalSales, 0);

      const radarData = employeeData.slice(0, 5).map(emp => {
        const maxSales = Math.max(...employeeData.map(e => e.totalSales));
        const maxCount = Math.max(...employeeData.map(e => e.salesCount));
        const maxAvg = Math.max(...employeeData.map(e => e.avgSale));
        const maxItems = Math.max(...employeeData.map(e => e.avgItems));
        
        return {
          name: emp.name,
          'المبيعات': maxSales > 0 ? (emp.totalSales / maxSales) * 100 : 0,
          'عدد العمليات': maxCount > 0 ? (emp.salesCount / maxCount) * 100 : 0,
          'متوسط الفاتورة': maxAvg > 0 ? (emp.avgSale / maxAvg) * 100 : 0,
          'متوسط القطع': maxItems > 0 ? (emp.avgItems / maxItems) * 100 : 0,
        };
      });

      return {
        employees: employeeData,
        topPerformer,
        totalTeamSales,
        radarData,
        summary: {
          totalEmployees: employeeData.length,
          totalSales: totalTeamSales,
          totalTransactions: sales.length,
          avgPerEmployee: employeeData.length > 0 ? totalTeamSales / employeeData.length : 0,
        },
      };
    },
  });

  const handleExportExcel = () => {
    if (!reportData) return;

    const employeeData = reportData.employees.map((emp: any, index: number) => ({
      'الترتيب': index + 1,
      'الموظف': emp.name,
      'عدد المبيعات': emp.salesCount,
      'إجمالي المبيعات': emp.totalSales,
      'عدد القطع': emp.totalItems,
      'متوسط الفاتورة': emp.avgSale,
      'متوسط القطع': emp.avgItems,
      'الخصومات': emp.totalDiscount,
      'نسبة الخصم': emp.discountRate.toFixed(2) + '%',
      'المرتجعات': emp.returnAmount,
      'نسبة المرتجعات': emp.returnRate.toFixed(2) + '%',
      'صافي المبيعات': emp.netSales,
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(employeeData), 'أداء الموظفين');
    XLSX.writeFile(wb, `تقرير-أداء-الموظفين-${startDate}-${endDate}.xlsx`);
  };

  const getRankBadge = (index: number) => {
    if (index === 0) return <Medal className="w-5 h-5 text-yellow-500" />;
    if (index === 1) return <Medal className="w-5 h-5 text-gray-400" />;
    if (index === 2) return <Medal className="w-5 h-5 text-amber-700" />;
    return <span className="w-5 h-5 flex items-center justify-center text-sm text-muted-foreground">{index + 1}</span>;
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
            <h1 className="text-2xl font-bold">تقرير أداء الموظفين</h1>
            <p className="text-muted-foreground">تحليل مبيعات وأداء فريق العمل</p>
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>الفرع</Label>
              <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر الفرع" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">جميع الفروع</SelectItem>
                  {branches.map((branch: any) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.branch_name}
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
          {/* Top Performer & Summary */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {reportData.topPerformer && (
              <Card className="bg-gradient-to-br from-yellow-50 to-amber-100 dark:from-yellow-900/20 dark:to-amber-900/20 border-yellow-200">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-yellow-800 dark:text-yellow-400 flex items-center gap-2">
                    <Award className="w-5 h-5" />
                    الموظف الأفضل
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xl font-bold text-yellow-900 dark:text-yellow-300">{reportData.topPerformer.name}</p>
                  <p className="text-sm text-yellow-700 dark:text-yellow-400">{formatCurrency(reportData.topPerformer.totalSales)}</p>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  عدد الموظفين
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{reportData.summary.totalEmployees}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  إجمالي الفريق
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-green-600">{formatCurrency(reportData.summary.totalSales)}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Target className="w-4 h-4" />
                  متوسط لكل موظف
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatCurrency(reportData.summary.avgPerEmployee)}</p>
              </CardContent>
            </Card>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>مقارنة المبيعات</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={reportData.employees.slice(0, 10)} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`} />
                      <YAxis type="category" dataKey="name" width={100} />
                      <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      <Bar dataKey="totalSales" fill="#22c55e" name="المبيعات" />
                      <Bar dataKey="returnAmount" fill="#ef4444" name="المرتجعات" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {reportData.radarData.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>مقارنة الأداء (أفضل 5)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={[
                        { metric: 'المبيعات', ...Object.fromEntries(reportData.radarData.map(r => [r.name, r['المبيعات']])) },
                        { metric: 'عدد العمليات', ...Object.fromEntries(reportData.radarData.map(r => [r.name, r['عدد العمليات']])) },
                        { metric: 'متوسط الفاتورة', ...Object.fromEntries(reportData.radarData.map(r => [r.name, r['متوسط الفاتورة']])) },
                        { metric: 'متوسط القطع', ...Object.fromEntries(reportData.radarData.map(r => [r.name, r['متوسط القطع']])) },
                      ]}>
                        <PolarGrid />
                        <PolarAngleAxis dataKey="metric" />
                        <PolarRadiusAxis angle={30} domain={[0, 100]} />
                        {reportData.radarData.map((emp, index) => (
                          <Radar
                            key={emp.name}
                            name={emp.name}
                            dataKey={emp.name}
                            stroke={['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'][index]}
                            fill={['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'][index]}
                            fillOpacity={0.2}
                          />
                        ))}
                        <Legend />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Performance Table */}
          <Card>
            <CardHeader>
              <CardTitle>جدول الأداء التفصيلي</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>الموظف</TableHead>
                    <TableHead>عدد المبيعات</TableHead>
                    <TableHead>إجمالي المبيعات</TableHead>
                    <TableHead>عدد القطع</TableHead>
                    <TableHead>متوسط الفاتورة</TableHead>
                    <TableHead>الخصومات</TableHead>
                    <TableHead>المرتجعات</TableHead>
                    <TableHead>صافي المبيعات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reportData.employees.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-muted-foreground">
                        لا توجد بيانات في هذه الفترة
                      </TableCell>
                    </TableRow>
                  ) : (
                    reportData.employees.map((emp: any, index: number) => (
                      <TableRow key={emp.name} className={index < 3 ? 'bg-primary/5' : ''}>
                        <TableCell>{getRankBadge(index)}</TableCell>
                        <TableCell className="font-semibold">{emp.name}</TableCell>
                        <TableCell>{emp.salesCount}</TableCell>
                        <TableCell className="font-semibold text-green-600">{formatCurrency(emp.totalSales)}</TableCell>
                        <TableCell>{emp.totalItems}</TableCell>
                        <TableCell>{formatCurrency(emp.avgSale)}</TableCell>
                        <TableCell>
                          <span className="text-orange-600">{formatCurrency(emp.totalDiscount)}</span>
                          <span className="text-xs text-muted-foreground mr-1">({emp.discountRate.toFixed(1)}%)</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-red-600">{formatCurrency(emp.returnAmount)}</span>
                          <span className="text-xs text-muted-foreground mr-1">({emp.returnRate.toFixed(1)}%)</span>
                        </TableCell>
                        <TableCell className="font-bold">{formatCurrency(emp.netSales)}</TableCell>
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
