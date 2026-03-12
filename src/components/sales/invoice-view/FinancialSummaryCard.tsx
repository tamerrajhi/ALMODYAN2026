import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Calculator, TrendingDown, Truck, Receipt } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

interface FinancialSummaryCardProps {
  subtotalBeforeDiscount: number;
  lineDiscounts: number;
  invoiceDiscount: number;
  shippingFees?: number;
  additionalFees?: number;
  totalBeforeTax: number;
  taxAmount: number;
  taxRate?: number;
  grandTotal: number;
  paidAmount: number;
  remainingAmount: number;
}

export default function FinancialSummaryCard({
  subtotalBeforeDiscount,
  lineDiscounts,
  invoiceDiscount,
  shippingFees = 0,
  additionalFees = 0,
  totalBeforeTax,
  taxAmount,
  taxRate = 0.15,
  grandTotal,
  paidAmount,
  remainingAmount,
}: FinancialSummaryCardProps) {
  const totalDiscounts = lineDiscounts + invoiceDiscount;
  const hasDiscounts = totalDiscounts > 0;
  const hasFees = shippingFees > 0 || additionalFees > 0;

  return (
    <Card className="border-2 border-primary/10">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Calculator className="w-4 h-4" />
          الملخص المالي
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Subtotal Before Discount */}
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">إجمالي المبيعات قبل الخصم:</span>
          <span className="font-mono">{formatCurrency(subtotalBeforeDiscount)}</span>
        </div>

        {/* Discounts Section */}
        {hasDiscounts && (
          <>
            {lineDiscounts > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-1">
                  <TrendingDown className="w-3 h-3" />
                  خصومات البنود:
                </span>
                <span className="font-mono text-destructive">-{formatCurrency(lineDiscounts)}</span>
              </div>
            )}
            {invoiceDiscount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-1">
                  <TrendingDown className="w-3 h-3" />
                  خصم الفاتورة:
                </span>
                <span className="font-mono text-destructive">-{formatCurrency(invoiceDiscount)}</span>
              </div>
            )}
          </>
        )}

        {/* Fees Section */}
        {hasFees && (
          <>
            {shippingFees > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Truck className="w-3 h-3" />
                  رسوم الشحن:
                </span>
                <span className="font-mono">+{formatCurrency(shippingFees)}</span>
              </div>
            )}
            {additionalFees > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Receipt className="w-3 h-3" />
                  رسوم إضافية:
                </span>
                <span className="font-mono">+{formatCurrency(additionalFees)}</span>
              </div>
            )}
          </>
        )}

        <Separator />

        {/* Total Before Tax */}
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">الإجمالي قبل الضريبة:</span>
          <span className="font-mono">{formatCurrency(totalBeforeTax)}</span>
        </div>

        {/* Tax */}
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">
            ضريبة القيمة المضافة ({(taxRate * 100).toFixed(0)}%):
          </span>
          <span className="font-mono">{formatCurrency(taxAmount)}</span>
        </div>

        <Separator className="my-3" />

        {/* Grand Total - Prominent */}
        <div className="flex justify-between items-center py-2 bg-primary/5 rounded-lg px-3 -mx-3">
          <span className="font-semibold text-lg">صافي المستحق:</span>
          <span className="text-2xl font-bold text-primary font-mono">
            {formatCurrency(grandTotal)}
          </span>
        </div>

        <Separator className="my-3" />

        {/* Payment Status */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-green-600 font-medium">المدفوع:</span>
            <span className="font-mono text-green-600 font-medium">
              {formatCurrency(paidAmount)}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-amber-600 font-medium">المتبقي:</span>
            <span className="font-mono text-amber-600 font-medium">
              {formatCurrency(remainingAmount)}
            </span>
          </div>
        </div>

        {/* Discount Summary Box */}
        {hasDiscounts && (
          <div className="bg-muted/50 rounded-lg p-3 mt-4 space-y-2 text-xs">
            <p className="font-medium text-muted-foreground mb-2">ملخص الخصومات</p>
            <div className="flex justify-between">
              <span>إجمالي الخصومات:</span>
              <span className="font-mono text-destructive">{formatCurrency(totalDiscounts)}</span>
            </div>
            <div className="flex justify-between">
              <span>نسبة التوفير:</span>
              <span className="font-mono">
                {((totalDiscounts / subtotalBeforeDiscount) * 100).toFixed(1)}%
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
