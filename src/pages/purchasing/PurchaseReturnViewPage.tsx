/**
 * Purchase Return View Page
 * 
 * Unified view for both return types:
 * - unique (jewelry items) → shows items table
 * - general (qty-based) → shows lines table
 * 
 * P3.3/P3.4: Read-only via DTO service + UX actions
 * PR-1: Uses voidPurchaseReturnAtomic for cancellation
 */

import { useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  ArrowRight, 
  RotateCcw, 
  Loader2,
  AlertCircle,
  FileText,
  Package,
  Gem,
  Building2,
  Truck,
  Calendar,
  Hash,
  ExternalLink,
  BookOpen,
  Printer,
  Download,
  XCircle,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatCurrency } from '@/lib/utils';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { toast } from 'sonner';
import { getPurchaseReturnByIdUnified } from '@/domain/purchasing/returnReadService';
import { voidPurchaseReturnAtomic } from '@/domain/purchasing/purchasingWriteService';
import type { PurchaseReturnDTO, PurchaseReturnLineDTO, PurchaseReturnItemDTO } from '@/domain/purchasing/dto';

export default function PurchaseReturnViewPage() {
  const { language } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id } = useParams<{ id: string }>();

  // Idempotency ref for void action
  const voidRequestIdRef = useRef<string | null>(null);

  // Cancel dialog state
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  // Fetch return data via unified read service
  const { data: returnData, isLoading, error } = useQuery({
    queryKey: ['purchase-return-view', id],
    queryFn: () => getPurchaseReturnByIdUnified(id!),
    enabled: !!id,
  });

  // Cancel mutation via atomic wrapper
  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!returnData) throw new Error('بيانات المرتجع غير متوفرة');
      
      // Generate stable request ID per action
      if (!voidRequestIdRef.current) {
        voidRequestIdRef.current = crypto.randomUUID();
      }

      const result = await voidPurchaseReturnAtomic({
        client_request_id: voidRequestIdRef.current,
        void: {
          purchase_return_id: returnData.id,
          reason: cancelReason || 'إلغاء من صفحة العرض',
          voided_by: user?.email || 'system',
        },
      });
      
      if (!result.success) {
        throw new Error(result.error || 'فشل في إلغاء المرتجع');
      }
      return result;
    },
    onSuccess: (result) => {
      // Reset request ID on success
      voidRequestIdRef.current = null;
      queryClient.invalidateQueries({ queryKey: ['purchase-return-view', id] });
      queryClient.invalidateQueries({ queryKey: ['purchase-returns-unified'] });
      toast.success(
        language === 'ar' 
          ? `تم إلغاء المرتجع بنجاح${result.reversal_je_id ? ` - قيد العكس: ${result.reversal_je_id}` : ''}`
          : `Return voided successfully${result.reversal_je_id ? ` - Reversal JE: ${result.reversal_je_id}` : ''}`
      );
      setCancelDialogOpen(false);
      setCancelReason('');
    },
    onError: (error: Error) => {
      // Don't reset request ID on error (allow retry)
      toast.error(error.message || (language === 'ar' ? 'حدث خطأ أثناء الإلغاء' : 'An error occurred'));
    },
  });

  // Check if actions should be disabled - cast status to string for comparison
  const statusStr = returnData?.status as string;
  const canCancel = returnData && ['pending', 'confirmed', 'approved', 'completed'].includes(statusStr);
  const isCancelled = statusStr === 'cancelled' || statusStr === 'voided';

  const handlePrint = () => {
    toast.info(language === 'ar' ? 'طباعة المرتجع قيد التطوير' : 'Print feature coming soon');
  };

  const handleExport = () => {
    toast.info(language === 'ar' ? 'تصدير المرتجع قيد التطوير' : 'Export feature coming soon');
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      pending: { label: language === 'ar' ? 'معلق' : 'Pending', variant: 'secondary' },
      approved: { label: language === 'ar' ? 'معتمد' : 'Approved', variant: 'default' },
      completed: { label: language === 'ar' ? 'مكتمل' : 'Completed', variant: 'default' },
      confirmed: { label: language === 'ar' ? 'مؤكد' : 'Confirmed', variant: 'default' },
      cancelled: { label: language === 'ar' ? 'ملغي' : 'Cancelled', variant: 'destructive' },
    };
    const config = statusConfig[status] || statusConfig.pending;
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getReturnTypeBadge = (returnType: 'general' | 'unique') => {
    if (returnType === 'unique') {
      return (
        <Badge variant="outline" className="gap-1">
          <Gem className="w-3 h-3" />
          {language === 'ar' ? 'قطع فريدة' : 'Unique Items'}
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="gap-1">
        <Package className="w-3 h-3" />
        {language === 'ar' ? 'كميات' : 'Quantity-Based'}
      </Badge>
    );
  };

  // Error states
  if (!id) {
    return (
      <MainLayout>
        <div className="p-8">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {language === 'ar' ? 'معرف المرتجع مطلوب' : 'Return ID is required'}
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
              {language === 'ar' ? 'فشل في تحميل بيانات المرتجع' : 'Failed to load return data'}
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
        <div className="flex items-center justify-between flex-wrap gap-4">
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
                <RotateCcw className="w-6 h-6 text-orange-500" />
                {language === 'ar' ? 'عرض مرتجع المشتريات' : 'Purchase Return View'}
              </h1>
              <p className="text-muted-foreground text-sm">
                {returnData?.returnNumber || '...'}
              </p>
            </div>
          </div>

          {/* Header Badges & Actions */}
          {returnData && (
            <div className="flex items-center gap-3 flex-wrap">
              {getReturnTypeBadge(returnData.returnType)}
              {getStatusBadge(returnData.status)}
              
              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePrint}
                  disabled={isCancelled}
                  className="gap-1"
                >
                  <Printer className="w-4 h-4" />
                  {language === 'ar' ? 'طباعة' : 'Print'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExport}
                  disabled={isCancelled}
                  className="gap-1"
                >
                  <Download className="w-4 h-4" />
                  {language === 'ar' ? 'تصدير' : 'Export'}
                </Button>
                {canCancel && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setCancelDialogOpen(true)}
                    className="gap-1"
                  >
                    <XCircle className="w-4 h-4" />
                    {language === 'ar' ? 'إلغاء المرتجع' : 'Cancel Return'}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : returnData ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-6">
              {/* Return Info */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    {language === 'ar' ? 'معلومات المرتجع' : 'Return Information'}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div className="flex items-start gap-2">
                      <Hash className="w-4 h-4 text-muted-foreground mt-0.5" />
                      <div>
                        <span className="text-muted-foreground block">
                          {language === 'ar' ? 'رقم المرتجع' : 'Return No.'}
                        </span>
                        <p className="font-medium">{returnData.returnNumber}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Calendar className="w-4 h-4 text-muted-foreground mt-0.5" />
                      <div>
                        <span className="text-muted-foreground block">
                          {language === 'ar' ? 'التاريخ' : 'Date'}
                        </span>
                        <p className="font-medium">
                          {format(new Date(returnData.returnDate), 'dd/MM/yyyy', {
                            locale: language === 'ar' ? ar : undefined,
                          })}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Truck className="w-4 h-4 text-muted-foreground mt-0.5" />
                      <div>
                        <span className="text-muted-foreground block">
                          {language === 'ar' ? 'المورد' : 'Supplier'}
                        </span>
                        <p className="font-medium">{returnData.supplierName || '-'}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Building2 className="w-4 h-4 text-muted-foreground mt-0.5" />
                      <div>
                        <span className="text-muted-foreground block">
                          {language === 'ar' ? 'الفرع' : 'Branch'}
                        </span>
                        <p className="font-medium">{returnData.branchName || '-'}</p>
                      </div>
                    </div>
                  </div>
                  
                  {/* Linked Invoice - Clickable */}
                  {returnData.linkedInvoiceNumber && returnData.linkedInvoiceId && (
                    <>
                      <Separator className="my-4" />
                      <div className="flex items-center gap-2 text-sm">
                        <FileText className="w-4 h-4 text-muted-foreground" />
                        <span className="text-muted-foreground">
                          {language === 'ar' ? 'الفاتورة الأصلية:' : 'Original Invoice:'}
                        </span>
                        <Link 
                          to={`/purchasing/invoices/${returnData.linkedInvoiceId}/view`}
                          className="font-medium text-primary hover:underline inline-flex items-center gap-1"
                        >
                          {returnData.linkedInvoiceNumber}
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                      </div>
                    </>
                  )}

                  {/* Journal Entry Link */}
                  {returnData.journalEntryId && (
                    <>
                      <Separator className="my-4" />
                      <div className="flex items-center gap-2 text-sm">
                        <BookOpen className="w-4 h-4 text-muted-foreground" />
                        <span className="text-muted-foreground">
                          {language === 'ar' ? 'القيد المحاسبي:' : 'Journal Entry:'}
                        </span>
                        <Link 
                          to={`/accounting/journal-entries?id=${returnData.journalEntryId}`}
                          className="font-medium text-primary hover:underline inline-flex items-center gap-1"
                        >
                          {language === 'ar' ? 'عرض القيد' : 'View Entry'}
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                      </div>
                    </>
                  )}
                  
                  {returnData.reason && (
                    <>
                      <Separator className="my-4" />
                      <div className="text-sm">
                        <span className="text-muted-foreground block mb-1">
                          {language === 'ar' ? 'سبب الإرجاع' : 'Return Reason'}
                        </span>
                        <p>{returnData.reason}</p>
                      </div>
                    </>
                  )}
                  
                  {returnData.notes && (
                    <>
                      <Separator className="my-4" />
                      <div className="text-sm">
                        <span className="text-muted-foreground block mb-1">
                          {language === 'ar' ? 'ملاحظات' : 'Notes'}
                        </span>
                        <p>{returnData.notes}</p>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Items/Lines Table */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    {returnData.returnType === 'unique' ? (
                      <>
                        <Gem className="w-4 h-4" />
                        {language === 'ar' ? 'القطع المرتجعة' : 'Returned Items'}
                        <Badge variant="secondary">{returnData.items.length}</Badge>
                      </>
                    ) : (
                      <>
                        <Package className="w-4 h-4" />
                        {language === 'ar' ? 'بنود المرتجع' : 'Return Lines'}
                        <Badge variant="secondary">{returnData.lines.length}</Badge>
                      </>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {returnData.returnType === 'unique' ? (
                    <UniqueItemsTable items={returnData.items} language={language} />
                  ) : (
                    <GeneralLinesTable lines={returnData.lines} language={language} />
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Sidebar - Totals */}
            <div className="space-y-6">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    {language === 'ar' ? 'ملخص المرتجع' : 'Return Summary'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {language === 'ar' ? 'عدد البنود' : 'Items Count'}
                    </span>
                    <span className="font-medium">
                      {returnData.returnType === 'unique' 
                        ? returnData.items.length 
                        : returnData.lines.length}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {language === 'ar' ? 'المجموع' : 'Subtotal'}
                    </span>
                    <span>{formatCurrency(returnData.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {language === 'ar' ? 'الضريبة' : 'VAT'}
                    </span>
                    <span>{formatCurrency(returnData.taxAmount)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between font-bold">
                    <span>{language === 'ar' ? 'الإجمالي' : 'Total'}</span>
                    <span className="text-lg text-orange-600">
                      -{formatCurrency(returnData.totalAmount)}
                    </span>
                  </div>
                </CardContent>
              </Card>

              {/* Actions */}
              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => navigate('/purchasing/returns')}
                >
                  {language === 'ar' ? 'العودة للقائمة' : 'Back to List'}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {language === 'ar' ? 'المرتجع غير موجود' : 'Return not found'}
            </AlertDescription>
          </Alert>
        )}

        {/* Cancel Dialog */}
        <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {language === 'ar' ? 'تأكيد إلغاء المرتجع' : 'Confirm Cancellation'}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {language === 'ar' 
                  ? 'سيتم إلغاء هذا المرتجع واستعادة الأصناف للمخزون وعكس القيد المحاسبي. هل أنت متأكد؟'
                  : 'This return will be cancelled, inventory will be restored, and journal entry reversed. Are you sure?'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2 py-4">
              <Label>{language === 'ar' ? 'سبب الإلغاء (اختياري)' : 'Cancellation Reason (optional)'}</Label>
              <Textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder={language === 'ar' ? 'أدخل سبب الإلغاء...' : 'Enter cancellation reason...'}
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={cancelMutation.isPending}>
                {language === 'ar' ? 'تراجع' : 'Cancel'}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {cancelMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  language === 'ar' ? 'تأكيد الإلغاء' : 'Confirm Cancel'
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </MainLayout>
  );
}

// ===========================
// Sub-components
// ===========================

function UniqueItemsTable({ items, language }: { items: PurchaseReturnItemDTO[]; language: string }) {
  if (items.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Gem className="w-12 h-12 mx-auto mb-3 opacity-50" />
        <p>{language === 'ar' ? 'لا توجد قطع' : 'No items'}</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{language === 'ar' ? 'الكود' : 'Code'}</TableHead>
          <TableHead>{language === 'ar' ? 'الوصف' : 'Description'}</TableHead>
          <TableHead>{language === 'ar' ? 'الوزن' : 'Weight'}</TableHead>
          <TableHead>{language === 'ar' ? 'السعر' : 'Price'}</TableHead>
          <TableHead>{language === 'ar' ? 'الضريبة' : 'Tax'}</TableHead>
          <TableHead>{language === 'ar' ? 'الإجمالي' : 'Total'}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell className="font-mono text-sm">{item.itemCode}</TableCell>
            <TableCell>{item.description || '-'}</TableCell>
            <TableCell>{item.goldWeight.toFixed(2)}g</TableCell>
            <TableCell>{formatCurrency(item.unitPrice)}</TableCell>
            <TableCell>{formatCurrency(item.taxAmount)}</TableCell>
            <TableCell className="font-medium">{formatCurrency(item.totalAmount)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function GeneralLinesTable({ lines, language }: { lines: PurchaseReturnLineDTO[]; language: string }) {
  if (lines.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
        <p>{language === 'ar' ? 'لا توجد بنود' : 'No lines'}</p>
      </div>
    );
  }

  const getItemTypeLabel = (type: string) => {
    switch (type) {
      case 'product': return language === 'ar' ? 'منتج' : 'Product';
      case 'cost': return language === 'ar' ? 'تكلفة' : 'Cost';
      case 'service': return language === 'ar' ? 'خدمة' : 'Service';
      default: return type;
    }
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{language === 'ar' ? 'النوع' : 'Type'}</TableHead>
          <TableHead>{language === 'ar' ? 'الوصف' : 'Description'}</TableHead>
          <TableHead className="text-center">{language === 'ar' ? 'الكمية' : 'Qty'}</TableHead>
          <TableHead>{language === 'ar' ? 'سعر الوحدة' : 'Unit Price'}</TableHead>
          <TableHead>{language === 'ar' ? 'الضريبة' : 'Tax'}</TableHead>
          <TableHead>{language === 'ar' ? 'الإجمالي' : 'Total'}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((line) => (
          <TableRow key={line.id}>
            <TableCell>
              <Badge variant="outline">{getItemTypeLabel(line.itemType)}</Badge>
            </TableCell>
            <TableCell>
              <div>
                <p className="font-medium">{line.description || line.productCode}</p>
                {line.productCode && line.description && (
                  <p className="text-xs text-muted-foreground">{line.productCode}</p>
                )}
              </div>
            </TableCell>
            <TableCell className="text-center">{line.quantity}</TableCell>
            <TableCell>{formatCurrency(line.unitPrice)}</TableCell>
            <TableCell>{formatCurrency(line.taxAmount)}</TableCell>
            <TableCell className="font-medium">{formatCurrency(line.totalAmount)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
