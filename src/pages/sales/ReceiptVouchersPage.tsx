import { useState, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as dataGateway from '@/lib/dataGateway';
import { useLanguage } from '@/contexts/LanguageContext';
import MainLayout from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';
import { Plus, ArrowDownCircle, Wallet, FileText, AlertTriangle, Settings } from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { useReactToPrint } from 'react-to-print';
import { RowActionsMenu } from '@/components/ui/RowActionsMenu';
import { createPaymentVoucher, deletePaymentVoucher, DeletePaymentVoucherCommand } from '@/domain/purchasing';

interface Customer {
  id: string;
  full_name: string;
  customer_code: string;
}

interface Invoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  status: string;
  invoice_type: string;
  customer_id: string | null;
  supplier_id: string | null;
}

interface PaymentInvoice {
  id: string;
  invoice_number: string;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  status: string;
}

interface Payment {
  id: string;
  payment_number: string;
  payment_type: string;
  payment_date: string;
  amount: number;
  payment_method: string;
  notes: string | null;
  invoice_id: string | null;
  customer?: Customer;
  invoice?: PaymentInvoice;
  created_at: string;
}

export default function ReceiptVouchersPage() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [previewPayment, setPreviewPayment] = useState<Payment | null>(null);
  const [deletePayment, setDeletePayment] = useState<Payment | null>(null);
  const [printPayment, setPrintPayment] = useState<Payment | null>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const [formData, setFormData] = useState({
    payment_date: format(new Date(), 'yyyy-MM-dd'),
    amount: '',
    payment_method: 'cash',
    customer_id: '',
    invoice_id: '',
    notes: '',
  });

  const paymentMethodLabels: Record<string, string> = {
    cash: t.payments.cash,
    bank: t.payments.bankTransfer,
    check: t.payments.check,
    credit_card: t.payments.creditCard,
  };

  const { data: payments = [], isLoading } = useQuery({
    queryKey: ['receipt-vouchers'],
    queryFn: async () => {
      const { data: rawPayments, error } = await dataGateway.queryTable('payments', {
        select: '*',
        filters: [{ type: 'eq', column: 'payment_type', value: 'receipt' }],
        order: { column: 'created_at', ascending: false },
      });
      if (error) throw error;
      if (!rawPayments || rawPayments.length === 0) return [];

      const customerIds = [...new Set(rawPayments.map((p: any) => p.customer_id).filter(Boolean))] as string[];
      const invoiceIds = [...new Set(rawPayments.map((p: any) => p.invoice_id).filter(Boolean))] as string[];

      const [custRes, invRes] = await Promise.all([
        customerIds.length > 0
          ? dataGateway.queryTable('customers', { select: 'id, full_name, customer_code', filters: [{ type: 'in', column: 'id', value: customerIds }] })
          : { data: [], error: null },
        invoiceIds.length > 0
          ? dataGateway.queryTable('invoices', { select: 'id, invoice_number, total_amount, paid_amount, remaining_amount, status', filters: [{ type: 'in', column: 'id', value: invoiceIds }] })
          : { data: [], error: null },
      ]);

      const custMap = new Map((custRes.data || []).map((c: any) => [c.id, c]));
      const invMap = new Map((invRes.data || []).map((i: any) => [i.id, i]));

      return rawPayments.map((p: any) => ({
        ...p,
        customer: custMap.get(p.customer_id) || undefined,
        invoice: invMap.get(p.invoice_id) || undefined,
      })) as Payment[];
    },
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers-for-receipts'],
    queryFn: async () => {
      const { data, error } = await dataGateway.queryTable('customers', {
        select: 'id, full_name, customer_code',
        order: { column: 'name', ascending: true },
      });
      if (error) throw error;
      return (data || []) as Customer[];
    },
  });

  // التحقق من إعدادات الحسابات النقدية
  const { data: paymentSettings } = useQuery({
    queryKey: ['payment-account-settings-check'],
    queryFn: async () => {
      const { data, error } = await dataGateway.queryTable('payment_account_settings', {
        select: '*',
        filters: [{ type: 'is', column: 'branch_id', value: null }],
      });
      if (error) throw error;
      return (data && data.length > 0) ? data[0] : null;
    },
  });

  const isSettingsComplete = paymentSettings && 
    paymentSettings.cash_account_id && 
    paymentSettings.bank_transfer_account_id && 
    paymentSettings.check_account_id && 
    paymentSettings.card_account_id;

  // فواتير المبيعات غير المسددة للعميل المختار مع حساب المتبقي الفعلي
  const { data: salesInvoices = [] } = useQuery({
    queryKey: ['sales-invoices-for-receipt', formData.customer_id],
    queryFn: async () => {
      if (!formData.customer_id) return [];

      const { data: invoices, error } = await dataGateway.queryTable('invoices', {
        select: 'id, invoice_number, invoice_date, total_amount, paid_amount, remaining_amount, status, invoice_type, customer_id, supplier_id',
        filters: [
          { type: 'eq', column: 'invoice_type', value: 'sales' },
          { type: 'eq', column: 'customer_id', value: formData.customer_id },
          { type: 'in', column: 'status', value: ['pending', 'partially_paid'] },
        ],
        order: { column: 'invoice_date', ascending: false },
      });
      if (error) throw error;
      if (!invoices || invoices.length === 0) return [];

      const invoiceIds = invoices.map((inv: any) => inv.id);
      const { data: paymentsData } = await dataGateway.queryTable('payments', {
        select: 'invoice_id, amount',
        filters: [{ type: 'in', column: 'invoice_id', value: invoiceIds }],
      });

      const paymentsByInvoice = new Map<string, number>();
      (paymentsData || []).forEach((p: any) => {
        paymentsByInvoice.set(p.invoice_id, (paymentsByInvoice.get(p.invoice_id) || 0) + (p.amount || 0));
      });

      return invoices.map((inv: any) => {
        const actualPaid = paymentsByInvoice.get(inv.id) || 0;
        const calculatedRemaining = inv.total_amount - actualPaid;
        return {
          id: inv.id,
          invoice_number: inv.invoice_number,
          invoice_date: inv.invoice_date,
          total_amount: inv.total_amount,
          paid_amount: actualPaid,
          remaining_amount: calculatedRemaining,
          status: inv.status,
          invoice_type: inv.invoice_type,
          supplier_id: inv.supplier_id,
          customer_id: inv.customer_id,
        } as Invoice;
      }).filter((inv: Invoice) => inv.remaining_amount > 0);
    },
    enabled: !!formData.customer_id,
  });

  const selectedInvoice = useMemo(() => {
    return salesInvoices.find(inv => inv.id === formData.invoice_id);
  }, [salesInvoices, formData.invoice_id]);

  // Stable clientRequestId for idempotency
  const clientRequestIdRef = useRef<string | null>(null);

  const createReceiptMutation = useMutation({
    mutationFn: async () => {
      // PV-2 Blocked: Lines are required but not available from UI yet
      // This will be enabled in PV-3 when server-side derivation is implemented
      throw new Error('لا يمكن إنشاء سند القبض حاليًا لأن خطوط القيد المحاسبي غير متاحة. سيتم تفعيلها في التحديث القادم (PV-3).');
      
      // The code below is preserved for PV-3 implementation
      /*
      // Generate clientRequestId once per attempt
      if (!clientRequestIdRef.current) {
        clientRequestIdRef.current = crypto.randomUUID();
      }

      const customerName = formData.customer_id 
        ? customers.find(c => c.id === formData.customer_id)?.full_name 
        : undefined;

      const result = await createPaymentVoucher({
        clientRequestId: clientRequestIdRef.current,
        paymentType: 'receipt',
        paymentDate: formData.payment_date,
        amount: parseFloat(formData.amount),
        paymentMethod: formData.payment_method,
        customerId: formData.customer_id || null,
        customerName: customerName || null,
        invoiceId: formData.invoice_id || null,
        notes: formData.notes || null,
        lines: [], // PV-3: Will be derived server-side
      });

      if (!result.success) {
        if (result.errorCode === 'IN_PROGRESS') {
          throw new Error('جاري معالجة الطلب...');
        }
        if (result.errorCode === 'IDEMPOTENCY_CONFLICT') {
          throw new Error('تم تقديم هذا الطلب مسبقًا بقيم مختلفة');
        }
        if (result.errorCode === 'LINES_REQUIRED') {
          throw new Error(result.error || 'خطوط القيد المحاسبي مطلوبة');
        }
        throw new Error(result.error || 'فشل إنشاء السند');
      }

      // Reset clientRequestId on success
      clientRequestIdRef.current = null;
      return result;
      */
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['receipt-vouchers'] });
      queryClient.invalidateQueries({ queryKey: ['journal-entries'] });
      queryClient.invalidateQueries({ queryKey: ['sales-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success(t.payments.voucherCreatedSuccess);
      resetForm();
      setDialogOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.message || t.payments.voucherCreatedError);
    },
  });

  const resetForm = () => {
    setFormData({
      payment_date: format(new Date(), 'yyyy-MM-dd'),
      amount: '',
      payment_method: 'cash',
      customer_id: '',
      invoice_id: '',
      notes: '',
    });
  };

  const handleCustomerChange = (value: string) => {
    setFormData({ ...formData, customer_id: value, invoice_id: '' });
  };

  const handleInvoiceSelect = (invoiceId: string) => {
    const invoice = salesInvoices.find(inv => inv.id === invoiceId);
    if (invoice) {
      setFormData({ 
        ...formData, 
        invoice_id: invoiceId,
        amount: invoice.remaining_amount.toString()
      });
    }
  };

  const totalReceipts = payments.reduce((sum, p) => sum + p.amount, 0);

  // PV-4: Delete mutation using atomic void RPC
  const deleteMutation = useMutation({
    mutationFn: async (payment: Payment) => {
      const cmd: DeletePaymentVoucherCommand = { 
        paymentId: payment.id,
        voidReason: 'حذف سند قبض'
      };
      const result = await deletePaymentVoucher(cmd);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['receipt-vouchers'] });
      queryClient.invalidateQueries({ queryKey: ['journal-entries'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('تم إلغاء سند القبض بنجاح');
      setDeletePayment(null);
    },
    onError: (error: any) => {
      toast.error(error.message || 'حدث خطأ أثناء إلغاء السند');
    },
  });

  // Print handler
  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `سند قبض - ${printPayment?.payment_number}`,
    onAfterPrint: () => setPrintPayment(null),
  });

  const filteredPayments = payments.filter(payment => {
    return (
      payment.payment_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.customer?.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.invoice?.invoice_number?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        {!isSettingsComplete && (
          <Alert className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20">
            <AlertTriangle className="h-4 w-4 text-yellow-600" />
            <AlertDescription className="flex items-center justify-between">
              <span className="text-yellow-800 dark:text-yellow-200">
                يجب ضبط إعدادات الحسابات النقدية لضمان تسجيل القيود المحاسبية بشكل صحيح
              </span>
              <Link 
                to="/settings/payment-accounts" 
                className="flex items-center gap-1 text-primary hover:underline font-medium mr-4"
              >
                <Settings className="h-4 w-4" />
                اذهب للإعدادات
              </Link>
            </AlertDescription>
          </Alert>
        )}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">{t.payments.receiptVouchers}</h1>
            <p className="text-muted-foreground">{t.payments.receiptVouchersSubtitle}</p>
          </div>

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                {t.payments.newReceiptVoucher}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{t.payments.createReceiptVoucher}</DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>{t.common.date}</Label>
                  <Input
                    type="date"
                    value={formData.payment_date}
                    onChange={(e) => setFormData({ ...formData, payment_date: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label>{t.customers.title}</Label>
                  <Select
                    value={formData.customer_id}
                    onValueChange={handleCustomerChange}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t.payments.selectCustomer} />
                    </SelectTrigger>
                    <SelectContent>
                      {customers.map((customer) => (
                        <SelectItem key={customer.id} value={customer.id}>
                          {customer.customer_code} - {customer.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>{t.payments.linkedSalesInvoice}</Label>
                  <Select
                    value={formData.invoice_id}
                    onValueChange={handleInvoiceSelect}
                    disabled={!formData.customer_id}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={
                        !formData.customer_id 
                          ? t.payments.selectCustomerFirst
                          : t.payments.selectInvoice
                      } />
                    </SelectTrigger>
                    <SelectContent>
                      {salesInvoices.length === 0 ? (
                        <div className="p-2 text-sm text-muted-foreground text-center">
                          {t.payments.noUnpaidInvoices}
                        </div>
                      ) : (
                        salesInvoices.map((invoice) => (
                          <SelectItem key={invoice.id} value={invoice.id}>
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4" />
                              <span>{invoice.invoice_number}</span>
                              <span className="text-muted-foreground">|</span>
                              <span>{format(new Date(invoice.invoice_date), 'yyyy/MM/dd')}</span>
                              <span className="text-muted-foreground">|</span>
                              <span className="text-primary font-medium">
                                {t.payments.remainingAmount}: {invoice.remaining_amount?.toLocaleString()} {t.currency.sar}
                              </span>
                            </div>
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  {selectedInvoice && (
                    <div className="text-sm text-muted-foreground bg-muted/50 p-2 rounded-md">
                      <div className="flex justify-between">
                        <span>{t.common.total}:</span>
                        <span>{selectedInvoice.total_amount?.toLocaleString()} {t.currency.sar}</span>
                      </div>
                      <div className="flex justify-between text-green-600">
                        <span>{t.payments.remainingAmount}:</span>
                        <span>{selectedInvoice.remaining_amount?.toLocaleString()} {t.currency.sar}</span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t.payments.amount}</Label>
                    <Input
                      type="number"
                      min="0"
                      value={formData.amount}
                      onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                      placeholder="0"
                      required
                    />
                    {selectedInvoice && parseFloat(formData.amount) > selectedInvoice.remaining_amount && (
                      <p className="text-xs text-yellow-600">{t.payments.amountExceedsRemaining}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>{t.payments.paymentMethod}</Label>
                    <Select
                      value={formData.payment_method}
                      onValueChange={(value) => setFormData({ ...formData, payment_method: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">{t.payments.cash}</SelectItem>
                        <SelectItem value="bank">{t.payments.bankTransfer}</SelectItem>
                        <SelectItem value="check">{t.payments.check}</SelectItem>
                        <SelectItem value="credit_card">{t.payments.creditCard}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>{t.common.notes}</Label>
                  <Textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder={t.payments.optionalNotes}
                  />
                </div>

                <div className="flex gap-2 justify-end">
                  <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                    {t.common.cancel}
                  </Button>
                  <Button
                    onClick={() => createReceiptMutation.mutate()}
                    disabled={!formData.amount || createReceiptMutation.isPending}
                  >
                    {t.payments.saveVoucher}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats Card */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">{t.payments.totalReceipts}</CardTitle>
              <ArrowDownCircle className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-500">{totalReceipts.toLocaleString()} {t.currency.sar}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">{t.payments.vouchersCount}</CardTitle>
              <Wallet className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{payments.length}</div>
            </CardContent>
          </Card>
        </div>

        <Input
          placeholder={t.payments.searchPlaceholder}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="max-w-sm"
        />

        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.payments.voucherNumber}</TableHead>
                <TableHead>{t.common.date}</TableHead>
                <TableHead>{t.customers.title}</TableHead>
                <TableHead>{t.payments.relatedInvoice}</TableHead>
                <TableHead className="text-left">{t.payments.amount}</TableHead>
                <TableHead>{t.payments.paymentMethod}</TableHead>
                <TableHead>{t.common.notes}</TableHead>
                <TableHead>{t.common.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
                    {t.common.loading}
                  </TableCell>
                </TableRow>
              ) : filteredPayments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
                    {t.payments.noVouchers}
                  </TableCell>
                </TableRow>
              ) : (
                filteredPayments.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell className="font-mono">{payment.payment_number}</TableCell>
                    <TableCell>
                      {format(new Date(payment.payment_date), 'yyyy/MM/dd')}
                    </TableCell>
                    <TableCell>
                      {payment.customer?.full_name || '-'}
                    </TableCell>
                    <TableCell>
                      {payment.invoice?.invoice_number ? (
                        <Badge variant="outline" className="font-mono">
                          <FileText className="h-3 w-3 mr-1" />
                          {payment.invoice.invoice_number}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-left font-mono font-bold text-green-500">
                      {payment.amount.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {paymentMethodLabels[payment.payment_method] || payment.payment_method}
                    </TableCell>
                    <TableCell className="max-w-xs truncate">
                      {payment.notes || '-'}
                    </TableCell>
                    <TableCell>
                      <RowActionsMenu
                        onPreview={() => setPreviewPayment(payment)}
                        onPrint={() => {
                          setPrintPayment(payment);
                          setTimeout(() => handlePrint(), 100);
                        }}
                        onDelete={() => setDeletePayment(payment)}
                        labels={{
                          preview: 'معاينة',
                          print: t.common.print,
                          delete: t.common.delete,
                        }}
                        isLoading={deleteMutation.isPending ? 'delete' : null}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Preview Dialog */}
        <Dialog open={!!previewPayment} onOpenChange={() => setPreviewPayment(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>تفاصيل سند القبض</DialogTitle>
            </DialogHeader>
            {previewPayment && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground">رقم السند</Label>
                    <p className="font-mono font-medium">{previewPayment.payment_number}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">التاريخ</Label>
                    <p>{format(new Date(previewPayment.payment_date), 'yyyy/MM/dd')}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">العميل</Label>
                    <p>{previewPayment.customer?.full_name || '-'}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">الفاتورة المرتبطة</Label>
                    <p className="font-mono">{previewPayment.invoice?.invoice_number || '-'}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">المبلغ</Label>
                    <p className="font-bold text-green-600">{previewPayment.amount.toLocaleString()} {t.currency.sar}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">طريقة الدفع</Label>
                    <p>{paymentMethodLabels[previewPayment.payment_method] || previewPayment.payment_method}</p>
                  </div>
                </div>
                {previewPayment.notes && (
                  <div>
                    <Label className="text-muted-foreground">ملاحظات</Label>
                    <p className="text-sm">{previewPayment.notes}</p>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={!!deletePayment} onOpenChange={() => setDeletePayment(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
              <AlertDialogDescription>
                هل أنت متأكد من حذف سند القبض رقم <strong>{deletePayment?.payment_number}</strong>؟
                <br />
                سيتم عكس القيد المحاسبي المرتبط وتحديث رصيد الفاتورة.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>إلغاء</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deletePayment && deleteMutation.mutate(deletePayment)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                حذف
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Hidden Print Content */}
        <div className="hidden">
          <div ref={printRef} className="invoice-a4-container" dir="rtl">
            {printPayment && (
              <div className="space-y-6">
                <div className="text-center border-b pb-4">
                  <h1 className="text-2xl font-bold">سند قبض</h1>
                  <p className="text-lg font-mono">{printPayment.payment_number}</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><strong>التاريخ:</strong> {format(new Date(printPayment.payment_date), 'yyyy/MM/dd')}</div>
                  <div><strong>العميل:</strong> {printPayment.customer?.full_name || '-'}</div>
                  <div><strong>الفاتورة:</strong> {printPayment.invoice?.invoice_number || '-'}</div>
                  <div><strong>طريقة الدفع:</strong> {paymentMethodLabels[printPayment.payment_method]}</div>
                </div>
                <div className="text-center text-2xl font-bold border-t border-b py-4">
                  المبلغ: {printPayment.amount.toLocaleString()} ر.س
                </div>
                {printPayment.notes && (
                  <div><strong>ملاحظات:</strong> {printPayment.notes}</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
