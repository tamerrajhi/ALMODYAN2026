import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { createPaymentVoucher } from '@/domain/purchasing';

interface PaymentEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: {
    id: string;
    invoice_number: string;
    supplier_id: string;
    supplier_name: string;
    total_amount: number;
    paid_amount: number;
    remaining_amount: number;
  };
  onPaymentCreated: () => void;
}

export function PaymentEntryDialog({ 
  open, 
  onOpenChange, 
  invoice,
  onPaymentCreated 
}: PaymentEntryDialogProps) {
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<string>('cash');
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Stable clientRequestId for idempotency - reset on successful submission
  const clientRequestIdRef = useRef<string | null>(null);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat(language === 'ar' ? 'ar-SA' : 'en-SA', {
      style: 'currency',
      currency: 'SAR',
      minimumFractionDigits: 2,
    }).format(value);
  };

  const handleSubmit = async () => {
    const paymentAmount = parseFloat(amount);

    // Basic validations
    if (isNaN(paymentAmount) || paymentAmount <= 0) {
      toast.error(language === 'ar' ? 'أدخل مبلغ صحيح' : 'Enter a valid amount');
      return;
    }

    if (paymentAmount > invoice.remaining_amount) {
      toast.error(language === 'ar' ? 'المبلغ أكبر من الرصيد المتبقي' : 'Amount exceeds remaining balance');
      return;
    }

    // Idempotency (stable per dialog submission)
    if (!clientRequestIdRef.current) {
      clientRequestIdRef.current = crypto.randomUUID();
    }

    setIsSubmitting(true);

    try {
      // PV-3B/PV-4: Lines are OPTIONAL - server derives them
      const result = await createPaymentVoucher({
        clientRequestId: clientRequestIdRef.current,
        paymentType: 'payment',
        paymentDate: format(new Date(), 'yyyy-MM-dd'),
        amount: paymentAmount,
        paymentMethod,
        supplierId: invoice.supplier_id,
        supplierName: invoice.supplier_name,
        invoiceId: invoice.id,
        notes: notes || undefined,
        // Allocations for proper invoice balance update
        allocations: [
          { invoiceId: invoice.id, amount: paymentAmount }
        ],
        // Lines NOT sent - server derives via derive_payment_voucher_lines
      });

      if (!result?.success) {
        toast.error(result?.error || (language === 'ar' ? 'فشل إنشاء السند' : 'Failed to create voucher'));
        return;
      }

      toast.success(
        language === 'ar'
          ? `تم إنشاء سند الصرف ${result.paymentNumber || ''} بنجاح`
          : `Payment voucher ${result.paymentNumber || ''} created successfully`
      );

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ['purchase-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['payment-vouchers'] });

      // Reset idempotency for next submission
      clientRequestIdRef.current = null;

      onPaymentCreated();
      handleClose();
    } catch (err: any) {
      console.error('Payment voucher creation failed:', err);
      toast.error(language === 'ar' ? 'حدث خطأ غير متوقع' : 'Unexpected error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setAmount('');
    setPaymentMethod('cash');
    setNotes('');
    clientRequestIdRef.current = null;
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]" dir={language === 'ar' ? 'rtl' : 'ltr'}>
        <DialogHeader>
          <DialogTitle>
            {language === 'ar' ? 'سند صرف جديد' : 'New Payment Voucher'}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Invoice Info - Read Only */}
          <div className="grid grid-cols-2 gap-4 p-3 bg-muted/50 rounded-lg">
            <div>
              <Label className="text-muted-foreground text-xs">
                {language === 'ar' ? 'رقم الفاتورة' : 'Invoice No'}
              </Label>
              <p className="font-medium">{invoice.invoice_number}</p>
            </div>
            <div>
              <Label className="text-muted-foreground text-xs">
                {language === 'ar' ? 'المورد' : 'Supplier'}
              </Label>
              <p className="font-medium">{invoice.supplier_name}</p>
            </div>
          </div>

          {/* Amount Summary */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-2 bg-muted/30 rounded">
              <p className="text-xs text-muted-foreground">
                {language === 'ar' ? 'الإجمالي' : 'Total'}
              </p>
              <p className="font-semibold text-sm">{formatCurrency(invoice.total_amount)}</p>
            </div>
            <div className="p-2 bg-green-50 dark:bg-green-900/20 rounded">
              <p className="text-xs text-muted-foreground">
                {language === 'ar' ? 'المدفوع' : 'Paid'}
              </p>
              <p className="font-semibold text-sm text-green-600">{formatCurrency(invoice.paid_amount)}</p>
            </div>
            <div className="p-2 bg-destructive/10 rounded">
              <p className="text-xs text-muted-foreground">
                {language === 'ar' ? 'المتبقي' : 'Remaining'}
              </p>
              <p className="font-semibold text-sm text-destructive">{formatCurrency(invoice.remaining_amount)}</p>
            </div>
          </div>

          {/* Payment Amount */}
          <div className="space-y-2">
            <Label htmlFor="amount">
              {language === 'ar' ? 'مبلغ السداد' : 'Payment Amount'} *
            </Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              min="0"
              max={invoice.remaining_amount}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={language === 'ar' ? 'أدخل المبلغ' : 'Enter amount'}
              className="text-lg"
            />
            <Button 
              type="button" 
              variant="link" 
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => setAmount(invoice.remaining_amount.toString())}
            >
              {language === 'ar' ? 'سداد كامل المتبقي' : 'Pay full remaining'}
            </Button>
          </div>

          {/* Payment Method */}
          <div className="space-y-2">
            <Label>
              {language === 'ar' ? 'طريقة الدفع' : 'Payment Method'}
            </Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">{language === 'ar' ? 'نقداً' : 'Cash'}</SelectItem>
                <SelectItem value="bank_transfer">{language === 'ar' ? 'تحويل بنكي' : 'Bank Transfer'}</SelectItem>
                <SelectItem value="check">{language === 'ar' ? 'شيك' : 'Check'}</SelectItem>
                <SelectItem value="card">{language === 'ar' ? 'بطاقة' : 'Card'}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">
              {language === 'ar' ? 'ملاحظات' : 'Notes'}
            </Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={language === 'ar' ? 'ملاحظات إضافية (اختياري)' : 'Additional notes (optional)'}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose} disabled={isSubmitting}>
            {language === 'ar' ? 'إلغاء' : 'Cancel'}
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin me-2" />}
            {language === 'ar' ? 'حفظ سند الصرف' : 'Save Payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}