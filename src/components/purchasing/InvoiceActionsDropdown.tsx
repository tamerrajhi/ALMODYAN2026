import { useState, useMemo, useRef } from 'react';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MoreHorizontal, Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { addCairoFont } from '@/lib/fonts/cairo-font';
import { 
  getInvoiceForActions, 
  voidPurchaseInvoiceAtomic,
  getInvoicePolicy,
  sendInvoiceEmail,
  type InvoiceForActionsDTO,
  type PurchaseInvoiceDTO,
  type InvoiceActionKey
} from '@/domain/purchasing';
import { InvoiceActionRenderer, type ActionHandlers } from './InvoiceActionRenderer';

/**
 * Props interface - accepts PurchaseInvoiceDTO directly
 * NO domain mapping in UI - policy is called with DTO as-is
 */
interface InvoiceActionsDropdownProps {
  invoice: PurchaseInvoiceDTO;
  onPaymentClick: () => void;
  onRefresh: () => void;
}

export function InvoiceActionsDropdown({ 
  invoice, 
  onPaymentClick,
  onRefresh 
}: InvoiceActionsDropdownProps) {
  const { language } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loadingAction, setLoadingAction] = useState<InvoiceActionKey | null>(null);
  
  // Stable request ID for idempotency
  const voidRequestIdRef = useRef<string | null>(null);

  // Get policy from the Policy Layer - SINGLE source of truth
  const policy = useMemo(() => getInvoicePolicy(invoice), [invoice]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat(language === 'ar' ? 'ar-SA' : 'en-SA', {
      style: 'currency',
      currency: 'SAR',
      minimumFractionDigits: 2,
    }).format(value);
  };

  const formatDate = (date: string) => format(new Date(date), 'yyyy-MM-dd');

  // ===========================
  // Action Handlers
  // ===========================

  const handleView = () => {
    navigate(`/purchasing/invoices/${invoice.id}/view`);
  };

  const handleEdit = () => {
    navigate(`/purchasing/invoices/${invoice.id}`);
  };

  const handlePrint = async () => {
    setLoadingAction('print');
    try {
      const invoiceData = await getInvoiceForActions(invoice.id);
      if (!invoiceData) {
        toast.error(language === 'ar' ? 'لم يتم العثور على الفاتورة' : 'Invoice not found');
        return;
      }
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        toast.error(language === 'ar' ? 'تم حظر النافذة المنبثقة' : 'Popup blocked');
        return;
      }
      printWindow.document.write(generatePrintHTML(invoiceData));
      printWindow.document.close();
      printWindow.print();
    } catch (error) {
      console.error('Print error:', error);
      toast.error(language === 'ar' ? 'حدث خطأ أثناء الطباعة' : 'Print error');
    } finally {
      setLoadingAction(null);
    }
  };

  const handlePdf = async () => {
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
      doc.text(`${language === 'ar' ? 'التاريخ:' : 'Date:'} ${formatDate(invoiceData.invoiceDate)}`, 15, 42);
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

  const handleDuplicate = async () => {
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

  const handleEmail = async () => {
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

  const handleCreateReturn = () => {
    navigate(`/purchasing/invoices/${invoice.id}/view?action=return`);
  };

  const handleViewJournal = () => {
    if (policy.actions.viewJournal.href) {
      navigate(policy.actions.viewJournal.href);
    }
  };

  const handlePay = () => {
    onPaymentClick();
  };

  const handleCancel = async () => {
    if (!window.confirm(language === 'ar' ? `هل أنت متأكد من إلغاء الفاتورة ${invoice.invoiceNumber}؟` : `Are you sure you want to cancel invoice ${invoice.invoiceNumber}?`)) {
      return;
    }

    // Generate stable request ID for idempotency
    if (!voidRequestIdRef.current) {
      voidRequestIdRef.current = crypto.randomUUID();
    }

    setLoadingAction('cancel');
    try {
      const result = await voidPurchaseInvoiceAtomic({
        client_request_id: voidRequestIdRef.current,
        created_by: user?.email || 'system',
        invoice_id: invoice.id,
        void_reason: language === 'ar' ? 'إلغاء من القائمة' : 'Cancelled from dropdown',
        void_date: new Date().toISOString().split('T')[0],
      });
      
      if (result.success) {
        voidRequestIdRef.current = null; // Reset on success
        toast.success(language === 'ar' 
          ? `تم إلغاء الفاتورة ${result.invoiceNumber || invoice.invoiceNumber}` 
          : `Invoice ${result.invoiceNumber || invoice.invoiceNumber} cancelled`);
        onRefresh();
      } else if (result.error_code === 'IDEMPOTENCY_CONFLICT') {
        toast.error(language === 'ar' ? 'طلب متعارض - حاول مرة أخرى' : 'Conflicting request - please try again');
        voidRequestIdRef.current = null; // Reset to allow retry
      } else {
        toast.error(result.error || (language === 'ar' ? 'فشل في الإلغاء' : 'Failed to cancel'));
      }
    } catch (error) {
      console.error('Cancel error:', error);
      toast.error(language === 'ar' ? 'حدث خطأ أثناء الإلغاء' : 'Error cancelling');
    } finally {
      setLoadingAction(null);
    }
  };

  // Handler map for renderer
  const handlers: ActionHandlers = {
    view: handleView,
    edit: handleEdit,
    print: handlePrint,
    pdf: handlePdf,
    duplicate: handleDuplicate,
    email: handleEmail,
    createReturn: handleCreateReturn,
    viewJournal: handleViewJournal,
    pay: handlePay,
    cancel: handleCancel,
  };

  const generatePrintHTML = (inv: InvoiceForActionsDTO) => `
    <!DOCTYPE html>
    <html dir="${language === 'ar' ? 'rtl' : 'ltr'}">
    <head>
      <meta charset="UTF-8">
      <title>${language === 'ar' ? 'فاتورة مشتريات' : 'Purchase Invoice'} - ${inv.invoiceNumber}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        .header { text-align: center; margin-bottom: 30px; }
        .info { margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        th, td { border: 1px solid #ddd; padding: 10px; text-align: ${language === 'ar' ? 'right' : 'left'}; }
        th { background: #f5f5f5; }
        .totals { margin-top: 20px; }
        @media print { body { print-color-adjust: exact; } }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>${language === 'ar' ? 'فاتورة مشتريات' : 'Purchase Invoice'}</h1>
        <p>${inv.invoiceNumber}</p>
      </div>
      <div class="info">
        <p><strong>${language === 'ar' ? 'المورد:' : 'Supplier:'}</strong> ${inv.supplierName}</p>
        <p><strong>${language === 'ar' ? 'التاريخ:' : 'Date:'}</strong> ${formatDate(inv.invoiceDate)}</p>
      </div>
      <table>
        <thead>
          <tr>
            <th>${language === 'ar' ? 'الوصف' : 'Description'}</th>
            <th>${language === 'ar' ? 'الكمية' : 'Qty'}</th>
            <th>${language === 'ar' ? 'السعر' : 'Price'}</th>
            <th>${language === 'ar' ? 'الإجمالي' : 'Total'}</th>
          </tr>
        </thead>
        <tbody>
          ${inv.lines.map(line => `
            <tr>
              <td>${line.description || ''}</td>
              <td>${line.quantity || 1}</td>
              <td>${formatCurrency(line.unitPrice || 0)}</td>
              <td>${formatCurrency(line.totalAmount || 0)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="totals">
        <p><strong>${language === 'ar' ? 'الإجمالي:' : 'Total:'}</strong> ${formatCurrency(inv.totalAmount)}</p>
        <p><strong>${language === 'ar' ? 'المدفوع:' : 'Paid:'}</strong> ${formatCurrency(inv.paidAmount)}</p>
        <p><strong>${language === 'ar' ? 'المتبقي:' : 'Remaining:'}</strong> ${formatCurrency(inv.remainingAmount)}</p>
      </div>
    </body>
    </html>
  `;

  return (
    <TooltipProvider>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            {loadingAction ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MoreHorizontal className="h-4 w-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <InvoiceActionRenderer
            policy={policy}
            placement="dropdown"
            handlers={handlers}
            loadingAction={loadingAction}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  );
}
