import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import * as dataGateway from '@/lib/dataGateway';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import MainLayout from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Plus, Receipt, Search, Calendar as CalendarIcon, Loader2, Eye, Ban, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/utils';
import { logAudit } from '@/lib/audit';
import { logPosAttemptStart, logPosAttemptFail, logPosAttemptSuccess, POS_ERROR_CODES } from '@/lib/posRequestLogger';

interface CustomerReceipt {
  id: string;
  receipt_number: string;
  receipt_date: string;
  customer_id: string;
  invoice_id: string | null;
  branch_id: string | null;
  amount: number;
  payment_method: string;
  reference_number: string | null;
  bank_name: string | null;
  check_number: string | null;
  check_date: string | null;
  notes: string | null;
  status: string;
  voided_at: string | null;
  void_reason: string | null;
  customer?: { full_name: string; customer_code: string };
  invoice?: { invoice_number: string };
  branch?: { branch_name: string };
}

// Generate unique client request ID for idempotency
const generateClientRequestId = () => `cr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

export default function CustomerReceiptsPage() {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<CustomerReceipt | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [isVoiding, setIsVoiding] = useState(false);
  const [clientRequestId, setClientRequestId] = useState(generateClientRequestId);

  // Open dialog if ?new=true query param is present
  useEffect(() => {
    if (searchParams.get('new') === 'true') {
      setDialogOpen(true);
      // Remove the query param after opening dialog
      searchParams.delete('new');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Form state
  const [receiptDate, setReceiptDate] = useState<Date>(new Date());
  const [customerId, setCustomerId] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [amount, setAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [bankName, setBankName] = useState('');
  const [checkNumber, setCheckNumber] = useState('');
  const [checkDate, setCheckDate] = useState<Date | undefined>();
  const [notes, setNotes] = useState('');

  // Fetch receipts
  const { data: receipts = [], isLoading } = useQuery({
    queryKey: ['customer-receipts'],
    queryFn: async () => {
      const { data: payments, error } = await dataGateway.queryTable('payments', {
        select: '*',
        filters: [{ type: 'eq', column: 'payment_type', value: 'receipt' }],
        order: { column: 'created_at', ascending: false },
      });
      if (error) throw error;
      if (!payments || payments.length === 0) return [];

      const customerIds = [...new Set(payments.map((p: any) => p.customer_id).filter(Boolean))] as string[];
      const invoiceIds = [...new Set(payments.map((p: any) => p.invoice_id).filter(Boolean))] as string[];
      const branchIds = [...new Set(payments.map((p: any) => p.branch_id).filter(Boolean))] as string[];

      const [custRes, invRes, brRes] = await Promise.all([
        customerIds.length > 0
          ? dataGateway.queryTable('customers', { select: 'id, full_name, customer_code', filters: [{ type: 'in', column: 'id', value: customerIds }] })
          : { data: [], error: null },
        invoiceIds.length > 0
          ? dataGateway.queryTable('invoices', { select: 'id, invoice_number', filters: [{ type: 'in', column: 'id', value: invoiceIds }] })
          : { data: [], error: null },
        branchIds.length > 0
          ? dataGateway.queryTable('branches', { select: 'id, branch_name', filters: [{ type: 'in', column: 'id', value: branchIds }] })
          : { data: [], error: null },
      ]);

      const custMap = new Map((custRes.data || []).map((c: any) => [c.id, c]));
      const invMap = new Map((invRes.data || []).map((i: any) => [i.id, i]));
      const brMap = new Map((brRes.data || []).map((b: any) => [b.id, b]));

      return payments.map((p: any) => ({
        id: p.id,
        receipt_number: p.payment_number,
        receipt_date: p.payment_date,
        customer_id: p.customer_id,
        invoice_id: p.invoice_id,
        branch_id: p.branch_id,
        amount: p.amount,
        payment_method: p.payment_method,
        reference_number: p.reference_number,
        bank_name: p.bank_name,
        check_number: p.check_number,
        check_date: p.check_date,
        notes: p.notes,
        status: p.status,
        voided_at: p.voided_at,
        void_reason: p.void_reason,
        customer: custMap.get(p.customer_id) || undefined,
        invoice: invMap.get(p.invoice_id) || undefined,
        branch: brMap.get(p.branch_id) || undefined,
      })) as CustomerReceipt[];
    },
  });

  // Fetch customers
  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => {
      const { data, error } = await dataGateway.queryTable('customers', {
        select: 'id, full_name, customer_code',
        order: { column: 'name', ascending: true },
      });
      if (error) throw error;
      return data;
    },
  });

  // Fetch unpaid invoices for selected customer
  const { data: unpaidInvoices = [] } = useQuery({
    queryKey: ['unpaid-invoices', customerId],
    queryFn: async () => {
      if (!customerId) return [];
      const { data, error } = await dataGateway.queryTable('invoices', {
        select: 'id, invoice_number, remaining_amount, paid_amount',
        filters: [
          { type: 'eq', column: 'customer_id', value: customerId },
          { type: 'eq', column: 'invoice_type', value: 'sales' },
          { type: 'gt', column: 'remaining_amount', value: 0 },
        ],
        order: { column: 'invoice_date', ascending: false },
      });
      if (error) throw error;
      return data;
    },
    enabled: !!customerId,
  });

  // Fetch branches
  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: async () => {
      const { data, error } = await dataGateway.queryTable('branches', {
        select: 'id, branch_name',
        filters: [{ type: 'eq', column: 'is_active', value: true }],
        order: { column: 'name', ascending: true },
      });
      if (error) throw error;
      return data;
    },
  });

  // Filter receipts
  const filteredReceipts = receipts.filter(r =>
    r.receipt_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.customer?.full_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Reset form
  const resetForm = () => {
    setReceiptDate(new Date());
    setCustomerId('');
    setInvoiceId('');
    setBranchId('');
    setAmount(0);
    setPaymentMethod('cash');
    setReferenceNumber('');
    setBankName('');
    setCheckNumber('');
    setCheckDate(undefined);
    setNotes('');
  };

  // Save receipt using atomic RPC with No-Silent-Fail Logging
  const handleSave = async () => {
    // Build preliminary payload for logging BEFORE guards
    const prelimPayload = {
      customer_id: customerId || null,
      branch_id: branchId || null,
      invoice_id: invoiceId || null,
      amount,
      payment_method: paymentMethod,
    };

    // Log attempt start BEFORE any guards
    await logPosAttemptStart({
      clientRequestId,
      workflowType: 'customer_receipt',
      payload: prelimPayload,
    });

    // Guard 1: Customer required
    if (!customerId) {
      const errorMsg = language === 'ar' ? 'يجب تحديد العميل' : 'Customer is required';
      await logPosAttemptFail({
        clientRequestId,
        errorCode: POS_ERROR_CODES.CUSTOMER_REQUIRED,
        errorMessage: errorMsg,
      });
      toast.error(t.common.required);
      return;
    }

    // Guard 2: Amount must be positive
    if (amount <= 0) {
      const errorMsg = language === 'ar' ? 'يجب أن يكون المبلغ أكبر من صفر' : 'Amount must be greater than zero';
      await logPosAttemptFail({
        clientRequestId,
        errorCode: POS_ERROR_CODES.AMOUNT_REQUIRED,
        errorMessage: errorMsg,
      });
      toast.error(t.common.required);
      return;
    }

    // Guard 3: Validate over-allocation before submit
    if (invoiceId) {
      const invoice = unpaidInvoices.find(i => i.id === invoiceId);
      if (invoice && amount > (invoice.remaining_amount || 0)) {
        const errorMsg = language === 'ar' 
          ? `المبلغ يتجاوز المتبقي من الفاتورة (${formatCurrency(invoice.remaining_amount || 0)})`
          : `Amount exceeds invoice remaining (${formatCurrency(invoice.remaining_amount || 0)})`;
        await logPosAttemptFail({
          clientRequestId,
          errorCode: POS_ERROR_CODES.OVERPAY_NOT_ALLOWED,
          errorMessage: errorMsg,
        });
        toast.error(errorMsg);
        return;
      }
    }

    setIsSaving(true);
    try {
      const payload = {
        client_request_id: clientRequestId,
        customer_id: customerId,
        branch_id: branchId || null,
        invoice_id: invoiceId || null,
        amount,
        receipt_date: format(receiptDate, 'yyyy-MM-dd'),
        payment_method: paymentMethod,
        notes: notes || null,
        allow_overpay: false,
      };

      const { data: result, error } = await dataGateway.rpc('create_customer_receipt_atomic', {
        p_payload: payload
      });

      if (error) {
        await logPosAttemptFail({
          clientRequestId,
          errorCode: POS_ERROR_CODES.RPC_ERROR,
          errorMessage: error.message || 'RPC call failed',
        });
        throw error;
      }

      const rpcResult = result as { success?: boolean; errorCode?: string; error?: string; receipt_id?: string; receipt_number?: string } | null;

      if (!rpcResult?.success) {
        // Log the failure
        await logPosAttemptFail({
          clientRequestId,
          errorCode: rpcResult?.errorCode || POS_ERROR_CODES.RPC_ERROR,
          errorMessage: rpcResult?.error || 'Receipt creation failed',
        });
        
        // Handle specific error codes
        const errorCode = rpcResult?.errorCode;
        if (errorCode === 'OVERPAY_NOT_ALLOWED') {
          toast.error(language === 'ar' 
            ? `المبلغ يتجاوز المتبقي من الفاتورة`
            : 'Receipt amount exceeds invoice remaining'
          );
        } else if (errorCode === 'POSTED_LOCKED') {
          toast.error(language === 'ar' 
            ? 'لا يمكن تعديل سند قبض مرحّل'
            : 'Cannot modify posted receipt'
          );
        } else {
          toast.error(rpcResult?.error || t.common.error);
        }
        return;
      }

      // Log success
      await logPosAttemptSuccess({
        clientRequestId,
        entityId: rpcResult.receipt_id || '',
        result: {
          receipt_number: rpcResult.receipt_number,
          amount,
          customer_id: customerId,
        },
      });

      await logAudit({
        actionType: 'Create',
        entityType: 'Payment',
        entityId: rpcResult.receipt_id || '',
        description: `إنشاء سند قبض ${rpcResult.receipt_number}`,
        newValue: payload,
      });

      toast.success(t.salesInvoices.receiptSaved);
      queryClient.invalidateQueries({ queryKey: ['customer-receipts'] });
      queryClient.invalidateQueries({ queryKey: ['sales-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['unpaid-invoices'] });
      setDialogOpen(false);
      resetForm();
      // Regenerate client request ID for next submission
      setClientRequestId(generateClientRequestId());
    } catch (error: any) {
      console.error('Error saving receipt:', error);
      toast.error(error.message || t.common.error);
    } finally {
      setIsSaving(false);
    }
  };

  // Void receipt using atomic RPC with No-Silent-Fail Logging
  const handleVoid = async () => {
    if (!selectedReceipt) return;

    setIsVoiding(true);
    const voidClientRequestId = generateClientRequestId();
    
    // Build preliminary payload for logging
    const prelimPayload = {
      receipt_id: selectedReceipt.id,
      receipt_number: selectedReceipt.receipt_number,
      void_reason: voidReason || 'User requested void',
    };

    // Log attempt start BEFORE any processing
    await logPosAttemptStart({
      clientRequestId: voidClientRequestId,
      workflowType: 'customer_receipt',
      payload: { ...prelimPayload, action: 'void' },
    });

    try {
      const payload = {
        client_request_id: voidClientRequestId,
        receipt_id: selectedReceipt.id,
        void_reason: voidReason || 'User requested void',
      };

      const { data: result, error } = await dataGateway.rpc('void_customer_receipt_atomic', {
        p_payload: payload
      });

      if (error) {
        await logPosAttemptFail({
          clientRequestId: voidClientRequestId,
          errorCode: POS_ERROR_CODES.RPC_ERROR,
          errorMessage: error.message || 'Void RPC failed',
        });
        throw error;
      }

      const rpcResult = result as { success?: boolean; errorCode?: string; error?: string } | null;

      if (!rpcResult?.success) {
        await logPosAttemptFail({
          clientRequestId: voidClientRequestId,
          errorCode: rpcResult?.errorCode || POS_ERROR_CODES.RPC_ERROR,
          errorMessage: rpcResult?.error || 'Void failed',
        });
        
        const errorCode = rpcResult?.errorCode;
        if (errorCode === 'ALREADY_VOIDED') {
          toast.error(language === 'ar' ? 'السند ملغي مسبقاً' : 'Receipt is already voided');
        } else if (errorCode === 'POSTED_LOCKED') {
          toast.error(language === 'ar' ? 'لا يمكن إلغاء سند مرحّل' : 'Cannot void posted receipt');
        } else if (errorCode === 'BRANCH_ACCESS_DENIED') {
          toast.error(language === 'ar' ? 'لا تملك صلاحية على هذا الفرع' : 'Branch access denied');
        } else {
          toast.error(rpcResult?.error || t.common.error);
        }
        return;
      }

      // Log success
      await logPosAttemptSuccess({
        clientRequestId: voidClientRequestId,
        entityId: selectedReceipt.id,
        result: {
          receipt_number: selectedReceipt.receipt_number,
          action: 'voided',
        },
      });

      await logAudit({
        actionType: 'Cancel',
        entityType: 'Payment',
        entityId: selectedReceipt.id,
        description: `إلغاء سند قبض ${selectedReceipt.receipt_number}`,
        newValue: { void_reason: voidReason },
      });

      toast.success(language === 'ar' ? 'تم إلغاء السند بنجاح' : 'Receipt voided successfully');
      queryClient.invalidateQueries({ queryKey: ['customer-receipts'] });
      queryClient.invalidateQueries({ queryKey: ['sales-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['unpaid-invoices'] });
      setVoidDialogOpen(false);
      setSelectedReceipt(null);
      setVoidReason('');
    } catch (error: any) {
      console.error('Error voiding receipt:', error);
      toast.error(error.message || t.common.error);
    } finally {
      setIsVoiding(false);
    }
  };

  // Open void dialog
  const openVoidDialog = (receipt: CustomerReceipt) => {
    if (receipt.status === 'voided') {
      toast.error(language === 'ar' ? 'السند ملغي مسبقاً' : 'Receipt is already voided');
      return;
    }
    setSelectedReceipt(receipt);
    setVoidDialogOpen(true);
  };

  const paymentMethodLabel = (method: string) => {
    const labels: Record<string, string> = {
      cash: t.pos.cash,
      card: t.pos.card,
      bank_transfer: t.pos.transfer,
      check: 'شيك',
    };
    return labels[method] || method;
  };

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        {/* Header */}
        <div className="page-header-rtl">
          <div>
            <h1 className="page-title">{t.salesInvoices.receipts}</h1>
            <p className="page-description">{t.salesInvoices.subtitle}</p>
          </div>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="w-4 h-4 ml-2" />
            {t.salesInvoices.newReceipt}
          </Button>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={t.common.searchPlaceholder}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pr-10"
          />
        </div>

        {/* Receipts Table */}
        <Card>
          <CardContent className="p-0">
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.salesInvoices.receiptNumber}</TableHead>
                    <TableHead>{t.salesInvoices.receiptDate}</TableHead>
                    <TableHead>{t.salesInvoices.customerName}</TableHead>
                    <TableHead>{t.invoices.invoiceNumber}</TableHead>
                    <TableHead className="text-left">{t.salesInvoices.receiptAmount}</TableHead>
                    <TableHead>{t.salesInvoices.paymentMethod}</TableHead>
                    <TableHead>{t.common.status}</TableHead>
                    <TableHead>{t.common.actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin mx-auto" />
                      </TableCell>
                    </TableRow>
                  ) : filteredReceipts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        {t.common.noData}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredReceipts.map((receipt) => (
                      <TableRow key={receipt.id} className={receipt.status === 'voided' ? 'opacity-50' : ''}>
                        <TableCell className="font-mono">{receipt.receipt_number}</TableCell>
                        <TableCell>{format(new Date(receipt.receipt_date), 'yyyy/MM/dd')}</TableCell>
                        <TableCell>{receipt.customer?.full_name || '-'}</TableCell>
                        <TableCell className="font-mono">
                          {receipt.invoice?.invoice_number || '-'}
                        </TableCell>
                        <TableCell className={`text-left font-mono font-semibold ${receipt.status === 'voided' ? 'line-through text-muted-foreground' : 'text-emerald-600'}`}>
                          {formatCurrency(receipt.amount)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{paymentMethodLabel(receipt.payment_method)}</Badge>
                        </TableCell>
                        <TableCell>
                          {receipt.status === 'voided' ? (
                            <Badge variant="destructive">
                              {language === 'ar' ? 'ملغي' : 'Voided'}
                            </Badge>
                          ) : (
                            <Badge className="bg-emerald-500/20 text-emerald-600">
                              {receipt.status === 'posted' ? (language === 'ar' ? 'مرحّل' : 'Posted') : t.common.completed}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {receipt.status !== 'voided' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openVoidDialog(receipt)}
                              className="text-destructive hover:text-destructive"
                            >
                              <Ban className="w-4 h-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* New Receipt Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="w-5 h-5" />
              {t.salesInvoices.newReceipt}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t.salesInvoices.customer} *</Label>
                <Select value={customerId} onValueChange={setCustomerId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t.common.select} />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>{t.salesInvoices.receiptDate}</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start">
                      <CalendarIcon className="ml-2 h-4 w-4" />
                      {format(receiptDate, 'yyyy-MM-dd')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={receiptDate}
                      onSelect={(d) => d && setReceiptDate(d)}
                      locale={language === 'ar' ? ar : undefined}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {customerId && unpaidInvoices.length > 0 && (
              <div className="space-y-2">
                <Label>{t.invoices.invoiceNumber}</Label>
                <Select value={invoiceId} onValueChange={setInvoiceId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t.common.select} />
                  </SelectTrigger>
                  <SelectContent>
                    {unpaidInvoices.map((inv) => (
                      <SelectItem key={inv.id} value={inv.id}>
                        {inv.invoice_number} - {formatCurrency(inv.remaining_amount)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t.salesInvoices.receiptAmount} *</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                />
              </div>

              <div className="space-y-2">
                <Label>{t.salesInvoices.paymentMethod}</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">{t.pos.cash}</SelectItem>
                    <SelectItem value="card">{t.pos.card}</SelectItem>
                    <SelectItem value="bank_transfer">{t.pos.transfer}</SelectItem>
                    <SelectItem value="check">شيك</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t.salesInvoices.location}</Label>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger>
                  <SelectValue placeholder={t.common.select} />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.branch_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t.common.notes}</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
              {t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Void Receipt Dialog */}
      <Dialog open={voidDialogOpen} onOpenChange={setVoidDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" />
              {language === 'ar' ? 'إلغاء سند القبض' : 'Void Receipt'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-muted-foreground">
              {language === 'ar' 
                ? `هل أنت متأكد من إلغاء السند رقم ${selectedReceipt?.receipt_number}؟ سيتم إنشاء قيد عكسي.`
                : `Are you sure you want to void receipt ${selectedReceipt?.receipt_number}? A reversal entry will be created.`
              }
            </p>
            <div className="space-y-2">
              <Label>{language === 'ar' ? 'سبب الإلغاء' : 'Void Reason'}</Label>
              <Textarea
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder={language === 'ar' ? 'أدخل سبب الإلغاء...' : 'Enter void reason...'}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidDialogOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button variant="destructive" onClick={handleVoid} disabled={isVoiding}>
              {isVoiding && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
              {language === 'ar' ? 'إلغاء السند' : 'Void Receipt'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
