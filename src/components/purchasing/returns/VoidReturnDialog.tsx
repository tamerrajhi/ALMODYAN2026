/**
 * Void Return Dialog Component
 * 
 * Provides a confirmation dialog with reason input for voiding purchase returns.
 * Supports both unique (purchase_returns) and general (invoices) return types.
 */

import { useState, useRef } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useQueryClient } from '@tanstack/react-query';
import * as dataGateway from '@/lib/dataGateway';
import { toast } from 'sonner';
import { logAudit } from '@/lib/audit';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertTriangle, Ban } from 'lucide-react';

interface VoidReturnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnType: 'unique' | 'general';
  canonicalId: string;
  returnNumber: string;
  branchId?: string;
  onSuccess?: () => void;
}

interface VoidResult {
  success: boolean;
  error?: string;
  errorCode?: string;
  return_type?: string;
  reversal_je_id?: string;
  reversal_je_number?: string;
  mirror_invoice_id?: string;
  items_restored_count?: number;
  items_skipped_sold_after_void?: number;
  idempotent?: boolean;
}

export function VoidReturnDialog({
  open,
  onOpenChange,
  returnType,
  canonicalId,
  returnNumber,
  branchId,
  onSuccess,
}: VoidReturnDialogProps) {
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  
  const [reason, setReason] = useState('');
  const [isVoiding, setIsVoiding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Client request ID for idempotency
  const clientRequestIdRef = useRef<string>(crypto.randomUUID());

  const handleVoid = async () => {
    if (!reason.trim()) {
      setError(language === 'ar' ? 'يرجى إدخال سبب الإلغاء' : 'Please enter a reason for voiding');
      return;
    }

    setError(null);
    setIsVoiding(true);

    try {
      // Build payload based on return type - using JSON-compatible types
      // D2-5: Both unique AND general now use purchase_return_id (canonical)
      const voidPayload: { [key: string]: string | undefined } = {
        purchase_return_id: canonicalId,  // Always use canonical ID from purchase_returns
        return_number: returnNumber,
        reason: reason.trim(),
        return_type: returnType,  // Pass return type for clarity
      };

      const payload: { [key: string]: string | { [key: string]: string | undefined } } = {
        client_request_id: clientRequestIdRef.current,
        void: voidPayload,
      };

      const { data: result, error: rpcError } = await dataGateway.rpc(
        'void_purchase_return_atomic',
        { p_payload: payload }
      );

      if (rpcError) throw rpcError;

      const typedResult = result as unknown as VoidResult | null;

      if (!typedResult?.success) {
        // Handle specific error codes
        const errorMessages: Record<string, { ar: string; en: string }> = {
          'NOT_FOUND': { ar: 'المرتجع غير موجود', en: 'Return not found' },
          'ALREADY_VOIDED': { ar: 'المرتجع ملغي بالفعل', en: 'Return is already voided' },
          'INVALID_STATUS': { ar: 'لا يمكن إلغاء هذا المرتجع بسبب حالته', en: 'Cannot void return due to its status' },
          'ACCESS_DENIED': { ar: 'لا تملك صلاحية إلغاء هذا المرتجع', en: 'You do not have permission to void this return' },
          'JE_REVERSAL_FAILED': { ar: 'فشل في إنشاء القيد العكسي', en: 'Failed to create reversal journal entry' },
        };

        const errCode = typedResult?.errorCode || 'UNKNOWN';
        const errMsg = errorMessages[errCode] 
          ? errorMessages[errCode][language === 'ar' ? 'ar' : 'en']
          : (typedResult?.error || (language === 'ar' ? 'حدث خطأ غير متوقع' : 'An unexpected error occurred'));
        
        throw new Error(errMsg);
      }

      // Regenerate client request ID for next operation
      clientRequestIdRef.current = crypto.randomUUID();

      // Log frontend audit for traceability
      try {
        await logAudit({
          actionType: 'Void',
          entityType: returnType === 'unique' ? 'purchase_return_unique' : 'purchase_return_general',
          entityId: canonicalId,
          entityCode: returnNumber,
          branchId: branchId,
          description: `Voided ${returnType} return ${returnNumber}`,
          metadata: {
            reason: reason.trim(),
            reversal_je_id: typedResult.reversal_je_id,
            reversal_je_number: typedResult.reversal_je_number,
            mirror_invoice_id: typedResult.mirror_invoice_id,
            items_restored_count: typedResult.items_restored_count,
          },
        });
      } catch (auditErr) {
        console.warn('Frontend audit log failed (non-blocking):', auditErr);
      }

      // Build success message
      let successMsg = language === 'ar' 
        ? `تم إلغاء المرتجع ${returnNumber} بنجاح`
        : `Return ${returnNumber} voided successfully`;

      if (typedResult.reversal_je_number) {
        successMsg += language === 'ar'
          ? ` - قيد العكس: ${typedResult.reversal_je_number}`
          : ` - Reversal JE: ${typedResult.reversal_je_number}`;
      }

      if (typedResult.items_restored_count && typedResult.items_restored_count > 0) {
        successMsg += language === 'ar'
          ? ` | تم استعادة ${typedResult.items_restored_count} قطعة`
          : ` | ${typedResult.items_restored_count} items restored`;
      }

      toast.success(successMsg);

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['returns-hub'] });
      queryClient.invalidateQueries({ queryKey: ['returns-hub-row', returnType, canonicalId] });
      queryClient.invalidateQueries({ queryKey: ['unique-return-detail', canonicalId] });
      queryClient.invalidateQueries({ queryKey: ['general-return-detail', canonicalId] });
      queryClient.invalidateQueries({ queryKey: ['unique-return-items', canonicalId] });
      queryClient.invalidateQueries({ queryKey: ['unique-return-movements', canonicalId] });
      queryClient.invalidateQueries({ queryKey: ['return-journal-entry'] });
      queryClient.invalidateQueries({ queryKey: ['return-journal-lines'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-returns'] });

      // Reset and close
      setReason('');
      onOpenChange(false);
      onSuccess?.();

    } catch (err: unknown) {
      console.error('Error voiding return:', err);
      const errorMessage = err instanceof Error ? err.message : (language === 'ar' ? 'حدث خطأ' : 'An error occurred');
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsVoiding(false);
    }
  };

  const handleClose = () => {
    if (!isVoiding) {
      setReason('');
      setError(null);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="w-5 h-5 text-destructive" />
            {language === 'ar' ? 'إلغاء المرتجع' : 'Void Return'}
          </DialogTitle>
          <DialogDescription>
            {language === 'ar'
              ? `سيتم إلغاء المرتجع ${returnNumber} وإنشاء قيد عكسي لإلغاء تأثيره المحاسبي. هذه العملية لا يمكن التراجع عنها.`
              : `Return ${returnNumber} will be voided and a reversal journal entry will be created. This action cannot be undone.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Warning Alert */}
          <Alert variant="destructive" className="border-destructive/30 bg-destructive/10 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {returnType === 'unique'
                ? (language === 'ar' 
                    ? 'سيتم استعادة القطع إلى الفرع الأصلي (إن لم تُباع)' 
                    : 'Items will be restored to original branch (if not sold)')
                : (language === 'ar'
                    ? 'سيتم إلغاء الفاتورة وإنشاء قيد عكسي'
                    : 'Invoice will be cancelled and reversal JE created')}
            </AlertDescription>
          </Alert>

          {/* Reason Input */}
          <div className="space-y-2">
            <Label htmlFor="void-reason">
              {language === 'ar' ? 'سبب الإلغاء *' : 'Reason for Voiding *'}
            </Label>
            <Textarea
              id="void-reason"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (error) setError(null);
              }}
              placeholder={language === 'ar' ? 'أدخل سبب إلغاء المرتجع...' : 'Enter reason for voiding...'}
              rows={3}
              disabled={isVoiding}
            />
          </div>

          {/* Error Display */}
          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isVoiding}
          >
            {language === 'ar' ? 'إلغاء' : 'Cancel'}
          </Button>
          <Button
            variant="destructive"
            onClick={handleVoid}
            disabled={isVoiding || !reason.trim()}
          >
            {isVoiding && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {language === 'ar' ? 'تأكيد الإلغاء' : 'Confirm Void'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
