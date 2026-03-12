import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as dataGateway from '@/lib/dataGateway';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import MainLayout from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Separator } from '@/components/ui/separator';
import { Plus, Calendar as CalendarIcon, Save, Loader2, User, Keyboard, AlertCircle, Pencil } from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/utils';
import { logAudit } from '@/lib/audit';
import CustomerCombobox from '@/components/sales/CustomerCombobox';
import SalesInvoiceLineRow, { InvoiceLine } from '@/components/sales/SalesInvoiceLineRow';
import InvoiceSummary from '@/components/sales/InvoiceSummary';
import QuickCustomerDialog from '@/components/sales/QuickCustomerDialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { UserPlus } from 'lucide-react';

const DEFAULT_TAX_RATE = 0.15;

interface CreateSalesInvoicePageProps {
  viewMode?: boolean;
}

export default function CreateSalesInvoicePage({ viewMode = false }: CreateSalesInvoicePageProps) {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams();
  const queryClient = useQueryClient();
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Track loaded invoice status to determine if editing is allowed
  const [loadedInvoiceStatus, setLoadedInvoiceStatus] = useState<string>('draft');
  
  // Force view mode if invoice is not draft (only drafts can be edited)
  const forceViewMode = !!id && !viewMode && loadedInvoiceStatus !== 'draft';
  const isEdit = !!id && !viewMode && !forceViewMode;
  const isView = (!!id && viewMode) || forceViewMode;

  // Form state
  const [invoiceDate, setInvoiceDate] = useState<Date>(new Date());
  const [dueDate, setDueDate] = useState<Date>(new Date());
  const [deliveryDate, setDeliveryDate] = useState<Date>(new Date());
  const [customerId, setCustomerId] = useState<string>('');
  const [branchId, setBranchId] = useState<string>('');
  const [paymentTerms, setPaymentTerms] = useState<string>('net30');
  const [paymentMethod, setPaymentMethod] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [taxInclusive, setTaxInclusive] = useState(false);
  
  // Invoice-level discount
  const [invoiceDiscountType, setInvoiceDiscountType] = useState<'value' | 'percentage'>('value');
  const [invoiceDiscountValue, setInvoiceDiscountValue] = useState(0);

  // Validation state
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Quick Customer Dialog
  const [showCustomerDialog, setShowCustomerDialog] = useState(false);

  // Loading state for edit mode
  const [isLoadingInvoice, setIsLoadingInvoice] = useState(false);

  // Idempotency: stable client request ID per submission
  const clientRequestIdRef = useRef<string>(crypto.randomUUID());
  const regenerateClientRequestId = useCallback(() => {
    clientRequestIdRef.current = crypto.randomUUID();
  }, []);

  // Fetch branches
  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: async () => {
      const res = await fetch('/api/active-branches', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch branches');
      return await res.json();
    },
  });

  // Fetch customers for details display
  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => {
      const res = await fetch('/api/customers', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch customers');
      return await res.json();
    },
  });

  const selectedCustomer = customers.find(c => c.id === customerId);

  // Calculate line totals
  const calculateLine = useCallback((line: InvoiceLine): InvoiceLine => {
    const subtotal = line.quantity * line.unitPrice;
    
    // Calculate discount
    let discountValue: number;
    if (line.discountType === 'percentage') {
      discountValue = subtotal * (line.discountValue / 100);
    } else {
      discountValue = line.discountValue;
    }
    
    const subtotalBeforeDiscount = subtotal;
    let totalBeforeTax: number;
    let taxAmount: number;
    let total: number;

    if (taxInclusive) {
      // Tax is included in the price
      total = subtotal - discountValue;
      totalBeforeTax = total / (1 + line.taxRate);
      taxAmount = total - totalBeforeTax;
    } else {
      totalBeforeTax = subtotal - discountValue;
      taxAmount = totalBeforeTax * line.taxRate;
      total = totalBeforeTax + taxAmount;
    }

    const subtotalAfterDiscount = subtotal - discountValue;

    return {
      ...line,
      subtotalBeforeDiscount,
      subtotalAfterDiscount,
      totalBeforeTax,
      taxAmount,
      total,
    };
  }, [taxInclusive]);

  // Add new line
  const addLine = useCallback(() => {
    const newLine: InvoiceLine = {
      id: crypto.randomUUID(),
      productId: '',
      productCode: '',
      description: '',
      branchId: branchId || '',
      unit: 'piece',
      quantity: 1,
      unitPrice: 0,
      discountType: 'value',
      discountValue: 0,
      taxRate: DEFAULT_TAX_RATE,
      taxAmount: 0,
      subtotalBeforeDiscount: 0,
      subtotalAfterDiscount: 0,
      totalBeforeTax: 0,
      total: 0,
      notes: '',
      availableStock: 0,
      goldWeight: 0,
      source: 'jewelry',
      isService: false,
    };
    setLines(prev => [...prev, newLine]);
  }, [branchId]);

  // Update line
  const updateLine = useCallback((index: number, updatedLine: InvoiceLine) => {
    setLines(prev => {
      const updated = [...prev];
      updated[index] = calculateLine(updatedLine);
      return updated;
    });
  }, [calculateLine]);

  // Duplicate line
  const duplicateLine = useCallback((index: number) => {
    setLines(prev => {
      const lineToDuplicate = prev[index];
      const duplicated: InvoiceLine = {
        ...lineToDuplicate,
        id: crypto.randomUUID(),
      };
      const updated = [...prev];
      updated.splice(index + 1, 0, duplicated);
      return updated;
    });
  }, []);

  // Remove line
  const removeLine = useCallback((index: number) => {
    if (lines.length > 1) {
      setLines(prev => prev.filter((_, i) => i !== index));
    }
  }, [lines.length]);

  // Calculate invoice totals
  const linesSubtotal = lines.reduce((sum, line) => sum + line.subtotalBeforeDiscount, 0);
  const linesDiscountTotal = lines.reduce((sum, line) => sum + (line.subtotalBeforeDiscount - line.subtotalAfterDiscount), 0);
  
  // Calculate invoice-level discount
  const invoiceDiscount = invoiceDiscountType === 'percentage' 
    ? (linesSubtotal - linesDiscountTotal) * (invoiceDiscountValue / 100)
    : invoiceDiscountValue;
  
  const totalBeforeTax = lines.reduce((sum, line) => sum + line.totalBeforeTax, 0) - (taxInclusive ? 0 : invoiceDiscount);
  const totalTax = lines.reduce((sum, line) => sum + line.taxAmount, 0);
  const grandTotal = lines.reduce((sum, line) => sum + line.total, 0) - invoiceDiscount;
  const totalDiscounts = linesDiscountTotal + invoiceDiscount;

  // Generate invoice number
  const generateInvoiceNumber = async () => {
    const today = format(new Date(), 'yyyyMMdd');
    const res = await fetch(`/api/invoice-next-number?prefix=INV-${today}`, { credentials: 'include' });
    const result = await res.json();
    const data = result.latest ? [{ invoice_number: result.latest }] : [];
    
    let sequence = 1;
    if (data && data.length > 0) {
      const lastNum = data[0].invoice_number.split('-').pop();
      sequence = parseInt(lastNum || '0') + 1;
    }
    return `INV-${today}-${sequence.toString().padStart(4, '0')}`;
  };

  // Validate form
  const validateForm = (): boolean => {
    const errors: string[] = [];

    if (!customerId) {
      errors.push(t.salesInvoices?.customerRequired || 'العميل مطلوب');
    }

    if (lines.length === 0 || lines.every(l => !l.productId)) {
      errors.push(t.salesInvoices?.itemsRequired || 'يجب إضافة بند واحد على الأقل');
    }

    const invalidLines = lines.filter(l => l.productId && (l.quantity <= 0 || l.unitPrice < 0));
    if (invalidLines.length > 0) {
      errors.push(t.salesInvoices?.invalidLineData || 'بعض البنود تحتوي على بيانات غير صحيحة');
    }

    // Check stock availability (skip for services)
    const outOfStockLines = lines.filter(l => l.productId && !l.isService && l.quantity > l.availableStock);
    if (outOfStockLines.length > 0) {
      errors.push(t.salesInvoices?.insufficientStock || 'بعض المنتجات غير متوفرة بالكمية المطلوبة');
    }

    setValidationErrors(errors);
    return errors.length === 0;
  };

  // Save invoice via Atomic RPC
  const saveInvoice = async (asDraft = false) => {
    if (!asDraft && !validateForm()) {
      toast.error(t.salesInvoices?.validationFailed || 'يرجى تصحيح الأخطاء قبل الحفظ');
      return;
    }

    if (!customerId) {
      toast.error(t.salesInvoices?.customerRequired || 'العميل مطلوب');
      return;
    }

    // Validate customer phone for non-credit payment methods (only when posting, not drafts)
    if (!asDraft && paymentMethod && paymentMethod !== 'credit') {
      const customerPhone = selectedCustomer?.phone?.replace(/\D/g, '') || '';
      const phoneDigits = customerPhone.slice(-9);
      if (!phoneDigits || !/^5\d{8}$/.test(phoneDigits)) {
        toast.error('رقم جوال العميل إلزامي عند البيع النقدي أو الشبكة');
        return;
      }
    }

    const validLines = lines.filter(l => l.productId);
    if (validLines.length === 0) {
      toast.error(t.salesInvoices?.itemsRequired || 'يجب إضافة بند واحد على الأقل');
      return;
    }

    setIsSaving(true);
    try {
      // Build items array for RPC
      const items = validLines.map(line => ({
        item_id: line.source === 'jewelry' ? line.productId : null,
        product_id: line.source === 'product' ? line.productId : null,
        unit_price: line.unitPrice,
        qty: line.quantity,
        description: line.description,
        source: line.source,
        is_service: line.isService,
        discount_amount: line.discountType === 'value' ? line.discountValue : 0,
        discount_percentage: line.discountType === 'percentage' ? line.discountValue : 0,
        tax_rate: line.taxRate,
      }));

      // Build RPC payload
      const payload = {
        client_request_id: clientRequestIdRef.current,
        invoice_id: isEdit ? id : null,
        branch_id: branchId || null,
        customer_id: customerId,
        issue_date: format(invoiceDate, 'yyyy-MM-dd'),
        due_date: format(dueDate, 'yyyy-MM-dd'),
        delivery_date: format(deliveryDate, 'yyyy-MM-dd'),
        payment_method: paymentMethod || 'credit',
        payment_terms: paymentTerms,
        discount_amount: invoiceDiscountValue,
        notes: notes,
        issued_by: user?.email,
        items: items,
        as_draft: asDraft,
      };

      // Call ERP sales invoice draft endpoint
      const response = await fetch('/api/sales-invoices/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const rpcResult = await response.json() as {
        success?: boolean;
        errorCode?: string;
        error?: string;
        invoice_id?: string;
        invoice_number?: string;
        journal_entry_id?: string;
        journal_entry_number?: string;
        idempotent?: boolean;
      };

      if (!rpcResult?.success) {
        const errorMessages: Record<string, string> = {
          'VALIDATION_ERROR': 'بيانات غير صالحة',
          'POSTED_LOCKED': 'لا يمكن تعديل الفاتورة بعد ترحيل القيد',
          'ACCESS_DENIED': 'لا تملك صلاحية الوصول لهذا الفرع',
          'CONFLICT_IN_PROGRESS': 'العملية قيد التنفيذ بالفعل',
          'ITEM_NOT_AVAILABLE': 'أحد الأصناف غير متوفر للبيع',
          'NOT_FOUND': 'الفاتورة غير موجودة',
        };
        const errorMsg = rpcResult?.errorCode 
          ? (errorMessages[rpcResult.errorCode] || rpcResult.error || 'حدث خطأ')
          : (rpcResult?.error || 'حدث خطأ في حفظ الفاتورة');
        throw new Error(errorMsg);
      }

      // Regenerate client request ID for next submission
      regenerateClientRequestId();

      // Show success with invoice details
      if (rpcResult.idempotent) {
        toast.info(`الفاتورة ${rpcResult.invoice_number} موجودة مسبقاً`);
      } else {
        toast.success(
          isEdit 
            ? t.salesInvoices?.invoiceSaved 
            : `تم إنشاء الفاتورة ${rpcResult.invoice_number} بنجاح`
        );
      }

      // Audit log (RPC handles the main transaction, this is supplementary)
      await logAudit({
        actionType: isEdit ? 'Update' : 'Create',
        entityType: 'Invoice',
        entityId: rpcResult.invoice_id || '',
        description: `${isEdit ? 'تعديل' : 'إنشاء'} فاتورة مبيعات ${rpcResult.invoice_number}`,
        newValue: { invoice_id: rpcResult.invoice_id, journal_entry_id: rpcResult.journal_entry_id },
      });

      queryClient.invalidateQueries({ queryKey: ['sales-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['products-for-sale'] });
      navigate('/sales/invoices');
    } catch (error: any) {
      console.error('Error saving invoice:', error);
      toast.error(error.message || t.common?.error);
    } finally {
      setIsSaving(false);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Enter to save
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        saveInvoice(false);
      }
      // Ctrl+S to save as draft
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        saveInvoice(true);
      }
      // Ctrl+N to add new line
      if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        addLine();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Initialize with one empty line (only for new invoices)
  useEffect(() => {
    if (!isEdit && lines.length === 0) {
      addLine();
    }
  }, [isEdit]);

  // Recalculate all lines when tax mode changes
  useEffect(() => {
    setLines(prev => prev.map(line => calculateLine(line)));
  }, [taxInclusive, calculateLine]);

  // Load invoice data when editing or viewing
  useEffect(() => {
    if ((!isEdit && !isView) || !id) return;

    const loadInvoice = async () => {
      setIsLoadingInvoice(true);
      try {
        // Fetch invoice data
        const res = await fetch(`/api/sales-invoice-with-details/${id}`, { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to load invoice');
        const invoice = await res.json();

        if (!invoice) {
          toast.error('لا يمكن عرض الفاتورة – الفاتورة غير موجودة');
          navigate('/sales/invoices');
          return;
        }

        // Set invoice status to determine edit permissions
        setLoadedInvoiceStatus(invoice.status || 'draft');
        
        // Show warning if trying to edit non-draft invoice
        if (!viewMode && invoice.status !== 'draft') {
          toast.warning('هذه الفاتورة غير قابلة للتعديل - يمكن تعديل المسودات فقط');
        }

        // Set invoice header data
        setCustomerId(invoice.customer_id || '');
        setBranchId(invoice.branch_id || '');
        setInvoiceDate(new Date(invoice.invoice_date));
        setDueDate(invoice.due_date ? new Date(invoice.due_date) : new Date());
        setDeliveryDate(invoice.delivery_date ? new Date(invoice.delivery_date) : new Date());
        setPaymentTerms(invoice.payment_terms || 'net30');
        setPaymentMethod(invoice.payment_method || '');
        setNotes(invoice.notes || '');

        // Fetch invoice items via API (handles both POS sale_items and regular sales_invoice_items)
        const itemParams: Record<string, string> = {};
        if (invoice.sale_id) {
          itemParams.sale_id = invoice.sale_id;
        } else {
          itemParams.invoice_id = id;
        }
        const itemsResponse = await fetch(`/api/sales-invoice-items?${new URLSearchParams(itemParams)}`);
        if (!itemsResponse.ok) throw new Error('Failed to fetch invoice items');
        const items = await itemsResponse.json();

        if (items && items.length > 0) {
          const loadedLines: InvoiceLine[] = items.map((item: any) => {
            const isPosItem = !!invoice.sale_id;
            const unitPrice = isPosItem ? (item.sale_price || 0) : (item.unit_price || 0);
            const quantity = isPosItem ? 1 : (item.quantity || 1);

            return {
              id: item.id || crypto.randomUUID(),
              productId: (item.jewelry_item_id || item.item_id) || item.product_id || '',
              productCode: item.jewelry_items?.item_code || '',
              description: item.description || item.jewelry_items?.description || '',
              branchId: invoice.branch_id || '',
              unit: 'piece',
              quantity,
              unitPrice,
              discountType: (item.discount_percentage > 0 ? 'percentage' : 'value') as 'percentage' | 'value',
              discountValue: item.discount_percentage > 0 ? item.discount_percentage : (item.discount_amount || 0),
              taxRate: DEFAULT_TAX_RATE,
              taxAmount: 0,
              subtotalBeforeDiscount: quantity * unitPrice,
              subtotalAfterDiscount: quantity * unitPrice,
              totalBeforeTax: quantity * unitPrice,
              total: 0,
              notes: '',
              availableStock: 999,
              goldWeight: item.jewelry_items?.g_weight || 0,
              source: ((item.jewelry_item_id || item.item_id) ? 'jewelry' : 'product') as 'jewelry' | 'product',
              isService: item.is_service || false,
            };
          });
          setLines(loadedLines.map(calculateLine));
        } else {
          addLine();
        }

        toast.success('تم تحميل بيانات الفاتورة');
      } catch (error: any) {
        console.error('Error loading invoice:', error);
        toast.error(error.message || t.common?.error || 'حدث خطأ في تحميل الفاتورة');
        navigate('/sales/invoices');
      } finally {
        setIsLoadingInvoice(false);
      }
    };

    loadInvoice();
  }, [isEdit, isView, id, navigate, t]);

  // Show loading state when loading invoice for edit/view
  if ((isEdit || isView) && isLoadingInvoice) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center space-y-4">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
            <p className="text-muted-foreground">جاري تحميل بيانات الفاتورة...</p>
          </div>
        </div>
      </MainLayout>
    );
  }

  // Get page title based on mode
  const getPageTitle = () => {
    if (isView) return 'عرض الفاتورة';
    if (isEdit) return t.salesInvoices?.editInvoice || 'تعديل الفاتورة';
    return t.salesInvoices?.newInvoice || 'فاتورة جديدة';
  };

  return (
    <MainLayout>
      <div className="rtl-mode content-full-width page-container space-y-6" ref={containerRef}>
        {/* Header */}
        <div className="page-header-rtl">
          <div>
            <h1 className="text-2xl font-bold">{getPageTitle()}</h1>
            <p className="text-sm text-muted-foreground">{t.salesInvoices?.referenceAuto}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate('/sales/invoices')}>
              {isView ? t.common?.back || 'رجوع' : t.common?.cancel}
            </Button>
            {isView ? (
              // Only show Edit button for draft invoices
              loadedInvoiceStatus === 'draft' && (
                <Button onClick={() => navigate(`/sales/invoices/${id}`)}>
                  <Pencil className="w-4 h-4 ml-2" />
                  {t.common?.edit || 'تعديل'}
                </Button>
              )
            ) : (
              <>
                <Button variant="outline" onClick={() => saveInvoice(true)} disabled={isSaving}>
                  {t.salesInvoices?.saveDraft}
                </Button>
                <Button onClick={() => saveInvoice(false)} disabled={isSaving}>
                  {isSaving && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
                  <Save className="w-4 h-4 ml-2" />
                  {t.salesInvoices?.saveInvoice}
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Keyboard shortcuts hint - hide in view mode */}
        {!isView && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 p-2 rounded-lg">
            <Keyboard className="w-4 h-4" />
            <span>اختصارات: Ctrl+Enter للحفظ | Ctrl+S مسودة | Ctrl+N سطر جديد | Ctrl+D نسخ السطر | Tab للتنقل</span>
          </div>
        )}

        {/* Validation Errors - hide in view mode */}
        {!isView && validationErrors.length > 0 && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <ul className="list-disc list-inside">
                {validationErrors.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Invoice Data */}
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>{t.salesInvoices?.invoiceData}</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Customer Selection */}
                <div className="space-y-2 sm:col-span-2">
                  <Label>{t.salesInvoices?.customer} *</Label>
                  {isView ? (
                    <div className="p-2 bg-muted rounded-md">
                      {selectedCustomer?.full_name || '-'}
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <CustomerCombobox
                          value={customerId}
                          onSelect={setCustomerId}
                          onAddNew={() => setShowCustomerDialog(true)}
                        />
                      </div>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              onClick={() => setShowCustomerDialog(true)}
                              className="shrink-0"
                            >
                              <UserPlus className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>إضافة عميل جديد</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  )}
                </div>

                {/* Issue Date */}
                <div className="space-y-2">
                  <Label>{t.salesInvoices?.issueDate} *</Label>
                  {isView ? (
                    <div className="p-2 bg-muted rounded-md">
                      {format(invoiceDate, 'yyyy-MM-dd')}
                    </div>
                  ) : (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full justify-start">
                          <CalendarIcon className="ml-2 h-4 w-4" />
                          {format(invoiceDate, 'yyyy-MM-dd')}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0">
                        <Calendar
                          mode="single"
                          selected={invoiceDate}
                          onSelect={(date) => date && setInvoiceDate(date)}
                          locale={language === 'ar' ? ar : undefined}
                        />
                      </PopoverContent>
                    </Popover>
                  )}
                </div>

                {/* Due Date */}
                <div className="space-y-2">
                  <Label>{t.salesInvoices?.dueDate} *</Label>
                  {isView ? (
                    <div className="p-2 bg-muted rounded-md">
                      {format(dueDate, 'yyyy-MM-dd')}
                    </div>
                  ) : (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full justify-start">
                          <CalendarIcon className="ml-2 h-4 w-4" />
                          {format(dueDate, 'yyyy-MM-dd')}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0">
                        <Calendar
                          mode="single"
                          selected={dueDate}
                          onSelect={(date) => date && setDueDate(date)}
                          locale={language === 'ar' ? ar : undefined}
                        />
                      </PopoverContent>
                    </Popover>
                  )}
                </div>

                {/* Payment Terms */}
                <div className="space-y-2">
                  <Label>{t.salesInvoices?.paymentTerms}</Label>
                  {isView ? (
                    <div className="p-2 bg-muted rounded-md">
                      {paymentTerms === 'immediate' && (t.salesInvoices?.immediate || 'فوري')}
                      {paymentTerms === 'net15' && (t.salesInvoices?.net15 || '15 يوم')}
                      {paymentTerms === 'net30' && (t.salesInvoices?.net30 || '30 يوم')}
                      {paymentTerms === 'net60' && (t.salesInvoices?.net60 || '60 يوم')}
                      {paymentTerms === 'net90' && (t.salesInvoices?.net90 || '90 يوم')}
                      {!paymentTerms && '-'}
                    </div>
                  ) : (
                    <Select value={paymentTerms} onValueChange={setPaymentTerms}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="immediate">{t.salesInvoices?.immediate}</SelectItem>
                        <SelectItem value="net15">{t.salesInvoices?.net15}</SelectItem>
                        <SelectItem value="net30">{t.salesInvoices?.net30}</SelectItem>
                        <SelectItem value="net60">{t.salesInvoices?.net60}</SelectItem>
                        <SelectItem value="net90">{t.salesInvoices?.net90}</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {/* Branch/Location */}
                <div className="space-y-2">
                  <Label>{t.salesInvoices?.location}</Label>
                  {isView ? (
                    <div className="p-2 bg-muted rounded-md">
                      {branches.find(b => b.id === branchId)?.branch_name || '-'}
                    </div>
                  ) : (
                    <Select value={branchId} onValueChange={setBranchId}>
                      <SelectTrigger>
                        <SelectValue placeholder={t.common?.select} />
                      </SelectTrigger>
                      <SelectContent>
                        {branches.map((branch) => (
                          <SelectItem key={branch.id} value={branch.id}>
                            {branch.branch_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {/* Payment Method */}
                <div className="space-y-2">
                  <Label>{t.salesInvoices?.paymentMethod}</Label>
                  {isView ? (
                    <div className="p-2 bg-muted rounded-md">
                      {paymentMethod === 'cash' && (t.pos?.cash || 'نقداً')}
                      {paymentMethod === 'card' && (t.pos?.card || 'بطاقة')}
                      {paymentMethod === 'bank_transfer' && (t.pos?.transfer || 'تحويل بنكي')}
                      {!paymentMethod && '-'}
                    </div>
                  ) : (
                    <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                      <SelectTrigger>
                        <SelectValue placeholder={t.common?.select} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">{t.pos?.cash || 'نقداً'}</SelectItem>
                        <SelectItem value="card">{t.pos?.card || 'بطاقة'}</SelectItem>
                        <SelectItem value="bank_transfer">{t.pos?.transfer || 'تحويل بنكي'}</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {/* Tax Inclusive Toggle */}
                <div className="flex items-center justify-between sm:col-span-2 p-3 bg-muted/50 rounded-lg">
                  <div>
                    <Label>{t.salesInvoices?.taxInclusive || 'الأسعار شاملة الضريبة'}</Label>
                    <p className="text-xs text-muted-foreground">
                      {taxInclusive 
                        ? 'الأسعار المدخلة تشمل ضريبة القيمة المضافة' 
                        : 'سيتم إضافة الضريبة على الأسعار المدخلة'}
                    </p>
                  </div>
                  <Switch checked={taxInclusive} onCheckedChange={setTaxInclusive} disabled={isView} />
                </div>
              </CardContent>
            </Card>

            {/* Invoice Lines */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>{t.salesInvoices?.invoiceItems}</CardTitle>
                {!isView && (
                  <Button size="sm" onClick={addLine}>
                    <Plus className="w-4 h-4 ml-2" />
                    {t.salesInvoices?.addMore}
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Table Header */}
                <div className="hidden lg:grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground pb-2 border-b">
                  <div className="col-span-3">{t.salesInvoices?.product}</div>
                  <div className="col-span-2">{t.salesInvoices?.productDescription}</div>
                  <div className="col-span-1 text-center">{t.salesInvoices?.quantity}</div>
                  <div className="col-span-1 text-center">{t.salesInvoices?.unitPrice}</div>
                  <div className="col-span-2 text-center">{t.salesInvoices?.discount}</div>
                  <div className="col-span-1 text-center">{t.salesInvoices?.taxAmount}</div>
                  <div className="col-span-1 text-center">{t.salesInvoices?.lineTotal}</div>
                  <div className="col-span-1"></div>
                </div>

                {/* Invoice Lines */}
                <div className="space-y-3">
                  {lines.map((line, index) => (
                    <SalesInvoiceLineRow
                      key={line.id}
                      line={line}
                      index={index}
                      branchId={branchId}
                      taxInclusive={taxInclusive}
                      defaultTaxRate={DEFAULT_TAX_RATE}
                      onUpdate={(updatedLine) => updateLine(index, updatedLine)}
                      onDuplicate={() => duplicateLine(index)}
                      onRemove={() => removeLine(index)}
                      canRemove={lines.length > 1}
                      readOnly={isView}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Invoice-Level Discount - hide in view mode or show as read-only */}
            {isView ? (
              invoiceDiscount > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>{t.salesInvoices?.invoiceDiscount || 'خصم الفاتورة'}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="p-2 bg-muted rounded-md text-sm">
                      {invoiceDiscountValue}{invoiceDiscountType === 'percentage' ? '%' : ' ر.س'}
                      {' = '}
                      {formatCurrency(invoiceDiscount)}
                    </div>
                  </CardContent>
                </Card>
              )
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>{t.salesInvoices?.invoiceDiscount || 'خصم الفاتورة'}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap items-end gap-4">
                    <div className="space-y-2">
                      <Label>{t.salesInvoices?.discountType || 'نوع الخصم'}</Label>
                      <Select 
                        value={invoiceDiscountType} 
                        onValueChange={(v) => setInvoiceDiscountType(v as 'value' | 'percentage')}
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="value">{t.salesInvoices?.discountValue || 'قيمة'}</SelectItem>
                          <SelectItem value="percentage">{t.salesInvoices?.discountPercentage || 'نسبة %'}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2 flex-1 max-w-xs">
                      <Label>
                        {invoiceDiscountType === 'percentage' 
                          ? (t.salesInvoices?.discountPercentage || 'نسبة الخصم %')
                          : (t.salesInvoices?.discountValue || 'قيمة الخصم')
                        }
                      </Label>
                      <Input
                        type="number"
                        min="0"
                        max={invoiceDiscountType === 'percentage' ? 100 : undefined}
                        value={invoiceDiscountValue}
                        onChange={(e) => setInvoiceDiscountValue(parseFloat(e.target.value) || 0)}
                        className="w-full"
                      />
                    </div>
                    {invoiceDiscount > 0 && (
                      <div className="text-sm text-muted-foreground">
                        = {formatCurrency(invoiceDiscount)}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right Sidebar */}
          <div className="space-y-6">
            {/* Customer Details */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="w-5 h-5" />
                  {t.salesInvoices?.customerData}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {selectedCustomer ? (
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t.common?.name}:</span>
                      <span className="font-medium">{selectedCustomer.full_name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t.common?.code}:</span>
                      <span className="font-mono">{selectedCustomer.customer_code}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t.common?.phone}:</span>
                      <span>{selectedCustomer.phone || '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t.common?.email}:</span>
                      <span className="text-xs">{selectedCustomer.email || '-'}</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t.customers?.totalPurchases}:</span>
                      <span className="font-mono">{formatCurrency(selectedCustomer.total_purchases || 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t.customers?.vatNumber}:</span>
                      <span className="font-mono text-xs">{selectedCustomer.vat_number || '-'}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm text-center py-4">
                    {t.salesInvoices?.selectCustomerFirst || 'اختر العميل لعرض بياناته'}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Summary */}
            <InvoiceSummary
              subtotalBeforeDiscount={linesSubtotal}
              lineDiscounts={linesDiscountTotal}
              invoiceDiscount={invoiceDiscount}
              totalBeforeTax={totalBeforeTax}
              totalTax={totalTax}
              grandTotal={grandTotal}
            />

            {/* Notes */}
            <Card>
              <CardHeader>
                <CardTitle>{t.common?.notes}</CardTitle>
              </CardHeader>
              <CardContent>
                {isView ? (
                  <div className="p-2 bg-muted rounded-md text-sm min-h-[80px]">
                    {notes || '-'}
                  </div>
                ) : (
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={t.common?.notes}
                    rows={4}
                  />
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Quick Customer Dialog */}
      <QuickCustomerDialog
        open={showCustomerDialog}
        onOpenChange={setShowCustomerDialog}
        onCustomerCreated={(newCustomerId) => {
          setCustomerId(newCustomerId);
          queryClient.invalidateQueries({ queryKey: ['customers'] });
          queryClient.invalidateQueries({ queryKey: ['customers-combobox'] });
        }}
      />
    </MainLayout>
  );
}
