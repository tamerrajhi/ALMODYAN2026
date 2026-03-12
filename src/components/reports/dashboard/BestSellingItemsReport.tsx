import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Trophy, Download, RefreshCw } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useQuery } from '@tanstack/react-query';
import { formatCurrency, formatNumber } from '@/lib/utils';

interface Props {
  onBack: () => void;
}

export default function BestSellingItemsReport({ onBack }: Props) {
  const { isRTL } = useLanguage();
  const [dateRange, setDateRange] = useState('30');

  const { data: topItems, isLoading, refetch } = useQuery({
    queryKey: ['best-selling-items', dateRange],
    queryFn: async () => {
      const res = await fetch(`/api/reports/best-selling?days=${dateRange}`, { credentials: 'include' });
      if (res.status === 501) return [];
      if (!res.ok) throw new Error('Failed to fetch best selling items');
      const soldItems = await res.json();

      if (!soldItems || soldItems.length === 0) return [];

      const grouped = new Map<string, { count: number; revenue: number; weight: number }>();
      
      soldItems.forEach((item: any) => {
        const key = item.model || item.type || 'غير محدد';
        const existing = grouped.get(key) || { count: 0, revenue: 0, weight: 0 };
        grouped.set(key, {
          count: existing.count + 1,
          revenue: existing.revenue + (Number(item.sold_price) || 0),
          weight: existing.weight + (Number(item.g_weight) || 0),
        });
      });

      const sorted = Array.from(grouped.entries())
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      return sorted;
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
              <Trophy className="w-6 h-6 text-yellow-500" />
              {isRTL ? 'تقرير أفضل الأصناف مبيعاً' : 'Best Selling Items Report'}
            </h1>
            <p className="text-muted-foreground text-sm">
              {isRTL ? 'ترتيب الأصناف حسب المبيعات' : 'Rank items by sales'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="px-3 py-2 border rounded-lg text-sm"
          >
            <option value="7">{isRTL ? 'آخر 7 أيام' : 'Last 7 days'}</option>
            <option value="30">{isRTL ? 'آخر 30 يوم' : 'Last 30 days'}</option>
            <option value="90">{isRTL ? 'آخر 90 يوم' : 'Last 90 days'}</option>
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

      <Card>
        <CardHeader>
          <CardTitle>{isRTL ? 'أفضل 10 أصناف مبيعاً' : 'Top 10 Best Selling Items'}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              {isRTL ? 'جاري التحميل...' : 'Loading...'}
            </div>
          ) : topItems?.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {isRTL ? 'لا توجد مبيعات في الفترة المحددة' : 'No sales in selected period'}
            </div>
          ) : (
            <div className="space-y-3">
              {topItems?.map((item, index) => (
                <div 
                  key={item.name}
                  className="flex items-center gap-4 p-4 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                >
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg ${
                    index === 0 ? 'bg-yellow-100 text-yellow-700' :
                    index === 1 ? 'bg-gray-100 text-gray-700' :
                    index === 2 ? 'bg-orange-100 text-orange-700' :
                    'bg-primary/10 text-primary'
                  }`}>
                    {index + 1}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {item.weight.toFixed(2)} {isRTL ? 'جم' : 'g'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-lg">{formatNumber(item.count)} {isRTL ? 'قطعة' : 'pcs'}</p>
                    <p className="text-sm text-muted-foreground">{formatCurrency(item.revenue)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
