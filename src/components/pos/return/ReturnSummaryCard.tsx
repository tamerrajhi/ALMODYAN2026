import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { 
  Calculator,
  RotateCcw,
  ShieldAlert,
  Wallet,
  Banknote,
  CreditCard,
  Package
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

interface ReturnTotals {
  subtotalBeforeTax: number;
  taxAmount: number;
  totalAmount: number;
  itemsCount: number;
}

interface ReturnSummaryCardProps {
  totals: ReturnTotals;
  refundMethod: 'cash' | 'card' | 'store_credit';
  requiresApproval: boolean;
  maxApprovalAmount?: number;
  customerCreditBalance?: number;
  onConfirm: () => void;
  disabled?: boolean;
}

export function ReturnSummaryCard({
  totals,
  refundMethod,
  requiresApproval,
  maxApprovalAmount = 5000,
  customerCreditBalance = 0,
  onConfirm,
  disabled = false
}: ReturnSummaryCardProps) {
  const getRefundMethodIcon = () => {
    switch (refundMethod) {
      case 'cash': return <Banknote className="w-5 h-5" />;
      case 'card': return <CreditCard className="w-5 h-5" />;
      case 'store_credit': return <Wallet className="w-5 h-5" />;
    }
  };

  const getRefundMethodLabel = () => {
    switch (refundMethod) {
      case 'cash': return 'استرداد نقدي';
      case 'card': return 'استرداد بالبطاقة';
      case 'store_credit': return 'إضافة لرصيد العميل';
    }
  };

  return (
    <Card className="border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent sticky top-4">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <div className="p-2 rounded-lg bg-primary/10">
            <Calculator className="w-5 h-5 text-primary" />
          </div>
          <span>ملخص المرتجع</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Manager Approval Warning */}
        {requiresApproval && (
          <Alert className="bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800">
            <ShieldAlert className="w-4 h-4 text-amber-600" />
            <AlertDescription className="text-amber-700 dark:text-amber-300 text-sm">
              يتطلب موافقة المدير (القيمة تتجاوز {formatCurrency(maxApprovalAmount)})
            </AlertDescription>
          </Alert>
        )}

        {/* Store Credit Info */}
        {refundMethod === 'store_credit' && (
          <Alert className="bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800">
            <Wallet className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-blue-700 dark:text-blue-300 text-sm">
              <div>سيتم إضافة {formatCurrency(totals.totalAmount)} لرصيد العميل</div>
              {customerCreditBalance > 0 && (
                <div className="text-xs mt-1 opacity-80">
                  الرصيد الجديد: {formatCurrency(customerCreditBalance + totals.totalAmount)}
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Summary Details */}
        <div className="space-y-3 bg-background/50 p-4 rounded-xl border">
          <div className="flex justify-between items-center text-sm">
            <span className="flex items-center gap-2 text-muted-foreground">
              <Package className="w-4 h-4" />
              عدد الأصناف
            </span>
            <Badge variant="secondary" className="font-bold">{totals.itemsCount}</Badge>
          </div>
          
          <Separator />
          
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">صافي المرتجع قبل الضريبة</span>
            <span className="font-medium">{formatCurrency(totals.subtotalBeforeTax)}</span>
          </div>
          
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">ضريبة القيمة المضافة (15%)</span>
            <span className="font-medium text-muted-foreground">{formatCurrency(totals.taxAmount)}</span>
          </div>
          
          <Separator className="my-2" />
          
          <div className="flex justify-between items-center p-3 bg-primary/5 rounded-lg border border-primary/20">
            <span className="font-bold text-lg">إجمالي المبلغ المسترد</span>
            <span className="font-bold text-2xl text-primary">{formatCurrency(totals.totalAmount)}</span>
          </div>
        </div>

        {/* Refund Method Display */}
        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border">
          <span className="text-muted-foreground text-sm">طريقة الاسترداد</span>
          <div className="flex items-center gap-2 font-medium">
            {getRefundMethodIcon()}
            <span>{getRefundMethodLabel()}</span>
          </div>
        </div>

        {/* Confirm Button */}
        <Button 
          className="w-full h-14 text-lg font-bold gap-3 shadow-lg hover:shadow-xl transition-shadow" 
          onClick={onConfirm}
          disabled={disabled || totals.itemsCount === 0}
          size="lg"
        >
          <RotateCcw className="w-6 h-6" />
          تنفيذ مرتجع POS
        </Button>
      </CardContent>
    </Card>
  );
}
