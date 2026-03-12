/**
 * Purchase Return - General (Quantity-Based)
 * 
 * This screen handles returns of products, costs, and services.
 * Users specify the quantity to return for each line (partial allowed).
 * 
 * PR-1: Wired to atomic RPC with idempotency
 * PR-12: E2E Hardening with strict UI validation + error mapping
 */

import { useState, useMemo, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { 
  ArrowRight, 
  RotateCcw, 
  Package, 
  Loader2,
  AlertCircle,
  CheckCircle,
  FileText,
  ExternalLink,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { 
  getInvoiceForGeneralReturn, 
  calculateGeneralReturnTotals 
} from '@/domain/purchasing/returnReadService';
import { createPurchaseReturnGeneralAtomic } from '@/domain/purchasing/purchasingWriteService';
import { RETURN_REASONS } from '@/domain/purchasing/dto/returnScreenDTOs';
import type { InvoiceLineForReturnDTO } from '@/domain/purchasing/dto/returnScreenDTOs';
import type { AtomicCreatePurchaseReturnGeneralCommand, AtomicPurchaseReturnLineInput } from '@/domain/purchasing/commands';

// ===========================
// Error Code Mappings (B)
// ===========================
const ERROR_MESSAGES: Record<string, { ar: string; en: string }> = {
  QUANTITY_EXCEEDED: {
    ar: 'الكمية المطلوبة أكبر من المتاحة',
    en: 'Requested quantity exceeds available quantity',
  },
  CONCURRENT_LOCK: {
    ar: 'يوجد عملية أخرى على نفس الفاتورة، أعد المحاولة',
    en: 'Another operation is in progress on this invoice, please retry',
  },
  IDEMPOTENCY_CONFLICT: {
    ar: 'تم استخدام رقم طلب مكرر ببيانات مختلفة',
    en: 'Duplicate request ID with different payload',
  },
  VALIDATION_ERROR: {
    ar: 'خطأ في البيانات المدخلة',
    en: 'Validation error in input data',
  },
  RPC_ERROR: {
    ar: 'خطأ في الخادم، يرجى المحاولة لاحقاً',
    en: 'Server error, please try again later',
  },
};

function getErrorMessage(errorCode: string | undefined, error: string | undefined, language: 'ar' | 'en'): string {
  if (errorCode && ERROR_MESSAGES[errorCode]) {
    return ERROR_MESSAGES[errorCode][language];
  }
  return error || (language === 'ar' ? 'حدث خطأ غير متوقع' : 'An unexpected error occurred');
}

// ===========================
// Success Result Type
// ===========================
interface ReturnSuccessResult {
  returnId: string;
  returnNumber: string;
  journalEntryId?: string;
  journalEntryNumber?: string;
}

export default function PurchaseReturnGeneralPage() {
  const { language } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const invoiceId = searchParams.get('invoiceId');

  // Idempotency: stable request ID per action attempt
  const requestIdRef = useRef<string | null>(null);
  const isSubmittingRef = useRef(false);

  // Form state
  const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({});
  const [returnReason, setReturnReason] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Success dialog state
  const [successResult, setSuccessResult] = useState<ReturnSuccessResult | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  // Fetch invoice with lines
  const { data: invoiceData, isLoading, error } = useQuery({
    queryKey: ['invoice-for-general-return', invoiceId],
    queryFn: () => getInvoiceForGeneralReturn(invoiceId!),
    enabled: !!invoiceId,
  });

  // Filter returnable lines
  const returnableLines = useMemo(() => {
    return invoiceData?.lines.filter(line => line.isReturnable) || [];
  }, [invoiceData]);

  // Calculate totals
  const totals = useMemo(() => {
    return calculateGeneralReturnTotals(returnableLines, returnQuantities);
  }, [returnableLines, returnQuantities]);

  // Handle quantity change
  const handleQuantityChange = (lineId: string, value: string, maxQty: number) => {
    const numValue = parseFloat(value) || 0;
    const clampedValue = Math.min(Math.max(0, numValue), maxQty);
    
    setReturnQuantities(prev => ({
      ...prev,
      [lineId]: clampedValue,
    }));
  };

  // Set all to max
  const handleReturnAll = () => {
    const allMax: Record<string, number> = {};
    returnableLines.forEach(line => {
      allMax[line.id] = line.availableQty;
    });
    setReturnQuantities(allMax);
  };

  // Clear all
  const handleClearAll = () => {
    setReturnQuantities({});
  };

  // Get item type label
  const getItemTypeLabel = (type: InvoiceLineForReturnDTO['itemType']) => {
    switch (type) {
      case 'product':
        return language === 'ar' ? 'منتج' : 'Product';
      case 'cost':
        return language === 'ar' ? 'تكلفة' : 'Cost';
      case 'service':
        return language === 'ar' ? 'خدمة' : 'Service';
      default:
        return type;
    }
  };

  // ===========================
  // UI Validation Helpers (C)
  // ===========================
  
  // Validate a single line quantity
  const validateLineQuantity = (lineId: string): { valid: boolean; error?: string } => {
    const line = returnableLines.find(l => l.id === lineId);
    if (!line) return { valid: false, error: 'Line not found' };
    
    const returnQty = returnQuantities[lineId] || 0;
    if (returnQty <= 0) return { valid: true }; // Not selected
    
    if (returnQty > line.availableQty) {
      return {
        valid: false,
        error: language === 'ar' 
          ? `الحد الأقصى: ${line.availableQty}` 
          : `Maximum: ${line.availableQty}`,
      };
    }
    
    return { valid: true };
  };
  
  // Check if any line has over-limit quantity
  const hasOverLimitQuantities = useMemo(() => {
    return returnableLines.some(line => {
      const returnQty = returnQuantities[line.id] || 0;
      return returnQty > line.availableQty;
    });
  }, [returnableLines, returnQuantities]);

  // Handle confirm return - PR-1 atomic with idempotency + PR-12 hardening
  const handleConfirmReturn = async () => {
    // === STRICT UI GUARDS (C) ===
    
    // Prevent double submit
    if (isSubmittingRef.current) {
      console.warn('[ReturnGeneral] Blocked duplicate submit');
      return;
    }
    
    if (!invoiceData || !user) {
      toast({
        variant: 'destructive',
        title: language === 'ar' ? 'خطأ' : 'Error',
        description: language === 'ar' ? 'بيانات الفاتورة أو المستخدم غير متوفرة' : 'Invoice or user data not available',
      });
      return;
    }

    // Guard: block if branchId is missing (required by RPC)
    if (!invoiceData.branchId) {
      toast({
        variant: 'destructive',
        title: language === 'ar' ? 'خطأ في البيانات' : 'Data Error',
        description: language === 'ar' 
          ? 'الفاتورة لا تحتوي على فرع. لا يمكن إنشاء المرتجع.'
          : 'Invoice is missing branch information. Cannot create return.',
      });
      return;
    }

    if (!invoiceData.id) {
      toast({
        variant: 'destructive',
        title: language === 'ar' ? 'خطأ في البيانات' : 'Data Error',
        description: language === 'ar' 
          ? 'معرف الفاتورة مفقود'
          : 'Invoice ID is missing',
      });
      return;
    }

    // Filter lines with returnQty > 0
    const linesToReturn = returnableLines.filter(line => {
      const qty = returnQuantities[line.id] || 0;
      return qty > 0;
    });

    if (linesToReturn.length === 0) {
      toast({
        variant: 'destructive',
        title: language === 'ar' ? 'لم يتم اختيار أصناف' : 'No Items Selected',
        description: language === 'ar' 
          ? 'يرجى إدخال كمية إرجاع لصنف واحد على الأقل'
          : 'Please enter a return quantity for at least one item',
      });
      return;
    }
    
    // Validate each line quantity BEFORE sending to RPC (C)
    for (const line of linesToReturn) {
      const returnQty = returnQuantities[line.id] || 0;
      if (returnQty > line.availableQty) {
        toast({
          variant: 'destructive',
          title: language === 'ar' ? 'كمية غير صالحة' : 'Invalid Quantity',
          description: language === 'ar' 
            ? `البند "${line.productCode || line.description}": الكمية ${returnQty} أكبر من المتاح ${line.availableQty}`
            : `Line "${line.productCode || line.description}": quantity ${returnQty} exceeds available ${line.availableQty}`,
        });
        return;
      }
    }

    // Generate request ID once per action attempt
    if (!requestIdRef.current) {
      requestIdRef.current = crypto.randomUUID();
    }

    // Block further submits
    isSubmittingRef.current = true;
    setIsSubmitting(true);

    try {
      // Build items array - RPC expects 'items' key with invoice_line_id (REQUIRED) (A)
      const items: AtomicPurchaseReturnLineInput[] = linesToReturn.map((line) => ({
        invoice_line_id: line.id,  // REQUIRED per contract
        item_id: line.productId || line.costEntryId || undefined,
        item_code: line.productCode,
        description: line.description,
        item_type: line.itemType,
        qty: returnQuantities[line.id],
        unit_price: line.unitPrice,
        tax_rate: line.taxRate,
        reason: returnReason,
      }));

      // Build command with NESTED return object (matches RPC contract)
      const cmd: AtomicCreatePurchaseReturnGeneralCommand = {
        client_request_id: requestIdRef.current,
        created_by: user.email || user.id,
        return: {
          branch_id: invoiceData.branchId,
          purchase_invoice_id: invoiceData.id,
          supplier_id: invoiceData.supplierId || null,
          return_date: new Date().toISOString().slice(0, 10),
          reason: returnReason || undefined,
          notes: notes || null,
        },
        items,
      };

      // DEV-only payload assertion
      if (import.meta.env.DEV) {
        const isValidUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        console.log('[ReturnGeneral payload]', JSON.stringify(cmd, null, 2));
        console.assert(
          cmd.return?.branch_id && isValidUUID.test(cmd.return.branch_id),
          'ASSERTION FAILED: cmd.return.branch_id must be a valid UUID'
        );
        // Assert invoice_line_id is present for all items
        items.forEach((item, idx) => {
          console.assert(
            item.invoice_line_id && isValidUUID.test(item.invoice_line_id),
            `ASSERTION FAILED: items[${idx}].invoice_line_id must be a valid UUID`
          );
        });
      }

      const result = await createPurchaseReturnGeneralAtomic(cmd);

      if (result.success) {
        // Reset request ID on success
        requestIdRef.current = null;

        // Store success result and show dialog (C)
        setSuccessResult({
          returnId: result.returnId || '',
          returnNumber: result.returnNumber || '',
          journalEntryId: result.journalEntryId,
          journalEntryNumber: result.journalEntryNumber,
        });
        setShowSuccessDialog(true);

        // Invalidate queries
        queryClient.invalidateQueries({ queryKey: ['purchase-returns'] });
        queryClient.invalidateQueries({ queryKey: ['invoice-for-general-return'] });
        queryClient.invalidateQueries({ queryKey: ['purchase-invoices'] });
      } else {
        // Map error codes to user-friendly messages (B)
        const errorMessage = getErrorMessage(result.error_code, result.error, language as 'ar' | 'en');
        throw new Error(errorMessage);
      }
    } catch (err) {
      console.error('Return creation failed:', err);
      // Reset request ID on error to allow retry
      requestIdRef.current = null;
      
      toast({
        variant: 'destructive',
        title: language === 'ar' ? 'فشل إنشاء المرتجع' : 'Return Creation Failed',
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  // Handle success dialog actions
  const handleOpenReturn = () => {
    if (successResult?.returnId) {
      navigate(`/purchasing/returns-hub/r/${successResult.returnId}`);
    }
    setShowSuccessDialog(false);
  };
  
  const handleBackToList = () => {
    setShowSuccessDialog(false);
    navigate('/purchasing/returns');
  };

  // Check if any quantity is set
  const hasReturnQuantities = Object.values(returnQuantities).some(qty => qty > 0);

  // Error state
  if (!invoiceId) {
    return (
      <MainLayout>
        <div className="p-8">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {language === 'ar' 
                ? 'معرف الفاتورة مطلوب' 
                : 'Invoice ID is required'}
            </AlertDescription>
          </Alert>
        </div>
      </MainLayout>
    );
  }

  if (error) {
    return (
      <MainLayout>
        <div className="p-8">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {language === 'ar' 
                ? 'فشل في تحميل بيانات الفاتورة' 
                : 'Failed to load invoice data'}
            </AlertDescription>
          </Alert>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => navigate('/purchasing/returns')}
            >
              <ArrowRight className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <RotateCcw className="w-6 h-6 text-amber-600" />
                {language === 'ar' ? 'مرتجع مشتريات - كميات' : 'Purchase Return - Quantities'}
              </h1>
              <p className="text-muted-foreground text-sm">
                {language === 'ar' 
                  ? 'حدد الكميات المراد إرجاعها للمورد' 
                  : 'Specify quantities to return to supplier'}
              </p>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : invoiceData ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Content - Lines Table */}
            <div className="lg:col-span-2 space-y-6">
              {/* Invoice Info */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    {language === 'ar' ? 'معلومات الفاتورة الأصلية' : 'Original Invoice Info'}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">
                        {language === 'ar' ? 'رقم الفاتورة' : 'Invoice No.'}
                      </span>
                      <p className="font-medium">{invoiceData.invoiceNumber}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        {language === 'ar' ? 'التاريخ' : 'Date'}
                      </span>
                      <p className="font-medium">{invoiceData.invoiceDate}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        {language === 'ar' ? 'المورد' : 'Supplier'}
                      </span>
                      <p className="font-medium">{invoiceData.supplierName}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        {language === 'ar' ? 'الفرع' : 'Branch'}
                      </span>
                      <p className="font-medium">{invoiceData.branchName}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Lines Table */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">
                      {language === 'ar' ? 'بنود الفاتورة' : 'Invoice Lines'}
                    </CardTitle>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={handleReturnAll}>
                        {language === 'ar' ? 'إرجاع الكل' : 'Return All'}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={handleClearAll}>
                        {language === 'ar' ? 'مسح' : 'Clear'}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {returnableLines.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
                      <p>{language === 'ar' ? 'لا توجد بنود قابلة للإرجاع' : 'No returnable lines'}</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{language === 'ar' ? 'النوع' : 'Type'}</TableHead>
                          <TableHead>{language === 'ar' ? 'الوصف' : 'Description'}</TableHead>
                          <TableHead className="text-center">{language === 'ar' ? 'الأصلي' : 'Original'}</TableHead>
                          <TableHead className="text-center">{language === 'ar' ? 'المرتجع' : 'Returned'}</TableHead>
                          <TableHead className="text-center">{language === 'ar' ? 'المتاح' : 'Available'}</TableHead>
                          <TableHead className="text-center">{language === 'ar' ? 'للإرجاع' : 'To Return'}</TableHead>
                          <TableHead>{language === 'ar' ? 'سعر الوحدة' : 'Unit Price'}</TableHead>
                          <TableHead>{language === 'ar' ? 'الإجمالي' : 'Line Total'}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {returnableLines.map((line) => {
                          const returnQty = returnQuantities[line.id] || 0;
                          const lineSubtotal = returnQty * line.unitPrice;
                          const lineTax = lineSubtotal * line.taxRate;
                          const lineTotal = lineSubtotal + lineTax;
                          
                          return (
                            <TableRow 
                              key={line.id}
                              className={returnQty > 0 ? 'bg-primary/5' : ''}
                            >
                              <TableCell>
                                <Badge variant="outline">
                                  {getItemTypeLabel(line.itemType)}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <div>
                                  <p className="font-medium">{line.description || line.productCode}</p>
                                  {line.productCode && line.description && (
                                    <p className="text-xs text-muted-foreground">{line.productCode}</p>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-center">{line.originalQty}</TableCell>
                              <TableCell className="text-center text-muted-foreground">{line.returnedQty}</TableCell>
                              <TableCell className="text-center font-medium">{line.availableQty}</TableCell>
                              <TableCell className="text-center">
                                <Input
                                  type="number"
                                  min={0}
                                  max={line.availableQty}
                                  step={line.itemType === 'service' ? 1 : 0.01}
                                  value={returnQty || ''}
                                  onChange={(e) => handleQuantityChange(line.id, e.target.value, line.availableQty)}
                                  className="w-20 text-center mx-auto"
                                  placeholder="0"
                                />
                              </TableCell>
                              <TableCell>{formatCurrency(line.unitPrice)}</TableCell>
                              <TableCell className="font-medium">
                                {returnQty > 0 ? formatCurrency(lineTotal) : '-'}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              {/* Non-Returnable Lines Info */}
              {invoiceData.lines.filter(l => !l.isReturnable).length > 0 && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {language === 'ar' 
                      ? `${invoiceData.lines.filter(l => !l.isReturnable).length} بند تم إرجاعه بالكامل مسبقاً`
                      : `${invoiceData.lines.filter(l => !l.isReturnable).length} line(s) fully returned previously`}
                  </AlertDescription>
                </Alert>
              )}
            </div>

            {/* Sidebar - Return Details & Totals */}
            <div className="space-y-6">
              {/* Return Details */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    {language === 'ar' ? 'تفاصيل المرتجع' : 'Return Details'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>{language === 'ar' ? 'سبب الإرجاع' : 'Return Reason'}</Label>
                    <Select value={returnReason} onValueChange={setReturnReason}>
                      <SelectTrigger>
                        <SelectValue placeholder={language === 'ar' ? 'اختر السبب...' : 'Select reason...'} />
                      </SelectTrigger>
                      <SelectContent>
                        {RETURN_REASONS.map((reason) => (
                          <SelectItem key={reason.value} value={reason.value}>
                            {language === 'ar' ? reason.labelAr : reason.labelEn}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{language === 'ar' ? 'ملاحظات' : 'Notes'}</Label>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder={language === 'ar' ? 'ملاحظات إضافية...' : 'Additional notes...'}
                      rows={3}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Totals */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    {language === 'ar' ? 'ملخص المرتجع' : 'Return Summary'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {language === 'ar' ? 'عدد البنود' : 'Lines Count'}
                    </span>
                    <span className="font-medium">{totals.lineCount}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {language === 'ar' ? 'المجموع' : 'Subtotal'}
                    </span>
                    <span>{formatCurrency(totals.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {language === 'ar' ? 'الضريبة' : 'VAT'}
                    </span>
                    <span>{formatCurrency(totals.taxAmount)}</span>
                  </div>
                  <div className="border-t pt-3">
                    <div className="flex justify-between font-bold">
                      <span>{language === 'ar' ? 'الإجمالي' : 'Total'}</span>
                      <span className="text-lg">{formatCurrency(totals.totalAmount)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Actions */}
              <div className="flex flex-col gap-2">
                {/* Show warning if over-limit quantities */}
                {hasOverLimitQuantities && (
                  <Alert variant="destructive" className="mb-2">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      {language === 'ar' 
                        ? 'بعض الكميات تتجاوز المتاح للإرجاع'
                        : 'Some quantities exceed available for return'}
                    </AlertDescription>
                  </Alert>
                )}
                <Button
                  size="lg"
                  className="w-full"
                  disabled={!hasReturnQuantities || isSubmitting || hasOverLimitQuantities}
                  onClick={handleConfirmReturn}
                >
                  {isSubmitting ? (
                    <Loader2 className="w-4 h-4 me-2 animate-spin" />
                  ) : (
                    <RotateCcw className="w-4 h-4 me-2" />
                  )}
                  {language === 'ar' ? 'تأكيد المرتجع' : 'Confirm Return'}
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  className="w-full"
                  disabled={isSubmitting}
                  onClick={() => navigate('/purchasing/returns')}
                >
                  {language === 'ar' ? 'إلغاء' : 'Cancel'}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {language === 'ar' ? 'الفاتورة غير موجودة' : 'Invoice not found'}
            </AlertDescription>
          </Alert>
        )}
      </div>
      
      {/* Success Dialog (C) */}
      <Dialog open={showSuccessDialog} onOpenChange={setShowSuccessDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-full bg-green-100 dark:bg-green-900/30">
                <CheckCircle className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <DialogTitle>
                {language === 'ar' ? 'تم إنشاء المرتجع بنجاح' : 'Return Created Successfully'}
              </DialogTitle>
            </div>
            <DialogDescription>
              {language === 'ar' 
                ? 'تم تسجيل المرتجع وتحديث المخزون والحسابات.'
                : 'The return has been recorded and inventory/accounts updated.'}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-3 py-4">
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {language === 'ar' ? 'رقم المرتجع' : 'Return Number'}
                </span>
              </div>
              <span className="font-mono font-bold">{successResult?.returnNumber}</span>
            </div>
            
            {successResult?.journalEntryNumber && (
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {language === 'ar' ? 'رقم القيد' : 'Journal Entry'}
                  </span>
                </div>
                <span className="font-mono font-bold">{successResult.journalEntryNumber}</span>
              </div>
            )}
          </div>
          
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={handleBackToList} className="w-full sm:w-auto">
              {language === 'ar' ? 'رجوع للقائمة' : 'Back to List'}
            </Button>
            <Button onClick={handleOpenReturn} className="w-full sm:w-auto">
              <ExternalLink className="w-4 h-4 me-2" />
              {language === 'ar' ? 'فتح المرتجع' : 'Open Return'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
