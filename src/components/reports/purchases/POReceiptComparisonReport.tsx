import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ArrowRight, BarChart3, TrendingUp, TrendingDown } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import ReportFilters from '../ReportFilters';

interface POReceiptComparisonReportProps {
  onBack: () => void;
}

interface ComparisonData {
  id: string;
  po_number: string;
  supplier_name: string;
  order_date: string;
  ordered_qty: number;
  ordered_weight: number;
  received_qty: number;
  received_weight: number;
  invoiced_qty: number;
  invoiced_weight: number;
  invoiced_amount: number;
  total_amount: number;
}

export default function POReceiptComparisonReport({ onBack }: POReceiptComparisonReportProps) {
  const { t, language } = useLanguage();
  const dateLocale = language === 'ar' ? ar : enUS;
  const [dateFrom, setDateFrom] = useState<Date>();
  const [dateTo, setDateTo] = useState<Date>();

  const { data: comparisonData, isLoading } = useQuery({
    queryKey: ['po-receipt-comparison', dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFrom) params.set('dateFrom', format(dateFrom, 'yyyy-MM-dd'));
      if (dateTo) params.set('dateTo', format(dateTo, 'yyyy-MM-dd'));
      const url = `/api/reports/po-receipt-comparison${params.toString() ? '?' + params : ''}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok && res.status === 501) return [];
      return res.json() as Promise<ComparisonData[]>;
    }
  });

  const totals = comparisonData?.reduce((acc, row) => ({
    orderedQty: acc.orderedQty + row.ordered_qty,
    orderedWeight: acc.orderedWeight + row.ordered_weight,
    receivedQty: acc.receivedQty + row.received_qty,
    receivedWeight: acc.receivedWeight + row.received_weight,
    invoicedQty: acc.invoicedQty + row.invoiced_qty,
    invoicedWeight: acc.invoicedWeight + row.invoiced_weight,
    totalAmount: acc.totalAmount + row.total_amount,
    invoicedAmount: acc.invoicedAmount + row.invoiced_amount,
  }), {
    orderedQty: 0, orderedWeight: 0, receivedQty: 0, receivedWeight: 0,
    invoicedQty: 0, invoicedWeight: 0, totalAmount: 0, invoicedAmount: 0
  });

  const getVariance = (ordered: number, received: number) => {
    if (ordered === 0) return { value: 0, isPositive: true };
    const variance = received - ordered;
    return { value: variance, isPositive: variance >= 0 };
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowRight className="w-5 h-5" />
          </Button>
          <div>
            <h2 className="text-xl font-bold">{language === 'ar' ? 'مقارنة PO vs GRN vs Invoice' : 'PO vs GRN vs Invoice Comparison'}</h2>
            <p className="text-muted-foreground text-sm">{language === 'ar' ? 'مقارنة الكميات المطلوبة والمستلمة والمفوترة' : 'Compare ordered, received, and invoiced quantities'}</p>
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
              <BarChart3 className="h-4 w-4" />
              {language === 'ar' ? 'إجمالي المطلوب' : 'Total Ordered'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold">{totals?.orderedQty || 0} وحدة</div>
            <div className="text-sm text-muted-foreground">{(totals?.orderedWeight || 0).toFixed(2)} جرام</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-600" />
              {language === 'ar' ? 'إجمالي المستلم' : 'Total Received'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold">{totals?.receivedQty || 0} وحدة</div>
            <div className="text-sm text-muted-foreground">{(totals?.receivedWeight || 0).toFixed(2)} جرام</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {language === 'ar' ? 'إجمالي المفوتر' : 'Total Invoiced'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold">{totals?.invoicedQty || 0} وحدة</div>
            <div className="text-sm text-muted-foreground">{(totals?.invoicedWeight || 0).toFixed(2)} جرام</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {language === 'ar' ? 'فرق المبالغ' : 'Amount Variance'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold">
              {((totals?.invoicedAmount || 0) - (totals?.totalAmount || 0)).toLocaleString()} {t.currency.sar}
            </div>
            <div className="text-sm text-muted-foreground">
              {language === 'ar' ? 'المفوتر - المطلوب' : 'Invoiced - Ordered'}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{language === 'ar' ? 'رقم الأمر' : 'PO #'}</TableHead>
                <TableHead>{language === 'ar' ? 'المورد' : 'Supplier'}</TableHead>
                <TableHead>{language === 'ar' ? 'التاريخ' : 'Date'}</TableHead>
                <TableHead className="text-center">{language === 'ar' ? 'المطلوب' : 'Ordered'}</TableHead>
                <TableHead className="text-center">{language === 'ar' ? 'المستلم' : 'Received'}</TableHead>
                <TableHead className="text-center">{language === 'ar' ? 'المفوتر' : 'Invoiced'}</TableHead>
                <TableHead className="text-center">{language === 'ar' ? 'الفرق' : 'Variance'}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">{t.common.loading}</TableCell>
                </TableRow>
              ) : comparisonData?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">{t.common.noData}</TableCell>
                </TableRow>
              ) : (
                comparisonData?.map((row) => {
                  const qtyVariance = getVariance(row.ordered_qty, row.received_qty);
                  const weightVariance = getVariance(row.ordered_weight, row.received_weight);
                  
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.po_number}</TableCell>
                      <TableCell>{row.supplier_name}</TableCell>
                      <TableCell>{format(new Date(row.order_date), 'PP', { locale: dateLocale })}</TableCell>
                      <TableCell className="text-center">
                        <div>{row.ordered_qty} وحدة</div>
                        {row.ordered_weight > 0 && (
                          <div className="text-xs text-muted-foreground">{row.ordered_weight.toFixed(2)} جرام</div>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <div>{row.received_qty} وحدة</div>
                        {row.received_weight > 0 && (
                          <div className="text-xs text-muted-foreground">{row.received_weight.toFixed(2)} جرام</div>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <div>{row.invoiced_qty} وحدة</div>
                        {row.invoiced_weight > 0 && (
                          <div className="text-xs text-muted-foreground">{row.invoiced_weight.toFixed(2)} جرام</div>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          {qtyVariance.isPositive ? (
                            <TrendingUp className="h-4 w-4 text-green-600" />
                          ) : (
                            <TrendingDown className="h-4 w-4 text-red-600" />
                          )}
                          <span className={qtyVariance.isPositive ? 'text-green-600' : 'text-red-600'}>
                            {qtyVariance.value > 0 ? '+' : ''}{qtyVariance.value}
                          </span>
                        </div>
                        {row.ordered_weight > 0 && (
                          <div className="text-xs text-muted-foreground">
                            {weightVariance.value > 0 ? '+' : ''}{weightVariance.value.toFixed(2)} جرام
                          </div>
                        )}
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
