import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, DollarSign, Download, RefreshCw } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useQuery } from '@tanstack/react-query';
import { formatCurrency } from '@/lib/utils';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface Props {
  onBack: () => void;
}

export default function ProfitMarginReport({ onBack }: Props) {
  const { isRTL } = useLanguage();
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  const { data: profitData, isLoading, refetch } = useQuery({
    queryKey: ['profit-margin', period],
    queryFn: async () => {
      const daysBack = period === 'daily' ? 30 : period === 'weekly' ? 90 : 365;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysBack);

      const res = await fetch(`/api/reports/profit-margin?startDate=${startDate.toISOString()}&endDate=${new Date().toISOString()}`, { credentials: 'include' });
      if (res.status === 501) return { chartData: [], totalRevenue: 0, estimatedProfit: 0 };
      const sales = await res.json();

      if (!sales || !Array.isArray(sales)) return { chartData: [], totalRevenue: 0, estimatedProfit: 0 };

      const grouped = new Map<string, { revenue: number; count: number }>();
      
      sales.forEach((sale: any) => {
        const date = new Date(sale.sale_date);
        let key: string;
        
        if (period === 'daily') {
          key = date.toISOString().split('T')[0];
        } else if (period === 'weekly') {
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          key = weekStart.toISOString().split('T')[0];
        } else {
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        }
        
        const existing = grouped.get(key) || { revenue: 0, count: 0 };
        grouped.set(key, {
          revenue: existing.revenue + (Number(sale.final_amount) || 0),
          count: existing.count + 1,
        });
      });

      const chartData = Array.from(grouped.entries()).map(([date, data]) => ({
        date,
        revenue: data.revenue,
        profit: data.revenue * 0.15,
      }));

      const totalRevenue = sales.reduce((sum: number, s: any) => sum + (Number(s.final_amount) || 0), 0);
      const estimatedProfit = totalRevenue * 0.15;

      return { chartData, totalRevenue, estimatedProfit };
    },
  });

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <DollarSign className="w-6 h-6 text-green-500" />
              {isRTL ? 'تقرير هامش الربح' : 'Profit Margin Report'}
            </h1>
            <p className="text-muted-foreground text-sm">
              {isRTL ? 'تحليل هامش الربح يومي/أسبوعي/شهري' : 'Daily/weekly/monthly profit margin analysis'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as any)}
            className="px-3 py-2 border rounded-lg text-sm"
          >
            <option value="daily">{isRTL ? 'يومي' : 'Daily'}</option>
            <option value="weekly">{isRTL ? 'أسبوعي' : 'Weekly'}</option>
            <option value="monthly">{isRTL ? 'شهري' : 'Monthly'}</option>
          </select>
          <Button variant="outline" size="icon" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button variant="outline" className="gap-2">
            <Download className="w-4 h-4" />
            {isRTL ? 'تصدير' : 'Export'}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="bg-blue-50 dark:bg-blue-950/30 border-blue-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-blue-700">{formatCurrency(profitData?.totalRevenue || 0)}</p>
            <p className="text-sm text-blue-600">{isRTL ? 'إجمالي الإيرادات' : 'Total Revenue'}</p>
          </CardContent>
        </Card>
        <Card className="bg-green-50 dark:bg-green-950/30 border-green-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-700">{formatCurrency(profitData?.estimatedProfit || 0)}</p>
            <p className="text-sm text-green-600">{isRTL ? 'الربح التقديري (15%)' : 'Estimated Profit (15%)'}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{isRTL ? 'اتجاه الإيرادات والأرباح' : 'Revenue & Profit Trend'}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              {isRTL ? 'جاري التحميل...' : 'Loading...'}
            </div>
          ) : profitData?.chartData.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {isRTL ? 'لا توجد بيانات' : 'No data available'}
            </div>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={profitData?.chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis tickFormatter={(v) => formatCurrency(v)} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Line 
                    type="monotone" 
                    dataKey="revenue" 
                    stroke="#3b82f6" 
                    name={isRTL ? 'الإيرادات' : 'Revenue'} 
                    strokeWidth={2}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="profit" 
                    stroke="#10b981" 
                    name={isRTL ? 'الربح' : 'Profit'} 
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
