import { useState, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '@/contexts/LanguageContext';
import { useScreenPermissions } from '@/hooks/useScreenPermissions';
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
import { Plus, ArrowUpCircle, Wallet, FileText, AlertTriangle, Settings, Maximize2, Minimize2, ExternalLink, Download, Printer } from 'lucide-react';
import { RowActionsMenu } from '@/components/ui/RowActionsMenu';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { useReactToPrint } from 'react-to-print';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import QRCode from 'qrcode';
import PrintablePaymentVoucher from '@/components/purchasing/PrintablePaymentVoucher';
import InvoiceAllocationsPicker, { type AllocationEntry } from '@/components/purchasing/InvoiceAllocationsPicker';

// Domain services
import {
  listPaymentVouchers,
  listSuppliersForPaymentVouchers,
  getPaymentAccountSettingsCheck,
  getCompanySettingsForVoucherPrint,
  listUnpaidPurchaseInvoicesBySupplier,
  getPaymentVoucherJournalEntryPreview,
  type PaymentVoucherRowDTO,
  type SupplierDropdownDTO,
  type UnpaidPurchaseInvoiceDTO,
  type CompanySettingsForPrintDTO,
  type JournalEntryPreviewDTO,
} from '@/domain/purchasing/purchasingReadService';

import {
  createPaymentVoucher,
  updatePaymentVoucher,
  deletePaymentVoucher,
  type CreatePaymentVoucherCommand,
  type UpdatePaymentVoucherCommand,
  type DeletePaymentVoucherCommand,
} from '@/domain/purchasing/purchasingWriteService';

// Legacy interface for PrintablePaymentVoucher compatibility
interface PaymentForPrint {
  id: string;
  payment_number: string;
  payment_type: string;
  payment_date: string;
  amount: number;
  payment_method: string;
  notes: string | null;
  invoice_id: string | null;
  supplier_id: string | null;
  journal_entry_id: string | null;
  supplier?: { id: string; supplier_name: string } | null;
  invoice?: {
    id: string;
    invoice_number: string;
    total_amount: number;
    paid_amount: number;
    remaining_amount: number;
    status: string;
  } | null;
  created_at: string;
}

interface JournalEntryForPrint {
  id: string;
  entry_number: string;
  entry_date: string;
  description: string | null;
  total_debit: number;
  total_credit: number;
  lines?: {
    id: string;
    account_code: string;
    account_name: string;
    debit_amount: number;
    credit_amount: number;
    description: string | null;
  }[];
}

interface CompanySettingsForPrint {
  company_name: string;
  company_name_en: string | null;
  logo_url: string | null;
  commercial_registration: string | null;
  tax_number: string | null;
  address: string | null;
  address_en: string | null;
  city: string | null;
  city_en: string | null;
  country: string | null;
  country_en: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  postal_code: string | null;
}

// Transform DTO to legacy format for PrintablePaymentVoucher
function toPaymentForPrint(dto: PaymentVoucherRowDTO): PaymentForPrint {
  return {
    id: dto.id,
    payment_number: dto.paymentNumber,
    payment_type: dto.paymentType,
    payment_date: dto.paymentDate,
    amount: dto.amount,
    payment_method: dto.paymentMethod,
    notes: dto.notes,
    invoice_id: dto.invoiceId,
    supplier_id: dto.supplierId,
    journal_entry_id: dto.journalEntryId,
    supplier: dto.supplierName ? { id: dto.supplierId || '', supplier_name: dto.supplierName } : null,
    invoice: dto.invoiceNumber
      ? {
          id: dto.invoiceId || '',
          invoice_number: dto.invoiceNumber,
          total_amount: dto.invoiceTotalAmount || 0,
          paid_amount: dto.invoicePaidAmount || 0,
          remaining_amount: dto.invoiceRemainingAmount || 0,
          status: dto.invoiceStatus || '',
        }
      : null,
    created_at: dto.createdAt,
  };
}

function toJournalEntryForPrint(dto: JournalEntryPreviewDTO | null): JournalEntryForPrint | null {
  if (!dto) return null;
  return {
    id: dto.id,
    entry_number: dto.entryNumber,
    entry_date: dto.entryDate,
    description: dto.description,
    total_debit: dto.totalDebit,
    total_credit: dto.totalCredit,
    lines: dto.lines.map((line) => ({
      id: line.id,
      account_code: line.accountCode,
      account_name: line.accountName,
      debit_amount: line.debitAmount,
      credit_amount: line.creditAmount,
      description: line.description,
    })),
  };
}

function toCompanySettingsForPrint(dto: CompanySettingsForPrintDTO | null): CompanySettingsForPrint | null {
  if (!dto) return null;
  return {
    company_name: dto.companyName,
    company_name_en: dto.companyNameEn,
    logo_url: dto.logoUrl,
    commercial_registration: dto.commercialRegistration,
    tax_number: dto.taxNumber,
    address: dto.address,
    address_en: dto.addressEn,
    city: dto.city,
    city_en: dto.cityEn,
    country: dto.country,
    country_en: dto.countryEn,
    phone: dto.phone,
    email: dto.email,
    website: dto.website,
    postal_code: dto.postalCode,
  };
}

export default function PaymentVouchersPage() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const printRef = useRef<HTMLDivElement>(null);
  const { canViewScreen } = useScreenPermissions();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [isPreviewFullScreen, setIsPreviewFullScreen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedVoucher, setSelectedVoucher] = useState<PaymentVoucherRowDTO | null>(null);
  const [selectedJournalEntry, setSelectedJournalEntry] = useState<JournalEntryPreviewDTO | null>(null);

  const [formData, setFormData] = useState({
    paymentDate: format(new Date(), 'yyyy-MM-dd'),
    amount: '',
    paymentMethod: 'cash',
    supplierId: '',
    invoiceId: '',
    notes: '',
  });

  // SET-1: Invoice allocations state
  const [allocations, setAllocations] = useState<AllocationEntry[]>([]);

  const [editFormData, setEditFormData] = useState({
    paymentDate: '',
    amount: '',
    paymentMethod: '',
    notes: '',
  });

  const paymentMethodLabels: Record<string, string> = {
    cash: t.payments.cash,
    bank: t.payments.bankTransfer,
    check: t.payments.check,
    credit_card: t.payments.creditCard,
  };

  // Read queries using domain services
  const { data: vouchers = [], isLoading } = useQuery({
    queryKey: ['payment-vouchers'],
    queryFn: () => listPaymentVouchers(),
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-for-payment-vouchers'],
    queryFn: () => listSuppliersForPaymentVouchers(),
  });

  const { data: accountSettings } = useQuery({
    queryKey: ['payment-account-settings-check'],
    queryFn: () => getPaymentAccountSettingsCheck(),
  });

  const { data: companySettings } = useQuery({
    queryKey: ['company-settings-for-voucher-print'],
    queryFn: () => getCompanySettingsForVoucherPrint(),
  });

  const isSettingsComplete = accountSettings?.isComplete ?? false;

  const { data: unpaidInvoices = [] } = useQuery({
    queryKey: ['unpaid-purchase-invoices-for-voucher', formData.supplierId],
    queryFn: () => listUnpaidPurchaseInvoicesBySupplier(formData.supplierId),
    enabled: !!formData.supplierId,
  });

  const selectedInvoice = useMemo(() => {
    return unpaidInvoices.find((inv) => inv.id === formData.invoiceId);
  }, [unpaidInvoices, formData.invoiceId]);

  // Stable request ID for atomic idempotency (PV-1)
  const createRequestIdRef = useRef<string | null>(null);

  // Write mutations using domain services
  const createMutation = useMutation({
    mutationFn: async () => {
      // PV-3B: Server-side derivation enabled - lines are now optional
      
      // Generate stable request ID if not already set
      if (!createRequestIdRef.current) {
        createRequestIdRef.current = crypto.randomUUID();
      }
      
      const supplierName = formData.supplierId
        ? suppliers.find((s) => s.id === formData.supplierId)?.supplierName || null
        : null;

      // Note: branchId will be derived in server if not provided


      const cmd: CreatePaymentVoucherCommand = {
        clientRequestId: createRequestIdRef.current,
        paymentDate: formData.paymentDate,
        amount: parseFloat(formData.amount),
        paymentMethod: formData.paymentMethod,
        supplierId: formData.supplierId || null,
        invoiceId: formData.invoiceId || null,
        notes: formData.notes || null,
        supplierName,
        // SET-1: Include allocations if any
        allocations: allocations.length > 0 ? allocations : undefined,
      };

      const result = await createPaymentVoucher(cmd);
      if (!result.success) {
        // Handle specific error codes with user-friendly messages
        if (result.error?.includes('MISSING_ACCOUNT_MAPPING')) {
          throw new Error('لم يتم إعداد حسابات طرق الدفع للفرع. يرجى مراجعة إعدادات حسابات الدفع.');
        }
        if (result.error?.includes('MISSING_PARTY_ACCOUNT')) {
          throw new Error('المورد المحدد ليس لديه حساب مرتبط. يرجى تحديث بيانات المورد.');
        }
        throw new Error(result.error);
      }

      // Reset request ID on success for next voucher
      createRequestIdRef.current = null;

      if (!result.journalEntryId) {
        toast.warning('تم إنشاء السند ولكن فشل إنشاء القيد المحاسبي - يرجى مراجعة إعدادات الحسابات');
      }

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payment-vouchers'] });
      queryClient.invalidateQueries({ queryKey: ['journal-entries'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['unpaid-purchase-invoices-for-voucher'] });
      toast.success(t.payments.voucherCreatedSuccess);
      resetForm();
      setAllocations([]); // SET-1: Reset allocations
      setDialogOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.message || t.payments.voucherCreatedError);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedVoucher) throw new Error('لم يتم تحديد السند');

      // PV-4: Use atomic update command
      const cmd: UpdatePaymentVoucherCommand = {
        clientRequestId: crypto.randomUUID(),
        paymentId: selectedVoucher.id,
        payment: {
          paymentDate: editFormData.paymentDate,
          amount: parseFloat(editFormData.amount),
          paymentMethod: editFormData.paymentMethod,
          notes: editFormData.notes || null,
        },
        // PV-4: No lines provided - server will derive
      };

      const result = await updatePaymentVoucher(cmd);
      if (!result.success) {
        throw new Error(result.error);
      }

      if (!result.journalEntryId) {
        toast.warning('تم تحديث السند ولكن فشل إنشاء القيد المحاسبي الجديد');
      }

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payment-vouchers'] });
      queryClient.invalidateQueries({ queryKey: ['journal-entries'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('تم تحديث السند والقيد المحاسبي بنجاح');
      setEditDialogOpen(false);
      setSelectedVoucher(null);
    },
    onError: (error: any) => {
      toast.error(error.message || 'فشل تحديث السند');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (voucher: PaymentVoucherRowDTO) => {
      const cmd: DeletePaymentVoucherCommand = { paymentId: voucher.id };
      const result = await deletePaymentVoucher(cmd);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payment-vouchers'] });
      queryClient.invalidateQueries({ queryKey: ['journal-entries'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('تم حذف السند والقيد المحاسبي بنجاح');
      setDeleteDialogOpen(false);
      setSelectedVoucher(null);
    },
    onError: (error: any) => {
      toast.error(error.message || 'فشل حذف السند');
    },
  });

  const resetForm = () => {
    setFormData({
      paymentDate: format(new Date(), 'yyyy-MM-dd'),
      amount: '',
      paymentMethod: 'cash',
      supplierId: '',
      invoiceId: '',
      notes: '',
    });
  };

  const handleSupplierChange = (value: string) => {
    setFormData({ ...formData, supplierId: value, invoiceId: '' });
    setAllocations([]); // Clear allocations when supplier changes
  };

  const handleInvoiceSelect = (invoiceId: string) => {
    const invoice = unpaidInvoices.find((inv) => inv.id === invoiceId);
    if (invoice) {
      setFormData({
        ...formData,
        invoiceId: invoiceId,
        amount: invoice.remainingAmount.toString(),
      });
    }
  };

  const handlePreview = async (voucher: PaymentVoucherRowDTO) => {
    setSelectedVoucher(voucher);
    if (voucher.journalEntryId) {
      const je = await getPaymentVoucherJournalEntryPreview(voucher.journalEntryId);
      setSelectedJournalEntry(je);
    } else {
      setSelectedJournalEntry(null);
    }
    setPreviewDialogOpen(true);
  };

  const handleEdit = (voucher: PaymentVoucherRowDTO) => {
    setSelectedVoucher(voucher);
    setEditFormData({
      paymentDate: voucher.paymentDate,
      amount: voucher.amount.toString(),
      paymentMethod: voucher.paymentMethod,
      notes: voucher.notes || '',
    });
    setEditDialogOpen(true);
  };

  const handleDelete = (voucher: PaymentVoucherRowDTO) => {
    setSelectedVoucher(voucher);
    setDeleteDialogOpen(true);
  };

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `سند_صرف_${selectedVoucher?.paymentNumber || ''}`,
  });

  const generatePDF = async (voucher: PaymentVoucherRowDTO) => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    doc.setFont('helvetica');

    const company = companySettings
      ? {
          company_name: companySettings.companyName,
          company_name_en: companySettings.companyNameEn,
          commercial_registration: companySettings.commercialRegistration,
          tax_number: companySettings.taxNumber,
          address: companySettings.address,
          phone: companySettings.phone,
          email: companySettings.email,
        }
      : {
          company_name: 'اسم الشركة',
          company_name_en: 'Company Name',
          commercial_registration: null,
          tax_number: null,
          address: null,
          phone: null,
          email: null,
        };

    // Generate QR Code
    const qrData = JSON.stringify({
      type: 'PAYMENT_VOUCHER',
      voucher_no: voucher.paymentNumber,
      date: voucher.paymentDate,
      supplier: voucher.supplierName || '-',
      amount: voucher.amount,
      currency: 'SAR',
      ref_id: voucher.id,
    });

    try {
      const qrCodeDataUrl = await QRCode.toDataURL(qrData, { width: 80, margin: 1 });
      doc.addImage(qrCodeDataUrl, 'PNG', 15, 10, 25, 25);
    } catch (err) {
      console.error('QR generation error:', err);
    }

    // ============ HEADER ============
    doc.setFontSize(16);
    doc.text(company.company_name, 105, 15, { align: 'center' });
    if (company.company_name_en) {
      doc.setFontSize(10);
      doc.text(company.company_name_en, 105, 21, { align: 'center' });
    }

    doc.setFontSize(8);
    let headerY = 28;
    if (company.commercial_registration) {
      doc.text(`CR: ${company.commercial_registration}`, 105, headerY, { align: 'center' });
      headerY += 4;
    }
    if (company.tax_number) {
      doc.text(`Tax ID: ${company.tax_number}`, 105, headerY, { align: 'center' });
    }

    // Document Title
    doc.setFontSize(14);
    doc.setFillColor(240, 240, 240);
    doc.rect(60, 38, 90, 10, 'F');
    doc.text('سند صرف - Payment Voucher', 105, 45, { align: 'center' });

    // Voucher Info (top right)
    doc.setFontSize(10);
    doc.text(`Voucher No: ${voucher.paymentNumber}`, 195, 15, { align: 'right' });
    doc.text(`Date: ${format(new Date(voucher.paymentDate), 'yyyy/MM/dd')}`, 195, 21, { align: 'right' });
    doc.text(`Ref: ${voucher.id.substring(0, 8).toUpperCase()}`, 195, 27, { align: 'right' });

    // ============ VOUCHER DETAILS ============
    doc.setFontSize(11);
    let detailY = 58;

    doc.text('Supplier / المورد:', 195, detailY, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.text(voucher.supplierName || '-', 130, detailY, { align: 'right' });
    doc.setFont('helvetica', 'normal');

    detailY += 7;
    doc.text('Payment Method / طريقة الدفع:', 195, detailY, { align: 'right' });
    doc.text(paymentMethodLabels[voucher.paymentMethod] || voucher.paymentMethod, 130, detailY, { align: 'right' });

    if (voucher.invoiceNumber) {
      detailY += 7;
      doc.text('Related Invoice / الفاتورة المرتبطة:', 195, detailY, { align: 'right' });
      doc.text(voucher.invoiceNumber, 130, detailY, { align: 'right' });
    }

    // ============ AMOUNT BOX ============
    detailY += 12;
    doc.setFillColor(245, 245, 245);
    doc.rect(50, detailY, 110, 18, 'F');
    doc.setDrawColor(100, 100, 100);
    doc.rect(50, detailY, 110, 18, 'S');

    doc.setFontSize(10);
    doc.text('Amount Paid / المبلغ المدفوع', 105, detailY + 6, { align: 'center' });
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(`SAR ${voucher.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 105, detailY + 14, { align: 'center' });
    doc.setFont('helvetica', 'normal');

    // ============ NOTES ============
    if (voucher.notes) {
      detailY += 25;
      doc.setFontSize(10);
      doc.text('Notes / ملاحظات:', 195, detailY, { align: 'right' });
      doc.text(voucher.notes, 195, detailY + 5, { align: 'right', maxWidth: 170 });
      detailY += 10;
    }

    // ============ JOURNAL ENTRY ============
    let tableStartY = detailY + 30;

    if (voucher.journalEntryId) {
      const je = await getPaymentVoucherJournalEntryPreview(voucher.journalEntryId);
      if (je && je.lines) {
        doc.setFontSize(11);
        doc.setFillColor(80, 80, 80);
        doc.setTextColor(255, 255, 255);
        doc.rect(15, tableStartY - 8, 180, 8, 'F');
        doc.text(`Journal Entry - القيد المحاسبي: ${je.entryNumber}`, 105, tableStartY - 2, { align: 'center' });
        doc.setTextColor(0, 0, 0);

        const tableData = je.lines.map((line) => [
          line.accountCode,
          line.accountName,
          line.debitAmount > 0 ? line.debitAmount.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '-',
          line.creditAmount > 0 ? line.creditAmount.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '-',
        ]);

        // Add totals row
        tableData.push([
          '',
          'Total / الإجمالي',
          je.totalDebit.toLocaleString('en-US', { minimumFractionDigits: 2 }),
          je.totalCredit.toLocaleString('en-US', { minimumFractionDigits: 2 }),
        ]);

        (doc as any).autoTable({
          head: [['Account No / رقم الحساب', 'Account Name / اسم الحساب', 'Debit / مدين', 'Credit / دائن']],
          body: tableData,
          startY: tableStartY,
          theme: 'grid',
          styles: { halign: 'center', font: 'helvetica', fontSize: 9 },
          headStyles: { fillColor: [100, 100, 100], textColor: [255, 255, 255] },
          footStyles: { fillColor: [220, 220, 220], fontStyle: 'bold' },
          columnStyles: {
            0: { cellWidth: 30 },
            1: { cellWidth: 80, halign: 'left' },
            2: { cellWidth: 35 },
            3: { cellWidth: 35 },
          },
        });

        tableStartY = (doc as any).lastAutoTable?.finalY || tableStartY + 30;
      }
    }

    // ============ SIGNATURES ============
    const sigY = tableStartY + 20;
    doc.setFontSize(10);
    doc.text('Signatures / التوقيعات:', 105, sigY, { align: 'center' });

    const sigBoxY = sigY + 5;
    const sigBoxWidth = 40;
    const sigBoxHeight = 20;
    const sigLabels = ['Prepared By\nأعده', 'Checked By\nراجعه', 'Approved By\nاعتمده', 'Received By\nاستلمه'];
    const sigStartX = 20;
    const sigGap = 45;

    sigLabels.forEach((label, i) => {
      const x = sigStartX + i * sigGap;
      doc.rect(x, sigBoxY, sigBoxWidth, sigBoxHeight, 'S');
      doc.setFontSize(7);
      const lines = label.split('\n');
      doc.text(lines[0], x + sigBoxWidth / 2, sigBoxY + sigBoxHeight + 4, { align: 'center' });
      doc.text(lines[1], x + sigBoxWidth / 2, sigBoxY + sigBoxHeight + 8, { align: 'center' });
    });

    // ============ FOOTER ============
    const footerY = 280;
    doc.setFontSize(7);
    doc.setTextColor(128, 128, 128);
    doc.text(`Printed: ${format(new Date(), 'yyyy/MM/dd HH:mm:ss')}`, 15, footerY);
    doc.text(`Internal Ref: ${voucher.id.substring(0, 8).toUpperCase()}`, 105, footerY, { align: 'center' });
    doc.text('Page 1 of 1', 195, footerY, { align: 'right' });
    doc.text('This document is generated from the accounting system', 105, footerY + 4, { align: 'center' });

    doc.save(`سند_صرف_${voucher.paymentNumber}.pdf`);
    toast.success('تم تحميل الملف بنجاح');
  };

  const totalAmount = vouchers.reduce((sum, v) => sum + v.amount, 0);

  const filteredVouchers = vouchers.filter((voucher) => {
    return (
      voucher.paymentNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      voucher.supplierName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      voucher.invoiceNumber?.toLowerCase().includes(searchTerm.toLowerCase())
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

        <div className="page-header-rtl">
          <div>
            <h1 className="text-3xl font-bold">{t.payments.paymentVouchers}</h1>
            <p className="text-muted-foreground">{t.payments.paymentVouchersSubtitle}</p>
          </div>

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                {t.payments.newPaymentVoucher}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{t.payments.createPaymentVoucher}</DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>{t.common.date}</Label>
                  <Input
                    type="date"
                    value={formData.paymentDate}
                    onChange={(e) => setFormData({ ...formData, paymentDate: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label>{t.suppliers.title}</Label>
                  <Select value={formData.supplierId} onValueChange={handleSupplierChange}>
                    <SelectTrigger>
                      <SelectValue placeholder={t.payments.selectSupplier} />
                    </SelectTrigger>
                    <SelectContent>
                      {suppliers.map((supplier) => (
                        <SelectItem key={supplier.id} value={supplier.id}>
                          {supplier.supplierName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Amount and Payment Method - before allocations */}
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
                  </div>
                  <div className="space-y-2">
                    <Label>{t.payments.paymentMethod}</Label>
                    <Select
                      value={formData.paymentMethod}
                      onValueChange={(value) => setFormData({ ...formData, paymentMethod: value })}
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

                {/* SET-HB: Invoice Allocations Picker - REQUIRED for supplier payments */}
                {formData.supplierId && (
                  <div className="space-y-2">
                    <Label className="text-destructive font-medium">توزيع على الفواتير (مطلوب لسندات صرف المورد) *</Label>
                    <InvoiceAllocationsPicker
                      invoices={unpaidInvoices}
                      paymentAmount={parseFloat(formData.amount) || 0}
                      allocations={allocations}
                      onAllocationsChange={setAllocations}
                      disabled={createMutation.isPending}
                    />
                    {allocations.length === 0 && parseFloat(formData.amount) > 0 && (
                      <Alert variant="destructive" className="py-2">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>
                          يجب توزيع المبلغ على فاتورة واحدة على الأقل. سند صرف المورد يتطلب تحديد الفواتير المرتبطة.
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                )}

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
                    onClick={() => createMutation.mutate()}
                    disabled={
                      !formData.amount || 
                      createMutation.isPending ||
                      // SET-HB: Hard block - supplier payments require allocations
                      (formData.supplierId && parseFloat(formData.amount) > 0 && allocations.length === 0)
                    }
                  >
                    {t.payments.saveVoucher}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">{t.payments.totalPayments}</CardTitle>
              <ArrowUpCircle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-500">
                {totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {t.currency.sar}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">{t.payments.vouchersCount}</CardTitle>
              <Wallet className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{vouchers.length}</div>
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
                <TableHead>{t.suppliers.title}</TableHead>
                <TableHead>{t.payments.relatedInvoice}</TableHead>
                <TableHead className="text-left">{t.payments.amount}</TableHead>
                <TableHead>{t.payments.paymentMethod}</TableHead>
                <TableHead className="text-center">الإجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    {t.common.loading}
                  </TableCell>
                </TableRow>
              ) : filteredVouchers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    {t.payments.noVouchers}
                  </TableCell>
                </TableRow>
              ) : (
                filteredVouchers.map((voucher) => (
                  <TableRow key={voucher.id}>
                    <TableCell className="font-mono">{voucher.paymentNumber}</TableCell>
                    <TableCell>{format(new Date(voucher.paymentDate), 'yyyy/MM/dd')}</TableCell>
                    <TableCell>{voucher.supplierName || '-'}</TableCell>
                    <TableCell>
                      {voucher.invoiceNumber ? (
                        canViewScreen('/purchasing/invoices') ? (
                          <Link to={`/purchasing/invoices/${voucher.invoiceId}/view`}>
                            <Badge
                              variant="outline"
                              className="font-mono cursor-pointer hover:bg-primary/10 transition-colors"
                            >
                              <FileText className="h-3 w-3 mr-1" />
                              {voucher.invoiceNumber}
                            </Badge>
                          </Link>
                        ) : (
                          <Badge
                            variant="outline"
                            className="font-mono cursor-not-allowed opacity-60"
                            title="ليس لديك صلاحية لعرض الفاتورة"
                          >
                            <FileText className="h-3 w-3 mr-1" />
                            {voucher.invoiceNumber}
                          </Badge>
                        )
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-left font-mono font-bold text-red-500">
                      {voucher.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell>
                      {paymentMethodLabels[voucher.paymentMethod] || voucher.paymentMethod}
                    </TableCell>
                    <TableCell className="text-center">
                      <RowActionsMenu
                        onPreview={() => handlePreview(voucher)}
                        onEdit={() => handleEdit(voucher)}
                        onDownloadPdf={() => generatePDF(voucher)}
                        onPrint={async () => {
                          await handlePreview(voucher);
                          setTimeout(() => handlePrint(), 300);
                        }}
                        onDelete={() => handleDelete(voucher)}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Preview Dialog */}
        <Dialog
          open={previewDialogOpen}
          onOpenChange={(open) => {
            setPreviewDialogOpen(open);
            if (!open) setIsPreviewFullScreen(false);
          }}
        >
          <DialogContent
            className={cn(
              'overflow-y-auto transition-all duration-300',
              isPreviewFullScreen
                ? 'max-w-[95vw] max-h-[95vh] w-[95vw] h-[95vh]'
                : 'max-w-3xl max-h-[90vh]'
            )}
          >
            <DialogHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <DialogTitle>معاينة سند الصرف</DialogTitle>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsPreviewFullScreen(!isPreviewFullScreen)}
                  title={isPreviewFullScreen ? 'تصغير' : 'تكبير'}
                  className="h-8 w-8"
                >
                  {isPreviewFullScreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    if (selectedVoucher) {
                      const newWindow = window.open('', '_blank');
                      if (newWindow) {
                        newWindow.document.write(`
                          <html dir="rtl">
                            <head>
                              <title>سند صرف - ${selectedVoucher.paymentNumber}</title>
                              <style>
                                body { font-family: Arial, sans-serif; padding: 20px; }
                                @media print { body { padding: 0; } }
                              </style>
                            </head>
                            <body>
                              <script>window.print();</script>
                            </body>
                          </html>
                        `);
                      }
                    }
                  }}
                  title="فتح في تبويب جديد"
                  className="h-8 w-8"
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </div>
            </DialogHeader>
            {selectedVoucher && (
              <PrintablePaymentVoucher
                ref={printRef}
                payment={toPaymentForPrint(selectedVoucher)}
                journalEntry={toJournalEntryForPrint(selectedJournalEntry)}
                companySettings={toCompanySettingsForPrint(companySettings)}
              />
            )}
            <div className="flex gap-2 justify-end mt-4">
              <Button variant="outline" onClick={() => selectedVoucher && generatePDF(selectedVoucher)}>
                <Download className="h-4 w-4 ml-2" />
                تحميل PDF
              </Button>
              <Button onClick={() => handlePrint()}>
                <Printer className="h-4 w-4 ml-2" />
                طباعة
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Edit Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>تعديل سند الصرف - {selectedVoucher?.paymentNumber}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t.common.date}</Label>
                <Input
                  type="date"
                  value={editFormData.paymentDate}
                  onChange={(e) => setEditFormData({ ...editFormData, paymentDate: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>{t.payments.amount}</Label>
                <Input
                  type="number"
                  min="0"
                  value={editFormData.amount}
                  onChange={(e) => setEditFormData({ ...editFormData, amount: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>{t.payments.paymentMethod}</Label>
                <Select
                  value={editFormData.paymentMethod}
                  onValueChange={(value) => setEditFormData({ ...editFormData, paymentMethod: value })}
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

              <div className="space-y-2">
                <Label>{t.common.notes}</Label>
                <Textarea
                  value={editFormData.notes}
                  onChange={(e) => setEditFormData({ ...editFormData, notes: e.target.value })}
                />
              </div>

              <Alert className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20">
                <AlertTriangle className="h-4 w-4 text-yellow-600" />
                <AlertDescription className="text-yellow-800 dark:text-yellow-200">
                  سيتم حذف القيد المحاسبي القديم وإنشاء قيد جديد بالبيانات المحدثة
                </AlertDescription>
              </Alert>

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                  {t.common.cancel}
                </Button>
                <Button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
                  حفظ التعديلات
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <p>هل أنت متأكد من حذف سند الصرف {selectedVoucher?.paymentNumber}؟</p>
                <p className="text-destructive font-medium">
                  ⚠️ سيتم حذف القيد المحاسبي المرتبط وعكس الأثر على دفاتر الحسابات.
                </p>
                <p className="text-muted-foreground text-sm">هذا الإجراء لا يمكن التراجع عنه.</p>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>إلغاء</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => selectedVoucher && deleteMutation.mutate(selectedVoucher)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? 'جاري الحذف...' : 'حذف السند والقيد'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Hidden print component */}
        <div className="hidden">
          {selectedVoucher && (
            <PrintablePaymentVoucher
              ref={printRef}
              payment={toPaymentForPrint(selectedVoucher)}
              journalEntry={toJournalEntryForPrint(selectedJournalEntry)}
              companySettings={toCompanySettingsForPrint(companySettings)}
            />
          )}
        </div>
      </div>
    </MainLayout>
  );
}
