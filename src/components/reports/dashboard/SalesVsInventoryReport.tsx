import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, BarChart3, Download, RefreshCw } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useQuery } from '@tanstack/react-query';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface Props {
  onBack: () => void;
}

export default function SalesVsInventoryReport({ onBack }: Props) {
  const { isRTL } = useLanguage();

  const { data: chartData, isLoading, refetch } = useQuery({
    queryKey: ['sales-vs-inventory'],
    queryFn: async () => {
      const res = await fetch('/api/reports/sales-vs-inventory', { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch sales vs inventory');
      const data = await res.json();
      return (data || []).map((b: any) => ({
        name: b.branch_name,
        sales: Number(b.total_sales) || 0,
        inventory: Number(b.inventory_value) || 0,
      }));
    },
  });

  const totalSales = chartData?.reduce((sum: number, d: any) => sum + d.sales, 0) || 0;
  const totalInventory = chartData?.reduce((sum: number, d: any) => sum + d.inventory, 0) || 0;

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-indigo-500" />
              {isRTL ? 'تقرير المبيعات مقابل المخزون' : 'Sales vs Inventory Report'}
            </h1>
            <p className="text-muted-foreground text-sm">
              {isRTL ? 'مقارنة بين المبيعات (آخر 30 يوم) والمخزون المتاح' : 'Compare sales (last 30 days) against available inventory'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button variant="outline" className="gap-2">
            <Download className="w-4 h-4" />
            {isRTL ? 'تصدير' : 'Export'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-emerald-700">{formatCurrency(totalSales)}</p>
            <p className="text-sm text-emerald-600">{isRTL ? 'إجمالي المبيعات (30 يوم)' : 'Total Sales (30 days)'}</p>
          </CardContent>
        </Card>
        <Card className="bg-blue-50 dark:bg-blue-950/30 border-blue-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-blue-700">{formatCurrency(totalInventory)}</p>
            <p className="text-sm text-blue-600">{isRTL ? 'قيمة المخزون الحالي' : 'Current Inventory Value'}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{isRTL ? 'مقارنة حسب الفرع' : 'Comparison by Branch'}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              {isRTL ? 'جاري التحميل...' : 'Loading...'}
            </div>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tickFormatter={(v) => formatCurrency(v)} />
                  <YAxis type="category" dataKey="name" width={100} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Legend />
                  <Bar dataKey="sales" fill="#10b981" name={isRTL ? 'المبيعات' : 'Sales'} />
                  <Bar dataKey="inventory" fill="#3b82f6" name={isRTL ? 'المخزون' : 'Inventory'} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
