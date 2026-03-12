import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useLanguage } from '@/contexts/LanguageContext';
import MainLayout from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Plus, Save, Loader2, Building2, SaveAll } from 'lucide-react';
import { toast } from 'sonner';
import { format, addDays } from 'date-fns';
import { UnifiedInvoiceLineRow, UnifiedInvoiceLine, calculateUnifiedLine } from '@/components/purchasing/UnifiedInvoiceLineRow';
import { ItemType } from '@/components/purchasing/UnifiedItemCombobox';
import { QuickSupplierDialog } from '@/components/purchasing/QuickSupplierDialog';
import {
  listSuppliersForSelect,
  listBranchesForSelect,
  listProductsForInvoiceForm,
  listCostEntriesForInvoiceForm,
  listPurchaseOrdersForImport,
  listPurchaseOrderItems,
  getPurchaseOrderForImport,
  getPurchaseInvoiceForEdit,
  listPurchaseInvoiceLinesForEdit,
  checkInvoiceReferenceDuplicate,
  type SupplierSelectDTO,
} from '@/domain/purchasing/purchasingReadService';
import {
  createPurchaseInvoiceAtomic,
  updatePurchaseInvoice,
  type AtomicCreatePurchaseInvoiceCommand,
  type AtomicPurchaseInvoiceLineInput,
} from '@/domain/purchasing';
import { UpdatePurchaseInvoiceCommand } from '@/domain/purchasing/commands';

