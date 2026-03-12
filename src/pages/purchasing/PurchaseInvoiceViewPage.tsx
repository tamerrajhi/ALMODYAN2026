import { useRef, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '@/contexts/LanguageContext';
import MainLayout from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ArrowLeft, FileText, Loader2, Package, AlertTriangle, Ban, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import { useReactToPrint } from 'react-to-print';
import { toast } from 'sonner';
import ImportedItemsTab from '@/components/purchasing/ImportedItemsTab';
import { PaymentEntryDialog } from '@/components/purchasing/PaymentEntryDialog';
import { UniqueInvoiceEditDialog } from '@/components/purchasing/UniqueInvoiceEditDialog';
import { InvoiceActionRenderer, type ActionHandlers } from '@/components/purchasing/InvoiceActionRenderer';
import { 
  getPurchaseInvoice, 
  voidPurchaseInvoiceAtomic,
  getInvoicePolicy,
  getBlockReasonMessage,
  getInvoiceForActions,
  sendInvoiceEmail,
  type PurchaseInvoiceLineDTO,
  type InvoiceActionKey,
  type AtomicVoidPurchaseInvoiceCommand,
} from '@/domain/purchasing';
import { fetchRebuildGate } from '@/domain/purchasing/purchasingWriteService';
import * as dataGateway from '@/lib/dataGateway';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { addCairoFont } from '@/lib/fonts/cairo-font';
import { determineReturnScreen, MixedItemTypesError, buildReturnUrl } from '@/domain/purchasing/returnRoutingService';

const PurchaseInvoiceViewPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const printRef = useRef<HTMLDivElement>(null);
  // Idempotency: stable request ID per void action
  const voidRequestIdRef = useRef<string | null>(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [loadingAction, setLoadingAction] = useState<InvoiceActionKey | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  // Fetch invoice using DTO read service
  const { data: invoice, isLoading, refetch } = useQuery({
    queryKey: ['purchase-invoice', id],
    queryFn: () => getPurchaseInvoice(id!),
    enabled: !!id,
  });

  const isImportInvoice = invoice?.purchaseType === 'import';

  const { data: rebuildGateData } = useQuery({
    queryKey: ['unique-invoice-rebuild-gate', id],
    queryFn: () => fetchRebuildGate(id!),
    enabled: !!id && isImportInvoice,
  });

  const canRebuildInvoice = rebuildGateData?.can_rebuild === true;

  // Get policy from the Policy Layer - SINGLE source of truth
  const policy = useMemo(() => {
    if (!invoice) return null;
    return getInvoicePolicy(invoice);
  }, [invoice]);

  // Helper to get localized block reason message
  const getReasonMessage = (actionKey: InvoiceActionKey): string | undefined => {
    if (!policy) return undefined;
    const action = policy.actions[actionKey];
    return getBlockReasonMessage(action.blockReason, language as 'ar' | 'en');
  };

  // Void invoice mutation via atomic RPC
  const cancelMutation = useMutation({
    mutationFn: async () => {
      // Generate client request ID for idempotency (once per action)
      if (!voidRequestIdRef.current) {
        voidRequestIdRef.current = crypto.randomUUID();
      }
      
      const voidCmd: AtomicVoidPurchaseInvoiceCommand = {
        client_request_id: voidRequestIdRef.current,
        created_by: undefined, // Will be set by RPC from auth context
        invoice_id: id!,
        void_reason: cancelReason || undefined,
        void_date: new Date().toISOString().split('T')[0],
      };
      
      return voidPurchaseInvoiceAtomic(voidCmd);
    },
    onSuccess: (result) => {
      if (result.success) {
        // Reset request ID on success
        voidRequestIdRef.current = null;
        toast.success(
          language === 'ar' 
            ? `تم إلغاء الفاتورة ${result.invoiceNumber || ''} بنجاح` 
            : `Invoice ${result.invoiceNumber || ''} voided successfully`
        );
        queryClient.invalidateQueries({ queryKey: ['purchase-invoices'] });
        navigate('/purchasing/invoices');
      } else {
        // Handle idempotency conflict
        if (result.error_code === 'IDEMPOTENCY_CONFLICT') {
          toast.error(
            language === 'ar'
              ? 'تم استخدام نفس request id ببيانات مختلفة'
              : 'Same request ID used with different data'
          );
        } else {
          toast.error(result.error || (language === 'ar' ? 'فشل في إلغاء الفاتورة' : 'Failed to void invoice'));
        }
      }
      setCancelDialogOpen(false);
      setCancelReason('');
    },
    onError: () => {
      toast.error(language === 'ar' ? 'حدث خطأ أثناء إلغاء الفاتورة' : 'Error voiding invoice');
    },
  });

  // Extract lines from invoice DTO
  const lines = invoice?.lines || [];

  // Check if this is an import invoice (has import_summary line)
  const hasImportedItems = useMemo(() => {
    return lines?.some((line: PurchaseInvoiceLineDTO) => line.lineKind === 'import_summary') || false;
  }, [lines]);

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `فاتورة-مشتريات-${invoice?.invoiceNumber || ''}`,
  });

  // ===========================
  // Action Handlers
  // ===========================

  const handleCreateReturn = () => {
    if (!invoice || !policy?.canCreateReturn) {
      const reason = getReasonMessage('createReturn');
      if (reason) toast.error(reason);
      return;
    }

    try {
      const routingResult = determineReturnScreen(invoice);
      const returnUrl = buildReturnUrl(invoice.id, routingResult.screenType);
      navigate(returnUrl);
    } catch (error) {
      if (error instanceof MixedItemTypesError) {
        const reason = getReasonMessage('createReturn');
        toast.error(reason || (language === 'ar' ? 'خطأ في توجيه المرتجع' : 'Return routing error'));
      } else {
        toast.error(language === 'ar' ? 'خطأ في توجيه المرتجع' : 'Return routing error');
      }
    }
  };

  const handleViewJournalEntry = () => {
    if (invoice?.journalEntryId) {
      navigate(`/accounting/journal-entries?id=${invoice.journalEntryId}`);
    }
  };

  const handleCancelClick = () => {
    if (!policy?.canCancel) {
      const reason = getReasonMessage('cancel');
      if (reason) toast.error(reason);
      return;
    }
    setCancelDialogOpen(true);
  };

  const handlePayClick = () => {
    if (!policy?.canPay) {
      const reason = getReasonMessage('pay');
      if (reason) toast.error(reason);
      return;
    }
    setPaymentDialogOpen(true);
  };

  const handlePrintClick = () => {
    handlePrint();
  };

  const handlePdfClick = async () => {
    if (!invoice) return;
    setLoadingAction('pdf');
    try {
      const invoiceData = await getInvoiceForActions(invoice.id);
      if (!invoiceData) {
        toast.error(language === 'ar' ? 'لم يتم العثور على الفاتورة' : 'Invoice not found');
        return;
      }
      const doc = new jsPDF({ orientation: 'portrait' });
      await addCairoFont(doc);
      doc.setFont('Cairo', 'normal');
      doc.setFontSize(18);
      doc.text(language === 'ar' ? 'فاتورة مشتريات' : 'Purchase Invoice', 105, 20, { align: 'center' });
      doc.setFontSize(11);
      doc.text(`${language === 'ar' ? 'رقم الفاتورة:' : 'Invoice No:'} ${invoiceData.invoiceNumber}`, 15, 35);
      doc.text(`${language === 'ar' ? 'التاريخ:' : 'Date:'} ${formatDateShort(invoiceData.invoiceDate)}`, 15, 42);
      doc.text(`${language === 'ar' ? 'المورد:' : 'Supplier:'} ${invoiceData.supplierName}`, 15, 49);
      autoTable(doc, {
        startY: 60,
        head: [[
          language === 'ar' ? 'الوصف' : 'Description',
          language === 'ar' ? 'الكمية' : 'Qty',
          language === 'ar' ? 'السعر' : 'Price',
          language === 'ar' ? 'الإجمالي' : 'Total'
        ]],
        body: invoiceData.lines.map(line => [
          line.description || '',
          line.quantity?.toString() || '1',
          formatCurrency(line.unitPrice || 0),
          formatCurrency(line.totalAmount || 0)
        ]),
        styles: { font: 'Cairo', halign: language === 'ar' ? 'right' : 'left' },
        headStyles: { fillColor: [59, 130, 246] },
      });
      const finalY = (doc as any).lastAutoTable.finalY + 10;
      doc.text(`${language === 'ar' ? 'الإجمالي:' : 'Total:'} ${formatCurrency(invoiceData.totalAmount)}`, 15, finalY);
      doc.text(`${language === 'ar' ? 'المدفوع:' : 'Paid:'} ${formatCurrency(invoiceData.paidAmount)}`, 15, finalY + 7);
      doc.text(`${language === 'ar' ? 'المتبقي:' : 'Remaining:'} ${formatCurrency(invoiceData.remainingAmount)}`, 15, finalY + 14);
      doc.save(`Invoice-${invoiceData.invoiceNumber}.pdf`);
      toast.success(language === 'ar' ? 'تم تحميل الفاتورة' : 'Invoice downloaded');
    } catch (error) {
      console.error('PDF error:', error);
      toast.error(language === 'ar' ? 'حدث خطأ أثناء إنشاء PDF' : 'PDF generation error');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleDuplicateClick = async () => {
    if (!invoice) return;
    setLoadingAction('duplicate');
    try {
      const invoiceData = await getInvoiceForActions(invoice.id);
      if (!invoiceData) {
        toast.error(language === 'ar' ? 'لم يتم العثور على الفاتورة' : 'Invoice not found');
        return;
      }
      const draftData = {
        copyFromInvoice: invoiceData.invoiceNumber,
        supplier_id: invoiceData.supplierId,
        supplier_name: invoiceData.supplierName,
        notes: `${language === 'ar' ? 'نسخة من الفاتورة' : 'Copy of invoice'} ${invoiceData.invoiceNumber}`,
        lines: invoiceData.lines.map((line, idx) => ({
          line_number: idx + 1,
          item_type: line.itemType || 'jewelry',
          item_id: line.productId || line.costEntryId,
          cost_entry_id: line.costEntryId,
          product_id: line.productId,
          gl_account_id: line.glAccountId,
          description: line.description,
          quantity: line.quantity || 1,
          unit_price: line.unitPrice || 0,
          tax_rate: line.taxRate || 0.15,
          tax_amount: line.taxAmount || 0,
          discount_amount: line.discountAmount || 0,
          total_amount: line.totalAmount || 0,
        })),
      };
      sessionStorage.setItem('purchaseInvoiceDraft', JSON.stringify(draftData));
      toast.info(language === 'ar' ? 'جاري فتح شاشة الفاتورة الجديدة...' : 'Opening new invoice form...');
      navigate('/purchasing/invoices/new');
    } catch (error) {
      console.error('Duplicate error:', error);
      toast.error(language === 'ar' ? 'حدث خطأ أثناء نسخ الفاتورة' : 'Error duplicating invoice');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleEmailClick = async () => {
    if (!invoice) return;
    setLoadingAction('email');
    try {
      const result = await sendInvoiceEmail({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        supplierEmail: invoice.supplierEmail,
        supplierName: invoice.supplierName,
        invoiceDate: invoice.invoiceDate,
        totalAmount: invoice.totalAmount,
        paidAmount: invoice.paidAmount,
        remainingAmount: invoice.remainingAmount,
        language,
      });
      if (result.success) {
        toast.success(language === 'ar' ? 'تم إرسال الفاتورة بنجاح' : 'Invoice sent successfully');
      } else {
        toast.error(result.error || (language === 'ar' ? 'حدث خطأ أثناء إرسال البريد' : 'Error sending email'));
      }
    } catch (error) {
      console.error('Email error:', error);
      toast.error(language === 'ar' ? 'حدث خطأ أثناء إرسال البريد' : 'Error sending email');
    } finally {
      setLoadingAction(null);
    }
  };

  const formatDateShort = (dateStr: string) => format(new Date(dateStr), 'yyyy-MM-dd');

  // Handler map for renderer
  const actionHandlers: ActionHandlers = {
    createReturn: handleCreateReturn,
    pay: handlePayClick,
    viewJournal: handleViewJournalEntry,
    print: handlePrintClick,
    cancel: handleCancelClick,
    pdf: handlePdfClick,
    duplicate: handleDuplicateClick,
    email: handleEmailClick,
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return format(new Date(dateStr), 'yyyy/MM/dd', { locale: language === 'ar' ? ar : enUS });
  };

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString(language === 'ar' ? 'ar-SA' : 'en-SA', {
      style: 'currency',
      currency: 'SAR',
      minimumFractionDigits: 2,
    });
  };

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case 'posted':
        return <Badge className="bg-green-600 text-white">{language === 'ar' ? 'مرحّل' : 'Posted'}</Badge>;
      case 'paid':
        return <Badge className="bg-green-500 text-white">{t.status.paid}</Badge>;
      case 'partial':
        return <Badge variant="secondary">{t.status.partial}</Badge>;
      case 'draft':
        return <Badge variant="outline">{language === 'ar' ? 'مسودة' : 'Draft'}</Badge>;
      case 'voided':
        return <Badge variant="destructive">{language === 'ar' ? 'ملغاة' : 'Voided'}</Badge>;
      case 'cancelled':
        return <Badge variant="destructive">{language === 'ar' ? 'ملغاة' : 'Cancelled'}</Badge>;
      case 'returned':
        return <Badge className="bg-orange-600 text-white">{language === 'ar' ? 'مرتجعة بالكامل' : 'Fully Returned'}</Badge>;
      case 'partially_returned':
        return <Badge variant="secondary" className="bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800">{language === 'ar' ? 'مرتجعة جزئياً' : 'Partially Returned'}</Badge>;
      case 'pending':
      default:
        return <Badge variant="outline">{t.status.pending}</Badge>;
    }
  };

  const getPurchaseTypeBadge = (purchaseType: 'general' | 'import') => {
    if (purchaseType === 'import') {
      return (
        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800">
          {language === 'ar' ? 'استيراد' : 'Import'}
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800">
        {language === 'ar' ? 'عام' : 'General'}
      </Badge>
    );
  };

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  if (!invoice || !policy) {
    return (
      <MainLayout>
        <div className="p-6 text-center text-muted-foreground">
          {t.common.noData}
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <TooltipProvider>
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="flex items-center gap-4">
              <Button variant="outline" size="icon" onClick={() => navigate('/purchasing/invoices')}>
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-bold">{t.purchaseInvoices.title}</h1>
                  {getPurchaseTypeBadge(invoice.purchaseType)}
                </div>
                <p className="text-muted-foreground">{invoice.invoiceNumber}</p>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              {isImportInvoice && canRebuildInvoice && (
                <Button
                  variant="outline"
                  onClick={() => setEditDialogOpen(true)}
                  data-testid="button-rebuild-unique-invoice"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span className="mr-1 ml-1">{language === 'ar' ? 'إعادة بناء الفاتورة' : 'Rebuild Invoice'}</span>
                </Button>
              )}
              <InvoiceActionRenderer
                policy={policy}
                placement="header"
                handlers={actionHandlers}
                loadingAction={loadingAction}
                excludeActions={['view']}
              />
            </div>
          </div>

          {/* Linked Invoice Alert */}
          {invoice.linkedInvoiceId && (
            <Card className="bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800">
              <CardContent className="py-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <span className="text-sm text-amber-700 dark:text-amber-300">
                  {language === 'ar' ? 'هذه الفاتورة مرتبطة بفاتورة أخرى' : 'This invoice is linked to another invoice'}
                </span>
              </CardContent>
            </Card>
          )}

          {/* Printable Content */}
          <div ref={printRef} className="print:p-8">
            {/* Invoice Header for Print */}
            <div className="hidden print:block text-center mb-8">
              <h1 className="text-2xl font-bold">{t.purchaseInvoices.title}</h1>
              <p className="text-lg">{invoice.invoiceNumber}</p>
            </div>

            {/* Invoice Details */}
            <div className="mb-6">
              <Card>
                <CardHeader className="py-2 px-4">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5" />
                    {t.common.details}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5 px-4 pb-3 pt-0 text-sm leading-tight">
                  <div className="flex justify-between">
                    <span className="text-xs text-muted-foreground">{t.purchaseInvoices.invoiceNumber}:</span>
                    <span className="font-medium">{invoice.invoiceNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-muted-foreground">{t.purchaseInvoices.supplier}:</span>
                    <span className="font-medium" data-testid="text-supplier-name">{invoice.supplierName || '-'}</span>
                  </div>
                  {invoice.supplierInvoiceNo && (
                    <div className="flex justify-between">
                      <span className="text-xs text-muted-foreground">{language === 'ar' ? 'رقم فاتورة المورد:' : 'Supplier Invoice No:'}</span>
                      <span className="font-medium" data-testid="text-supplier-invoice-no">{invoice.supplierInvoiceNo}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-xs text-muted-foreground">{t.purchaseInvoices.invoiceDate}:</span>
                    <span>{formatDate(invoice.invoiceDate)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">{t.common.status}:</span>
                    {getStatusBadge(invoice.status)}
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-muted-foreground">{t.branches.branchName}:</span>
                    <span>{invoice.branchName || '-'}</span>
                  </div>
                  {hasImportedItems && (
                    <div className="flex justify-between">
                      <span className="text-xs text-muted-foreground">{language === 'ar' ? 'عدد القطع:' : 'Items:'}</span>
                      <span className="font-medium" data-testid="text-item-count">{lines.length || '-'}</span>
                    </div>
                  )}
                  {invoice.uploadedFileName && (
                    <div className="flex justify-between">
                      <span className="text-xs text-muted-foreground">{language === 'ar' ? 'ملف الاستيراد:' : 'Import File:'}</span>
                      <span className="font-medium" data-testid="text-uploaded-file-name">{invoice.uploadedFileName}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Items Section */}
            {hasImportedItems ? (
              <>
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-3 text-sm font-medium">
                  <Package className="w-4 h-4" />
                  {language === 'ar' ? `تفاصيل القطع (${lines.length})` : `Item Details (${lines.length})`}
                </div>
                <ImportedItemsTab invoiceId={id!} invoiceNumber={invoice.invoiceNumber} purchaseType={invoice.purchaseType} />
              </div>

              {/* Print-only items table */}
              <div className="hidden print:block">
                <ImportedItemsTab invoiceId={id!} invoiceNumber={invoice.invoiceNumber} purchaseType={invoice.purchaseType} />
              </div>
            </>
            ) : (
              <InvoiceLinesTable lines={lines} formatCurrency={formatCurrency} t={t} language={language} />
            )}

            {/* Totals */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-col items-end space-y-2">
                  <div className="flex justify-between w-full max-w-xs text-sm">
                    <span className="text-muted-foreground">{t.purchaseInvoices.subtotal}:</span>
                    <span>{formatCurrency(invoice.subtotal)}</span>
                  </div>
                  <div className="flex justify-between w-full max-w-xs text-sm">
                    <span className="text-muted-foreground">{t.purchaseInvoices.discount}:</span>
                    <span>- {formatCurrency(invoice.discountAmount)}</span>
                  </div>
                  <div className="flex justify-between w-full max-w-xs text-sm">
                    <span className="text-muted-foreground">{t.purchaseInvoices.taxAmount} (15%):</span>
                    <span>{formatCurrency(invoice.taxAmount)}</span>
                  </div>
                  <Separator className="w-full max-w-xs" />
                  <div className="flex justify-between w-full max-w-xs font-bold text-lg">
                    <span>{t.purchaseInvoices.totalAmount}:</span>
                    <span>{formatCurrency(invoice.totalAmount)}</span>
                  </div>
                  {invoice.paidAmount > 0 && (
                    <>
                      <div className="flex justify-between w-full max-w-xs text-sm text-green-600">
                        <span>{language === 'ar' ? 'المدفوع' : 'Paid'}:</span>
                        <span>{formatCurrency(invoice.paidAmount)}</span>
                      </div>
                      <div className="flex justify-between w-full max-w-xs text-sm text-destructive">
                        <span>{language === 'ar' ? 'المتبقي' : 'Remaining'}:</span>
                        <span>{formatCurrency(invoice.remainingAmount)}</span>
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Notes */}
            {invoice.notes && (
              <Card className="mt-6">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{t.common.notes}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{invoice.notes}</p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Payment Dialog */}
          <PaymentEntryDialog
            open={paymentDialogOpen}
            onOpenChange={setPaymentDialogOpen}
            invoice={{
              id: invoice.id,
              invoice_number: invoice.invoiceNumber,
              supplier_id: invoice.supplierId || '',
              supplier_name: invoice.supplierName || '',
              total_amount: invoice.totalAmount,
              paid_amount: invoice.paidAmount,
              remaining_amount: invoice.remainingAmount,
            }}
            onPaymentCreated={() => {
              refetch();
              setPaymentDialogOpen(false);
            }}
          />

          {/* Cancel Confirmation Dialog */}
          <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
            <AlertDialogContent className="max-w-md">
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                  <Ban className="w-5 h-5" />
                  {language === 'ar' ? 'إلغاء الفاتورة' : 'Cancel Invoice'}
                </AlertDialogTitle>
                <AlertDialogDescription className="text-right space-y-2">
                  <p>
                    {language === 'ar' 
                      ? 'هل أنت متأكد من إلغاء هذه الفاتورة؟ لا يمكن التراجع عن هذا الإجراء.' 
                      : 'Are you sure you want to cancel this invoice? This action cannot be undone.'}
                  </p>
                  <div className="bg-muted p-3 rounded-md text-sm space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{language === 'ar' ? 'رقم الفاتورة:' : 'Invoice No:'}</span>
                      <span className="font-medium">{invoice.invoiceNumber}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{language === 'ar' ? 'المورد:' : 'Supplier:'}</span>
                      <span>{invoice.supplierName || '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{language === 'ar' ? 'الإجمالي:' : 'Total:'}</span>
                      <span>{formatCurrency(invoice.totalAmount)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{language === 'ar' ? 'المدفوع:' : 'Paid:'}</span>
                      <span>{formatCurrency(invoice.paidAmount)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{language === 'ar' ? 'المتبقي:' : 'Remaining:'}</span>
                      <span>{formatCurrency(invoice.remainingAmount)}</span>
                    </div>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              
              <div className="space-y-2 py-2">
                <Label htmlFor="cancel-reason">{language === 'ar' ? 'سبب الإلغاء (اختياري)' : 'Cancellation reason (optional)'}</Label>
                <Textarea
                  id="cancel-reason"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder={language === 'ar' ? 'أدخل سبب الإلغاء...' : 'Enter cancellation reason...'}
                  className="min-h-[80px]"
                />
              </div>

              <AlertDialogFooter className="flex-row-reverse gap-2 sm:gap-0">
                <AlertDialogCancel disabled={cancelMutation.isPending}>
                  {language === 'ar' ? 'تراجع' : 'Go Back'}
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => cancelMutation.mutate()}
                  disabled={cancelMutation.isPending}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {cancelMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin me-2" />
                  ) : (
                    <Ban className="w-4 h-4 me-2" />
                  )}
                  {language === 'ar' ? 'تأكيد الإلغاء' : 'Confirm Cancel'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {isImportInvoice && canRebuildInvoice && (
            <UniqueInvoiceEditDialog
              open={editDialogOpen}
              onOpenChange={setEditDialogOpen}
              invoice={invoice}
              onEditComplete={() => refetch()}
            />
          )}
        </div>
      </TooltipProvider>
    </MainLayout>
  );
};

// ===========================
// Invoice Lines Table Component
// ===========================

interface InvoiceLinesTableProps {
  lines: PurchaseInvoiceLineDTO[];
  formatCurrency: (amount: number) => string;
  t: any;
  language: string;
}

function InvoiceLinesTable({ lines, formatCurrency, t, language }: InvoiceLinesTableProps) {
  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t.purchaseInvoices.invoiceLines}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>{t.common.code}</TableHead>
                <TableHead>{t.common.description}</TableHead>
                <TableHead className="text-center">{t.common.quantity}</TableHead>
                <TableHead className="text-left">{t.purchaseInvoices.unitPrice}</TableHead>
                <TableHead className="text-left">{t.purchaseInvoices.discount}</TableHead>
                <TableHead className="text-left">{t.purchaseInvoices.taxAmount}</TableHead>
                <TableHead className="text-left">{t.common.total}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines && lines.length > 0 ? (
                lines.map((line, index) => (
                  <TableRow key={line.id} className={line.lineKind === 'import_summary' ? 'bg-blue-50 dark:bg-blue-950/20' : ''}>
                    <TableCell>{index + 1}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {line.lineKind === 'import_summary' ? (
                        <Badge variant="secondary" className="font-normal">
                          {language === 'ar' ? 'ملخص مستورد' : 'Import Summary'}
                        </Badge>
                      ) : (
                        line.productCode
                      )}
                    </TableCell>
                    <TableCell>{line.description || '-'}</TableCell>
                    <TableCell className="text-center">{line.quantity}</TableCell>
                    <TableCell className="text-left">{formatCurrency(line.unitPrice)}</TableCell>
                    <TableCell className="text-left">{formatCurrency(line.discountAmount)}</TableCell>
                    <TableCell className="text-left">{formatCurrency(line.taxAmount)}</TableCell>
                    <TableCell className="text-left font-medium">{formatCurrency(line.totalAmount)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    {t.common.noData}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export default PurchaseInvoiceViewPage;
