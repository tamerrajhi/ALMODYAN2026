import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { CreditCard, Banknote, Building2, Receipt, ExternalLink } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

interface PaymentInfoCardProps {
  paymentMethod?: string | null;
  paymentStatus: 'paid' | 'partial' | 'pending' | 'unpaid';
  currency?: string;
  exchangeRate?: number;
  paidAmount: number;
  remainingAmount: number;
  totalAmount: number;
  linkedReceiptId?: string | null;
  linkedReceiptNumber?: string | null;
}

const paymentMethodConfig: Record<string, { label: string; icon: React.ReactNode }> = {
  cash: { label: 'نقداً', icon: <Banknote className="w-4 h-4" /> },
  card: { label: 'بطاقة', icon: <CreditCard className="w-4 h-4" /> },
  bank_transfer: { label: 'تحويل بنكي', icon: <Building2 className="w-4 h-4" /> },
  multiple: { label: 'متعدد', icon: <CreditCard className="w-4 h-4" /> },
};

const paymentStatusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  paid: { label: 'مدفوعة بالكامل', variant: 'default' },
  partial: { label: 'مدفوعة جزئياً', variant: 'secondary' },
  pending: { label: 'غير مدفوعة', variant: 'outline' },
  unpaid: { label: 'غير مدفوعة', variant: 'outline' },
};

export default function PaymentInfoCard({
  paymentMethod,
  paymentStatus,
  currency = 'SAR',
  exchangeRate,
  paidAmount,
  remainingAmount,
  totalAmount,
  linkedReceiptId,
  linkedReceiptNumber,
}: PaymentInfoCardProps) {
  const navigate = useNavigate();
  const methodInfo = paymentMethod ? paymentMethodConfig[paymentMethod] : null;
  const statusInfo = paymentStatusConfig[paymentStatus] || paymentStatusConfig.pending;

  // Calculate payment percentage for visual indicator
  const paymentPercentage = totalAmount > 0 ? (paidAmount / totalAmount) * 100 : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CreditCard className="w-4 h-4" />
          بيانات الدفع
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Payment Status Badge */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">حالة الدفع:</span>
          <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
        </div>

        {/* Payment Method */}
        {methodInfo && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">طريقة الدفع:</span>
            <div className="flex items-center gap-2">
              {methodInfo.icon}
              <span className="text-sm font-medium">{methodInfo.label}</span>
            </div>
          </div>
        )}

        {/* Currency */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">العملة:</span>
          <span className="text-sm font-medium">
            {currency === 'SAR' ? 'ريال سعودي' : currency}
          </span>
        </div>

        {/* Exchange Rate (if applicable) */}
        {exchangeRate && exchangeRate !== 1 && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">سعر الصرف:</span>
            <span className="text-sm font-mono">{exchangeRate.toFixed(4)}</span>
          </div>
        )}

        <Separator />

        {/* Payment Progress */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">نسبة السداد:</span>
            <span className="font-medium">{paymentPercentage.toFixed(0)}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all ${
                paymentPercentage >= 100 
                  ? 'bg-green-500' 
                  : paymentPercentage > 0 
                    ? 'bg-amber-500' 
                    : 'bg-muted-foreground/20'
              }`}
              style={{ width: `${Math.min(paymentPercentage, 100)}%` }}
            />
          </div>
        </div>

        {/* Amounts */}
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">إجمالي الفاتورة:</span>
            <span className="font-mono">{formatCurrency(totalAmount)}</span>
          </div>
          <div className="flex justify-between text-green-600">
            <span>المدفوع:</span>
            <span className="font-mono font-medium">{formatCurrency(paidAmount)}</span>
          </div>
          <div className="flex justify-between text-amber-600">
            <span>المتبقي:</span>
            <span className="font-mono font-medium">{formatCurrency(remainingAmount)}</span>
          </div>
        </div>

        {/* Linked Receipt */}
        {linkedReceiptId && linkedReceiptNumber && (
          <>
            <Separator />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <Receipt className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground">سند القبض:</span>
              </div>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                onClick={() => navigate(`/sales/receipts/${linkedReceiptId}`)}
              >
                {linkedReceiptNumber}
                <ExternalLink className="w-3 h-3 mr-1" />
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
