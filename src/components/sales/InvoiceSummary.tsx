import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { formatCurrency } from '@/lib/utils';

interface InvoiceSummaryProps {
  subtotalBeforeDiscount: number;
  lineDiscounts: number;
  invoiceDiscount: number;
  totalBeforeTax: number;
  totalTax: number;
  grandTotal: number;
}

export default function InvoiceSummary({
  subtotalBeforeDiscount,
  lineDiscounts,
  invoiceDiscount,
  totalBeforeTax,
  totalTax,
  grandTotal,
}: InvoiceSummaryProps) {
  const { t } = useLanguage();

  const totalDiscounts = lineDiscounts + invoiceDiscount;

  return (
    <Card className="sticky top-4">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">
          {t.salesInvoices?.summary || 'ملخص الفاتورة'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Subtotal before discounts */}
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">
            {t.salesInvoices?.subtotalBeforeDiscount || 'الإجمالي قبل الخصم'}
          </span>
          <span className="font-mono">{formatCurrency(subtotalBeforeDiscount)}</span>
        </div>

        {/* Line discounts */}
        {lineDiscounts > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">
              {t.salesInvoices?.lineDiscounts || 'خصومات البنود'}
            </span>
            <span className="font-mono text-destructive">-{formatCurrency(lineDiscounts)}</span>
          </div>
        )}

        {/* Invoice discount */}
        {invoiceDiscount > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">
              {t.salesInvoices?.invoiceDiscount || 'خصم الفاتورة'}
            </span>
            <span className="font-mono text-destructive">-{formatCurrency(invoiceDiscount)}</span>
          </div>
        )}

        {/* Subtotal before tax */}
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">
            {t.salesInvoices?.subtotalBeforeTax || 'الإجمالي قبل الضريبة'}
          </span>
          <span className="font-mono">{formatCurrency(totalBeforeTax)}</span>
        </div>

        {/* Tax */}
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">
            {t.salesInvoices?.taxAmount || 'ضريبة القيمة المضافة (15%)'}
          </span>
          <span className="font-mono">{formatCurrency(totalTax)}</span>
        </div>

        <Separator />

        {/* Grand Total */}
        <div className="flex justify-between items-center pt-2">
          <span className="text-lg font-semibold">
            {t.salesInvoices?.grandTotal || 'المبلغ المستحق'}
          </span>
          <span className="text-2xl font-bold text-primary font-mono">
            {formatCurrency(grandTotal)}
          </span>
        </div>

        {/* Summary breakdown */}
        {totalDiscounts > 0 && (
          <div className="bg-muted/50 rounded-lg p-3 mt-4 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span>{t.salesInvoices?.subtotalBeforeDiscount || 'إجمالي البنود'}</span>
              <span className="font-mono">{formatCurrency(subtotalBeforeDiscount)}</span>
            </div>
            <div className="flex justify-between text-destructive">
              <span>{t.salesInvoices?.totalDiscounts || 'إجمالي الخصومات'}</span>
              <span className="font-mono">-{formatCurrency(totalDiscounts)}</span>
            </div>
            <div className="flex justify-between">
              <span>{t.salesInvoices?.taxAmount || 'الضريبة'}</span>
              <span className="font-mono">{formatCurrency(totalTax)}</span>
            </div>
            <Separator className="my-1" />
            <div className="flex justify-between font-semibold">
              <span>{t.salesInvoices?.grandTotal || 'الإجمالي النهائي'}</span>
              <span className="font-mono">{formatCurrency(grandTotal)}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
