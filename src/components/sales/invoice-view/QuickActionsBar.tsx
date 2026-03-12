import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { 
  Printer, 
  ArrowRight,
  Ban,
  Loader2,
  RotateCcw,
  CheckCircle2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import * as dataGateway from '@/lib/dataGateway';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface QuickActionsBarProps {
  invoiceId: string;
  invoiceNumber: string;
  status: string;
  journalEntryId?: string | null;
  saleId?: string | null;
  totalAmount?: number;
  onPostSuccess?: () => void;
  onVoidSuccess?: () => void;
}

export default function QuickActionsBar({
  invoiceId,
  invoiceNumber,
  status,
  saleId,
  totalAmount,
  onPostSuccess,
  onVoidSuccess,
}: QuickActionsBarProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canPost = status === 'draft' && !saleId;
  const canVoid = status !== 'voided' && status !== 'draft';
  const isVoided = status === 'voided';
  const isPOS = !!saleId;
  const backPath = isPOS ? '/pos/invoices' : '/sales/invoices';
  const canReturn = status === 'posted';

  const [showPostDialog, setShowPostDialog] = useState(false);
  const [postPaymentMethod, setPostPaymentMethod] = useState('cash');
  const [postPaymentAmount, setPostPaymentAmount] = useState(String(totalAmount || 0));
  const [isPosting, setIsPosting] = useState(false);

  const [showVoidDialog, setShowVoidDialog] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [isVoiding, setIsVoiding] = useState(false);
  const clientRequestIdRef = useRef<string>(crypto.randomUUID());

  const handlePost = async () => {
    setIsPosting(true);
    try {
      const response = await fetch(`/api/sales-invoices/${invoiceId}/post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          payment: {
            method: postPaymentMethod,
            amount: Number(postPaymentAmount) || 0,
          },
        }),
      });

      const result = await response.json() as {
        success?: boolean;
        idempotent?: boolean;
        journal_entry_id?: string;
        journal_entry_number?: string;
        error?: string;
        errorCode?: string;
        message?: string;
      };

      if (!result?.success) {
        throw new Error(result?.error || 'حدث خطأ في ترحيل الفاتورة');
      }

      if (result.idempotent) {
        toast.info(result.message || 'الفاتورة مرحلة مسبقاً');
      } else {
        toast.success(`تم ترحيل الفاتورة بنجاح - القيد: ${result.journal_entry_number || ''}`);
      }

      queryClient.invalidateQueries({ queryKey: ['sales-invoice-view', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['sales-invoices'] });

      setShowPostDialog(false);
      onPostSuccess?.();
    } catch (error: any) {
      console.error('Error posting invoice:', error);
      toast.error(error.message || 'حدث خطأ في ترحيل الفاتورة');
    } finally {
      setIsPosting(false);
    }
  };

  const handleVoid = async () => {
    if (!voidReason.trim()) {
      toast.error('يرجى إدخال سبب الإلغاء');
      return;
    }

    setIsVoiding(true);
    try {
      const payload = {
        client_request_id: clientRequestIdRef.current,
        invoice_id: invoiceId,
        void_reason: voidReason.trim(),
      };

      const { data: result, error } = await dataGateway.rpc('void_sales_invoice_atomic', {
        p_payload: payload
      });

      if (error) throw error;

      const rpcResult = result as {
        success?: boolean;
        errorCode?: string;
        error?: string;
        reversal_journal_entry_id?: string;
        reversal_journal_entry_number?: string;
        idempotent?: boolean;
      } | null;

      if (!rpcResult?.success && rpcResult?.errorCode !== 'ALREADY_VOIDED') {
        const errorMessages: Record<string, string> = {
          'NOT_FOUND': 'الفاتورة غير موجودة',
          'ACCESS_DENIED': 'لا تملك صلاحية إلغاء هذه الفاتورة',
          'INVALID_TYPE': 'هذه العملية لفواتير المبيعات فقط',
          'CONFLICT_IN_PROGRESS': 'العملية قيد التنفيذ بالفعل',
        };
        const errorMsg = rpcResult?.errorCode 
          ? (errorMessages[rpcResult.errorCode] || rpcResult.error || 'حدث خطأ')
          : (rpcResult?.error || 'حدث خطأ في إلغاء الفاتورة');
        throw new Error(errorMsg);
      }

      clientRequestIdRef.current = crypto.randomUUID();

      if (rpcResult?.reversal_journal_entry_number) {
        toast.success(`تم إلغاء الفاتورة بنجاح - قيد العكس: ${rpcResult.reversal_journal_entry_number}`);
      } else {
        toast.success('تم إلغاء الفاتورة بنجاح');
      }

      queryClient.invalidateQueries({ queryKey: ['sales-invoice-view', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['sales-invoices'] });
      
      setShowVoidDialog(false);
      setVoidReason('');
      onVoidSuccess?.();
    } catch (error: any) {
      console.error('Error voiding invoice:', error);
      toast.error(error.message || 'حدث خطأ في إلغاء الفاتورة');
    } finally {
      setIsVoiding(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 p-4 bg-muted/30 rounded-lg border">
        {/* 1. Back */}
        <Button 
          variant="outline" 
          size="sm"
          onClick={() => navigate(backPath)}
          data-testid="button-back-to-list"
        >
          <ArrowRight className="w-4 h-4 ml-1" />
          رجوع
        </Button>

        {/* 2. Print */}
        <Button 
          variant="outline" 
          size="sm"
          onClick={() => window.print()}
          data-testid="button-print-invoice"
        >
          <Printer className="w-4 h-4 ml-1" />
          طباعة
        </Button>

        {/* 3. Create Return */}
        {canReturn && (
          <Button 
            variant="outline" 
            size="sm"
            data-testid="button-create-return"
            onClick={() => {
              if (isPOS) {
                navigate(`/pos/return?invoice_id=${invoiceId}`);
              } else {
                navigate(`/sales/returns/new?invoice_id=${invoiceId}`);
              }
            }}
          >
            <RotateCcw className="w-4 h-4 ml-1" />
            إنشاء مرتجع
          </Button>
        )}

        {/* 4. Post (ERP drafts only) */}
        {canPost && (
          <Button 
            variant="default" 
            size="sm"
            onClick={() => {
              setPostPaymentAmount(String(totalAmount || 0));
              setShowPostDialog(true);
            }}
            data-testid="button-post-invoice"
          >
            <CheckCircle2 className="w-4 h-4 ml-1" />
            ترحيل
          </Button>
        )}

        {/* 5. Void */}
        {canVoid && (
          <Button 
            variant="destructive" 
            size="sm"
            onClick={() => setShowVoidDialog(true)}
            data-testid="button-void-invoice"
          >
            <Ban className="w-4 h-4 ml-1" />
            إلغاء
          </Button>
        )}

        <div className="flex-1" />

        {isVoided && (
          <Badge variant="destructive" className="text-xs">
            ملغاة
          </Badge>
        )}
      </div>

      {/* Void Confirmation Dialog */}
      <Dialog open={showVoidDialog} onOpenChange={setShowVoidDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>إلغاء الفاتورة</DialogTitle>
            <DialogDescription>
              سيتم إلغاء الفاتورة رقم {invoiceNumber} وإنشاء قيد عكسي لإلغاء تأثيرها المحاسبي.
              هذه العملية لا يمكن التراجع عنها.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="void-reason">سبب الإلغاء *</Label>
              <Textarea
                id="void-reason"
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="أدخل سبب إلغاء الفاتورة..."
                rows={3}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowVoidDialog(false)}
              disabled={isVoiding}
            >
              إلغاء
            </Button>
            <Button
              variant="destructive"
              onClick={handleVoid}
              disabled={isVoiding || !voidReason.trim()}
            >
              {isVoiding && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
              تأكيد الإلغاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Post Confirmation Dialog */}
      <Dialog open={showPostDialog} onOpenChange={setShowPostDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ترحيل الفاتورة</DialogTitle>
            <DialogDescription>
              سيتم ترحيل الفاتورة رقم {invoiceNumber} وإنشاء قيد محاسبي وتسجيل الدفعة.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="post-payment-method">طريقة الدفع</Label>
              <Select value={postPaymentMethod} onValueChange={setPostPaymentMethod}>
                <SelectTrigger data-testid="select-payment-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">نقدي</SelectItem>
                  <SelectItem value="bank_transfer">تحويل بنكي</SelectItem>
                  <SelectItem value="card">بطاقة</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="post-payment-amount">مبلغ الدفع (كامل المبلغ)</Label>
              <Input
                id="post-payment-amount"
                type="number"
                value={postPaymentAmount}
                readOnly
                data-testid="input-payment-amount"
              />
              <p className="text-xs text-muted-foreground">
                يجب دفع كامل المبلغ عند الترحيل: {(totalAmount || 0).toLocaleString('ar-SA')} ر.س
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowPostDialog(false)}
              disabled={isPosting}
            >
              إلغاء
            </Button>
            <Button
              variant="default"
              onClick={handlePost}
              disabled={isPosting}
              data-testid="button-confirm-post"
            >
              {isPosting && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
              تأكيد الترحيل
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
