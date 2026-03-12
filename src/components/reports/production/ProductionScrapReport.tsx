import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { Loader2, Trash2, Download, AlertTriangle, BarChart3 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface ProductionScrapReportProps {
  branchId?: string;
}

export default function ProductionScrapReport({ branchId }: ProductionScrapReportProps) {
  const [startDate, setStartDate] = useState(format(new Date(new Date().setMonth(new Date().getMonth() - 1)), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [selectedBranch, setSelectedBranch] = useState<string>(branchId || 'all');

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const res = await fetch('/api/active-branches', { credentials: 'include' });
      if (!res.ok && res.status === 501) return [];
      return res.json();
    },
  });

  const { data: goldScrap = [], isLoading } = useQuery({
    queryKey: ['gold-scrap-report', selectedBranch, startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams({ startDate, endDate });
      if (selectedBranch && selectedBranch !== 'all') params.set('branch', selectedBranch);
      const res = await fetch(`/api/reports/production-scrap?${params}`, { credentials: 'include' });
      if (!res.ok && res.status === 501) return [];
      return res.json();
    },
  });

  const productionLoss: any[] = [];
  const totalLossWeight = 0;
  const totalLossValue = 0;

  const totalGoldWeight = goldScrap.reduce((sum: number, s: any) => sum + (s.weight_grams || 0), 0);

  const chartData = goldScrap.reduce((acc: any[], s: any) => {
    const date = format(new Date(s.scrap_date), 'MM/dd');
    const existing = acc.find(item => item.date === date);
    if (existing) {
      existing.weight += s.weight_grams || 0;
    } else {
      acc.push({ date, weight: s.weight_grams || 0 });
    }
    return acc;
  }, []);

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trash2 className="w-5 h-5" />
            تقرير الهالك والفاقد
          </CardTitle>
          <CardDescription>تحليل كميات وقيم الهالك في الإنتاج</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
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
            <div className="space-y-2">
              <Label>الفرع</Label>
              <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="جميع الفروع" />
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
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">عدد سجلات الهالك</p>
                <p className="text-2xl font-bold">{goldScrap.length}</p>
              </div>
              <AlertTriangle className="w-8 h-8 text-yellow-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">إجمالي وزن الذهب الهالك</p>
            <p className="text-2xl font-bold text-destructive">{totalGoldWeight.toFixed(2)} جم</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">إجمالي الفاقد في الإنتاج</p>
            <p className="text-2xl font-bold text-destructive">{totalLossWeight.toFixed(2)} جم</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">قيمة الخسائر</p>
            <p className="text-2xl font-bold text-destructive">{totalLossValue.toLocaleString()} ر.س</p>
          </CardContent>
        </Card>
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              توزيع الهالك خلال الفترة
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip formatter={(value: number) => value.toFixed(2) + ' جم'} />
                <Legend />
                <Bar dataKey="weight" name="الوزن (جم)" fill="#ef4444" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Gold Scrap Table */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>سجلات هالك الذهب</CardTitle>
            <Button variant="outline" size="sm">
              <Download className="w-4 h-4 ml-2" />
              تصدير
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : goldScrap.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              لا توجد سجلات هالك في الفترة المحددة
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>الفرع</TableHead>
                  <TableHead>العيار</TableHead>
                  <TableHead className="text-center">الوزن (جم)</TableHead>
                  <TableHead>السبب</TableHead>
                  <TableHead>ملاحظات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {goldScrap.map((scrap: any) => (
                  <TableRow key={scrap.id}>
                    <TableCell>
                      {format(new Date(scrap.scrap_date), 'yyyy/MM/dd', { locale: ar })}
                    </TableCell>
                    <TableCell>{scrap.branches?.branch_name || scrap.branch_name || '-'}</TableCell>
                    <TableCell>{scrap.gold_karats?.karat_name || scrap.karat_name || '-'}</TableCell>
                    <TableCell className="text-center font-medium text-destructive">
                      {scrap.weight_grams?.toFixed(2)}
                    </TableCell>
                    <TableCell>{scrap.reason || '-'}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{scrap.notes || '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Production Loss Table */}
      {productionLoss.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>فاقد الإنتاج المرتبط بأوامر العمل</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>أمر الإنتاج</TableHead>
                  <TableHead>الفرع</TableHead>
                  <TableHead className="text-center">الوزن (جم)</TableHead>
                  <TableHead className="text-center">القيمة</TableHead>
                  <TableHead>السبب</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {productionLoss.map((loss: any) => (
                  <TableRow key={loss.id}>
                    <TableCell>
                      {format(new Date(loss.loss_date), 'yyyy/MM/dd', { locale: ar })}
                    </TableCell>
                    <TableCell>{loss.work_orders?.order_number || '-'}</TableCell>
                    <TableCell>{loss.branches?.branch_name || '-'}</TableCell>
                    <TableCell className="text-center font-medium text-destructive">
                      {loss.loss_weight?.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-center font-medium text-destructive">
                      {loss.loss_value?.toLocaleString()}
                    </TableCell>
                    <TableCell>{loss.reason || '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
