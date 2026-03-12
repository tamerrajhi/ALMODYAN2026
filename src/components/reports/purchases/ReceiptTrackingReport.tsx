import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ArrowRight, Truck, Clock, CheckCircle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import ReportFilters from '../ReportFilters';

interface ReceiptTrackingReportProps {
  onBack: () => void;
}

export default function ReceiptTrackingReport({ onBack }: ReceiptTrackingReportProps) {
  const { t, language } = useLanguage();
  const dateLocale = language === 'ar' ? ar : enUS;
  const [dateFrom, setDateFrom] = useState<Date>();
  const [dateTo, setDateTo] = useState<Date>();

  const { data: receipts, isLoading } = useQuery({
    queryKey: ['receipt-tracking-report', dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFrom) params.set('dateFrom', format(dateFrom, 'yyyy-MM-dd'));
      if (dateTo) params.set('dateTo', format(dateTo, 'yyyy-MM-dd'));
      const res = await fetch(`/api/reports/receipt-tracking?${params}`, { credentials: 'include' });
      if (res.status === 501) return [];
      return res.json();
    }
  });

  const totalReceipts = receipts?.length || 0;
  const totalItems = receipts?.reduce((sum, r) => sum + ((r.goods_receipt_items as any[])?.length || 0), 0) || 0;
  const totalRejected = receipts?.reduce((sum, r) => {
    return sum + ((r.goods_receipt_items as any[])?.reduce((s: number, i: any) => s + (i.quantity_rejected || 0), 0) || 0);
  }, 0) || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowRight className="w-5 h-5" />
          </Button>
          <div>
            <h2 className="text-xl font-bold">{language === 'ar' ? 'متابعة الاستلام' : 'Receipt Tracking'}</h2>
            <p className="text-muted-foreground text-sm">{language === 'ar' ? 'سجل مستندات الاستلام GRN' : 'GRN documents history'}</p>
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

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Truck className="h-4 w-4" />
              {language === 'ar' ? 'إجمالي الاستلامات' : 'Total Receipts'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalReceipts}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-600" />
              {language === 'ar' ? 'إجمالي البنود' : 'Total Items'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{totalItems}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4 text-red-600" />
              {language === 'ar' ? 'كميات مرفوضة' : 'Rejected Qty'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{totalRejected}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{language === 'ar' ? 'رقم الاستلام' : 'GRN #'}</TableHead>
                <TableHead>{language === 'ar' ? 'رقم أمر الشراء' : 'PO #'}</TableHead>
                <TableHead>{language === 'ar' ? 'المورد' : 'Supplier'}</TableHead>
                <TableHead>{language === 'ar' ? 'تاريخ الاستلام' : 'Receipt Date'}</TableHead>
                <TableHead>{language === 'ar' ? 'الفرع' : 'Branch'}</TableHead>
                <TableHead>{language === 'ar' ? 'عدد البنود' : 'Items'}</TableHead>
                <TableHead>{language === 'ar' ? 'المستلم بواسطة' : 'Received By'}</TableHead>
                <TableHead>{language === 'ar' ? 'الحالة' : 'Status'}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">{t.common.loading}</TableCell>
                </TableRow>
              ) : receipts?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">{t.common.noData}</TableCell>
                </TableRow>
              ) : (
                receipts?.map((receipt) => {
                  const items = receipt.goods_receipt_items as any[] || [];
                  const hasRejected = items.some(i => (i.quantity_rejected || 0) > 0);
                  
                  return (
                    <TableRow key={receipt.id}>
                      <TableCell className="font-medium">{receipt.grn_number}</TableCell>
                      <TableCell>{(receipt.purchase_orders as any)?.po_number || '-'}</TableCell>
                      <TableCell>{(receipt.suppliers as any)?.supplier_name || '-'}</TableCell>
                      <TableCell>{format(new Date(receipt.receipt_date), 'PP', { locale: dateLocale })}</TableCell>
                      <TableCell>{(receipt.branches as any)?.branch_name || '-'}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{items.length} {language === 'ar' ? 'بند' : 'items'}</Badge>
                      </TableCell>
                      <TableCell>{receipt.received_by_name || '-'}</TableCell>
                      <TableCell>
                        <Badge variant={hasRejected ? 'destructive' : 'default'}>
                          {hasRejected 
                            ? (language === 'ar' ? 'يوجد مرفوض' : 'Has Rejected')
                            : (language === 'ar' ? 'مكتمل' : 'Complete')
                          }
                        </Badge>
                      </TableCell>
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
