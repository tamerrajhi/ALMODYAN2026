import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, TrendingDown, Download, RefreshCw, AlertTriangle, CheckCircle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useQuery } from '@tanstack/react-query';
import { formatCurrency, formatNumber } from '@/lib/utils';

interface Props {
  onBack: () => void;
}

export default function LossProductivityReport({ onBack }: Props) {
  const { isRTL } = useLanguage();
  const [dateRange, setDateRange] = useState('30');

  const { data: stats, isLoading, refetch } = useQuery({
    queryKey: ['loss-productivity', dateRange],
    queryFn: async () => {
      const res = await fetch(`/api/reports/loss-productivity?days=${dateRange}`, { credentials: 'include' });
      if (!res.ok && res.status === 501) return null;
      if (!res.ok) return null;
      return await res.json();
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
              <TrendingDown className="w-6 h-6 text-orange-500" />
              {isRTL ? 'تقرير الفاقد والإنتاجية' : 'Loss & Productivity Report'}
            </h1>
            <p className="text-muted-foreground text-sm">
              {isRTL ? 'تحليل نسب الفاقد ومعدلات الإنتاجية' : 'Analyze loss rates and productivity'}
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

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">
          {isRTL ? 'جاري التحميل...' : 'Loading...'}
        </div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-500" />
                {isRTL ? 'تحليل الفاقد والزيادة' : 'Loss & Surplus Analysis'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-4 bg-red-50 dark:bg-red-950/30 rounded-lg">
                  <p className="text-2xl font-bold text-red-700">{formatCurrency(stats?.totalShortage || 0)}</p>
                  <p className="text-sm text-red-600">{isRTL ? 'قيمة العجز' : 'Shortage Value'}</p>
                </div>
                <div className="text-center p-4 bg-green-50 dark:bg-green-950/30 rounded-lg">
                  <p className="text-2xl font-bold text-green-700">{formatCurrency(stats?.totalOverage || 0)}</p>
                  <p className="text-sm text-green-600">{isRTL ? 'قيمة الزيادة' : 'Surplus Value'}</p>
                </div>
                <div className="text-center p-4 bg-orange-50 dark:bg-orange-950/30 rounded-lg">
                  <p className="text-2xl font-bold text-orange-700">{formatNumber(stats?.shortageCount || 0)}</p>
                  <p className="text-sm text-orange-600">{isRTL ? 'قطع ناقصة' : 'Missing Items'}</p>
                </div>
                <div className="text-center p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg">
                  <p className="text-2xl font-bold text-blue-700">{formatCurrency(stats?.netLoss || 0)}</p>
                  <p className="text-sm text-blue-600">{isRTL ? 'صافي الفاقد' : 'Net Loss'}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-500" />
                {isRTL ? 'معدلات الإنتاجية' : 'Productivity Rates'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="text-center p-4 bg-primary/5 rounded-lg">
                  <p className="text-2xl font-bold">{stats?.completedOrders || 0} / {stats?.totalOrders || 0}</p>
                  <p className="text-sm text-muted-foreground">{isRTL ? 'أوامر العمل المكتملة' : 'Completed Work Orders'}</p>
                  <p className="text-lg font-semibold text-primary mt-2">{stats?.completionRate?.toFixed(1)}%</p>
                </div>
                <div className="text-center p-4 bg-primary/5 rounded-lg">
                  <p className="text-2xl font-bold">{stats?.totalOrders || 0}</p>
                  <p className="text-sm text-muted-foreground">{isRTL ? 'إجمالي أوامر العمل' : 'Total Work Orders'}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
