import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Users, Download, RefreshCw, Star } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useQuery } from '@tanstack/react-query';
import { formatCurrency, formatNumber } from '@/lib/utils';

interface Props {
  onBack: () => void;
}

export default function TopCustomersReport({ onBack }: Props) {
  const { isRTL } = useLanguage();
  const [dateRange, setDateRange] = useState('30');

  const { data: topCustomers, isLoading, refetch } = useQuery({
    queryKey: ['top-customers', dateRange],
    queryFn: async () => {
      const res = await fetch(`/api/reports/top-customers?days=${dateRange}`, { credentials: 'include' });
      if (res.status === 501) return [];
      const sales = await res.json();

      if (!sales || !Array.isArray(sales)) return [];

      const grouped = new Map<string, { 
        name: string; 
        phone: string; 
        points: number;
        purchases: number; 
        amount: number; 
        items: number 
      }>();
      
      sales.forEach((sale: any) => {
        if (!sale.customer_id) return;
        const customers = { full_name: sale.full_name, phone: sale.phone, loyalty_points: sale.loyalty_points };
        const existing = grouped.get(sale.customer_id) || { 
          name: customers?.full_name || 'غير معروف',
          phone: customers?.phone || '',
          points: customers?.loyalty_points || 0,
          purchases: 0, 
          amount: 0, 
          items: 0 
        };
        grouped.set(sale.customer_id, {
          ...existing,
          purchases: existing.purchases + 1,
          amount: existing.amount + (Number(sale.final_amount) || 0),
          items: existing.items + (sale.total_items || 0),
        });
      });

      const sorted = Array.from(grouped.entries())
        .map(([id, data]) => ({ id, ...data }))
        .sort((a, b) => b.amount - a.amount)
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
              <Users className="w-6 h-6 text-indigo-500" />
              {isRTL ? 'تقرير أعلى العملاء شراءً' : 'Top Customers Report'}
            </h1>
            <p className="text-muted-foreground text-sm">
              {isRTL ? 'ترتيب العملاء حسب حجم المشتريات' : 'Rank customers by purchase volume'}
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
          <CardTitle>{isRTL ? 'أفضل 10 عملاء' : 'Top 10 Customers'}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              {isRTL ? 'جاري التحميل...' : 'Loading...'}
            </div>
          ) : topCustomers?.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {isRTL ? 'لا توجد مشتريات في الفترة المحددة' : 'No purchases in selected period'}
            </div>
          ) : (
            <div className="space-y-3">
              {topCustomers?.map((customer, index) => (
                <div 
                  key={customer.id}
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
                    <p className="font-medium">{customer.name}</p>
                    <p className="text-sm text-muted-foreground">{customer.phone || '-'}</p>
                  </div>
                  <div className="flex items-center gap-1 text-amber-500">
                    <Star className="w-4 h-4 fill-current" />
                    <span className="text-sm">{formatNumber(customer.points)}</span>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-lg">{formatCurrency(customer.amount)}</p>
                    <p className="text-sm text-muted-foreground">
                      {customer.purchases} {isRTL ? 'عملية' : 'orders'} • {customer.items} {isRTL ? 'قطعة' : 'items'}
                    </p>
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
