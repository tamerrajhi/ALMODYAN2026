import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { 
  FileText, 
  Calendar, 
  User, 
  CreditCard, 
  Building2, 
  Clock, 
  Hash,
  CheckCircle,
  XCircle
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

interface SaleForReturn {
  id: string;
  sale_code: string;
  invoice_number?: string;
  sale_date: string;
  total_amount: number;
  customer_id?: string;
  customer_name?: string;
  branch_id: string;
  branch_name?: string;
  branch_code?: string;
  cashier_name?: string;
  shift_number?: string;
  payment_status?: 'paid' | 'partial' | 'pending';
}

interface InvoiceTotals {
  originalTotal: number;
  previouslyReturned: number;
  availableForReturn: number;
}

interface SelectedInvoiceCardProps {
  sale: SaleForReturn;
  invoiceTotals: InvoiceTotals | null;
  onReset: () => void;
}

export function SelectedInvoiceCard({ sale, invoiceTotals, onReset }: SelectedInvoiceCardProps) {
  const getPaymentMethodLabel = (method?: string) => {
    switch (method) {
      case 'cash': return 'نقداً';
      case 'card': return 'بطاقة';
      case 'mixed': return 'مختلط';
      case 'credit': return 'آجل';
      default: return method || 'نقداً';
    }
  };

  const getPaymentStatusBadge = (status?: string) => {
    switch (status) {
      case 'paid':
        return <Badge className="bg-green-500/10 text-green-600 border-green-200">مدفوعة</Badge>;
      case 'partial':
        return <Badge className="bg-amber-500/10 text-amber-600 border-amber-200">مدفوعة جزئياً</Badge>;
      case 'pending':
        return <Badge className="bg-red-500/10 text-red-600 border-red-200">غير مدفوعة</Badge>;
      default:
        return <Badge className="bg-green-500/10 text-green-600 border-green-200">مدفوعة</Badge>;
    }
  };

  return (
    <Card className="border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <FileText className="w-5 h-5 text-primary" />
            </div>
            <span>بيانات الفاتورة المختارة</span>
          </CardTitle>
          <Button variant="outline" size="sm" onClick={onReset}>
            تغيير الفاتورة
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Main Invoice Info */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Invoice Number - Prominent */}
          <div className="col-span-2 md:col-span-1 p-4 bg-background rounded-xl border-2 border-primary/30">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Hash className="w-3 h-3" />
              رقم الفاتورة
            </div>
            <div className="font-bold text-lg font-mono text-primary">{sale.invoice_number || sale.sale_code}</div>
          </div>

          {/* Date */}
          <div className="p-4 bg-background rounded-xl border">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Calendar className="w-3 h-3" />
              تاريخ الفاتورة
            </div>
            <div className="font-medium">
              {new Date(sale.sale_date).toLocaleDateString('ar-SA', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
              })}
            </div>
          </div>

          {/* Payment Status */}
          <div className="p-4 bg-background rounded-xl border">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <CheckCircle className="w-3 h-3" />
              حالة الدفع
            </div>
            <div className="mt-1">
              {getPaymentStatusBadge(sale.payment_status)}
            </div>
          </div>

          {/* Sale Source */}
          <div className="p-4 bg-background rounded-xl border">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <CreditCard className="w-3 h-3" />
              المصدر
            </div>
            <div className="font-medium">نقطة البيع (POS)</div>
          </div>
        </div>

        <Separator />

        {/* Secondary Info */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Customer */}
          <div className="p-3 bg-muted/30 rounded-lg">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <User className="w-3 h-3" />
              العميل
            </div>
            <div className="font-medium text-sm">{sale.customer_name || 'عميل نقدي'}</div>
          </div>

          {/* Branch */}
          <div className="p-3 bg-muted/30 rounded-lg">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Building2 className="w-3 h-3" />
              الفرع
            </div>
            <div className="font-medium text-sm">{sale.branch_name || sale.branch_code}</div>
          </div>

          {/* Cashier */}
          {sale.cashier_name && (
            <div className="p-3 bg-muted/30 rounded-lg">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <User className="w-3 h-3" />
                الكاشير
              </div>
              <div className="font-medium text-sm">{sale.cashier_name}</div>
            </div>
          )}

          {/* Shift */}
          {sale.shift_number && (
            <div className="p-3 bg-muted/30 rounded-lg">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <Clock className="w-3 h-3" />
                رقم الشفت
              </div>
              <div className="font-medium text-sm">{sale.shift_number}</div>
            </div>
          )}
        </div>

        {/* Financial Summary */}
        {invoiceTotals && (
          <>
            <Separator />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="p-4 bg-background border-2 rounded-xl text-center">
                <div className="text-xs text-muted-foreground mb-1">إجمالي الفاتورة الأصلية</div>
                <div className="font-bold text-xl">{formatCurrency(invoiceTotals.originalTotal)}</div>
              </div>
              <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border-2 border-amber-200 dark:border-amber-800 rounded-xl text-center">
                <div className="text-xs text-amber-600 dark:text-amber-400 mb-1">المبلغ المرتجع سابقاً</div>
                <div className="font-bold text-xl text-amber-700 dark:text-amber-300">
                  {formatCurrency(invoiceTotals.previouslyReturned)}
                </div>
              </div>
              <div className="p-4 bg-green-50 dark:bg-green-950/30 border-2 border-green-200 dark:border-green-800 rounded-xl text-center">
                <div className="text-xs text-green-600 dark:text-green-400 mb-1">المتبقي المتاح للإرجاع</div>
                <div className="font-bold text-xl text-green-700 dark:text-green-300">
                  {formatCurrency(invoiceTotals.availableForReturn)}
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
