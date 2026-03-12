import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, AlertTriangle, Download, RefreshCw, AlertCircle, Clock, Package, TrendingDown } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useQuery } from '@tanstack/react-query';
import { formatNumber } from '@/lib/utils';

interface Props {
  onBack: () => void;
}

export default function RisksAlertsReport({ onBack }: Props) {
  const { isRTL } = useLanguage();

  const { data: alerts, isLoading, refetch } = useQuery({
    queryKey: ['risks-alerts'],
    queryFn: async () => {
      const res = await fetch('/api/risks-alerts', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch alerts');
      const data = await res.json();
      
      const alertsList = [];
      
      if (!data.gold_prices_today) {
        alertsList.push({
          id: 'no-prices',
          type: 'error',
          icon: AlertCircle,
          title: isRTL ? 'لم يتم تسجيل أسعار الذهب لليوم' : 'Gold prices not set for today',
          description: isRTL ? 'يجب إضافة أسعار الذهب قبل بدء المبيعات' : 'Gold prices must be set before sales',
        });
      }

      if (data.pending_transfers > 0) {
        alertsList.push({
          id: 'pending-transfers',
          type: 'warning',
          icon: Clock,
          title: isRTL ? `${data.pending_transfers} طلب نقل في الانتظار` : `${data.pending_transfers} pending transfer requests`,
          description: isRTL ? 'يوجد طلبات نقل تحتاج للموافقة' : 'Transfer requests awaiting approval',
        });
      }

      if (data.low_stock_branches.length > 0) {
        alertsList.push({
          id: 'low-stock',
          type: 'warning',
          icon: Package,
          title: isRTL ? 'مخزون منخفض في بعض الفروع' : 'Low stock in some branches',
          description: data.low_stock_branches.join(', '),
        });
      }

      if (data.pending_inventory_counts > 0) {
        alertsList.push({
          id: 'pending-counts',
          type: 'info',
          icon: Package,
          title: isRTL ? `${data.pending_inventory_counts} عملية جرد غير مكتملة` : `${data.pending_inventory_counts} incomplete inventory counts`,
          description: isRTL ? 'يوجد عمليات جرد تحتاج للمتابعة' : 'Inventory counts need follow-up',
        });
      }

      if (data.overdue_work_orders > 0) {
        alertsList.push({
          id: 'overdue-orders',
          type: 'warning',
          icon: TrendingDown,
          title: isRTL ? `${data.overdue_work_orders} أمر عمل متأخر` : `${data.overdue_work_orders} overdue work orders`,
          description: isRTL ? 'أوامر عمل قيد التنفيذ منذ أكثر من 3 أيام' : 'Work orders in progress for more than 3 days',
        });
      }

      return alertsList;
    },
  });

  const getAlertStyles = (type: string) => {
    switch (type) {
      case 'error':
        return 'bg-red-50 dark:bg-red-950/30 border-red-200 text-red-800 dark:text-red-300';
      case 'warning':
        return 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 text-amber-800 dark:text-amber-300';
      default:
        return 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 text-blue-800 dark:text-blue-300';
    }
  };

  const getIconStyles = (type: string) => {
    switch (type) {
      case 'error':
        return 'text-red-500';
      case 'warning':
        return 'text-amber-500';
      default:
        return 'text-blue-500';
    }
  };

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <AlertTriangle className="w-6 h-6 text-red-500" />
              {isRTL ? 'تقرير المخاطر والتنبيهات' : 'Risks & Alerts Report'}
            </h1>
            <p className="text-muted-foreground text-sm">
              {isRTL ? 'التنبيهات والمخاطر التي تحتاج متابعة' : 'Alerts and risks requiring attention'}
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>{isRTL ? 'التنبيهات النشطة' : 'Active Alerts'}</span>
            <span className="text-sm font-normal text-muted-foreground">
              {formatNumber(alerts?.length || 0)} {isRTL ? 'تنبيه' : 'alerts'}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              {isRTL ? 'جاري التحميل...' : 'Loading...'}
            </div>
          ) : alerts?.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-4">
                <AlertTriangle className="w-8 h-8 text-green-500" />
              </div>
              <h3 className="text-lg font-medium text-green-700 dark:text-green-400">
                {isRTL ? 'لا توجد تنبيهات' : 'No Alerts'}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                {isRTL ? 'كل شيء يعمل بشكل جيد!' : 'Everything is running smoothly!'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {alerts?.map((alert: any) => {
                const Icon = alert.icon;
                return (
                  <div 
                    key={alert.id}
                    className={`flex items-start gap-4 p-4 rounded-lg border ${getAlertStyles(alert.type)}`}
                  >
                    <Icon className={`w-6 h-6 flex-shrink-0 mt-0.5 ${getIconStyles(alert.type)}`} />
                    <div>
                      <p className="font-medium">{alert.title}</p>
                      <p className="text-sm opacity-80 mt-0.5">{alert.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
