/**
 * Purchase Return - Unique Items (Jewelry)
 * 
 * This screen handles returns of unique/serialized jewelry items.
 * Items are selected via checkbox and returned as whole pieces.
 * 
 * PR-1: Wired to atomic RPC with idempotency
 * PR-2: UI Guardrails - prevent invalid selections, double-submit, enhanced UX
 */

import { useState, useMemo, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { 
  ArrowRight, 
  RotateCcw, 
  Package, 
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  FileText,
  ExternalLink,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { 
  getInvoiceForUniqueReturn, 
  calculateUniqueReturnTotals 
} from '@/domain/purchasing/returnReadService';
import { createPurchaseReturnUniqueAtomic } from '@/domain/purchasing/purchasingWriteService';
import { RETURN_REASONS } from '@/domain/purchasing/dto/returnScreenDTOs';
import type { JewelryItemForReturnDTO } from '@/domain/purchasing/dto/returnScreenDTOs';
import type { AtomicCreatePurchaseReturnUniqueCommand, AtomicPurchaseReturnItemInput } from '@/domain/purchasing/commands';

// Success result type for dialog
interface ReturnSuccessResult {
  returnId: string;
  returnNumber: string;
  journalEntryId?: string;
  journalEntryNumber?: string;
  totalAmount: number;
  itemCount: number;
  idempotent?: boolean;
}

export default function PurchaseReturnUniquePage() {
  const { language } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const invoiceId = searchParams.get('invoiceId');

  // Idempotency: stable request ID per action attempt
  const requestIdRef = useRef<string | null>(null);
  
  // Double-submit prevention
  const isSubmittingRef = useRef(false);

  // Form state
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [returnReason, setReturnReason] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Success dialog state
  const [successResult, setSuccessResult] = useState<ReturnSuccessResult | null>(null);

  // Fetch invoice with jewelry items
  const { data: invoiceData, isLoading, error } = useQuery({
    queryKey: ['invoice-for-unique-return', invoiceId],
    queryFn: () => getInvoiceForUniqueReturn(invoiceId!),
    enabled: !!invoiceId,
  });

  // Filter returnable items
  const returnableItems = useMemo(() => {
    return invoiceData?.jewelryItems.filter(item => item.isReturnable) || [];
  }, [invoiceData]);

  const nonReturnableItems = useMemo(() => {
    return invoiceData?.jewelryItems.filter(item => !item.isReturnable) || [];
  }, [invoiceData]);

  const isFullyReturned = useMemo(() => {
    if (!invoiceData || invoiceData.jewelryItems.length === 0) return false;
    return returnableItems.length === 0 && nonReturnableItems.length > 0;
  }, [invoiceData, returnableItems, nonReturnableItems]);

  // Selected items
  const selectedItems = useMemo(() => {
    return returnableItems.filter(item => selectedItemIds.has(item.id));
  }, [returnableItems, selectedItemIds]);

  // Calculate totals
  const totals = useMemo(() => {
    return calculateUniqueReturnTotals(selectedItems);
  }, [selectedItems]);

  // Select all handler
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedItemIds(new Set(returnableItems.map(item => item.id)));
    } else {
      setSelectedItemIds(new Set());
    }
  };

  // Single item selection
  const handleItemSelect = (itemId: string, checked: boolean) => {
    const newSet = new Set(selectedItemIds);
    if (checked) {
      newSet.add(itemId);
    } else {
      newSet.delete(itemId);
    }
    setSelectedItemIds(newSet);
  };

  // Get block reason label
  const getBlockReasonLabel = (reason: JewelryItemForReturnDTO['returnBlockReason']) => {
    switch (reason) {
      case 'SOLD':
        return language === 'ar' ? 'مباعة' : 'Sold';
      case 'ALREADY_RETURNED':
        return language === 'ar' ? 'مرتجعة مسبقاً' : 'Already Returned';
      case 'NOT_IN_BRANCH':
        return language === 'ar' ? 'فرع مختلف' : 'Different Branch';
      default:
        return '';
    }
  };

  // Handle confirm return - PR-1 atomic with idempotency, PR-2 double-submit prevention
  // PR-3: Generate NEW UUID per attempt, reset on any terminal outcome
  const handleConfirmReturn = useCallback(async () => {
    // === DOUBLE-SUBMIT GUARD ===
    if (isSubmittingRef.current) {
      console.warn('[ReturnUnique] Ignoring duplicate submit');
      return;
    }
    
    // === STRICT UI GUARDS ===
    if (!invoiceData) {
      toast({
        variant: 'destructive',
        title: language === 'ar' ? 'خطأ' : 'Error',
        description: language === 'ar' ? 'بيانات الفاتورة غير متوفرة' : 'Invoice data not available',
      });
      return;
    }

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

    if (selectedItems.length === 0) {
      toast({
        variant: 'destructive',
        title: language === 'ar' ? 'لم يتم اختيار قطع' : 'No Items Selected',
        description: language === 'ar' 
          ? 'يرجى اختيار قطعة واحدة على الأقل للإرجاع'
          : 'Please select at least one item to return',
      });
      return;
    }

    // PR-2: Validate selected items are still available
    const unavailableItems = selectedItems.filter(item => !item.isReturnable);
    if (unavailableItems.length > 0) {
      toast({
        variant: 'destructive',
        title: language === 'ar' ? 'قطع غير قابلة للإرجاع' : 'Items Not Returnable',
        description: language === 'ar' 
          ? `لا يمكن إرجاع ${unavailableItems.length} قطعة بسبب حالتها الحالية`
          : `${unavailableItems.length} item(s) cannot be returned due to their current status`,
      });
      return;
    }

    if (!user) {
      toast({
        variant: 'destructive',
        title: language === 'ar' ? 'خطأ' : 'Error',
        description: language === 'ar' ? 'يجب تسجيل الدخول' : 'You must be logged in',
      });
      return;
    }

    const IDEMPOTENCY_KEY = `upr:return:create:${invoiceData.id}`;
    let currentRequestId = localStorage.getItem(IDEMPOTENCY_KEY);
    if (!currentRequestId) {
      currentRequestId = crypto.randomUUID();
      localStorage.setItem(IDEMPOTENCY_KEY, currentRequestId);
    }
    requestIdRef.current = currentRequestId;

    isSubmittingRef.current = true;
    setIsSubmitting(true);

    const executeReturn = async (reqId: string) => {
      const items: AtomicPurchaseReturnItemInput[] = selectedItems.map((item) => ({
        item_id: item.id,
        item_code: item.itemCode,
        description: item.description || item.model || item.itemCode,
        unit_price: item.unitPrice,
        tax_rate: item.taxRate,
        gold_weight: item.goldWeight,
        karat_id: item.karatId || undefined,
        reason: returnReason,
      }));

      const cmd: AtomicCreatePurchaseReturnUniqueCommand = {
        client_request_id: reqId,
        created_by: user.id,
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

      if (import.meta.env.DEV) {
        console.log('[ReturnUnique payload]', JSON.stringify(cmd, null, 2));
      }

      return createPurchaseReturnUniqueAtomic(cmd);
    };

    try {
      let result = await executeReturn(currentRequestId);

      const conflictCodes = ['CONFLICT_IN_PROGRESS', 'CONCURRENT_LOCK', 'IN_PROGRESS'];
      if (!result.success && result.error_code && conflictCodes.includes(result.error_code)) {
        if (import.meta.env.DEV) {
          console.warn('[ReturnUnique] Conflict detected, retrying with new UUID...');
        }
        localStorage.removeItem(IDEMPOTENCY_KEY);
        const retryRequestId = crypto.randomUUID();
        localStorage.setItem(IDEMPOTENCY_KEY, retryRequestId);
        requestIdRef.current = retryRequestId;
        result = await executeReturn(retryRequestId);
      }

      if (result.success) {
        localStorage.removeItem(IDEMPOTENCY_KEY);
        requestIdRef.current = null;
        
        // Show success dialog with details
        setSuccessResult({
          returnId: result.returnId || '',
          returnNumber: result.returnNumber || '',
          journalEntryId: result.journalEntryId,
          journalEntryNumber: result.journalEntryNumber,
          totalAmount: result.totals?.totalAmount || totals.totalAmount,
          itemCount: selectedItems.length,
          idempotent: result.idempotent,
        });

        // Invalidate queries
        queryClient.invalidateQueries({ queryKey: ['purchase-returns'] });
        queryClient.invalidateQueries({ queryKey: ['invoice-for-unique-return'] });
      } else {
        localStorage.removeItem(IDEMPOTENCY_KEY);
        requestIdRef.current = null;

        // DEV-only detailed logging
        if (import.meta.env.DEV) {
          console.error('[ReturnUnique RPC Error]', { error_code: result.error_code, error: result.error });
        }
        
        // User-friendly error messages
        let userMessage = result.error || 'Unknown error';
        if (result.error_code === 'IN_PROGRESS' || result.error_code === 'CONFLICT_IN_PROGRESS') {
          userMessage = language === 'ar' 
            ? 'العملية قيد التنفيذ بالفعل. يرجى الانتظار ثم المحاولة مرة أخرى.'
            : 'Operation is in progress. Please wait and try again.';
        } else if (result.error_code === 'IDEMPOTENCY_CONFLICT') {
          userMessage = language === 'ar'
            ? 'تم تغيير البيانات. يرجى تحديث الصفحة والمحاولة مرة أخرى.'
            : 'Data has changed. Please refresh and try again.';
        }
        
        toast({
          variant: 'destructive',
          title: language === 'ar' ? 'فشل إنشاء المرتجع' : 'Return Creation Failed',
          description: userMessage,
        });
      }
    } catch (err) {
      localStorage.removeItem(IDEMPOTENCY_KEY);
      requestIdRef.current = null;

      console.error('Return creation failed:', err);
      toast({
        variant: 'destructive',
        title: language === 'ar' ? 'فشل إنشاء المرتجع' : 'Return Creation Failed',
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [invoiceData, selectedItems, user, returnReason, notes, totals, language, toast, queryClient]);

  // Close success dialog and navigate
  const handleSuccessClose = useCallback(() => {
    setSuccessResult(null);
    navigate('/purchasing/returns');
  }, [navigate]);

  // Open return details
  const handleOpenReturn = useCallback(() => {
    if (successResult?.returnId) {
      navigate(`/purchasing/returns-hub/r/${successResult.returnId}`);
    }
  }, [navigate, successResult]);

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
                {language === 'ar' ? 'مرتجع مشتريات - قطع فريدة' : 'Purchase Return - Unique Items'}
              </h1>
              <p className="text-muted-foreground text-sm">
                {language === 'ar' 
                  ? 'اختر القطع المراد إرجاعها للمورد' 
                  : 'Select items to return to supplier'}
              </p>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : invoiceData ? (
          <>
          {isFullyReturned && (
            <Alert variant="destructive" data-testid="alert-fully-returned">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="font-semibold">
                {language === 'ar' 
                  ? 'هذه الفاتورة مرتجعة بالكامل ولا يمكن إجراء مرتجع جديد عليها' 
                  : 'This invoice has been fully returned and cannot be returned again'}
              </AlertDescription>
            </Alert>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Content - Items Table */}
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

              {/* Returnable Items */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                      {language === 'ar' ? 'القطع القابلة للإرجاع' : 'Returnable Items'}
                      <Badge variant="secondary">{returnableItems.length}</Badge>
                    </CardTitle>
                    {returnableItems.length > 0 && (
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="select-all"
                          checked={selectedItemIds.size === returnableItems.length && returnableItems.length > 0}
                          onCheckedChange={handleSelectAll}
                        />
                        <Label htmlFor="select-all" className="text-sm cursor-pointer">
                          {language === 'ar' ? 'تحديد الكل' : 'Select All'}
                        </Label>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {returnableItems.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
                      <p>{language === 'ar' ? 'لا توجد قطع قابلة للإرجاع' : 'No returnable items'}</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12"></TableHead>
                          <TableHead>{language === 'ar' ? 'الكود' : 'Code'}</TableHead>
                          <TableHead>{language === 'ar' ? 'الوصف' : 'Description'}</TableHead>
                          <TableHead>{language === 'ar' ? 'العيار' : 'Karat'}</TableHead>
                          <TableHead>{language === 'ar' ? 'الوزن' : 'Weight'}</TableHead>
                          <TableHead>{language === 'ar' ? 'السعر' : 'Price'}</TableHead>
                          <TableHead>{language === 'ar' ? 'الضريبة' : 'Tax'}</TableHead>
                          <TableHead>{language === 'ar' ? 'الإجمالي' : 'Total'}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {returnableItems.map((item) => (
                          <TableRow 
                            key={item.id}
                            className={selectedItemIds.has(item.id) ? 'bg-primary/5' : ''}
                          >
                            <TableCell>
                              <Checkbox
                                checked={selectedItemIds.has(item.id)}
                                onCheckedChange={(checked) => handleItemSelect(item.id, !!checked)}
                              />
                            </TableCell>
                            <TableCell className="font-mono text-sm">{item.itemCode}</TableCell>
                            <TableCell>{item.description || item.model || '-'}</TableCell>
                            <TableCell>{item.karatName || '-'}</TableCell>
                            <TableCell>{Number(item.goldWeight || 0).toFixed(2)}g</TableCell>
                            <TableCell>{formatCurrency(item.unitPrice)}</TableCell>
                            <TableCell>{formatCurrency(item.taxAmount)}</TableCell>
                            <TableCell className="font-medium">{formatCurrency(item.totalAmount)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              {/* Non-Returnable Items */}
              {nonReturnableItems.length > 0 && (
                <Card className="border-destructive/20">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2 text-muted-foreground">
                      <XCircle className="w-4 h-4 text-destructive" />
                      {language === 'ar' ? 'قطع غير قابلة للإرجاع' : 'Non-Returnable Items'}
                      <Badge variant="outline">{nonReturnableItems.length}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{language === 'ar' ? 'الكود' : 'Code'}</TableHead>
                          <TableHead>{language === 'ar' ? 'الوصف' : 'Description'}</TableHead>
                          <TableHead>{language === 'ar' ? 'السبب' : 'Reason'}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {nonReturnableItems.map((item) => (
                          <TableRow key={item.id} className="opacity-60">
                            <TableCell className="font-mono text-sm">{item.itemCode}</TableCell>
                            <TableCell>{item.description || item.model || '-'}</TableCell>
                            <TableCell>
                              <Badge variant="destructive">
                                {getBlockReasonLabel(item.returnBlockReason)}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
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
                      {language === 'ar' ? 'عدد القطع' : 'Items Count'}
                    </span>
                    <span className="font-medium">{totals.itemCount}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {language === 'ar' ? 'المجموع' : 'Subtotal'}
                    </span>
                    <span>{formatCurrency(totals.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {language === 'ar' ? 'الضريبة (15%)' : 'VAT (15%)'}
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
                <Button
                  size="lg"
                  className="w-full"
                  disabled={selectedItemIds.size === 0 || isSubmitting || isFullyReturned}
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
          </>
        ) : (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {language === 'ar' ? 'الفاتورة غير موجودة' : 'Invoice not found'}
            </AlertDescription>
          </Alert>
        )}
      </div>

      {/* Success Dialog */}
      <Dialog open={!!successResult} onOpenChange={(open) => !open && handleSuccessClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="w-5 h-5" />
              {language === 'ar' ? 'تم إنشاء المرتجع بنجاح' : 'Return Created Successfully'}
            </DialogTitle>
            <DialogDescription>
              {successResult?.idempotent && (
                <Badge variant="secondary" className="mt-2">
                  {language === 'ar' ? 'مخزن مؤقتاً' : 'Cached'}
                </Badge>
              )}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Return Info */}
            <div className="grid grid-cols-2 gap-4 p-4 bg-muted rounded-lg">
              <div>
                <p className="text-sm text-muted-foreground">
                  {language === 'ar' ? 'رقم المرتجع' : 'Return Number'}
                </p>
                <p className="font-bold text-lg">{successResult?.returnNumber}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {language === 'ar' ? 'عدد القطع' : 'Items'}
                </p>
                <p className="font-bold text-lg">{successResult?.itemCount}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {language === 'ar' ? 'الإجمالي' : 'Total'}
                </p>
                <p className="font-bold text-lg">{formatCurrency(successResult?.totalAmount || 0)}</p>
              </div>
              {successResult?.journalEntryNumber && (
                <div>
                  <p className="text-sm text-muted-foreground">
                    {language === 'ar' ? 'القيد المحاسبي' : 'Journal Entry'}
                  </p>
                  <p className="font-bold text-lg flex items-center gap-1">
                    <FileText className="w-4 h-4" />
                    {successResult.journalEntryNumber}
                  </p>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={handleSuccessClose}>
              {language === 'ar' ? 'إغلاق' : 'Close'}
            </Button>
            <Button onClick={handleOpenReturn} className="gap-2">
              <ExternalLink className="w-4 h-4" />
              {language === 'ar' ? 'عرض المرتجع' : 'View Return'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
