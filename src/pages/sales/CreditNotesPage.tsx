import { useState, useRef } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import * as dataGateway from '@/lib/dataGateway';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import MainLayout from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
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
import { Plus, CreditCard, Search, Calendar as CalendarIcon, Loader2, Ban, Lock } from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/utils';
import { logAudit } from '@/lib/audit';

interface CreditNote {
  id: string;
  credit_note_number: string;
  credit_note_date: string;
  invoice_id: string | null;
  customer_id: string;
  branch_id: string | null;
  reason: string | null;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  status: string;
  notes: string | null;
  journal_entry_id: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  customer?: { full_name: string };
  invoice?: { invoice_number: string };
  branch?: { branch_name: string };
}

export default function CreditNotesPage() {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [selectedCreditNote, setSelectedCreditNote] = useState<CreditNote | null>(null);
  const [voidReason, setVoidReason] = useState('');

  // Form state
  const [creditNoteDate, setCreditNoteDate] = useState<Date>(new Date());
  const [customerId, setCustomerId] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState<number>(0);
  const [notes, setNotes] = useState('');

  // Idempotency - generate once per form submission attempt
  const clientRequestIdRef = useRef<string>(crypto.randomUUID());
  const regenerateClientRequestId = () => {
    clientRequestIdRef.current = crypto.randomUUID();
  };

  const TAX_RATE = 0.15;

  // Fetch credit notes
  const { data: creditNotes = [], isLoading } = useQuery({
    queryKey: ['credit-notes'],
    queryFn: async () => {
      const { data: notes, error } = await dataGateway.queryTable('credit_notes', {
        select: '*',
        order: { column: 'created_at', ascending: false },
      });
      if (error) throw error;
      if (!notes || notes.length === 0) return [];

      const customerIds = [...new Set(notes.map((n: any) => n.customer_id).filter(Boolean))] as string[];
      const invoiceIds = [...new Set(notes.map((n: any) => n.invoice_id).filter(Boolean))] as string[];
      const branchIds = [...new Set(notes.map((n: any) => n.branch_id).filter(Boolean))] as string[];

      const [custRes, invRes, brRes] = await Promise.all([
        customerIds.length > 0
          ? dataGateway.queryTable('customers', { select: 'id, full_name', filters: [{ type: 'in', column: 'id', value: customerIds }] })
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

      return notes.map((n: any) => ({
        ...n,
        customer: custMap.get(n.customer_id) || undefined,
        invoice: invMap.get(n.invoice_id) || undefined,
        branch: brMap.get(n.branch_id) || undefined,
      })) as CreditNote[];
    },
  });

  // Fetch customers
  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => {
      const { data, error } = await dataGateway.queryTable('customers', {
        select: 'id, full_name',
        order: { column: 'name', ascending: true },
      });
      if (error) throw error;
      return data;
    },
  });

  // Fetch customer invoices
  const { data: customerInvoices = [] } = useQuery({
    queryKey: ['customer-invoices', customerId],
    queryFn: async () => {
      if (!customerId) return [];
      const { data, error } = await dataGateway.queryTable('invoices', {
        select: 'id, invoice_number, total_amount, remaining_amount',
        filters: [
          { type: 'eq', column: 'customer_id', value: customerId },
          { type: 'eq', column: 'invoice_type', value: 'sales' },
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

  // Filter
  const filteredNotes = creditNotes.filter(cn =>
    cn.credit_note_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    cn.customer?.full_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Reset form
  const resetForm = () => {
    setCreditNoteDate(new Date());
    setCustomerId('');
    setInvoiceId('');
    setBranchId('');
    setReason('');
    setAmount(0);
    setNotes('');
    regenerateClientRequestId();
  };

  // Create Credit Note Mutation - uses RPC
  const createMutation = useMutation({
    mutationFn: async () => {
      if (!customerId || amount <= 0) {
        throw new Error(t.common.required);
      }

      // Check overpay if invoice selected
      if (invoiceId) {
        const invoice = customerInvoices.find(inv => inv.id === invoiceId);
        if (invoice && amount > (invoice.remaining_amount || 0)) {
          throw new Error('OVER_CREDIT_NOT_ALLOWED');
        }
      }

      const subtotal = amount / (1 + TAX_RATE);
      const taxAmount = amount - subtotal;

      const payload = {
        client_request_id: clientRequestIdRef.current,
        customer_id: customerId,
        branch_id: branchId || null,
        linked_invoice_id: invoiceId || null,
        credit_note_date: format(creditNoteDate, 'yyyy-MM-dd'),
        reason: reason || null,
        notes: notes || null,
        tax_rate: TAX_RATE,
        is_draft: false,
        lines: [
          {
            description: reason || 'إشعار دائن',
            qty: 1,
            unit_price: subtotal,
            tax_rate: TAX_RATE,
          }
        ],
      };

      const { data, error } = await dataGateway.rpc('complete_erp_credit_note_atomic', {
        p_payload: payload,
      });

      if (error) throw error;
      
      const result = data as { success?: boolean; error?: string; credit_note_id?: string; credit_note_number?: string } | null;
      if (!result?.success) {
        throw new Error(result?.error || 'UNKNOWN_ERROR');
      }

      return result;
    },
    onSuccess: (data) => {
      toast.success(`${t.salesInvoices.creditNoteSaved} - ${data.credit_note_number}`);
      
      logAudit({
        actionType: 'Create',
        entityType: 'CreditNote',
        entityId: data.credit_note_id || '',
        entityCode: data.credit_note_number,
        description: `إنشاء إشعار دائن ${data.credit_note_number}`,
        newValue: { amount, customer_id: customerId },
      });

      queryClient.invalidateQueries({ queryKey: ['credit-notes'] });
      queryClient.invalidateQueries({ queryKey: ['sales-invoices'] });
      setDialogOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      const errorCode = error.message || 'UNKNOWN_ERROR';
      
      const errorMessages: Record<string, string> = {
        'OVER_CREDIT_NOT_ALLOWED': 'المبلغ يتجاوز المتبقي على الفاتورة',
        'POSTED_LOCKED': 'لا يمكن التعديل - القيد المحاسبي مرحّل',
        'ACCESS_DENIED': 'لا تملك صلاحية الوصول لهذا الفرع',
        'MISSING_CUSTOMER_ID': 'يرجى اختيار العميل',
        'MISSING_LINES': 'يرجى إدخال المبلغ',
        'ACCOUNT_PREFLIGHT_FAILED': 'خطأ في إعدادات الحسابات',
      };

      toast.error(errorMessages[errorCode] || error.message || t.common.error);
    },
  });

  // Void Credit Note Mutation
  const voidMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCreditNote || !voidReason.trim()) {
        throw new Error('MISSING_VOID_REASON');
      }

      const payload = {
        client_request_id: crypto.randomUUID(),
        credit_note_id: selectedCreditNote.id,
        void_reason: voidReason,
      };

      const { data, error } = await dataGateway.rpc('void_credit_note_atomic', {
        p_payload: payload,
      });

      if (error) throw error;
      
      const result = data as { success?: boolean; error?: string; reversal_journal_entry_number?: string } | null;
      if (!result?.success) {
        throw new Error(result?.error || 'UNKNOWN_ERROR');
      }

      return result;
    },
    onSuccess: (data) => {
      toast.success(`تم إلغاء الإشعار الدائن بنجاح${data.reversal_journal_entry_number ? ` - قيد عكسي: ${data.reversal_journal_entry_number}` : ''}`);
      
      logAudit({
        actionType: 'Update',
        entityType: 'CreditNote',
        entityId: selectedCreditNote!.id,
        entityCode: selectedCreditNote!.credit_note_number,
        description: `إلغاء إشعار دائن ${selectedCreditNote!.credit_note_number}`,
        newValue: { void_reason: voidReason, reversal_je: data.reversal_journal_entry_number },
      });

      queryClient.invalidateQueries({ queryKey: ['credit-notes'] });
      queryClient.invalidateQueries({ queryKey: ['sales-invoices'] });
      setVoidDialogOpen(false);
      setSelectedCreditNote(null);
      setVoidReason('');
    },
    onError: (error: any) => {
      const errorCode = error.message || 'UNKNOWN_ERROR';
      
      const errorMessages: Record<string, string> = {
        'ALREADY_VOIDED': 'الإشعار ملغي بالفعل',
        'POSTED_LOCKED': 'لا يمكن الإلغاء - القيد المحاسبي مرحّل',
        'ACCESS_DENIED': 'لا تملك صلاحية الوصول',
        'MISSING_VOID_REASON': 'يرجى إدخال سبب الإلغاء',
        'CREDIT_NOTE_NOT_FOUND': 'الإشعار غير موجود',
      };

      toast.error(errorMessages[errorCode] || error.message || t.common.error);
    },
  });

  const handleOpenVoidDialog = (creditNote: CreditNote) => {
    if (creditNote.status === 'voided') {
      toast.error('الإشعار ملغي بالفعل');
      return;
    }
    setSelectedCreditNote(creditNote);
    setVoidReason('');
    setVoidDialogOpen(true);
  };

  const statusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: 'bg-yellow-500/20 text-yellow-600',
      approved: 'bg-green-500/20 text-green-600',
      applied: 'bg-blue-500/20 text-blue-600',
      issued: 'bg-green-500/20 text-green-600',
      posted: 'bg-blue-500/20 text-blue-600',
      voided: 'bg-red-500/20 text-red-600',
      draft: 'bg-gray-500/20 text-gray-600',
    };
    
    const labels: Record<string, string> = {
      pending: 'قيد الانتظار',
      approved: 'معتمد',
      applied: 'مطبق',
      issued: 'صادر',
      posted: 'مرحّل',
      voided: 'ملغي',
      draft: 'مسودة',
    };
    
    return (
      <Badge className={styles[status] || 'bg-gray-500/20 text-gray-600'}>
        {status === 'voided' && <Ban className="w-3 h-3 mr-1" />}
        {labels[status] || status}
      </Badge>
    );
  };

  const isPosted = (cn: CreditNote) => cn.journal_entry_id !== null;

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6">
        {/* Header */}
        <div className="page-header-rtl">
          <div>
            <h1 className="page-title">{t.salesInvoices.creditNotes}</h1>
            <p className="page-description">{t.salesInvoices.subtitle}</p>
          </div>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="w-4 h-4 ml-2" />
            {t.salesInvoices.newCreditNote}
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

        {/* Credit Notes Table */}
        <Card>
          <CardContent className="p-0">
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.salesInvoices.creditNoteNumber}</TableHead>
                    <TableHead>{t.salesInvoices.creditNoteDate}</TableHead>
                    <TableHead>{t.salesInvoices.customerName}</TableHead>
                    <TableHead>{t.invoices.invoiceNumber}</TableHead>
                    <TableHead>{t.salesInvoices.reason}</TableHead>
                    <TableHead className="text-left">{t.common.amount}</TableHead>
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
                  ) : filteredNotes.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        {t.common.noData}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredNotes.map((cn) => (
                      <TableRow key={cn.id} className={cn.status === 'voided' ? 'opacity-60' : ''}>
                        <TableCell className="font-mono">
                          <div className="flex items-center gap-2">
                            {cn.credit_note_number}
                            {isPosted(cn) && cn.status !== 'voided' && (
                              <Lock className="w-3 h-3 text-primary" />
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{format(new Date(cn.credit_note_date), 'yyyy/MM/dd')}</TableCell>
                        <TableCell>{cn.customer?.full_name || '-'}</TableCell>
                        <TableCell className="font-mono">{cn.invoice?.invoice_number || '-'}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{cn.reason || '-'}</TableCell>
                        <TableCell className={`text-left font-mono font-semibold ${cn.status === 'voided' ? 'line-through text-muted-foreground' : 'text-red-600'}`}>
                          -{formatCurrency(cn.total_amount)}
                        </TableCell>
                        <TableCell>{statusBadge(cn.status)}</TableCell>
                        <TableCell>
                          {cn.status !== 'voided' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleOpenVoidDialog(cn)}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <Ban className="w-4 h-4 ml-1" />
                              إلغاء
                            </Button>
                          )}
                          {cn.status === 'voided' && cn.void_reason && (
                            <span className="text-xs text-muted-foreground" title={cn.void_reason}>
                              {cn.void_reason.substring(0, 20)}...
                            </span>
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

      {/* New Credit Note Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="w-5 h-5" />
              {t.salesInvoices.newCreditNote}
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
                <Label>{t.salesInvoices.creditNoteDate}</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start">
                      <CalendarIcon className="ml-2 h-4 w-4" />
                      {format(creditNoteDate, 'yyyy-MM-dd')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={creditNoteDate}
                      onSelect={(d) => d && setCreditNoteDate(d)}
                      locale={language === 'ar' ? ar : undefined}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {customerId && customerInvoices.length > 0 && (
              <div className="space-y-2">
                <Label>{t.invoices.invoiceNumber}</Label>
                <Select value={invoiceId} onValueChange={setInvoiceId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t.common.select} />
                  </SelectTrigger>
                  <SelectContent>
                    {customerInvoices.map((inv) => (
                      <SelectItem key={inv.id} value={inv.id}>
                        {inv.invoice_number} - {formatCurrency(inv.total_amount)} (متبقي: {formatCurrency(inv.remaining_amount || 0)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t.common.amount} *</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                />
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
            </div>

            <div className="space-y-2">
              <Label>{t.salesInvoices.reason}</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t.salesInvoices.reason}
              />
            </div>

            <div className="space-y-2">
              <Label>{t.common.notes}</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t.common.notes}
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button 
              onClick={() => createMutation.mutate()} 
              disabled={createMutation.isPending || !customerId || amount <= 0}
            >
              {createMutation.isPending && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
              {t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Void Dialog */}
      <Dialog open={voidDialogOpen} onOpenChange={setVoidDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Ban className="w-5 h-5" />
              إلغاء إشعار دائن
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-800">
                سيتم إلغاء الإشعار الدائن رقم: <strong>{selectedCreditNote?.credit_note_number}</strong>
                {selectedCreditNote?.journal_entry_id && (
                  <span className="block mt-1">وسيتم إنشاء قيد محاسبي عكسي.</span>
                )}
              </p>
            </div>

            <div className="space-y-2">
              <Label>سبب الإلغاء *</Label>
              <Textarea
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="اكتب سبب إلغاء الإشعار الدائن..."
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidDialogOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button 
              variant="destructive"
              onClick={() => voidMutation.mutate()} 
              disabled={voidMutation.isPending || !voidReason.trim()}
            >
              {voidMutation.isPending && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
              تأكيد الإلغاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
