import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowRight, Download, TrendingUp, Scale, Coins, Receipt } from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import * as XLSX from 'xlsx';

interface GoldSalesReportProps {
  onBack: () => void;
}

interface SaleWithItems {
  id: string;
  sale_code: string;
  invoice_number?: string;
  sale_date: string;
  final_amount: number;
  branch: { branch_name: string } | null;
  customer: { full_name: string } | null;
  items: {
    sale_price: number;
    unique_item: {
      serial_no: string;
      description: string;
      g_weight: number;
      metal: string;
    } | null;
  }[];
}

interface KaratSummary {
  karat: string;
  itemCount: number;
  totalWeight: number;
  totalSales: number;
}

export default function GoldSalesReport({ onBack }: GoldSalesReportProps) {
  const [dateFrom, setDateFrom] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [selectedBranch, setSelectedBranch] = useState<string>('all');

  const { data: branches } = useQuery({
    queryKey: ['gold-branches'],
    queryFn: async () => {
      const res = await fetch('/api/active-branches', { credentials: 'include' });
      if (!res.ok && res.status === 501) return [];
      if (!res.ok) return [];
      const data = await res.json();
      return (data as any[]).filter(b => b.branch_type === 'gold');
    },
  });

  const { data: sales, isLoading } = useQuery({
    queryKey: ['gold-sales-report', dateFrom, dateTo, selectedBranch],
    queryFn: async () => {
      const params = new URLSearchParams({ startDate: dateFrom, endDate: dateTo });
      if (selectedBranch !== 'all') params.set('branch', selectedBranch);
      const res = await fetch(`/api/reports/gold-sales?${params}`, { credentials: 'include' });
      if (!res.ok && res.status === 501) return [];
      if (!res.ok) return [];
      const data = await res.json();
      return (data as any[]).map(row => ({
        ...row,
        final_amount: row.final_amount ?? row.total_amount ?? 0,
        branch: row.branch || (row.branch_name ? { branch_name: row.branch_name } : null),
        customer: row.customer || (row.customer_name ? { full_name: row.customer_name } : null),
        items: row.items || [],
      })) as SaleWithItems[];
    },
    enabled: !!branches,
  });

  const extractKarat = (metal: string | null): string => {
    if (!metal) return 'غير محدد';
    const match = metal.match(/(\d+)\s*[Kk]/);
    return match ? `${match[1]}K` : metal;
  };

  const calculateSummaries = () => {
    if (!sales) return { karatSummaries: [], totals: { items: 0, weight: 0, sales: 0 } };

    const karatMap = new Map<string, KaratSummary>();
    let totalItems = 0;
    let totalWeight = 0;
    let totalSales = 0;

    sales.forEach(sale => {
      sale.items.forEach(item => {
        if (!item.unique_item) return;

        const karat = extractKarat(item.unique_item.metal);
        const weight = item.unique_item.g_weight || 0;
        const price = item.sale_price || 0;

        totalItems++;
        totalWeight += weight;
        totalSales += price;

        if (karatMap.has(karat)) {
          const existing = karatMap.get(karat)!;
          existing.itemCount++;
          existing.totalWeight += weight;
          existing.totalSales += price;
        } else {
          karatMap.set(karat, {
            karat,
            itemCount: 1,
            totalWeight: weight,
            totalSales: price,
          });
        }
      });
    });

    return {
      karatSummaries: Array.from(karatMap.values()).sort((a, b) => 
        parseInt(b.karat) - parseInt(a.karat)
      ),
      totals: { items: totalItems, weight: totalWeight, sales: totalSales },
    };
  };

  const { karatSummaries, totals } = calculateSummaries();

  const flattenedItems = sales?.flatMap(sale =>
    sale.items.map(item => ({
      saleCode: sale.invoice_number || sale.sale_code,
      saleDate: sale.sale_date,
      branch: sale.branch?.branch_name || '-',
      customer: sale.customer?.full_name || 'عميل نقدي',
      itemCode: item.unique_item?.serial_no || '-',
      description: item.unique_item?.description || '-',
      karat: extractKarat(item.unique_item?.metal || null),
      weight: item.unique_item?.g_weight || 0,
      price: item.sale_price || 0,
    }))
  ) || [];

  const handleExport = () => {
    const exportData = flattenedItems.map(item => ({
      'رقم الفاتورة': item.saleCode,
      'التاريخ': format(new Date(item.saleDate), 'yyyy-MM-dd'),
      'الفرع': item.branch,
      'العميل': item.customer,
      'كود القطعة': item.itemCode,
      'الوصف': item.description,
      'العيار': item.karat,
      'الوزن (جرام)': item.weight,
      'السعر': item.price,
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'مبيعات الذهب');
    XLSX.writeFile(wb, `gold-sales-report-${dateFrom}-to-${dateTo}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={onBack}>
            <ArrowRight className="w-4 h-4 ml-2" />
            رجوع
          </Button>
          <h1 className="text-2xl font-bold">تقرير مبيعات الذهب</h1>
        </div>
        <Button onClick={handleExport} disabled={!flattenedItems.length}>
          <Download className="w-4 h-4 ml-2" />
          تصدير Excel
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>من تاريخ</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>إلى تاريخ</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>الفرع</Label>
              <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                <SelectTrigger>
                  <SelectValue placeholder="جميع الفروع" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">جميع فروع الذهب</SelectItem>
                  {branches?.map((branch: any) => (
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

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">إجمالي الفواتير</CardTitle>
            <Receipt className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{sales?.length || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">عدد القطع</CardTitle>
            <Coins className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.items}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">إجمالي الوزن</CardTitle>
            <Scale className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.weight.toFixed(2)} جم</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">إجمالي المبيعات</CardTitle>
            <TrendingUp className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.sales.toLocaleString()} ر.س</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>تحليل حسب العيار</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-center text-muted-foreground py-4">جاري التحميل...</p>
          ) : karatSummaries.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">لا توجد بيانات</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>العيار</TableHead>
                  <TableHead>عدد القطع</TableHead>
                  <TableHead>الوزن (جرام)</TableHead>
                  <TableHead>المبيعات</TableHead>
                  <TableHead>متوسط سعر الجرام</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {karatSummaries.map((summary) => (
                  <TableRow key={summary.karat}>
                    <TableCell className="font-medium">{summary.karat}</TableCell>
                    <TableCell>{summary.itemCount}</TableCell>
                    <TableCell>{summary.totalWeight.toFixed(2)}</TableCell>
                    <TableCell>{summary.totalSales.toLocaleString()} ر.س</TableCell>
                    <TableCell>
                      {summary.totalWeight > 0
                        ? (summary.totalSales / summary.totalWeight).toFixed(2)
                        : 0} ر.س
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>تفاصيل المبيعات</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-center text-muted-foreground py-4">جاري التحميل...</p>
          ) : flattenedItems.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">لا توجد مبيعات في الفترة المحددة</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>رقم الفاتورة</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>الفرع</TableHead>
                    <TableHead>العميل</TableHead>
                    <TableHead>كود القطعة</TableHead>
                    <TableHead>العيار</TableHead>
                    <TableHead>الوزن</TableHead>
                    <TableHead>السعر</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {flattenedItems.slice(0, 100).map((item, index) => (
                    <TableRow key={index}>
                      <TableCell>{item.saleCode}</TableCell>
                      <TableCell>
                        {format(new Date(item.saleDate), 'yyyy-MM-dd', { locale: ar })}
                      </TableCell>
                      <TableCell>{item.branch}</TableCell>
                      <TableCell>{item.customer}</TableCell>
                      <TableCell>{item.itemCode}</TableCell>
                      <TableCell>{item.karat}</TableCell>
                      <TableCell>{item.weight.toFixed(2)} جم</TableCell>
                      <TableCell>{item.price.toLocaleString()} ر.س</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {flattenedItems.length > 100 && (
                <p className="text-center text-muted-foreground py-2">
                  يتم عرض أول 100 سجل فقط. استخدم التصدير للحصول على جميع البيانات.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
