import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useLanguage } from '@/contexts/LanguageContext';
import { 
  Calendar, CreditCard, FileText, Building2, 
  Hash, CircleDollarSign, Truck, Package
} from 'lucide-react';

interface ImportPaymentPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: any;
}

const EXPENSE_TYPE_LABELS: Record<string, { ar: string; en: string; icon: any }> = {
  invoice_value: { ar: 'قيمة الفاتورة', en: 'Invoice Value', icon: FileText },
  shipping: { ar: 'رسوم الشحن', en: 'Shipping Fees', icon: Truck },
  customs: { ar: 'رسوم الجمارك', en: 'Customs Duties', icon: Package },
  bank_fees: { ar: 'عمولة البنك', en: 'Bank Fees', icon: Building2 },
  other: { ar: 'مصاريف أخرى', en: 'Other Expenses', icon: CircleDollarSign },
};

const PAYMENT_METHOD_LABELS: Record<string, { ar: string; en: string }> = {
  bank_transfer: { ar: 'تحويل بنكي', en: 'Bank Transfer' },
  cash: { ar: 'نقدي', en: 'Cash' },
  check: { ar: 'شيك', en: 'Check' },
  lc: { ar: 'اعتماد مستندي', en: 'Letter of Credit' },
  card: { ar: 'بطاقة', en: 'Card' },
};

export function ImportPaymentPreview({
  open,
  onOpenChange,
  payment,
}: ImportPaymentPreviewProps) {
  const { language } = useLanguage();

  if (!payment) return null;

  const formatCurrency = (amount: number, currency = 'SAR') => {
    return new Intl.NumberFormat(language === 'ar' ? 'ar-SA' : 'en-SA', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(amount);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
      completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    };
    const labels: Record<string, { ar: string; en: string }> = {
      pending: { ar: 'قيد الانتظار', en: 'Pending' },
      completed: { ar: 'مكتمل', en: 'Completed' },
      cancelled: { ar: 'ملغي', en: 'Cancelled' },
    };
    return (
      <Badge className={styles[status] || ''}>
        {labels[status]?.[language] || status}
      </Badge>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            {language === 'ar' ? 'تفاصيل الدفعة' : 'Payment Details'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Payment Header */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">
                {language === 'ar' ? 'رقم الدفعة' : 'Payment Number'}
              </p>
              <p className="font-mono text-lg font-medium">{payment.payment_number}</p>
            </div>
            {getStatusBadge(payment.status)}
          </div>

          <Separator />

          {/* Main Info Grid */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-start gap-3">
              <Calendar className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm text-muted-foreground">
                  {language === 'ar' ? 'تاريخ الدفعة' : 'Payment Date'}
                </p>
                <p className="font-medium">{formatDate(payment.payment_date)}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <CreditCard className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm text-muted-foreground">
                  {language === 'ar' ? 'طريقة الدفع' : 'Payment Method'}
                </p>
                <p className="font-medium">
                  {PAYMENT_METHOD_LABELS[payment.payment_method]?.[language] || payment.payment_method}
                </p>
              </div>
            </div>

            {payment.supplier && (
              <div className="flex items-start gap-3">
                <Building2 className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm text-muted-foreground">
                    {language === 'ar' ? 'المورد' : 'Supplier'}
                  </p>
                  <p className="font-medium">{payment.supplier.supplier_name}</p>
                  <p className="text-xs text-muted-foreground font-mono">
                    {payment.supplier.supplier_code}
                  </p>
                </div>
              </div>
            )}

            {payment.invoice && (
              <div className="flex items-start gap-3">
                <FileText className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm text-muted-foreground">
                    {language === 'ar' ? 'الفاتورة' : 'Invoice'}
                  </p>
                  <p className="font-mono font-medium">{payment.invoice.invoice_number}</p>
                </div>
              </div>
            )}

            {payment.document_number && (
              <div className="flex items-start gap-3 col-span-2">
                <Hash className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm text-muted-foreground">
                    {language === 'ar' ? 'رقم المستند' : 'Document Number'}
                  </p>
                  <p className="font-mono font-medium">{payment.document_number}</p>
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* Amount Section */}
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="pt-4">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {language === 'ar' ? 'المبلغ' : 'Amount'}
                  </p>
                  <p className="text-lg font-bold">
                    {formatCurrency(payment.amount, payment.currency)}
                  </p>
                </div>
                {payment.currency !== 'SAR' && (
                  <>
                    <div>
                      <p className="text-sm text-muted-foreground">
                        {language === 'ar' ? 'سعر الصرف' : 'Rate'}
                      </p>
                      <p className="text-lg font-medium">{payment.exchange_rate}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">
                        {language === 'ar' ? 'بالريال' : 'In SAR'}
                      </p>
                      <p className="text-lg font-bold text-primary">
                        {formatCurrency(payment.local_amount || payment.amount)}
                      </p>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Expense Distribution */}
          {payment.expenses && payment.expenses.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  {language === 'ar' ? 'توزيع المصاريف' : 'Expense Distribution'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {payment.expenses.map((expense: any, index: number) => {
                  const typeInfo = EXPENSE_TYPE_LABELS[expense.expense_type];
                  const Icon = typeInfo?.icon || CircleDollarSign;
                  
                  return (
                    <div key={index} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <span>{typeInfo?.[language] || expense.expense_type}</span>
                      </div>
                      <span className="font-medium">
                        {formatCurrency(expense.local_amount || expense.amount)}
                      </span>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Notes */}
          {payment.notes && (
            <div>
              <p className="text-sm text-muted-foreground mb-1">
                {language === 'ar' ? 'ملاحظات' : 'Notes'}
              </p>
              <p className="text-sm bg-muted p-3 rounded-lg">{payment.notes}</p>
            </div>
          )}

          {/* Timestamps */}
          <div className="text-xs text-muted-foreground text-center">
            {language === 'ar' ? 'تم الإنشاء:' : 'Created:'} {formatDate(payment.created_at)}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
