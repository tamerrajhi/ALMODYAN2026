import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as dataGateway from '@/lib/dataGateway';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import MainLayout from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, Plus, Save, Loader2, User, SaveAll, RotateCcw } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import CustomerCombobox from '@/components/sales/CustomerCombobox';
import SalesInvoiceLineRow, { InvoiceLine } from '@/components/sales/SalesInvoiceLineRow';
import InvoiceSummary from '@/components/sales/InvoiceSummary';

const DEFAULT_TAX_RATE = 0.15;

interface Customer {
  id: string;
  full_name: string;
  customer_code: string;
  phone: string | null;
  email: string | null;
  vat_number: string | null;
}

interface SalesReturnFormPageProps {
  viewMode?: boolean;
}

const SalesReturnFormPage = ({ viewMode = false }: SalesReturnFormPageProps) => {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams();
  const location = useLocation();
  const queryInvoiceId = useMemo(() => new URLSearchParams(location.search).get('invoice_id') || '', [location.search]);
  const isEditing = !!id;

  // Form state
  const [returnDate, setReturnDate] = useState<Date>(new Date());
  const [customerId, setCustomerId] = useState<string>('');
  const [branchId, setBranchId] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [returnNumber, setReturnNumber] = useState('');
  const [linkedInvoiceId, setLinkedInvoiceId] = useState(queryInvoiceId);
  const [autoLoading, setAutoLoading] = useState(!!queryInvoiceId && !isEditing);
  const [taxInclusive, setTaxInclusive] = useState(false);
  
  // Invoice-level discount
  const [invoiceDiscountType, setInvoiceDiscountType] = useState<'value' | 'percentage'>('value');
  const [invoiceDiscountValue, setInvoiceDiscountValue] = useState(0);

  // Fetch branches
  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: async () => {
      const res = await fetch('/api/active-branches', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  // Fetch customers
  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => {
      const res = await fetch('/api/customers-full', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch');
      return (await res.json()) as Customer[];
    },
  });

  const selectedCustomer = customers.find(c => c.id === customerId);

  // Fetch original sales invoices for linking
  const { data: originalInvoices = [] } = useQuery({
    queryKey: ['sales-invoices-for-return', customerId],
    queryFn: async () => {
      if (!customerId) return [];
      const res = await fetch(`/api/sales-invoices-for-return?customer_id=${customerId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
    enabled: !!customerId,
  });

  // Auto-populate customer & branch from query param invoice_id
  useEffect(() => {
    if (!queryInvoiceId || isEditing) return;
    setAutoLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/invoice-with-customer/${queryInvoiceId}`, { credentials: 'include' });
        if (!res.ok) {
          toast.error('لم يتم العثور على الفاتورة المرتبطة');
          setAutoLoading(false);
          return;
        }
        const inv = await res.json();
        if (inv?.customer_id) setCustomerId(inv.customer_id);
        if (inv?.branch_id) setBranchId(inv.branch_id);
        setAutoLoading(false);
      } catch {
        toast.error('حدث خطأ في تحميل بيانات الفاتورة');
        setAutoLoading(false);
      }
    })();
  }, [queryInvoiceId, isEditing]);

  // State for original invoice lines and available quantities
  const [originalInvoiceLines, setOriginalInvoiceLines] = useState<{
    itemId: string;
    itemCode: string;
    description: string;
    quantity: number;
    unitPrice: number;
    taxRate: number;
    goldWeight: number;
    returnedQty: number;
    availableQty: number;
  }[]>([]);

  // Fetch original invoice lines when linked invoice changes
  useEffect(() => {
    const fetchOriginalInvoiceLines = async () => {
      if (!linkedInvoiceId) {
        setOriginalInvoiceLines([]);
        return;
      }

      try {
        const invoiceLinesRes = await fetch(`/api/sales-invoice-items-by-invoice/${linkedInvoiceId}`, { credentials: 'include' });
        if (!invoiceLinesRes.ok) throw new Error('Failed to fetch');
        const invoiceLines = await invoiceLinesRes.json();

        const returnInvoicesRes = await fetch(`/api/return-invoices-for-original/${linkedInvoiceId}`, { credentials: 'include' });
        const returnInvoices = await returnInvoicesRes.json();

        const returnedQtyMap: Record<string, number> = {};
        
        if (returnInvoices && returnInvoices.length > 0) {
          const returnIds = returnInvoices.map((r: any) => r.id);
          const returnLinesRes = await fetch('/api/return-line-items', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ invoiceIds: returnIds }),
          });
          const returnLines = await returnLinesRes.json();
          
          if (returnLines) {
            returnLines.forEach((line: any) => {
              if (line.jewelry_item_id) {
                returnedQtyMap[line.jewelry_item_id] = (returnedQtyMap[line.jewelry_item_id] || 0) + line.quantity;
              }
            });
          }
        }

        // Build available quantities
        const linesWithAvailable = (invoiceLines || []).map(line => ({
          itemId: line.jewelry_item_id || '',
          itemCode: '',
          description: line.description || '',
          quantity: line.quantity,
          unitPrice: line.unit_price,
          taxRate: line.tax_rate || DEFAULT_TAX_RATE,
          goldWeight: 0,
          returnedQty: returnedQtyMap[line.jewelry_item_id || ''] || 0,
          availableQty: line.quantity - (returnedQtyMap[line.jewelry_item_id || ''] || 0),
        }));

        setOriginalInvoiceLines(linesWithAvailable);

        // Auto-populate lines from original invoice if creating new return
        if (!isEditing && linesWithAvailable.length > 0) {
          const newLines: InvoiceLine[] = linesWithAvailable
            .filter(l => l.availableQty > 0)
            .map((origLine) => {
              const subtotal = origLine.availableQty * origLine.unitPrice;
              const taxAmount = subtotal * origLine.taxRate;
              const total = subtotal + taxAmount;
              
              return {
                id: crypto.randomUUID(),
                productId: origLine.itemId,
                productCode: origLine.itemCode,
                description: origLine.description,
                branchId: branchId || '',
                unit: 'piece',
                quantity: origLine.availableQty,
                unitPrice: origLine.unitPrice,
                discountType: 'value' as const,
                discountValue: 0,
                taxRate: origLine.taxRate,
                taxAmount,
                subtotalBeforeDiscount: subtotal,
                subtotalAfterDiscount: subtotal,
                totalBeforeTax: subtotal,
                total,
                notes: '',
                availableStock: 999,
                goldWeight: origLine.goldWeight,
                source: 'jewelry' as const,
                isService: false,
              };
            });

          if (newLines.length > 0) {
            setLines(newLines);
          }
        }
      } catch (error) {
        console.error('Error fetching original invoice lines:', error);
      }
    };

    fetchOriginalInvoiceLines();
  }, [linkedInvoiceId, isEditing, branchId]);

  // Validate quantity against available
  const validateReturnQuantity = useCallback((itemId: string, quantity: number): { valid: boolean; maxQty: number } => {
    if (!linkedInvoiceId || !itemId) {
      return { valid: true, maxQty: 999 };
    }
    
    const originalLine = originalInvoiceLines.find(l => l.itemId === itemId);
    if (!originalLine) {
      return { valid: true, maxQty: 999 };
    }
    
    return {
      valid: quantity <= originalLine.availableQty,
      maxQty: originalLine.availableQty,
    };
  }, [linkedInvoiceId, originalInvoiceLines]);

  // Generate return number
  const generateReturnNumber = async () => {
    try {
      const { data, error } = await dataGateway.rpc('generate_sales_return_number', {});
      if (error) {
        const today = format(new Date(), 'yyyyMMdd');
        const randomNum = Math.floor(Math.random() * 9000) + 1000;
        setReturnNumber(`SR-${today}-${randomNum}`);
        return;
      }
      if (data) {
        setReturnNumber(data);
      }
    } catch (error) {
      console.error('Error generating return number:', error);
      const today = format(new Date(), 'yyyyMMdd');
      const randomNum = Math.floor(Math.random() * 9000) + 1000;
      setReturnNumber(`SR-${today}-${randomNum}`);
    }
  };

  useEffect(() => {
    if (!isEditing) {
      generateReturnNumber();
    } else {
      loadReturn();
    }
  }, [id, isEditing]);

  const loadReturn = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/return-invoice/${id}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch');
      const { invoice, items: lineData } = await res.json();

      setReturnNumber(invoice.invoice_number);
      setCustomerId(invoice.customer_id || '');
      setBranchId(invoice.branch_id || '');
      setNotes(invoice.notes || '');
      setReturnDate(new Date(invoice.invoice_date));

      if (lineData) {
        setLines(lineData.map((item: any) => ({
          id: item.id,
          productId: item.jewelry_item_id || (item as any).product_id || '',
          productCode: '',
          description: item.description || '',
          branchId: branchId,
          unit: 'piece',
          quantity: item.quantity,
          unitPrice: item.unit_price,
          discountType: item.discount_percentage ? 'percentage' : 'value',
          discountValue: item.discount_percentage || item.discount_amount || 0,
          taxRate: item.tax_rate || DEFAULT_TAX_RATE,
          taxAmount: item.tax_amount,
          subtotalBeforeDiscount: item.quantity * item.unit_price,
          subtotalAfterDiscount: item.total_before_tax,
          totalBeforeTax: item.total_before_tax,
          total: item.total_amount,
          notes: '',
          availableStock: 999,
          goldWeight: 0,
          source: item.jewelry_item_id ? 'jewelry' as const : 'product' as const,
          isService: (item as any).is_service || false,
        })));
      }
    } catch (error) {
      console.error('Error loading return:', error);
      toast.error(t.common.error);
    } finally {
      setIsLoading(false);
    }
  };

  // Calculate line totals
  const calculateLine = useCallback((line: InvoiceLine): InvoiceLine => {
    const subtotal = line.quantity * line.unitPrice;
    
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
      availableStock: 999,
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

  // Calculate totals
  const linesSubtotal = lines.reduce((sum, line) => sum + line.subtotalBeforeDiscount, 0);
  const linesDiscountTotal = lines.reduce((sum, line) => sum + (line.subtotalBeforeDiscount - line.subtotalAfterDiscount), 0);
  
  const invoiceDiscount = invoiceDiscountType === 'percentage' 
    ? (linesSubtotal - linesDiscountTotal) * (invoiceDiscountValue / 100)
    : invoiceDiscountValue;
  
  const totalBeforeTax = lines.reduce((sum, line) => sum + line.totalBeforeTax, 0) - (taxInclusive ? 0 : invoiceDiscount);
  const totalTax = lines.reduce((sum, line) => sum + line.taxAmount, 0);
  const grandTotal = lines.reduce((sum, line) => sum + line.total, 0) - invoiceDiscount;
  const totalDiscounts = linesDiscountTotal + invoiceDiscount;

  // Idempotency: stable client request ID per submission
  const clientRequestIdRef = useRef<string>(crypto.randomUUID());
  const regenerateClientRequestId = () => {
    clientRequestIdRef.current = crypto.randomUUID();
  };

  // Save return via atomic RPC
  const saveReturn = async (closeAfterSave: boolean = false) => {
    if (viewMode) return;
    
    if (!customerId) {
      toast.error(language === 'ar' ? 'العميل مطلوب' : 'Customer is required');
      return;
    }

    const validLines = lines.filter(l => l.productId);
    if (validLines.length === 0) {
      toast.error(language === 'ar' ? 'يجب إضافة بند واحد على الأقل' : 'At least one item is required');
      return;
    }

    // Note: quantity validation is now handled by the RPC (OVER_RETURN_NOT_ALLOWED)

    setIsSaving(true);
    try {
      // Build payload for atomic RPC
      const payload = {
        client_request_id: clientRequestIdRef.current,
        branch_id: branchId || null,
        customer_id: customerId,
        linked_invoice_id: linkedInvoiceId || null,
        return_date: format(returnDate, 'yyyy-MM-dd'),
        notes,
        items: validLines.map(line => ({
          jewelry_item_id: line.productId || null,
          description: line.description,
          quantity: line.quantity,
          unit_price: line.unitPrice,
          tax_rate: line.taxRate,
          discount_amount: line.discountType === 'value' ? line.discountValue : 0,
          discount_percentage: line.discountType === 'percentage' ? line.discountValue : 0,
        })),
      };

      const { data: result, error } = await dataGateway.rpc('complete_erp_sales_return_atomic', {
        p_payload: payload
      });

      if (error) throw error;

      const rpcResult = result as {
        success: boolean;
        return_id?: string;
        return_number?: string;
        journal_entry_id?: string;
        errorCode?: string;
        error?: string;
      };

      if (!rpcResult.success) {
        // Map error codes to user-friendly messages
        const errorMessages: Record<string, string> = {
          'VALIDATION_ERROR': rpcResult.error || (language === 'ar' ? 'خطأ في البيانات' : 'Validation error'),
          'OVER_RETURN_NOT_ALLOWED': language === 'ar' ? 'الكمية المرتجعة تتجاوز المتاح' : 'Return quantity exceeds available',
          'ACCESS_DENIED': language === 'ar' ? 'لا يوجد صلاحية للفرع' : 'No access to this branch',
          'INVALID_INVOICE': language === 'ar' ? 'الفاتورة الأصلية غير موجودة' : 'Original invoice not found',
          'INVOICE_VOIDED': language === 'ar' ? 'لا يمكن الإرجاع من فاتورة ملغاة' : 'Cannot return from voided invoice',
        };
        const errorMsg = errorMessages[rpcResult.errorCode || ''] || rpcResult.error || 'Unknown error';
        throw new Error(errorMsg);
      }

      // Success - regenerate idempotency key for next submission
      regenerateClientRequestId();

      toast.success(language === 'ar' ? 'تم حفظ المرتجع بنجاح' : 'Return saved successfully');
      
      if (closeAfterSave) {
        navigate('/sales/returns');
      } else if (rpcResult.return_id) {
        navigate(`/sales/returns/${rpcResult.return_id}`, { replace: true });
      }
    } catch (error: any) {
      console.error('Error saving return:', error);
      toast.error(error.message || t.common.error);
    } finally {
      setIsSaving(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString(language === 'ar' ? 'ar-SA' : 'en-SA', {
      style: 'currency',
      currency: 'SAR',
      minimumFractionDigits: 2,
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
      <div className="rtl-mode content-full-width page-container space-y-6">
        {/* Header */}
        <div className="page-header-rtl">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/sales/returns')}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <RotateCcw className="w-6 h-6 text-blue-500" />
                {isEditing 
                  ? (language === 'ar' ? 'تعديل مرتجع مبيعات' : 'Edit Sales Return')
                  : (language === 'ar' ? 'مرتجع مبيعات جديد' : 'New Sales Return')}
              </h1>
              <p className="text-muted-foreground">
                {t.nav.sales} / {language === 'ar' ? 'مرتجعات المبيعات' : 'Sales Returns'}
              </p>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Customer Details Card */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <User className="w-5 h-5" />
                {language === 'ar' ? 'بيانات العميل' : 'Customer Details'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedCustomer ? (
                <>
                  <div>
                    <Label className="text-muted-foreground text-xs">{t.common.name}</Label>
                    <p className="font-medium">{selectedCustomer.full_name}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">{t.common.phone}</Label>
                    <p dir="ltr" className="text-start">{selectedCustomer.phone || '-'}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">{t.common.email}</Label>
                    <p dir="ltr" className="text-start">{selectedCustomer.email || '-'}</p>
                  </div>
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  {language === 'ar' ? 'اختر العميل أولاً' : 'Select customer first'}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Return Details */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg">
                {language === 'ar' ? 'تفاصيل المرتجع' : 'Return Details'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {autoLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    <span className="text-muted-foreground">جاري تحميل بيانات الفاتورة...</span>
                  </div>
                </div>
              ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{language === 'ar' ? 'رقم المرتجع' : 'Return Number'}</Label>
                  <Input
                    value={returnNumber}
                    readOnly
                    className="bg-muted"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{language === 'ar' ? 'تاريخ المرتجع' : 'Return Date'}</Label>
                  <Input
                    type="date"
                    value={format(returnDate, 'yyyy-MM-dd')}
                    onChange={(e) => setReturnDate(new Date(e.target.value))}
                    readOnly={viewMode}
                    className={viewMode ? 'bg-muted' : ''}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{language === 'ar' ? 'العميل' : 'Customer'} *</Label>
                  {viewMode ? (
                    <Input
                      value={selectedCustomer?.full_name || ''}
                      readOnly
                      className="bg-muted"
                    />
                  ) : (
                    <CustomerCombobox
                      value={customerId}
                      onSelect={(value) => {
                        setCustomerId(value);
                        setLinkedInvoiceId('');
                      }}
                      disabled={!!queryInvoiceId && !!customerId}
                    />
                  )}
                </div>
                {customerId && (
                  <div className="space-y-2">
                    <Label>{language === 'ar' ? 'الفاتورة الأصلية' : 'Original Invoice'}</Label>
                    <Select value={linkedInvoiceId} onValueChange={setLinkedInvoiceId} disabled={viewMode || (!!queryInvoiceId && !!linkedInvoiceId)}>
                      <SelectTrigger className={(viewMode || (!!queryInvoiceId && !!linkedInvoiceId)) ? 'bg-muted' : ''}>
                        <SelectValue placeholder={language === 'ar' ? 'اختر الفاتورة (اختياري)' : 'Select invoice (optional)'} />
                      </SelectTrigger>
                      <SelectContent>
                        {originalInvoices.map(inv => (
                          <SelectItem key={inv.id} value={inv.id}>
                            {inv.invoice_number} - {formatCurrency(inv.total_amount)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>{language === 'ar' ? 'الفرع' : 'Branch'}</Label>
                  <Select value={branchId} onValueChange={setBranchId} disabled={viewMode}>
                    <SelectTrigger className={viewMode ? 'bg-muted' : ''}>
                      <SelectValue placeholder={language === 'ar' ? 'اختر الفرع' : 'Select branch'} />
                    </SelectTrigger>
                    <SelectContent>
                      {branches.map(branch => (
                        <SelectItem key={branch.id} value={branch.id}>
                          {branch.branch_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>{language === 'ar' ? 'ملاحظات / سبب الإرجاع' : 'Notes / Return Reason'}</Label>
                  <Input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={language === 'ar' ? 'سبب الإرجاع...' : 'Return reason...'}
                    readOnly={viewMode}
                    className={viewMode ? 'bg-muted' : ''}
                  />
                </div>
              </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Return Items */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">
              {language === 'ar' ? 'بنود المرتجع' : 'Return Items'}
            </CardTitle>
            {!viewMode && (
              <Button onClick={addLine} size="sm" className="gap-2">
                <Plus className="w-4 h-4" />
                {language === 'ar' ? 'إضافة بند' : 'Add Item'}
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {lines.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {language === 'ar' ? 'لا توجد بنود' : 'No items'}
                </div>
              ) : viewMode ? (
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="p-2 text-start">{language === 'ar' ? 'الوصف' : 'Description'}</th>
                      <th className="p-2 text-center">{language === 'ar' ? 'الكمية' : 'Qty'}</th>
                      <th className="p-2 text-center">{language === 'ar' ? 'السعر' : 'Price'}</th>
                      <th className="p-2 text-center">{language === 'ar' ? 'الضريبة' : 'Tax'}</th>
                      <th className="p-2 text-center">{language === 'ar' ? 'الإجمالي' : 'Total'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <tr key={line.id} className="border-b">
                        <td className="p-2">{line.description}</td>
                        <td className="p-2 text-center">{line.quantity}</td>
                        <td className="p-2 text-center" dir="ltr">{formatCurrency(line.unitPrice)}</td>
                        <td className="p-2 text-center" dir="ltr">{formatCurrency(line.taxAmount)}</td>
                        <td className="p-2 text-center font-medium" dir="ltr">{formatCurrency(line.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                lines.map((line, index) => (
                  <SalesInvoiceLineRow
                    key={line.id}
                    line={line}
                    index={index}
                    branchId={branchId}
                    taxInclusive={taxInclusive}
                    defaultTaxRate={DEFAULT_TAX_RATE}
                    onUpdate={(updatedLine) => updateLine(index, updatedLine)}
                    onRemove={() => removeLine(index)}
                    onDuplicate={() => duplicateLine(index)}
                    canRemove={lines.length > 1}
                  />
                ))
              )}
            </div>
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

        {/* Totals Display */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex justify-end">
              <div className="w-full max-w-sm space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{language === 'ar' ? 'المجموع قبل الضريبة' : 'Subtotal'}</span>
                  <span className="font-medium" dir="ltr">{formatCurrency(totalBeforeTax)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{language === 'ar' ? 'الضريبة' : 'Tax'}</span>
                  <span className="font-medium" dir="ltr">{formatCurrency(totalTax)}</span>
                </div>
                <div className="flex justify-between border-t pt-3">
                  <span className="font-bold text-lg">{language === 'ar' ? 'الإجمالي' : 'Total'}</span>
                  <span className="font-bold text-lg text-blue-500" dir="ltr">
                    -{formatCurrency(grandTotal)}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => navigate('/sales/returns')}>
            {viewMode ? t.common.back : t.common.cancel}
          </Button>
          {viewMode ? (
            <Button onClick={() => navigate(`/sales/returns/${id}`)} className="gap-2">
              <Save className="w-4 h-4" />
              {t.common.edit}
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => saveReturn(false)} disabled={isSaving} className="gap-2">
                {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                <Save className="w-4 h-4" />
                {t.common.save}
              </Button>
              <Button onClick={() => saveReturn(true)} disabled={isSaving} className="gap-2">
                {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                <SaveAll className="w-4 h-4" />
                {language === 'ar' ? 'حفظ وإغلاق' : 'Save & Close'}
              </Button>
            </>
          )}
        </div>
      </div>
    </MainLayout>
  );
};

export default SalesReturnFormPage;
