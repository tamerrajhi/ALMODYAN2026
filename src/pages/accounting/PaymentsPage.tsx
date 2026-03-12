import { useState, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Plus, ArrowUpCircle, ArrowDownCircle, Wallet, FileText } from 'lucide-react';
import { format } from 'date-fns';
import { createPaymentVoucher } from '@/domain/purchasing';
import { queryTable } from '@/lib/dataGateway';
import * as apiClient from '@/lib/apiClient';

interface Customer {
  id: string;
  full_name: string;
  customer_code: string;
}

interface Supplier {
  id: string;
  supplier_name: string;
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
  supplier?: Supplier;
  invoice?: PaymentInvoice;
  created_at: string;
}

export default function PaymentsPage() {
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [formData, setFormData] = useState({
    payment_type: 'receipt',
    payment_date: format(new Date(), 'yyyy-MM-dd'),
    amount: '',
    payment_method: 'cash',
    customer_id: '',
    supplier_id: '',
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
    queryKey: ['payments'],
    queryFn: async () => {
      const { data, error } = await apiClient.get<Payment[]>('/api/payments-with-relations');
      if (error) throw new Error(error.message);
      return data || [];
    },
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers-for-payments'],
    queryFn: async () => {
      const { data, error } = await queryTable<any[]>('customers', { select: 'id, name, code', order: { column: 'name', ascending: true } });
      if (error) throw new Error(error.message);
      return (data || []).map(c => ({ id: c.id, full_name: c.name, customer_code: c.code })) as Customer[];
    },
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-for-payments'],
    queryFn: async () => {
      const { data, error } = await queryTable<Supplier[]>('suppliers', { order: { column: 'supplier_name', ascending: true } });
      if (error) throw new Error(error.message);
      return data || [];
    },
  });

  // فواتير المشتريات غير المسددة للمورد المختار مع حساب المتبقي الفعلي
  const { data: purchaseInvoices = [] } = useQuery({
    queryKey: ['purchase-invoices-for-payment', formData.supplier_id],
    queryFn: async () => {
      if (!formData.supplier_id) return [];
      
      const { data, error } = await apiClient.get<Invoice[]>('/api/invoices-for-payment', { invoice_type: 'purchase', supplier_id: formData.supplier_id });
      if (error) throw new Error(error.message);
      return (data || []).filter(inv => inv.remaining_amount > 0);
    },
    enabled: !!formData.supplier_id && formData.payment_type === 'payment',
  });

  // فواتير المبيعات غير المسددة للعميل المختار مع حساب المتبقي الفعلي
  const { data: salesInvoices = [] } = useQuery({
    queryKey: ['sales-invoices-for-receipt', formData.customer_id],
    queryFn: async () => {
      if (!formData.customer_id) return [];
      
      const { data, error } = await apiClient.get<Invoice[]>('/api/invoices-for-payment', { invoice_type: 'sales', customer_id: formData.customer_id });
      if (error) throw new Error(error.message);
      return (data || []).filter(inv => inv.remaining_amount > 0);
    },
    enabled: !!formData.customer_id && formData.payment_type === 'receipt',
  });

  // الفواتير المتاحة بناءً على نوع السند
  const availableInvoices = useMemo(() => {
    return formData.payment_type === 'payment' ? purchaseInvoices : salesInvoices;
  }, [formData.payment_type, purchaseInvoices, salesInvoices]);

  // الفاتورة المختارة
  const selectedInvoice = useMemo(() => {
    return availableInvoices.find(inv => inv.id === formData.invoice_id);
  }, [availableInvoices, formData.invoice_id]);

  // Stable clientRequestId for idempotency
  const clientRequestIdRef = useRef<string | null>(null);

  const createPaymentMutation = useMutation({
    mutationFn: async () => {
      // PV-2 Blocked: Lines are required but not available from UI yet
      // This will be enabled in PV-3 when server-side derivation is implemented
      throw new Error('لا يمكن إنشاء سند الدفع حاليًا لأن خطوط القيد المحاسبي غير متاحة. سيتم تفعيلها في التحديث القادم (PV-3).');
      
      // The code below is preserved for PV-3 implementation
      /*
      // Generate clientRequestId once per attempt
      if (!clientRequestIdRef.current) {
        clientRequestIdRef.current = crypto.randomUUID();
      }

      const customerName = formData.customer_id 
        ? customers.find(c => c.id === formData.customer_id)?.full_name 
        : undefined;
      const supplierName = formData.supplier_id 
        ? suppliers.find(s => s.id === formData.supplier_id)?.supplier_name 
        : undefined;

      const result = await createPaymentVoucher({
        clientRequestId: clientRequestIdRef.current,
        paymentType: formData.payment_type as 'payment' | 'receipt',
        paymentDate: formData.payment_date,
        amount: parseFloat(formData.amount),
        paymentMethod: formData.payment_method,
        customerId: formData.customer_id || null,
        supplierId: formData.supplier_id || null,
        customerName: customerName || null,
        supplierName: supplierName || null,
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
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['journal-entries'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-invoices'] });
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
      payment_type: 'receipt',
      payment_date: format(new Date(), 'yyyy-MM-dd'),
      amount: '',
      payment_method: 'cash',
      customer_id: '',
      supplier_id: '',
      invoice_id: '',
      notes: '',
    });
  };

  const handlePaymentTypeChange = (value: string) => {
    setFormData({ 
      ...formData, 
      payment_type: value, 
      customer_id: '', 
      supplier_id: '', 
      invoice_id: '' 
    });
  };

  const handleCustomerChange = (value: string) => {
    setFormData({ ...formData, customer_id: value, invoice_id: '' });
  };

  const handleSupplierChange = (value: string) => {
    setFormData({ ...formData, supplier_id: value, invoice_id: '' });
  };

  const handleInvoiceSelect = (invoiceId: string) => {
    const invoice = availableInvoices.find(inv => inv.id === invoiceId);
    if (invoice) {
      setFormData({ 
        ...formData, 
        invoice_id: invoiceId,
        // تعبئة المبلغ المتبقي تلقائياً
        amount: invoice.remaining_amount.toString()
      });
    }
  };

  const stats = {
    receipts: payments.filter(p => p.payment_type === 'receipt').reduce((sum, p) => sum + p.amount, 0),
    payments: payments.filter(p => p.payment_type === 'payment').reduce((sum, p) => sum + p.amount, 0),
  };

  const filteredPayments = payments.filter(payment => {
    const matchesSearch = 
      payment.payment_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.customer?.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.supplier?.supplier_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.invoice?.invoice_number?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesTab = 
      activeTab === 'all' ||
      (activeTab === 'receipts' && payment.payment_type === 'receipt') ||
      (activeTab === 'payments' && payment.payment_type === 'payment');

    return matchesSearch && matchesTab;
  });

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-3xl font-bold">{t.payments.title}</h1>
            <p className="text-muted-foreground">{t.payments.subtitle}</p>
          </div>

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                {t.payments.newVoucher}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{t.payments.createVoucher}</DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t.payments.voucherType}</Label>
                    <Select
                      value={formData.payment_type}
                      onValueChange={handlePaymentTypeChange}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="receipt">{t.payments.receipt}</SelectItem>
                        <SelectItem value="payment">{t.payments.payment}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{t.common.date}</Label>
                    <Input
                      type="date"
                      value={formData.payment_date}
                      onChange={(e) => setFormData({ ...formData, payment_date: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>{formData.payment_type === 'receipt' ? t.customers.title : t.suppliers.title}</Label>
                  {formData.payment_type === 'receipt' ? (
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
                  ) : (
                    <Select
                      value={formData.supplier_id}
                      onValueChange={handleSupplierChange}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t.payments.selectSupplier} />
                      </SelectTrigger>
                      <SelectContent>
                        {suppliers.map((supplier) => (
                          <SelectItem key={supplier.id} value={supplier.id}>
                            {supplier.supplier_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {/* حقل الفاتورة المرتبطة */}
                <div className="space-y-2">
                  <Label>
                    {formData.payment_type === 'receipt' 
                      ? t.payments.linkedSalesInvoice 
                      : t.payments.linkedPurchaseInvoice}
                  </Label>
                  <Select
                    value={formData.invoice_id}
                    onValueChange={handleInvoiceSelect}
                    disabled={
                      (formData.payment_type === 'receipt' && !formData.customer_id) ||
                      (formData.payment_type === 'payment' && !formData.supplier_id)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={
                        (formData.payment_type === 'receipt' && !formData.customer_id) 
                          ? t.payments.selectCustomerFirst
                          : (formData.payment_type === 'payment' && !formData.supplier_id)
                            ? t.payments.selectSupplierFirst
                            : t.payments.selectInvoice
                      } />
                    </SelectTrigger>
                    <SelectContent>
                      {availableInvoices.length === 0 ? (
                        <div className="p-2 text-sm text-muted-foreground text-center">
                          {t.payments.noUnpaidInvoices}
                        </div>
                      ) : (
                        availableInvoices.map((invoice) => (
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
                    onClick={() => createPaymentMutation.mutate()}
                    disabled={!formData.amount || createPaymentMutation.isPending}
                  >
                    {t.payments.saveVoucher}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">{t.payments.totalReceipts}</CardTitle>
              <ArrowDownCircle className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-500">{stats.receipts.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">{t.payments.totalPayments}</CardTitle>
              <ArrowUpCircle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-500">{stats.payments.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">{t.payments.netBalance}</CardTitle>
              <Wallet className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${stats.receipts - stats.payments >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {(stats.receipts - stats.payments).toLocaleString()}
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="all">{t.common.all}</TabsTrigger>
            <TabsTrigger value="receipts">{t.payments.receipts}</TabsTrigger>
            <TabsTrigger value="payments">{t.payments.payments}</TabsTrigger>
          </TabsList>
        </Tabs>

        <Input
          placeholder={t.payments.searchPlaceholder}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="max-w-sm"
        />

        <div className="responsive-table-wrapper">
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.payments.voucherNumber}</TableHead>
                <TableHead>{t.payments.type}</TableHead>
                <TableHead>{t.common.date}</TableHead>
                <TableHead>{t.payments.customerSupplier}</TableHead>
                <TableHead>{t.payments.relatedInvoice}</TableHead>
                <TableHead className="text-left">{t.payments.amount}</TableHead>
                <TableHead>{t.payments.paymentMethod}</TableHead>
                <TableHead>{t.common.notes}</TableHead>
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
                      <Badge className={payment.payment_type === 'receipt' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}>
                        {payment.payment_type === 'receipt' ? t.payments.receipt : t.payments.payment}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {format(new Date(payment.payment_date), 'yyyy/MM/dd')}
                    </TableCell>
                    <TableCell>
                      {payment.customer?.full_name || payment.supplier?.supplier_name || '-'}
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
                    <TableCell className={`text-left font-mono font-bold ${payment.payment_type === 'receipt' ? 'text-green-500' : 'text-red-500'}`}>
                      {payment.amount.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {paymentMethodLabels[payment.payment_method] || payment.payment_method}
                    </TableCell>
                    <TableCell className="max-w-xs truncate">
                      {payment.notes || '-'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        </div>
      </div>
    </MainLayout>
  );
}
