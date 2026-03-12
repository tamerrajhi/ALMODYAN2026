import { useState, useMemo } from 'react';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '@/contexts/LanguageContext';
import { 
  Plus, Loader2, RotateCcw, FileText, 
  CircleDollarSign, Truck, Wallet, Search
} from 'lucide-react';
import SupplierSelect from '@/components/purchasing/SupplierSelect';
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
import { RowActionsMenu } from '@/components/ui/RowActionsMenu';
import { ImportPaymentDialog } from '@/components/purchasing/ImportPaymentDialog';
import { ImportPaymentPreview } from '@/components/purchasing/ImportPaymentPreview';
import { toast } from 'sonner';
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
  listImportPayments, 
  listInvoicesForPayment,
  type ImportPaymentDTO 
} from '@/domain/purchasing/purchasingReadService';
import { deleteImportPayment } from '@/domain/purchasing/purchasingWriteService';

export default function ImportPaymentsPage() {
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  
  // Filter states
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Dialog states
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<ImportPaymentDTO | null>(null);

  // Fetch purchase invoices for filter dropdown via Read Service
  const { data: purchaseInvoices } = useQuery({
    queryKey: ['purchase-invoices-for-filter', selectedSupplierId],
    queryFn: () => listInvoicesForPayment(selectedSupplierId),
  });

  // Fetch payments via Read Service
  const { data: payments, isLoading: paymentsLoading } = useQuery({
    queryKey: ['import-payments', selectedSupplierId, selectedInvoiceId, dateFrom, dateTo],
    queryFn: () => listImportPayments({
      supplierId: selectedSupplierId,
      invoiceId: selectedInvoiceId,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    }),
  });

  // Delete mutation via Write Service
  const deleteMutation = useMutation({
    mutationFn: deleteImportPayment,
    onSuccess: (result) => {
      if (result.success) {
        toast.success(language === 'ar' ? 'تم حذف الدفعة بنجاح' : 'Payment deleted successfully');
        queryClient.invalidateQueries({ queryKey: ['import-payments'] });
        queryClient.invalidateQueries({ queryKey: ['purchase-invoices-for-filter'] });
      } else {
        toast.error(result.error || (language === 'ar' ? 'حدث خطأ أثناء الحذف' : 'Error deleting payment'));
      }
      setDeleteDialogOpen(false);
      setSelectedPayment(null);
    },
    onError: (error: any) => {
      console.error('Error deleting payment:', error);
      toast.error(language === 'ar' ? 'حدث خطأ أثناء الحذف' : 'Error deleting payment');
      setDeleteDialogOpen(false);
      setSelectedPayment(null);
    },
  });

  // Selected invoice details for header
  const selectedInvoice = useMemo(() => {
    if (!selectedInvoiceId || !purchaseInvoices) return null;
    return purchaseInvoices.find(inv => inv.id === selectedInvoiceId);
  }, [selectedInvoiceId, purchaseInvoices]);

  // Calculate summary
  const summary = useMemo(() => {
    if (!payments) return { totalInvoices: 0, totalPaid: 0, totalRemaining: 0, totalExpenses: 0 };
    
    const uniqueInvoices = new Set(payments.filter(p => p.invoiceId).map(p => p.invoiceId));
    const totalPaid = payments.reduce((sum, p) => sum + (p.localAmount || p.amount), 0);
    
    // Calculate expenses breakdown
    const expensesByType = payments.reduce((acc, p) => {
      (p.expenses || []).forEach(exp => {
        if (exp.expenseType !== 'invoice_value') {
          acc.total += exp.localAmount || exp.amount;
        }
      });
      return acc;
    }, { total: 0 });
    
    return {
      totalInvoices: uniqueInvoices.size,
      totalPaid,
      totalRemaining: selectedInvoice?.remainingAmount || 0,
      totalExpenses: expensesByType.total,
    };
  }, [payments, selectedInvoice]);

  // Filter payments by search and status
  const filteredPayments = useMemo(() => {
    if (!payments) return [];
    
    return payments.filter(payment => {
      // Filter by status
      if (paymentStatus !== 'all' && payment.status !== paymentStatus) {
        return false;
      }
      
      // Filter by search
      if (searchQuery) {
        const search = searchQuery.toLowerCase();
        return (
          payment.paymentNumber?.toLowerCase().includes(search) ||
          payment.documentNumber?.toLowerCase().includes(search) ||
          payment.supplier?.supplierName?.toLowerCase().includes(search) ||
          payment.invoice?.invoiceNumber?.toLowerCase().includes(search)
        );
      }
      
      return true;
    });
  }, [payments, paymentStatus, searchQuery]);

  const resetFilters = () => {
    setSelectedSupplierId(null);
    setSelectedInvoiceId(null);
    setDateFrom('');
    setDateTo('');
    setPaymentStatus('all');
    setSearchQuery('');
  };

  const handleAddPayment = () => {
    setSelectedPayment(null);
    setPaymentDialogOpen(true);
  };

  const handleEditPayment = (payment: ImportPaymentDTO) => {
    setSelectedPayment(payment);
    setPaymentDialogOpen(true);
  };

  const handlePreviewPayment = (payment: ImportPaymentDTO) => {
    setSelectedPayment(payment);
    setPreviewDialogOpen(true);
  };

  const handleDeletePayment = (payment: ImportPaymentDTO) => {
    setSelectedPayment(payment);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (!selectedPayment) return;
    deleteMutation.mutate(selectedPayment.id);
  };

  const formatCurrency = (amount: number, currency = 'SAR') => {
    return new Intl.NumberFormat(language === 'ar' ? 'ar-SA' : 'en-SA', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(amount);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US');
  };

  const getPaymentMethodLabel = (method: string) => {
    const labels: Record<string, { ar: string; en: string }> = {
      cash: { ar: 'نقدي', en: 'Cash' },
      bank_transfer: { ar: 'تحويل بنكي', en: 'Bank Transfer' },
      card: { ar: 'بطاقة', en: 'Card' },
      check: { ar: 'شيك', en: 'Check' },
      lc: { ar: 'اعتماد مستندي', en: 'Letter of Credit' },
    };
    return labels[method]?.[language] || method;
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

  const getInvoiceStatusBadge = (invoice: { remainingAmount: number; totalAmount: number; paidAmount: number } | null) => {
    if (!invoice) return null;
    
    const remaining = invoice.remainingAmount || 0;
    const paid = invoice.paidAmount || 0;
    
    if (remaining <= 0) {
      return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
        {language === 'ar' ? 'مسدد بالكامل' : 'Fully Paid'}
      </Badge>;
    } else if (paid > 0) {
      return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
        {language === 'ar' ? 'مسدد جزئياً' : 'Partially Paid'}
      </Badge>;
    } else {
      return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
        {language === 'ar' ? 'غير مسدد' : 'Unpaid'}
      </Badge>;
    }
  };

  // Convert DTO to legacy format for child components that expect snake_case
  const convertToLegacyFormat = (payment: ImportPaymentDTO | null) => {
    if (!payment) return null;
    return {
      id: payment.id,
      payment_number: payment.paymentNumber,
      payment_date: payment.paymentDate,
      amount: payment.amount,
      currency: payment.currency,
      exchange_rate: payment.exchangeRate,
      local_amount: payment.localAmount,
      payment_method: payment.paymentMethod,
      document_number: payment.documentNumber,
      notes: payment.notes,
      status: payment.status,
      invoice_id: payment.invoiceId,
      supplier_id: payment.supplierId,
      created_at: payment.createdAt,
      invoice: payment.invoice ? {
        invoice_number: payment.invoice.invoiceNumber,
        total_amount: payment.invoice.totalAmount,
        paid_amount: payment.invoice.paidAmount,
        remaining_amount: payment.invoice.remainingAmount,
        status: payment.invoice.status,
        invoice_date: payment.invoice.invoiceDate,
      } : undefined,
      supplier: payment.supplier ? {
        supplier_name: payment.supplier.supplierName,
        supplier_code: payment.supplier.supplierCode,
      } : undefined,
      expenses: payment.expenses?.map(e => ({
        expense_type: e.expenseType,
        amount: e.amount,
        local_amount: e.localAmount,
      })),
    };
  };

  return (
    <MainLayout>
      <div className="animate-fade-in space-y-6">
        {/* Page Header */}
        <div className="page-header">
          <h1 className="page-title">
            {language === 'ar' ? 'دفعات الاستيراد' : 'Import Payments'}
          </h1>
          <p className="page-description">
            {language === 'ar' 
              ? 'إدارة ومتابعة دفعات فواتير الاستيراد ورسوم الشحن والجمارك'
              : 'Manage and track import invoice payments, shipping and customs fees'}
          </p>
        </div>

        {/* Selected Invoice Header */}
        {selectedInvoice && (
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                {language === 'ar' ? 'معلومات الفاتورة المحددة' : 'Selected Invoice Details'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {language === 'ar' ? 'رقم الفاتورة' : 'Invoice Number'}
                  </p>
                  <p className="font-medium font-mono">{selectedInvoice.invoiceNumber}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {language === 'ar' ? 'إجمالي الفاتورة' : 'Total Amount'}
                  </p>
                  <p className="font-medium text-lg">{formatCurrency(selectedInvoice.totalAmount)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {language === 'ar' ? 'المدفوع' : 'Paid'}
                  </p>
                  <p className="font-medium text-green-600">{formatCurrency(selectedInvoice.paidAmount || 0)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {language === 'ar' ? 'المتبقي' : 'Remaining'}
                  </p>
                  <p className="font-medium text-red-600">{formatCurrency(selectedInvoice.remainingAmount || 0)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {language === 'ar' ? 'الحالة' : 'Status'}
                  </p>
                  {getInvoiceStatusBadge(selectedInvoice)}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filter Bar */}
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
              {/* Supplier Select */}
              <div className="lg:col-span-1">
                <Label className="mb-2 block">
                  {language === 'ar' ? 'المورد' : 'Supplier'}
                </Label>
                <SupplierSelect
                  value={selectedSupplierId || ''}
                  onSelect={(id) => {
                    setSelectedSupplierId(id || null);
                    setSelectedInvoiceId(null);
                  }}
                />
              </div>

              {/* Invoice Select */}
              <div className="lg:col-span-1">
                <Label className="mb-2 block">
                  {language === 'ar' ? 'فاتورة الاستيراد' : 'Import Invoice'}
                </Label>
                <Select
                  value={selectedInvoiceId || 'all'}
                  onValueChange={(value) => setSelectedInvoiceId(value === 'all' ? null : value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={language === 'ar' ? 'اختر الفاتورة' : 'Select Invoice'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{language === 'ar' ? 'كل الفواتير' : 'All Invoices'}</SelectItem>
                    {purchaseInvoices?.map((inv) => (
                      <SelectItem key={inv.id} value={inv.id}>
                        {inv.invoiceNumber}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Date From */}
              <div>
                <Label className="mb-2 block">
                  {language === 'ar' ? 'من تاريخ' : 'From Date'}
                </Label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>

              {/* Date To */}
              <div>
                <Label className="mb-2 block">
                  {language === 'ar' ? 'إلى تاريخ' : 'To Date'}
                </Label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>

              {/* Payment Status */}
              <div>
                <Label className="mb-2 block">
                  {language === 'ar' ? 'حالة الدفعة' : 'Payment Status'}
                </Label>
                <Select value={paymentStatus} onValueChange={setPaymentStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{language === 'ar' ? 'كل الحالات' : 'All Statuses'}</SelectItem>
                    <SelectItem value="pending">{language === 'ar' ? 'قيد الانتظار' : 'Pending'}</SelectItem>
                    <SelectItem value="completed">{language === 'ar' ? 'مكتمل' : 'Completed'}</SelectItem>
                    <SelectItem value="cancelled">{language === 'ar' ? 'ملغي' : 'Cancelled'}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Actions */}
              <div className="flex items-end gap-2">
                <Button variant="outline" onClick={resetFilters} className="gap-2">
                  <RotateCcw className="h-4 w-4" />
                  {language === 'ar' ? 'إعادة تعيين' : 'Reset'}
                </Button>
              </div>
            </div>

            {/* Search */}
            <div className="mt-4">
              <div className="relative max-w-md">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder={language === 'ar' ? 'بحث برقم الدفعة أو المستند...' : 'Search by payment or document number...'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pr-10"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                  <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {language === 'ar' ? 'عدد الفواتير' : 'Invoices Count'}
                  </p>
                  <p className="text-2xl font-bold">{summary.totalInvoices}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                  <CircleDollarSign className="h-5 w-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {language === 'ar' ? 'إجمالي المدفوع' : 'Total Paid'}
                  </p>
                  <p className="text-2xl font-bold text-green-600">{formatCurrency(summary.totalPaid)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
                  <Wallet className="h-5 w-5 text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {language === 'ar' ? 'المتبقي' : 'Remaining'}
                  </p>
                  <p className="text-2xl font-bold text-red-600">{formatCurrency(summary.totalRemaining)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                  <Truck className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {language === 'ar' ? 'رسوم إضافية' : 'Additional Fees'}
                  </p>
                  <p className="text-2xl font-bold text-amber-600">{formatCurrency(summary.totalExpenses)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Payments Table */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>
              {language === 'ar' ? 'سجل الدفعات' : 'Payments Log'}
            </CardTitle>
            <Button onClick={handleAddPayment} className="gap-2">
              <Plus className="h-4 w-4" />
              {language === 'ar' ? 'إضافة دفعة' : 'Add Payment'}
            </Button>
          </CardHeader>
          <CardContent>
            {paymentsLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : filteredPayments.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                {language === 'ar' ? 'لا توجد دفعات مسجلة' : 'No payments recorded'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{language === 'ar' ? 'التاريخ' : 'Date'}</TableHead>
                      <TableHead>{language === 'ar' ? 'رقم الدفعة' : 'Payment #'}</TableHead>
                      <TableHead>{language === 'ar' ? 'المورد' : 'Supplier'}</TableHead>
                      <TableHead>{language === 'ar' ? 'الفاتورة' : 'Invoice'}</TableHead>
                      <TableHead>{language === 'ar' ? 'نوع الدفعة' : 'Type'}</TableHead>
                      <TableHead>{language === 'ar' ? 'رقم المستند' : 'Doc #'}</TableHead>
                      <TableHead>{language === 'ar' ? 'العملة' : 'Currency'}</TableHead>
                      <TableHead>{language === 'ar' ? 'المبلغ' : 'Amount'}</TableHead>
                      <TableHead>{language === 'ar' ? 'المبلغ المحلي' : 'Local Amount'}</TableHead>
                      <TableHead>{language === 'ar' ? 'الحالة' : 'Status'}</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPayments.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell>{formatDate(payment.paymentDate)}</TableCell>
                        <TableCell className="font-mono text-sm">{payment.paymentNumber}</TableCell>
                        <TableCell>{payment.supplier?.supplierName || '-'}</TableCell>
                        <TableCell className="font-mono text-sm">
                          {payment.invoice?.invoiceNumber || '-'}
                        </TableCell>
                        <TableCell>{getPaymentMethodLabel(payment.paymentMethod)}</TableCell>
                        <TableCell className="font-mono text-sm">{payment.documentNumber || '-'}</TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {payment.currency} {payment.exchangeRate !== 1 && `(${payment.exchangeRate})`}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">
                          {formatCurrency(payment.amount, payment.currency)}
                        </TableCell>
                        <TableCell className="font-medium text-primary">
                          {formatCurrency(payment.localAmount || payment.amount)}
                        </TableCell>
                        <TableCell>{getStatusBadge(payment.status)}</TableCell>
                        <TableCell>
                          <RowActionsMenu
                            onPreview={() => handlePreviewPayment(payment)}
                            onEdit={() => handleEditPayment(payment)}
                            onDelete={() => handleDeletePayment(payment)}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add/Edit Payment Dialog */}
      <ImportPaymentDialog
        open={paymentDialogOpen}
        onOpenChange={setPaymentDialogOpen}
        payment={convertToLegacyFormat(selectedPayment)}
        defaultInvoiceId={selectedInvoiceId}
        defaultSupplierId={selectedSupplierId}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['import-payments'] });
          queryClient.invalidateQueries({ queryKey: ['purchase-invoices-for-filter'] });
        }}
      />

      {/* Preview Dialog */}
      <ImportPaymentPreview
        open={previewDialogOpen}
        onOpenChange={setPreviewDialogOpen}
        payment={convertToLegacyFormat(selectedPayment)}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {language === 'ar' ? 'تأكيد الحذف' : 'Confirm Delete'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {language === 'ar' 
                ? `هل أنت متأكد من حذف الدفعة رقم ${selectedPayment?.paymentNumber}؟ سيتم تحديث رصيد الفاتورة تلقائياً.`
                : `Are you sure you want to delete payment ${selectedPayment?.paymentNumber}? Invoice balance will be updated automatically.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              {language === 'ar' ? 'إلغاء' : 'Cancel'}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                language === 'ar' ? 'حذف' : 'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
}