const PurchaseInvoiceFormPage = () => {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = !!id;

  // Idempotency: stable request ID per save action
  const clientRequestIdRef = useRef<string | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showSupplierDialog, setShowSupplierDialog] = useState(false);
  const [selectedPOId, setSelectedPOId] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    reference: '',
    description: '',
    supplier_id: '',
    supplier_invoice_no: '',  // NEW: Supplier Invoice Number
    issue_date: format(new Date(), 'yyyy-MM-dd'),
    payment_terms: 'cash',
    due_date: format(new Date(), 'yyyy-MM-dd'),
    delivery_date: format(new Date(), 'yyyy-MM-dd'),
    branch_id: '',
    po_id: null as string | null,
  });

  // Helper function to create an empty line
  const createEmptyLine = useCallback((lineNumber: number = 1): UnifiedInvoiceLine => ({
    id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    line_number: lineNumber,
    item_id: null,
    item_type: null,
    item_code: '',
    description: '',
    quantity: 1,
    unit_price: 0,
    is_inclusive: false,
    discount_amount: 0,
    subtotal: 0,
    tax_rate: 15,
    tax_amount: 0,
    total_amount: 0,
    gl_account_id: null,
    warehouse_account_id: null,
  }), []);

  // Initialize with one empty line for new invoices
  const [lines, setLines] = useState<UnifiedInvoiceLine[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierSelectDTO | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Fetch suppliers via Read Service
  const { data: suppliers = [], refetch: refetchSuppliers } = useQuery({
    queryKey: ['suppliers-for-select'],
    queryFn: listSuppliersForSelect,
  });

  // Fetch branches via Read Service
  const { data: branches = [] } = useQuery({
    queryKey: ['branches-for-select'],
    queryFn: listBranchesForSelect,
  });

  // Fetch cost entries via Read Service
  const { data: costEntries = [] } = useQuery({
    queryKey: ['cost-entries-for-invoice-form'],
    queryFn: () => listCostEntriesForInvoiceForm(),
  });

  // Fetch products via Read Service
  const { data: products = [] } = useQuery({
    queryKey: ['products-for-invoice-form'],
    queryFn: () => listProductsForInvoiceForm(),
  });

  // Fetch purchase orders for import via Read Service
  const { data: purchaseOrders = [] } = useQuery({
    queryKey: ['purchase-orders-for-import', formData.supplier_id],
    queryFn: () => listPurchaseOrdersForImport({ 
      supplierId: formData.supplier_id || undefined 
    }),
    enabled: !isEditing,
  });


  // Fetch existing invoice if editing, load draft if copying, or initialize new invoice
  useEffect(() => {
    if (isEditing) {
      loadInvoice();
    } else {
      // Check for draft data from invoice copy
      const draftDataStr = sessionStorage.getItem('purchaseInvoiceDraft');
      if (draftDataStr) {
        try {
          const draftData = JSON.parse(draftDataStr);
          loadDraftData(draftData);
          // Clear the draft after loading
          sessionStorage.removeItem('purchaseInvoiceDraft');
          setIsInitialized(true);
          return; // Skip normal initialization
        } catch (e) {
          console.error('Error loading draft data:', e);
          sessionStorage.removeItem('purchaseInvoiceDraft');
        }
      }
      
      // Normal new invoice initialization - reference will be generated by write service
      if (!isInitialized) {
        setLines([createEmptyLine(1)]);
        setIsInitialized(true);
      }
    }
  }, [id, isEditing, isInitialized, createEmptyLine]);

  // Load draft data from invoice copy
  const loadDraftData = (draftData: any) => {
    // Reference will be generated by write service on save
    
    // Set form data
    setFormData(prev => ({
      ...prev,
      supplier_id: draftData.supplier_id || '',
      description: draftData.notes || '',
    }));

    // Set supplier
    if (draftData.supplier_id) {
      const supplier = suppliers.find(s => s.id === draftData.supplier_id);
      if (supplier) setSelectedSupplier(supplier);
    }

    // Set lines
    if (draftData.lines && draftData.lines.length > 0) {
      setLines(draftData.lines.map((line: any, idx: number) => ({
        id: `temp-${Date.now()}-${idx}`,
        line_number: idx + 1,
        item_id: line.item_id || line.product_id || line.cost_entry_id,
        item_type: line.item_type || 'cost',
        item_code: line.item_code || '',
        description: line.description || '',
        quantity: line.quantity || 1,
        unit_price: line.unit_price || 0,
        is_inclusive: line.is_inclusive || false,
        discount_amount: line.discount_amount || 0,
        subtotal: line.subtotal || 0,
        tax_rate: line.tax_rate || 15,
        tax_amount: line.tax_amount || 0,
        total_amount: line.total_amount || 0,
        gl_account_id: line.gl_account_id || null,
        warehouse_account_id: line.warehouse_account_id || null,
      })));
    } else {
      setLines([createEmptyLine(1)]);
    }

    toast.info(
      language === 'ar' 
        ? `تم تحميل بيانات الفاتورة المنسوخة من ${draftData.copyFromInvoice}. راجع البيانات ثم اضغط حفظ.`
        : `Invoice data copied from ${draftData.copyFromInvoice}. Review and click Save.`
    );
  };

  // Load invoice via Read Service
  const loadInvoice = async () => {
    if (!id) return;
    setIsLoading(true);
    try {
      // Fetch invoice header via Read Service
      const invoice = await getPurchaseInvoiceForEdit(id);
      if (!invoice) {
        toast.error(t.common.error);
        navigate('/purchasing/invoices');
        return;
      }

      setFormData({
        reference: invoice.invoiceNumber,
        description: invoice.notes || '',
        supplier_id: invoice.supplierId || '',
        supplier_invoice_no: invoice.supplierInvoiceNo || '',  // NEW: Load supplier invoice no
        issue_date: invoice.invoiceDate,
        payment_terms: 'cash',
        due_date: invoice.dueDate || invoice.invoiceDate,
        delivery_date: invoice.invoiceDate,
        branch_id: invoice.branchId || '',
        po_id: invoice.poId || null,
      });

      // Load lines via Read Service
      const lineData = await listPurchaseInvoiceLinesForEdit(id);

      if (lineData.length > 0) {
        setLines(lineData.map(line => ({
          id: line.id,
          line_number: line.lineNumber,
          item_id: line.productId,
          item_type: (line.itemType as ItemType) || 'cost',
          item_code: line.productCode || '',
          description: line.description || '',
          quantity: line.quantity,
          unit_price: line.unitPrice,
          is_inclusive: line.isInclusive,
          discount_amount: line.discountAmount,
          subtotal: line.subtotal,
          tax_rate: line.taxRate,
          tax_amount: line.taxAmount,
          total_amount: line.totalAmount,
          gl_account_id: line.glAccountId || null,
          warehouse_account_id: line.warehouseAccountId || null,
        })));
      }

      // Set supplier
      if (invoice.supplierId) {
        const supplier = suppliers.find(s => s.id === invoice.supplierId);
        if (supplier) setSelectedSupplier(supplier);
      }
    } catch (error) {
      console.error('Error loading invoice:', error);
      toast.error(t.common.error);
    } finally {
      setIsLoading(false);
    }
  };

  // Calculate due date based on payment terms
  const calculateDueDate = useCallback((issueDate: string, paymentTerms: string) => {
    const baseDate = new Date(issueDate);
    switch (paymentTerms) {
      case 'net30':
        return format(addDays(baseDate, 30), 'yyyy-MM-dd');
      case 'net60':
        return format(addDays(baseDate, 60), 'yyyy-MM-dd');
      case 'net90':
        return format(addDays(baseDate, 90), 'yyyy-MM-dd');
      case 'cash':
      default:
        return format(baseDate, 'yyyy-MM-dd');
    }
  }, []);

  // Handle payment terms change
  const handlePaymentTermsChange = (value: string) => {
    const newDueDate = calculateDueDate(formData.issue_date, value);
    setFormData(prev => ({ 
      ...prev, 
      payment_terms: value,
      due_date: newDueDate 
    }));
  };

  // Handle issue date change
  const handleIssueDateChange = (newDate: string) => {
    const newDueDate = calculateDueDate(newDate, formData.payment_terms);
    setFormData(prev => ({ 
      ...prev, 
      issue_date: newDate,
      due_date: newDueDate 
    }));
  };

  // Handle supplier change
  const handleSupplierChange = (supplierId: string) => {
    setFormData(prev => ({ ...prev, supplier_id: supplierId }));
    const supplier = suppliers.find(s => s.id === supplierId);
    setSelectedSupplier(supplier || null);
  };

  // Handle supplier created
  const handleSupplierCreated = (supplierId: string) => {
    refetchSuppliers().then(() => {
      handleSupplierChange(supplierId);
    });
  };

  // Import lines from Purchase Order via Read Service
  const importFromPO = async (poId: string) => {
    try {
      // Get PO items via Read Service
      const poItems = await listPurchaseOrderItems(poId);
      
      if (poItems.length === 0) {
        toast.error(language === 'ar' ? 'لا توجد بنود في أمر الشراء' : 'No items in purchase order');
        return;
      }

      // Get PO header via Read Service
      const po = await getPurchaseOrderForImport(poId);

      if (po?.supplierId && !formData.supplier_id) {
        handleSupplierChange(po.supplierId);
      }
      if (po?.branchId && !formData.branch_id) {
        setFormData(prev => ({ ...prev, branch_id: po.branchId! }));
      }

      const newLines: UnifiedInvoiceLine[] = poItems.map((item, idx) => ({
        id: `temp-${Date.now()}-${idx}`,
        line_number: idx + 1,
        item_id: null,
        item_type: (item.itemType as ItemType) || 'cost',
        item_code: '',
        description: item.description || '',
        quantity: item.quantity || 1,
        unit_price: item.unitPrice || 0,
        is_inclusive: false,
        discount_amount: 0,
        subtotal: (item.quantity || 1) * (item.unitPrice || 0),
        tax_rate: 15,
        tax_amount: ((item.quantity || 1) * (item.unitPrice || 0)) * 0.15,
        total_amount: ((item.quantity || 1) * (item.unitPrice || 0)) * 1.15,
        gl_account_id: null,
        warehouse_account_id: null,
        po_item_id: item.id,
      }));

      setLines(newLines);
      setFormData(prev => ({ ...prev, po_id: poId }));
      setSelectedPOId(poId);
      toast.success(language === 'ar' ? 'تم استيراد البنود من أمر الشراء' : 'Items imported from PO');
    } catch (err: any) {
      console.error('Error importing from PO:', err);
      toast.error(language === 'ar' ? 'فشل في استيراد البنود' : 'Failed to import items');
    }
  };

  // Add new line
  const addLine = useCallback(() => {
    setLines(prev => [...prev, createEmptyLine(prev.length + 1)]);
  }, [createEmptyLine]);

  // Update line
  const updateLine = (index: number, updatedLine: UnifiedInvoiceLine) => {
    setLines(prev => prev.map((line, i) => i === index ? updatedLine : line));
  };

  // Delete line - ensure at least one line remains
  const deleteLine = useCallback((index: number) => {
    setLines(prev => {
      const newLines = prev.filter((_, i) => i !== index);
      // If no lines remain, add a new empty line
      if (newLines.length === 0) {
        return [createEmptyLine(1)];
      }
      // Re-number remaining lines
      return newLines.map((line, i) => ({ ...line, line_number: i + 1 }));
    });
  }, [createEmptyLine]);

  // Calculate totals
  const totals = useMemo(() => {
    return {
      subtotal: lines.reduce((sum, l) => sum + (l.subtotal || 0), 0),
      taxAmount: lines.reduce((sum, l) => sum + (l.tax_amount || 0), 0),
      total: lines.reduce((sum, l) => sum + (l.total_amount || 0), 0),
    };
  }, [lines]);

  // Save invoice via atomic RPC
  const handleSave = async (closeAfterSave: boolean = false) => {
    // Validation: reference is now auto-generated for new invoices
    if (!formData.supplier_id) {
      toast.error(t.purchaseInvoices.supplierRequired);
      return;
    }
    if (!formData.branch_id) {
      toast.error(t.purchaseInvoices.locationRequired);
      return;
    }
    if (lines.length === 0) {
      toast.error(t.purchaseInvoices.linesRequired);
      return;
    }

    // Check that all lines have an item selected
    const linesWithoutItem = lines.filter(line => !line.item_id);
    if (linesWithoutItem.length > 0) {
      toast.error(language === 'ar' ? 'يجب اختيار صنف لجميع السطور' : 'All lines must have an item selected');
      return;
    }

    // Check that all cost/service lines have a linked expense account (gl_account_id)
    const costLinesWithoutAccount = lines.filter(
      line => line.item_type === 'cost' && !line.gl_account_id
    );
    if (costLinesWithoutAccount.length > 0) {
      toast.error(
        language === 'ar' 
          ? 'يجب ربط حساب المصروف لجميع بنود التكاليف والخدمات'
          : 'All cost/service lines must have a linked expense account'
      );
      return;
    }

    // Check that tax_rate is defined for all lines with tax_amount > 0
    const linesWithInvalidVat = lines.filter(
      line => line.tax_amount > 0 && (line.tax_rate === null || line.tax_rate === undefined || line.tax_rate === 0)
    );
    if (linesWithInvalidVat.length > 0) {
      toast.error(
        language === 'ar'
          ? 'يجب تحديد معدل الضريبة لجميع البنود التي تحتوي ضريبة'
          : 'Tax rate must be defined for all lines with tax amount'
      );
      return;
    }

    // ==========================================
    // SUPP INV NORMALIZE (optional for general purchases)
    // ==========================================
    const normalizedSuppInv = (formData.supplier_invoice_no || '').trim().toUpperCase();

    setIsSaving(true);

    // Tax rate safeguard: all lines must have tax_rate as percent (0-100), not fraction
    const suspiciousFractionLines = lines.filter(line => 
      line.tax_rate > 0 && line.tax_rate < 1
    );
    if (suspiciousFractionLines.length > 0) {
      console.error('[PurchaseInvoiceFormPage] TAX_RATE_FRACTION_ERROR: tax_rate appears to be a fraction instead of percent', {
        suspiciousLines: suspiciousFractionLines.map(l => ({ line: l.line_number, tax_rate: l.tax_rate }))
      });
      toast.error(
        language === 'ar'
          ? 'خطأ: معدل الضريبة يجب أن يكون نسبة مئوية (مثل 15) وليس كسر عشري'
          : 'Error: tax_rate must be a percentage (e.g. 15), not a fraction'
      );
      setIsSaving(false);
      return;
    }
    try {
      // Generate client request ID for idempotency (once per action)
      if (!clientRequestIdRef.current) {
        clientRequestIdRef.current = crypto.randomUUID();
      }

      // Build line DTOs for the atomic RPC
      // IMPORTANT: tax_rate is sent as PERCENT (e.g. 15), NOT fraction
      // RPC handles conversion internally: taxRate/100 for calculations
      const atomicLines: AtomicPurchaseInvoiceLineInput[] = lines.map((line) => ({
        item_id: line.item_id || undefined,
        item_code: line.item_code || undefined,
        description: line.description || undefined,
        qty: line.quantity || 1,
        unit_cost: line.unit_price || 0,
        tax_rate: line.tax_rate || 0, // PERCENT (15), NO division - RPC handles conversion
        discount_amount: line.discount_amount || 0,
        item_type: (line.item_type || 'cost') as 'jewelry' | 'product' | 'cost' | 'service' | 'imported_piece',
        gl_account_id: line.gl_account_id || undefined,
        cost_entry_id: line.item_type === 'cost' ? (line.item_id || undefined) : undefined,
        warehouse_id: undefined,
        line_notes: undefined,
      }));

      // ================================================================
      // EDIT MODE: Call updatePurchaseInvoice RPC
      // ================================================================
      if (isEditing && id) {
        const updateCmd: UpdatePurchaseInvoiceCommand = {
          id: id,
          supplierId: formData.supplier_id,
          invoiceDate: formData.issue_date,
          dueDate: formData.due_date,
          notes: formData.description || undefined,
          lines: lines.map((line) => ({
            lineNumber: line.line_number,
            itemType: (line.item_type || 'cost') as 'jewelry' | 'product' | 'cost' | 'service',
            itemId: line.item_id || undefined,
            itemCode: line.item_code || undefined,
            description: line.description || undefined,
            quantity: line.quantity || 1,
            unitPrice: line.unit_price || 0,
            taxRate: line.tax_rate || 0, // PERCENT (15)
            discountAmount: line.discount_amount || 0,
            isInclusive: line.is_inclusive || false,
            glAccountId: line.gl_account_id || undefined,
            warehouseAccountId: line.warehouse_account_id || undefined,
          })),
        };

        const updateResult = await updatePurchaseInvoice(updateCmd);
        
        if (!updateResult.success) {
          const errorCode = updateResult.error?.code || '';
          const errorMsg = updateResult.error?.message || '';
          
          // Handle specific error codes with user-friendly messages
          if (errorCode === 'JE_POSTED' || errorMsg.includes('posted')) {
            toast.error(
              language === 'ar'
                ? 'لا يمكن تعديل الفاتورة: القيد المحاسبي المرتبط تم ترحيله'
                : 'Cannot edit invoice: linked journal entry is posted'
            );
          } else if (errorCode === 'STATUS_LOCKED') {
            toast.error(
              language === 'ar'
                ? 'لا يمكن تعديل الفاتورة: حالة الفاتورة لا تسمح بالتعديل'
                : 'Cannot edit invoice: status does not allow updates'
            );
          } else if (errorCode === 'ACCESS_DENIED') {
            toast.error(
              language === 'ar'
                ? 'ليس لديك صلاحية تعديل هذه الفاتورة'
                : 'You do not have permission to edit this invoice'
            );
          } else if (errorCode === 'IDEMPOTENCY_CONFLICT') {
            toast.error(
              language === 'ar'
                ? 'تم استخدام نفس request id ببيانات مختلفة'
                : 'Same request ID used with different data'
            );
          } else {
            toast.error(errorMsg || (language === 'ar' ? 'فشل في تحديث الفاتورة' : 'Failed to update invoice'));
          }
          return;
        }

        // Reset request ID on success
        clientRequestIdRef.current = null;

        toast.success(
          language === 'ar'
            ? `تم تحديث الفاتورة بنجاح`
            : `Invoice updated successfully`
        );
        
        if (closeAfterSave) {
          navigate('/purchasing/invoices');
        } else {
          navigate(`/purchasing/invoices/view/${id}`, { replace: true });
        }
        return;
      }

      // ================================================================
      // CREATE MODE: Call createPurchaseInvoiceAtomic RPC
      // ================================================================
      const createCmd: AtomicCreatePurchaseInvoiceCommand = {
        client_request_id: clientRequestIdRef.current,
        created_by: undefined, // Will be set by RPC from auth context
        invoice: {
          supplier_id: formData.supplier_id,
          branch_id: formData.branch_id,
          invoice_date: formData.issue_date,
          due_date: formData.due_date,
          notes: formData.description || undefined,
          invoice_type: 'general',
          external_ref: formData.reference || undefined,
          supplier_invoice_no: normalizedSuppInv || undefined,
        },
        items: atomicLines,
      };

      const result = await createPurchaseInvoiceAtomic(createCmd);
      
      if (!result.success) {
        // Handle SUPP INV specific errors with Arabic messages
        if (result.error_code === 'SUPP_INV_REQUIRED') {
          toast.error(result.message_ar || 'مرفوض: رقم فاتورة المورد (SUPP INV) مطلوب');
        } else if (result.error_code === 'SUPP_INV_DUPLICATE') {
          toast.error(result.message_ar || 'مرفوض: رقم فاتورة المورد (SUPP INV) مكرر لنفس المورد — موجود بالفعل في النظام');
        } else if (result.error_code === 'IDEMPOTENCY_CONFLICT') {
          toast.error(
            language === 'ar'
              ? 'تم استخدام نفس request id ببيانات مختلفة'
              : 'Same request ID used with different data'
          );
        } else {
          toast.error(result.error || (language === 'ar' ? 'فشل في حفظ الفاتورة' : 'Failed to save invoice'));
        }
        return;
      }

      // Reset request ID on success
      clientRequestIdRef.current = null;

      const invoiceId = result.invoiceId;
      const invoiceNumber = result.invoiceNumber || '';

      toast.success(
        language === 'ar'
          ? `تم إنشاء الفاتورة ${invoiceNumber} بنجاح`
          : `Invoice ${invoiceNumber} created successfully`
      );
      
      if (closeAfterSave) {
        navigate('/purchasing/invoices');
      } else if (invoiceId) {
        // Stay on page but switch to view mode
        navigate(`/purchasing/invoices/view/${invoiceId}`, { replace: true });
      }
    } catch (error: any) {
      console.error('Error saving invoice:', error);
      toast.error(
        language === 'ar'
          ? `حدث خطأ أثناء الحفظ: ${error?.message || ''}`
          : `Error while saving: ${error?.message || ''}`
      );
    } finally {
      setIsSaving(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString(language === 'ar' ? 'ar-SA' : 'en-SA', {
      style: 'currency',
      currency: 'SAR',
      minimumFractionDigits: 2
    });
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

  return (
    <MainLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/purchasing/invoices')}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">
                {isEditing ? t.purchaseInvoices.edit : t.purchaseInvoices.createNew}
              </h1>
              <p className="text-muted-foreground">{t.nav.purchases} / {t.purchaseInvoices.title}</p>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Supplier Details Card (Left) */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Building2 className="w-5 h-5" />
                {t.purchaseInvoices.supplierDetails}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedSupplier ? (
                <>
                  <div>
                    <Label className="text-muted-foreground text-xs">{t.common.name}</Label>
                    <p className="font-medium">{selectedSupplier.supplierName}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">{t.common.phone}</Label>
                    <p dir="ltr" className="text-start">{selectedSupplier.phone || '-'}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">{t.common.email}</Label>
                    <p dir="ltr" className="text-start">{selectedSupplier.email || '-'}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">{t.purchaseInvoices.vatNumber}</Label>
                    <p dir="ltr" className="text-start">{selectedSupplier.vatNumber || '-'}</p>
                  </div>
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  {t.purchaseInvoices.selectSupplierFirst}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Invoice Header Fields (Right) */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg">{t.purchaseInvoices.invoiceDetails}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t.purchaseInvoices.reference} *</Label>
                  <Input
                    value={formData.reference}
                    onChange={(e) => setFormData(prev => ({ ...prev, reference: e.target.value }))}
                    placeholder="PI-YYYYMMDD-0001"
                    readOnly={!isEditing}
                    className={!isEditing ? 'bg-muted' : ''}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t.purchaseInvoices.invoiceDescription} *</Label>
                  <Input
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    placeholder={t.purchaseInvoices.descriptionPlaceholder}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{language === 'ar' ? 'رقم فاتورة المورد' : 'Supplier Invoice No'}</Label>
                  <Input
                    value={formData.supplier_invoice_no}
                    onChange={(e) => setFormData(prev => ({ ...prev, supplier_invoice_no: e.target.value }))}
                    placeholder={language === 'ar' ? 'رقم الفاتورة من المورد' : 'Invoice number from supplier'}
                    data-testid="input-supplier-invoice-no"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t.purchaseInvoices.supplier} *</Label>
                  <div className="flex gap-2">
                    <Select value={formData.supplier_id} onValueChange={handleSupplierChange}>
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder={t.purchaseInvoices.selectSupplier} />
                      </SelectTrigger>
                      <SelectContent>
                        {suppliers.map(supplier => (
                          <SelectItem key={supplier.id} value={supplier.id}>
                            {supplier.supplierName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button variant="outline" size="icon" onClick={() => setShowSupplierDialog(true)}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                
                {/* Import from PO - only for new invoices */}
                {!isEditing && purchaseOrders.length > 0 && (
                  <div className="space-y-2 md:col-span-2">
                    <Label>{language === 'ar' ? 'استيراد من أمر شراء' : 'Import from Purchase Order'}</Label>
                    <div className="flex gap-2">
                      <Select
                        value={selectedPOId || ''}
                        onValueChange={(poId) => {
                          if (poId) importFromPO(poId);
                        }}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder={language === 'ar' ? 'اختر أمر شراء للاستيراد...' : 'Select PO to import...'} />
                        </SelectTrigger>
                        <SelectContent>
                          {purchaseOrders.map((po) => (
                            <SelectItem key={po.id} value={po.id}>
                              {po.poNumber} - {po.supplierName || ''} ({po.totalAmount?.toLocaleString()} ر.س)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {selectedPOId && (
                      <p className="text-xs text-muted-foreground">
                        {language === 'ar' ? 'تم ربط الفاتورة بأمر الشراء' : 'Invoice linked to PO'}
                      </p>
                    )}
                  </div>
                )}
                
                <div className="space-y-2">
                  <Label>{t.purchaseInvoices.issueDate} *</Label>
                  <Input
                    type="date"
                    value={formData.issue_date}
                    onChange={(e) => handleIssueDateChange(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t.purchaseInvoices.paymentTerms}</Label>
                  <Select 
                    value={formData.payment_terms} 
                    onValueChange={handlePaymentTermsChange}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">{t.purchaseInvoices.cash}</SelectItem>
                      <SelectItem value="net30">{t.purchaseInvoices.net30}</SelectItem>
                      <SelectItem value="net60">{t.purchaseInvoices.net60}</SelectItem>
                      <SelectItem value="net90">{t.purchaseInvoices.net90}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t.purchaseInvoices.dueDate} *</Label>
                  <Input
                    type="date"
                    value={formData.due_date}
                    onChange={(e) => setFormData(prev => ({ ...prev, due_date: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t.purchaseInvoices.deliveryDate} *</Label>
                  <Input
                    type="date"
                    value={formData.delivery_date}
                    onChange={(e) => setFormData(prev => ({ ...prev, delivery_date: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t.purchaseInvoices.location} *</Label>
                  <Select 
                    value={formData.branch_id} 
                    onValueChange={(value) => setFormData(prev => ({ ...prev, branch_id: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t.purchaseInvoices.selectLocation} />
                    </SelectTrigger>
                    <SelectContent>
                      {branches.map(branch => (
                        <SelectItem key={branch.id} value={branch.id}>
                          {branch.branchName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Invoice Lines */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">{t.purchaseInvoices.invoiceLines}</CardTitle>
            <Button onClick={addLine} size="sm" className="gap-2">
              <Plus className="w-4 h-4" />
              {t.purchaseInvoices.addLine}
            </Button>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px]">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="p-2 text-center w-12">#</th>
                    <th className="p-2 text-start">{language === 'ar' ? 'المنتج' : 'Product'}</th>
                    <th className="p-2 text-start">{language === 'ar' ? 'الوصف' : 'Description'}</th>
                    <th className="p-2 text-center">{language === 'ar' ? 'الكمية' : 'Qty'}</th>
                    <th className="p-2 text-center">{language === 'ar' ? 'سعر الوحدة' : 'Unit Price'}</th>
                    <th className="p-2 text-center">{language === 'ar' ? 'شامل؟' : 'Incl?'}</th>
                    <th className="p-2 text-center">{language === 'ar' ? 'الخصم' : 'Discount'}</th>
                    <th className="p-2 text-center">{language === 'ar' ? 'الإجمالي قبل الضريبة' : 'Subtotal'}</th>
                    <th className="p-2 text-center">{language === 'ar' ? 'نسبة الضريبة' : 'Tax %'}</th>
                    <th className="p-2 text-center">{language === 'ar' ? 'قيمة الضريبة' : 'Tax Amt'}</th>
                    <th className="p-2 text-center">{language === 'ar' ? 'الإجمالي' : 'Total'}</th>
                    <th className="p-2 text-center w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => (
                    <UnifiedInvoiceLineRow
                      key={line.id}
                      line={line}
                      onUpdate={(updatedLine) => updateLine(index, updatedLine)}
                      onDelete={() => deleteLine(index)}
                      jewelryItems={[]}
                      costEntries={costEntries.map(c => ({ id: c.id, cost_code: c.costCode, name_ar: c.nameAr, cost_type: c.costType, gl_account_id: c.glAccountId, tax_rate: c.taxRate }))}
                      products={products.map(p => ({ id: p.id, product_code: p.productCode, name_ar: p.nameAr, product_type: p.productType, inventory_account_id: p.inventoryAccountId, expense_account_id: p.expenseAccountId, tax_rate: p.taxRate }))}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Totals */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-end gap-2">
              <div className="flex justify-between w-full max-w-xs">
                <span className="text-muted-foreground">{t.purchaseInvoices.subtotal}:</span>
                <span className="font-medium">{formatCurrency(totals.subtotal)}</span>
              </div>
              <div className="flex justify-between w-full max-w-xs">
                <span className="text-muted-foreground">{language === 'ar' ? 'ضريبة القيمة المضافة' : 'VAT'} (15%):</span>
                <span className="font-medium">{formatCurrency(totals.taxAmount)}</span>
              </div>
              <div className="flex justify-between w-full max-w-xs border-t pt-2">
                <span className="font-bold">{t.purchaseInvoices.totalAmount}:</span>
                <span className="font-bold text-lg">{formatCurrency(totals.total)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex justify-end gap-4">
          <Button variant="outline" onClick={() => navigate('/purchasing/invoices')}>
            {t.common.cancel}
          </Button>
          <Button onClick={() => handleSave(false)} disabled={isSaving} className="gap-2">
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {t.common.save}
          </Button>
          <Button onClick={() => handleSave(true)} disabled={isSaving} variant="secondary" className="gap-2">
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <SaveAll className="w-4 h-4" />}
            {language === 'ar' ? 'حفظ وإغلاق' : 'Save & Close'}
          </Button>
        </div>
      </div>

      {/* Dialogs */}
      <QuickSupplierDialog
        open={showSupplierDialog}
        onOpenChange={setShowSupplierDialog}
        onSupplierCreated={handleSupplierCreated}
      />
    </MainLayout>
  );
};

export default PurchaseInvoiceFormPage;