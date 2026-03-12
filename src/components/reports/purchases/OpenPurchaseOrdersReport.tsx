import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ArrowRight, Package, Clock, AlertTriangle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import ReportFilters from '../ReportFilters';
import { Progress } from '@/components/ui/progress';

interface OpenPurchaseOrdersReportProps {
  onBack: () => void;
}

export default function OpenPurchaseOrdersReport({ onBack }: OpenPurchaseOrdersReportProps) {
  const { t, language } = useLanguage();
  const dateLocale = language === 'ar' ? ar : enUS;
  const [dateFrom, setDateFrom] = useState<Date>();
  const [dateTo, setDateTo] = useState<Date>();

  const { data: orders, isLoading } = useQuery({
    queryKey: ['open-purchase-orders-report', dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFrom) params.set('dateFrom', format(dateFrom, 'yyyy-MM-dd'));
      if (dateTo) params.set('dateTo', format(dateTo, 'yyyy-MM-dd'));
      const res = await fetch(`/api/reports/open-purchase-orders?${params}`, { credentials: 'include' });
      if (res.status === 501) return [];
      const data = await res.json();

      return (data || []).map((po: any) => {
        const itemsCount = po.items_count || 0;
        const purchase_order_items = Array.from({ length: itemsCount }, (_, i) => ({ id: `item-${i}` }));
        const order = {
          ...po,
          suppliers: { supplier_name: po.supplier_name },
          branches: { branch_name: po.branch_name },
          purchase_order_items,
        };

        const items = order.purchase_order_items || [];
        const totalQty = items.reduce((sum: number, i: any) => sum + (i.quantity || 0), 0);
        const receivedQty = items.reduce((sum: number, i: any) => sum + (i.received_quantity || 0), 0);
        const totalWeight = items.reduce((sum: number, i: any) => sum + (i.weight_grams || 0), 0);
        const receivedWeight = items.reduce((sum: number, i: any) => sum + (i.received_weight || 0), 0);
        
        const progressQty = totalQty > 0 ? (receivedQty / totalQty) * 100 : 0;
        const progressWeight = totalWeight > 0 ? (receivedWeight / totalWeight) * 100 : 0;
        const progress = totalWeight > 0 ? progressWeight : progressQty;

        return {
          ...order,
          totalQty,
          receivedQty,
          remainingQty: totalQty - receivedQty,
          totalWeight,
          receivedWeight,
          remainingWeight: totalWeight - receivedWeight,
          progress,
        };
      });
    }
  });

  const totalOrders = orders?.length || 0;
  const pendingApproval = orders?.filter(o => o.status === 'pending_approval').length || 0;
  const partiallyReceived = orders?.filter(o => o.status === 'partially_received').length || 0;
  const overdue = orders?.filter(o => {
    if (!o.expected_delivery_date) return false;
    return new Date(o.expected_delivery_date) < new Date() && o.status !== 'fully_received';
  }).length || 0;

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      draft: { label: 'مسودة', variant: 'outline' },
      pending_approval: { label: 'في انتظار الموافقة', variant: 'secondary' },
      approved: { label: 'معتمد', variant: 'default' },
      sent_to_supplier: { label: 'تم الإرسال للمورد', variant: 'default' },
      partially_received: { label: 'مستلم جزئياً', variant: 'secondary' },
    };
    const config = statusMap[status] || { label: status, variant: 'outline' as const };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowRight className="w-5 h-5" />
          </Button>
          <div>
            <h2 className="text-xl font-bold">{language === 'ar' ? 'أوامر الشراء المفتوحة' : 'Open Purchase Orders'}</h2>
            <p className="text-muted-foreground text-sm">{language === 'ar' ? 'الأوامر غير المكتملة ومتابعة الاستلام' : 'Incomplete orders and receipt tracking'}</p>
          </div>
        </div>
      </div>

      <ReportFilters
        showBranchFilter={false}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onReset={() => { setDateFrom(undefined); setDateTo(undefined); }}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Package className="h-4 w-4" />
              {language === 'ar' ? 'أوامر مفتوحة' : 'Open Orders'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalOrders}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" />
              {language === 'ar' ? 'بانتظار الموافقة' : 'Pending Approval'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{pendingApproval}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {language === 'ar' ? 'مستلم جزئياً' : 'Partially Received'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{partiallyReceived}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {language === 'ar' ? 'متأخر' : 'Overdue'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{overdue}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{language === 'ar' ? 'رقم الأمر' : 'Order #'}</TableHead>
                <TableHead>{language === 'ar' ? 'المورد' : 'Supplier'}</TableHead>
                <TableHead>{language === 'ar' ? 'التاريخ' : 'Date'}</TableHead>
                <TableHead>{language === 'ar' ? 'تاريخ التسليم المتوقع' : 'Expected Delivery'}</TableHead>
                <TableHead>{language === 'ar' ? 'الحالة' : 'Status'}</TableHead>
                <TableHead>{language === 'ar' ? 'نسبة الاستلام' : 'Receipt %'}</TableHead>
                <TableHead className="text-right">{language === 'ar' ? 'المبلغ' : 'Amount'}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">{t.common.loading}</TableCell>
                </TableRow>
              ) : orders?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">{t.common.noData}</TableCell>
                </TableRow>
              ) : (
                orders?.map((order) => {
                  const isOverdue = order.expected_delivery_date && new Date(order.expected_delivery_date) < new Date();
                  return (
                    <TableRow key={order.id} className={isOverdue ? 'bg-red-50' : ''}>
                      <TableCell className="font-medium">{order.po_number || order.id.slice(0, 8)}</TableCell>
                      <TableCell>{order.suppliers?.supplier_name || '-'}</TableCell>
                      <TableCell>{format(new Date(order.order_date), 'PP', { locale: dateLocale })}</TableCell>
                      <TableCell>
                        {order.expected_delivery_date ? (
                          <span className={isOverdue ? 'text-red-600 font-medium' : ''}>
                            {format(new Date(order.expected_delivery_date), 'PP', { locale: dateLocale })}
                            {isOverdue && <AlertTriangle className="inline h-4 w-4 mr-1" />}
                          </span>
                        ) : '-'}
                      </TableCell>
                      <TableCell>{getStatusBadge(order.status)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 min-w-[120px]">
                          <Progress value={order.progress} className="h-2 flex-1" />
                          <span className="text-sm text-muted-foreground w-12">
                            {order.progress.toFixed(0)}%
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{(order.total_amount || 0).toLocaleString()} {t.currency.sar}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
