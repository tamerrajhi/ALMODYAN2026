import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { useLanguage } from '@/contexts/LanguageContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, AlertCircle } from 'lucide-react';
import SupplierSelect from './SupplierSelect';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { listInvoicesForPayment } from '@/domain/purchasing/purchasingReadService';
import { processImportPayment } from '@/domain/purchasing/purchasingWriteService';

interface PaymentExpense {
  expense_type: string;
  amount: number;
}

interface ImportPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment?: any;
  defaultInvoiceId?: string | null;
  defaultSupplierId?: string | null;
  onSuccess?: () => void;
}

const CURRENCIES = [
  { code: 'SAR', label: { ar: 'ريال سعودي', en: 'Saudi Riyal' } },
  { code: 'USD', label: { ar: 'دولار أمريكي', en: 'US Dollar' } },
  { code: 'EUR', label: { ar: 'يورو', en: 'Euro' } },
  { code: 'GBP', label: { ar: 'جنيه إسترليني', en: 'British Pound' } },
  { code: 'AED', label: { ar: 'درهم إماراتي', en: 'UAE Dirham' } },
  { code: 'INR', label: { ar: 'روبية هندية', en: 'Indian Rupee' } },
];

const PAYMENT_METHODS = [
  { value: 'bank_transfer', label: { ar: 'تحويل بنكي', en: 'Bank Transfer' } },
  { value: 'cash', label: { ar: 'نقدي', en: 'Cash' } },
  { value: 'check', label: { ar: 'شيك', en: 'Check' } },
  { value: 'lc', label: { ar: 'اعتماد مستندي', en: 'Letter of Credit' } },
  { value: 'card', label: { ar: 'بطاقة', en: 'Card' } },
];

const EXPENSE_TYPES = [
  { value: 'invoice_value', label: { ar: 'قيمة الفاتورة', en: 'Invoice Value' } },
  { value: 'shipping', label: { ar: 'رسوم الشحن', en: 'Shipping Fees' } },
  { value: 'customs', label: { ar: 'رسوم الجمارك', en: 'Customs Duties' } },
  { value: 'bank_fees', label: { ar: 'عمولة البنك', en: 'Bank Fees' } },
  { value: 'other', label: { ar: 'مصاريف أخرى', en: 'Other Expenses' } },
];

