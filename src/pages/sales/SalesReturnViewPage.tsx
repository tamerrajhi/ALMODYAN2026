import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as dataGateway from '@/lib/dataGateway';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { 
  ArrowLeft, 
  RotateCcw, 
  Printer, 
  BookOpen, 
  Ban, 
  Loader2,
  User,
  FileText
} from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { toast } from 'sonner';

export default function SalesReturnViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const isPosPath = location.pathname.startsWith('/pos/');
  const queryClient = useQueryClient();
  const { t, language } = useLanguage();

  // Void dialog state
  const [showVoidDialog, setShowVoidDialog] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [isVoiding, setIsVoiding] = useState(false);
  const clientRequestIdRef = useRef<string>(crypto.randomUUID());

  // Fetch return data
  const { data: returnData, isLoading, error } = useQuery({
    queryKey: ['sales-return-view', id],
    queryFn: async () => {
      if (!id) throw new Error('معرف المرتجع مطلوب');

      const res = await fetch(`/api/return-with-details/${id}`, { credentials: 'include' });
      if (res.status === 404) throw new Error('المرتجع غير موجود');
      if (!res.ok) throw new Error('Failed to fetch return data');
      const raw = await res.json();
      if (!raw) throw new Error('المرتجع غير موجود');

      return {
        ...raw,
        customer: raw.customer || null,
        branch: raw.branch_name ? { id: raw.branch_id, branch_name: raw.branch_name, branch_code: raw.branch_code } : null,
        journal_entry: raw.je_id ? { id: raw.je_id, entry_number: raw.entry_number } : null,
      };
    },
    enabled: !!id,
  });

  // Fetch return items
  const { data: items = [] } = useQuery({
    queryKey: ['sales-return-items-view', id],
    queryFn: async () => {
      if (!id) return [];

      const response = await fetch(`/api/return-items/${id}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch return items');
      const data = await response.json();
      return data || [];
    },
    enabled: !!id,
  });

  // Handle error
  useEffect(() => {
    if (error) {
      toast.error(error instanceof Error ? error.message : 'حدث خطأ في تحميل المرتجع');
      navigate(isPosPath ? '/pos/returns' : '/sales/returns');
    }
  }, [error, navigate]);

  // Void handler
  const handleVoid = async () => {
    if (!voidReason.trim()) {
      toast.error(language === 'ar' ? 'يرجى إدخال سبب الإلغاء' : 'Please enter void reason');
      return;
    }

    setIsVoiding(true);
    try {
      const payload = {
        client_request_id: clientRequestIdRef.current,
        return_id: id,
        void_reason: voidReason.trim(),
      };

      const { data: result, error } = await dataGateway.rpc('void_erp_sales_return_atomic', {
        p_payload: payload
      });

      if (error) throw error;

      const rpcResult = result as {
        success?: boolean;
        errorCode?: string;
        error?: string;
        reversal_journal_entry_id?: string;
        reversal_journal_entry_number?: string;
      } | null;

      if (!rpcResult?.success && rpcResult?.errorCode !== 'ALREADY_VOIDED') {
        const errorMessages: Record<string, string> = {
          'NOT_FOUND': language === 'ar' ? 'المرتجع غير موجود' : 'Return not found',
          'ACCESS_DENIED': language === 'ar' ? 'لا تملك صلاحية إلغاء هذا المرتجع' : 'Access denied',
          'VALIDATION_ERROR': rpcResult?.error || (language === 'ar' ? 'خطأ في البيانات' : 'Validation error'),
          'CONFLICT_IN_PROGRESS': language === 'ar' ? 'العملية قيد التنفيذ بالفعل' : 'Operation in progress',
        };
        const errorMsg = rpcResult?.errorCode 
          ? (errorMessages[rpcResult.errorCode] || rpcResult.error || 'Error')
          : (rpcResult?.error || (language === 'ar' ? 'حدث خطأ في إلغاء المرتجع' : 'Error voiding return'));
        throw new Error(errorMsg);
      }

      // Regenerate client request ID
      clientRequestIdRef.current = crypto.randomUUID();

      // Show success
      if (rpcResult?.reversal_journal_entry_number) {
        toast.success(
          language === 'ar' 
            ? `تم إلغاء المرتجع بنجاح - قيد العكس: ${rpcResult.reversal_journal_entry_number}`
            : `Return voided successfully - Reversal JE: ${rpcResult.reversal_journal_entry_number}`
        );
      } else {
        toast.success(language === 'ar' ? 'تم إلغاء المرتجع بنجاح' : 'Return voided successfully');
      }

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ['sales-return-view', id] });
      queryClient.invalidateQueries({ queryKey: ['sales-returns'] });
      
      setShowVoidDialog(false);
      setVoidReason('');
    } catch (error: any) {
      console.error('Error voiding return:', error);
      toast.error(error.message || t.common.error);
    } finally {
      setIsVoiding(false);
    }
  };

  // Format currency
  const formatCurrency = (amount: number) => {
    return amount.toLocaleString(language === 'ar' ? 'ar-SA' : 'en-SA', {
      style: 'currency',
      currency: 'SAR',
      minimumFractionDigits: 2,
    });
  };

  // Status badge
  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      pending: { label: language === 'ar' ? 'معلق' : 'Pending', variant: 'secondary' },
      approved: { label: language === 'ar' ? 'معتمد' : 'Approved', variant: 'default' },
      completed: { label: language === 'ar' ? 'مكتمل' : 'Completed', variant: 'default' },
      cancelled: { label: language === 'ar' ? 'ملغي' : 'Cancelled', variant: 'destructive' },
      voided: { label: language === 'ar' ? 'ملغي' : 'Voided', variant: 'destructive' },
    };
    const config = statusConfig[status] || statusConfig.pending;
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  // Check void eligibility
  const canVoid = returnData?.status !== 'voided' && returnData?.status !== 'cancelled';
  const isVoided = returnData?.status === 'voided' || returnData?.status === 'cancelled';

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!returnData) {
    return null;
  }

  return (
    <>
      <div className="rtl-mode content-full-width page-container space-y-6">
        {/* Header */}
        <div className="page-header-rtl">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate(isPosPath ? '/pos/returns' : '/sales/returns')}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <RotateCcw className="w-6 h-6 text-blue-500" />
                {language === 'ar' ? 'عرض مرتجع مبيعات' : 'View Sales Return'}
              </h1>
              <p className="text-muted-foreground">
                {returnData.invoice_number}
              </p>
            </div>
          </div>
          
          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            {isVoided && (
              <Badge variant="destructive" className="text-sm px-3 py-1">
                {language === 'ar' ? 'ملغي' : 'Voided'}
              </Badge>
            )}
            
            <Button 
              variant="outline" 
              size="sm" 
              className="gap-2"
              onClick={() => window.print()}
              data-testid="button-print-return"
            >
              <Printer className="w-4 h-4" />
              {language === 'ar' ? 'طباعة' : 'Print'}
            </Button>
            
            {returnData.journal_entry?.id && (
              <Button 
                variant="outline" 
                size="sm" 
                className="gap-2"
                onClick={() => navigate(`/journal-entries/${returnData.journal_entry.id}`)}
              >
                <BookOpen className="w-4 h-4" />
                {returnData.journal_entry.entry_number}
              </Button>
            )}
            
            {canVoid && (
              <Button 
                variant="destructive" 
                size="sm" 
                className="gap-2"
                onClick={() => setShowVoidDialog(true)}
                data-testid="button-void-return"
              >
                <Ban className="w-4 h-4" />
                {language === 'ar' ? 'إلغاء المرتجع' : 'Void Return'}
              </Button>
            )}
          </div>
        </div>

        {/* Void Warning Banner */}
        {isVoided && returnData.void_reason && (
          <Card className="border-destructive bg-destructive/5">
            <CardContent className="py-4">
              <div className="flex items-start gap-3">
                <Ban className="w-5 h-5 text-destructive mt-0.5" />
                <div>
                  <p className="font-medium text-destructive">
                    {language === 'ar' ? 'تم إلغاء هذا المرتجع' : 'This return has been voided'}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    <span className="font-medium">{language === 'ar' ? 'السبب:' : 'Reason:'}</span>{' '}
                    {returnData.void_reason}
                  </p>
                  {returnData.voided_at && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {format(new Date(returnData.voided_at), 'dd/MM/yyyy HH:mm', {
                        locale: language === 'ar' ? ar : undefined,
                      })}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

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
              <div>
                <Label className="text-muted-foreground text-xs">{t.common.name}</Label>
                <p className="font-medium">{returnData.customer?.full_name || '-'}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">{t.common.phone}</Label>
                <p dir="ltr" className="text-start">{returnData.customer?.phone || '-'}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">{t.common.email}</Label>
                <p dir="ltr" className="text-start">{returnData.customer?.email || '-'}</p>
              </div>
            </CardContent>
          </Card>

          {/* Return Details */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText className="w-5 h-5" />
                {language === 'ar' ? 'تفاصيل المرتجع' : 'Return Details'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-xs">
                    {language === 'ar' ? 'رقم المرتجع' : 'Return Number'}
                  </Label>
                  <p className="font-medium">{returnData.invoice_number}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-xs">
                    {language === 'ar' ? 'التاريخ' : 'Date'}
                  </Label>
                  <p className="font-medium">
                    {format(new Date(returnData.invoice_date), 'dd/MM/yyyy', {
                      locale: language === 'ar' ? ar : undefined,
                    })}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-xs">
                    {language === 'ar' ? 'الفرع' : 'Branch'}
                  </Label>
                  <p className="font-medium">{returnData.branch?.branch_name || '-'}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-xs">
                    {language === 'ar' ? 'الحالة' : 'Status'}
                  </Label>
                  <div>{getStatusBadge(returnData.status)}</div>
                </div>
                {returnData.linked_invoice_id && (
                  <div className="space-y-1 md:col-span-2">
                    <Label className="text-muted-foreground text-xs">
                      {language === 'ar' ? 'الفاتورة الأصلية' : 'Original Invoice'}
                    </Label>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium">{returnData.original_invoice_number || '-'}</span>
                      <Button 
                        variant="link" 
                        className="p-0 h-auto text-primary"
                        onClick={() => navigate(isPosPath ? `/pos/invoices/${returnData.linked_invoice_id}/view` : `/sales/invoices/${returnData.linked_invoice_id}/view`)}
                      >
                        {language === 'ar' ? 'عرض الفاتورة' : 'View Invoice'}
                      </Button>
                    </div>
                  </div>
                )}
                {returnData.notes && (
                  <div className="space-y-1 md:col-span-2">
                    <Label className="text-muted-foreground text-xs">
                      {language === 'ar' ? 'ملاحظات / سبب الإرجاع' : 'Notes / Return Reason'}
                    </Label>
                    <p>{returnData.notes}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Return Items */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {language === 'ar' ? 'بنود المرتجع' : 'Return Items'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{language === 'ar' ? 'الكود' : 'Code'}</TableHead>
                  <TableHead>{language === 'ar' ? 'الوصف' : 'Description'}</TableHead>
                  <TableHead>{language === 'ar' ? 'فاتورة المورد' : 'Supplier Inv.'}</TableHead>
                  <TableHead className="text-center">{language === 'ar' ? 'الكمية' : 'Qty'}</TableHead>
                  <TableHead className="text-center">{language === 'ar' ? 'سعر الوحدة' : 'Unit Price'}</TableHead>
                  <TableHead className="text-center">{language === 'ar' ? 'الضريبة' : 'Tax'}</TableHead>
                  <TableHead className="text-center">{language === 'ar' ? 'الإجمالي' : 'Total'}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item: any) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs">
                      {item.jewelry_items?.item_code || '-'}
                    </TableCell>
                    <TableCell>{item.description || item.jewelry_items?.description || '-'}</TableCell>
                    <TableCell className="text-sm">{item.jewelry_items?.supp_ref || '-'}</TableCell>
                    <TableCell className="text-center">{item.quantity}</TableCell>
                    <TableCell className="text-center" dir="ltr">
                      {formatCurrency(item.unit_price)}
                    </TableCell>
                    <TableCell className="text-center" dir="ltr">
                      {formatCurrency(item.tax_amount || 0)}
                    </TableCell>
                    <TableCell className="text-center font-medium" dir="ltr">
                      {formatCurrency(item.total_amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Totals */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex justify-end">
              <div className="w-full max-w-sm space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {language === 'ar' ? 'المجموع قبل الضريبة' : 'Subtotal'}
                  </span>
                  <span className="font-medium" dir="ltr">
                    {formatCurrency(returnData.subtotal || 0)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {language === 'ar' ? 'الضريبة' : 'Tax'}
                  </span>
                  <span className="font-medium" dir="ltr">
                    {formatCurrency(returnData.tax_amount || 0)}
                  </span>
                </div>
                <div className="flex justify-between border-t pt-3">
                  <span className="font-bold text-lg">
                    {language === 'ar' ? 'الإجمالي' : 'Total'}
                  </span>
                  <span className="font-bold text-lg text-blue-500" dir="ltr">
                    -{formatCurrency(returnData.total_amount || 0)}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => navigate(isPosPath ? '/pos/returns' : '/sales/returns')}>
            {t.common.back}
          </Button>
        </div>
      </div>

      {/* Void Dialog */}
      <Dialog open={showVoidDialog} onOpenChange={setShowVoidDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {language === 'ar' ? 'إلغاء مرتجع المبيعات' : 'Void Sales Return'}
            </DialogTitle>
            <DialogDescription>
              {language === 'ar' 
                ? 'سيتم إلغاء هذا المرتجع وعكس القيد المحاسبي وإعادة حالة الأصناف. هذا الإجراء لا يمكن التراجع عنه.'
                : 'This will void the return, create a reversal journal entry, and restore item states. This action cannot be undone.'}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="void-reason">
                {language === 'ar' ? 'سبب الإلغاء' : 'Void Reason'} *
              </Label>
              <Textarea
                id="void-reason"
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder={language === 'ar' ? 'أدخل سبب إلغاء المرتجع...' : 'Enter reason for voiding...'}
                rows={3}
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowVoidDialog(false);
                setVoidReason('');
              }}
              disabled={isVoiding}
            >
              {t.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={handleVoid}
              disabled={isVoiding || !voidReason.trim()}
              className="gap-2"
            >
              {isVoiding && <Loader2 className="w-4 h-4 animate-spin" />}
              <Ban className="w-4 h-4" />
              {language === 'ar' ? 'تأكيد الإلغاء' : 'Confirm Void'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