export function ImportPaymentDialog({
  open,
  onOpenChange,
  payment,
  defaultInvoiceId,
  defaultSupplierId,
  onSuccess,
}: ImportPaymentDialogProps) {
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const isEditing = !!payment;

  // Form state
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer');
  const [documentNumber, setDocumentNumber] = useState('');
  const [currency, setCurrency] = useState('SAR');
  const [exchangeRate, setExchangeRate] = useState('1');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');

  // Expense distribution state
  const [useDistribution, setUseDistribution] = useState(false);
  const [expenses, setExpenses] = useState<PaymentExpense[]>([
    { expense_type: 'invoice_value', amount: 0 },
  ]);

  // Fetch purchase invoices via Read Service
  const { data: invoices } = useQuery({
    queryKey: ['purchase-invoices-for-payment', supplierId],
    queryFn: () => listInvoicesForPayment(supplierId),
    enabled: open,
  });

  // Process payment mutation via Write Service
  const processPaymentMutation = useMutation({
    mutationFn: processImportPayment,
    onSuccess: (result) => {
      if (result.success) {
        toast.success(language === 'ar' 
          ? (isEditing ? 'تم تحديث الدفعة بنجاح' : 'تم إضافة الدفعة بنجاح')
          : (isEditing ? 'Payment updated successfully' : 'Payment added successfully'));
        queryClient.invalidateQueries({ queryKey: ['import-payments'] });
        queryClient.invalidateQueries({ queryKey: ['purchase-invoices-for-payment'] });
        queryClient.invalidateQueries({ queryKey: ['purchase-invoices-for-filter'] });
        onSuccess?.();
        onOpenChange(false);
      } else {
        toast.error(result.error || (language === 'ar' ? 'حدث خطأ أثناء الحفظ' : 'Error saving payment'));
      }
    },
    onError: (error: any) => {
      console.error('Error saving payment:', error);
      toast.error(language === 'ar' ? 'حدث خطأ أثناء الحفظ' : 'Error saving payment');
    },
  });

  // Selected invoice details
  const selectedInvoice = useMemo(() => {
    if (!invoiceId || !invoices) return null;
    return invoices.find(inv => inv.id === invoiceId);
  }, [invoiceId, invoices]);

  // Calculate local amount
  const localAmount = useMemo(() => {
    const amt = parseFloat(amount) || 0;
    const rate = parseFloat(exchangeRate) || 1;
    return amt * rate;
  }, [amount, exchangeRate]);

  // Calculate total expenses
  const totalExpenses = useMemo(() => {
    return expenses.reduce((sum, exp) => sum + (exp.amount || 0), 0);
  }, [expenses]);

  // Validation
  const validation = useMemo(() => {
    const errors: string[] = [];
    const amt = parseFloat(amount) || 0;
    
    if (!invoiceId) {
      errors.push(language === 'ar' ? 'يجب اختيار الفاتورة' : 'Invoice is required');
    }
    if (!amt || amt <= 0) {
      errors.push(language === 'ar' ? 'المبلغ يجب أن يكون أكبر من صفر' : 'Amount must be greater than zero');
    }
    if (useDistribution && Math.abs(totalExpenses - amt) > 0.01) {
      errors.push(language === 'ar' 
        ? 'مجموع التوزيع يجب أن يساوي المبلغ الإجمالي' 
        : 'Distribution total must equal payment amount');
    }
    
    // Check remaining amount
    if (selectedInvoice && localAmount > (selectedInvoice.remainingAmount || 0) + 0.01) {
      errors.push(language === 'ar' 
        ? `المبلغ يتجاوز المتبقي من الفاتورة (${formatCurrency(selectedInvoice.remainingAmount || 0)})`
        : `Amount exceeds invoice remaining (${formatCurrency(selectedInvoice.remainingAmount || 0)})`);
    }
    
    return {
      isValid: errors.length === 0,
      errors,
    };
  }, [amount, invoiceId, useDistribution, totalExpenses, selectedInvoice, localAmount, language]);

  // Reset form
  useEffect(() => {
    if (open) {
      if (payment) {
        // Editing mode
        setSupplierId(payment.supplier_id);
        setInvoiceId(payment.invoice_id);
        setPaymentDate(payment.payment_date);
        setPaymentMethod(payment.payment_method);
        setDocumentNumber(payment.document_number || '');
        setCurrency(payment.currency || 'SAR');
        setExchangeRate(String(payment.exchange_rate || 1));
        setAmount(String(payment.amount));
        setNotes(payment.notes || '');
        
        if (payment.expenses?.length > 0) {
          setUseDistribution(true);
          setExpenses(payment.expenses.map((e: any) => ({
            expense_type: e.expense_type || e.expenseType,
            amount: e.amount,
          })));
        }
      } else {
        // New payment
        setSupplierId(defaultSupplierId || null);
        setInvoiceId(defaultInvoiceId || null);
        setPaymentDate(new Date().toISOString().split('T')[0]);
        setPaymentMethod('bank_transfer');
        setDocumentNumber('');
        setCurrency('SAR');
        setExchangeRate('1');
        setAmount('');
        setNotes('');
        setUseDistribution(false);
        setExpenses([{ expense_type: 'invoice_value', amount: 0 }]);
      }
    }
  }, [open, payment, defaultInvoiceId, defaultSupplierId]);

  // Update expense amount when main amount changes
  useEffect(() => {
    if (!useDistribution && expenses.length === 1) {
      setExpenses([{ expense_type: 'invoice_value', amount: parseFloat(amount) || 0 }]);
    }
  }, [amount, useDistribution]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat(language === 'ar' ? 'ar-SA' : 'en-SA', {
      style: 'currency',
      currency: 'SAR',
      minimumFractionDigits: 2,
    }).format(value);
  };

  const handleExpenseChange = (index: number, value: number) => {
    const newExpenses = [...expenses];
    newExpenses[index].amount = value;
    setExpenses(newExpenses);
  };

  const addExpenseType = (type: string) => {
    if (!expenses.find(e => e.expense_type === type)) {
      setExpenses([...expenses, { expense_type: type, amount: 0 }]);
    }
  };

  const removeExpenseType = (type: string) => {
    if (type !== 'invoice_value') {
      setExpenses(expenses.filter(e => e.expense_type !== type));
    }
  };

  const handleSubmit = () => {
    if (!validation.isValid) {
      validation.errors.forEach(err => toast.error(err));
      return;
    }

    processPaymentMutation.mutate({
      id: payment?.id,
      invoiceId: invoiceId!,
      supplierId: supplierId || selectedInvoice?.supplierId,
      paymentDate,
      paymentMethod,
      documentNumber: documentNumber || null,
      currency,
      exchangeRate: parseFloat(exchangeRate) || 1,
      amount: parseFloat(amount),
      notes: notes || null,
      useDistribution,
      expenses: expenses.map(e => ({
        expenseType: e.expense_type,
        amount: e.amount,
      })),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing 
              ? (language === 'ar' ? 'تعديل دفعة' : 'Edit Payment')
              : (language === 'ar' ? 'إضافة دفعة جديدة' : 'Add New Payment')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Supplier & Invoice Selection */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="mb-2 block">
                {language === 'ar' ? 'المورد' : 'Supplier'}
              </Label>
              <SupplierSelect
                value={supplierId || ''}
                onSelect={(id) => {
                  setSupplierId(id || null);
                  setInvoiceId(null);
                }}
              />
            </div>
            <div>
              <Label className="mb-2 block">
                {language === 'ar' ? 'فاتورة الاستيراد' : 'Import Invoice'} *
              </Label>
              <Select
                value={invoiceId || ''}
                onValueChange={(value) => setInvoiceId(value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={language === 'ar' ? 'اختر الفاتورة' : 'Select Invoice'} />
                </SelectTrigger>
                <SelectContent>
                  {invoices?.map((inv) => (
                    <SelectItem key={inv.id} value={inv.id}>
                      {inv.invoiceNumber} - {formatCurrency(inv.remainingAmount || 0)} {language === 'ar' ? 'متبقي' : 'remaining'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Selected Invoice Summary */}
          {selectedInvoice && (
            <Card className="bg-muted/50">
              <CardContent className="pt-4">
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">{language === 'ar' ? 'إجمالي الفاتورة' : 'Invoice Total'}</p>
                    <p className="font-medium">{formatCurrency(selectedInvoice.totalAmount)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{language === 'ar' ? 'المدفوع' : 'Paid'}</p>
                    <p className="font-medium text-green-600">{formatCurrency(selectedInvoice.paidAmount || 0)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{language === 'ar' ? 'المتبقي' : 'Remaining'}</p>
                    <p className="font-medium text-red-600">{formatCurrency(selectedInvoice.remainingAmount || 0)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Payment Details */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label className="mb-2 block">
                {language === 'ar' ? 'تاريخ الدفعة' : 'Payment Date'} *
              </Label>
              <Input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
              />
            </div>
            <div>
              <Label className="mb-2 block">
                {language === 'ar' ? 'نوع الدفعة' : 'Payment Method'} *
              </Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((method) => (
                    <SelectItem key={method.value} value={method.value}>
                      {method.label[language]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-2 block">
                {language === 'ar' ? 'رقم المستند' : 'Document Number'}
              </Label>
              <Input
                value={documentNumber}
                onChange={(e) => setDocumentNumber(e.target.value)}
                placeholder={language === 'ar' ? 'رقم التحويل / الشيك' : 'Transfer / Check #'}
              />
            </div>
          </div>

          {/* Currency & Amount */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <Label className="mb-2 block">
                {language === 'ar' ? 'العملة' : 'Currency'}
              </Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((curr) => (
                    <SelectItem key={curr.code} value={curr.code}>
                      {curr.code} - {curr.label[language]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-2 block">
                {language === 'ar' ? 'سعر الصرف' : 'Exchange Rate'}
              </Label>
              <Input
                type="number"
                step="0.0001"
                value={exchangeRate}
                onChange={(e) => setExchangeRate(e.target.value)}
                disabled={currency === 'SAR'}
              />
            </div>
            <div>
              <Label className="mb-2 block">
                {language === 'ar' ? 'المبلغ' : 'Amount'} *
              </Label>
              <Input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div>
              <Label className="mb-2 block">
                {language === 'ar' ? 'المبلغ بالريال' : 'Amount in SAR'}
              </Label>
              <Input
                type="text"
                value={formatCurrency(localAmount)}
                disabled
                className="bg-muted"
              />
            </div>
          </div>

          {/* Expense Distribution */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id="useDistribution"
                checked={useDistribution}
                onCheckedChange={(checked) => setUseDistribution(checked === true)}
              />
              <Label htmlFor="useDistribution" className="cursor-pointer">
                {language === 'ar' ? 'توزيع الدفعة على أنواع المصاريف' : 'Distribute payment across expense types'}
              </Label>
            </div>

            {useDistribution && (
              <Card>
                <CardContent className="pt-4 space-y-4">
                  {EXPENSE_TYPES.map((type) => {
                    const expense = expenses.find(e => e.expense_type === type.value);
                    const isActive = !!expense;
                    
                    return (
                      <div key={type.value} className="flex items-center gap-4">
                        <Checkbox
                          checked={isActive}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              addExpenseType(type.value);
                            } else {
                              removeExpenseType(type.value);
                            }
                          }}
                          disabled={type.value === 'invoice_value'}
                        />
                        <Label className="flex-1 min-w-[120px]">
                          {type.label[language]}
                        </Label>
                        {isActive && (
                          <Input
                            type="number"
                            step="0.01"
                            value={expense?.amount || ''}
                            onChange={(e) => {
                              const index = expenses.findIndex(ex => ex.expense_type === type.value);
                              if (index >= 0) {
                                handleExpenseChange(index, parseFloat(e.target.value) || 0);
                              }
                            }}
                            className="w-32"
                            placeholder="0.00"
                          />
                        )}
                      </div>
                    );
                  })}
                  
                  <div className="pt-2 border-t flex justify-between items-center">
                    <span className="font-medium">
                      {language === 'ar' ? 'المجموع:' : 'Total:'}
                    </span>
                    <span className={`font-bold ${Math.abs(totalExpenses - (parseFloat(amount) || 0)) > 0.01 ? 'text-red-600' : 'text-green-600'}`}>
                      {formatCurrency(totalExpenses)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Notes */}
          <div>
            <Label className="mb-2 block">
              {language === 'ar' ? 'ملاحظات' : 'Notes'}
            </Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={language === 'ar' ? 'أضف ملاحظات...' : 'Add notes...'}
              rows={2}
            />
          </div>

          {/* Validation Errors */}
          {!validation.isValid && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <ul className="list-disc list-inside">
                  {validation.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={processPaymentMutation.isPending}>
            {language === 'ar' ? 'إلغاء' : 'Cancel'}
          </Button>
          <Button onClick={handleSubmit} disabled={processPaymentMutation.isPending || !validation.isValid}>
            {processPaymentMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              language === 'ar' ? 'حفظ' : 'Save'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
