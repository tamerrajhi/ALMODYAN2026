import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Send, CheckCircle, XCircle, Info } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useZatcaSubmit } from '@/hooks/useZatcaSubmit';
import { useZatcaSettings } from '@/hooks/useZatcaSettings';
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface ZatcaSubmitButtonProps {
  invoiceId: string;
  invoiceType: 'standard' | 'simplified';
  zatcaStatus: string | null;
  disabled?: boolean;
}

export function ZatcaSubmitButton({
  invoiceId,
  invoiceType,
  zatcaStatus,
  disabled,
}: ZatcaSubmitButtonProps) {
  const { language } = useLanguage();
  const { submitInvoice, isSubmitting } = useZatcaSubmit();
  const { zatca_mode, canSubmit, disabledReason } = useZatcaSettings();
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  const isSubmitted = zatcaStatus === 'cleared' || zatcaStatus === 'reported' || zatcaStatus === 'approved';
  const isRejected = zatcaStatus === 'rejected';

  const handleSubmit = () => {
    submitInvoice.mutate({ invoiceId, invoiceType });
    setShowConfirmDialog(false);
  };

  if (isSubmitted) {
    return (
      <Button variant="ghost" size="sm" disabled className="text-green-600">
        <CheckCircle className="w-4 h-4 ml-2" />
        {invoiceType === 'standard' 
          ? (language === 'ar' ? 'تم الاعتماد' : 'Cleared')
          : (language === 'ar' ? 'تم الإبلاغ' : 'Reported')
        }
      </Button>
    );
  }

  const modeLabel = zatca_mode === 'production'
    ? (language === 'ar' ? 'إرسال Production' : 'Submit Production')
    : (language === 'ar' ? 'إرسال Sandbox' : 'Submit Sandbox');

  const defaultLabel = isRejected
    ? (language === 'ar' ? 'إعادة الإرسال' : 'Retry')
    : invoiceType === 'standard'
      ? (language === 'ar' ? 'Clearance' : 'Clearance')
      : (language === 'ar' ? 'Reporting' : 'Reporting');

  const buttonLabel = canSubmit ? modeLabel : defaultLabel;
  const isButtonDisabled = disabled || isSubmitting || !canSubmit;

  const button = (
    <Button
      variant={isRejected ? 'destructive' : 'outline'}
      size="sm"
      onClick={() => canSubmit && setShowConfirmDialog(true)}
      disabled={isButtonDisabled}
      data-testid={`button-zatca-submit-${invoiceId}`}
    >
      {isSubmitting ? (
        <Loader2 className="w-4 h-4 ml-2 animate-spin" />
      ) : isRejected ? (
        <XCircle className="w-4 h-4 ml-2" />
      ) : !canSubmit ? (
        <Info className="w-4 h-4 ml-2" />
      ) : (
        <Send className="w-4 h-4 ml-2" />
      )}
      {buttonLabel}
    </Button>
  );

  return (
    <>
      {!canSubmit && disabledReason ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>{button}</span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs text-center">
            <p>{disabledReason}</p>
          </TooltipContent>
        </Tooltip>
      ) : (
        button
      )}

      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {language === 'ar' ? 'تأكيد الإرسال للهيئة' : 'Confirm ZATCA Submission'}
              {zatca_mode === 'sandbox' && (
                <span className="text-sm font-normal text-blue-500 mr-2">(Sandbox)</span>
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {zatca_mode === 'sandbox' ? (
                language === 'ar' 
                  ? 'سيتم إرسال الفاتورة لبيئة التجربة (Sandbox). هذا الإجراء للاختبار فقط.'
                  : 'The invoice will be submitted to the Sandbox environment. This is for testing only.'
              ) : invoiceType === 'standard' ? (
                language === 'ar' 
                  ? 'سيتم إرسال الفاتورة للاعتماد (Clearance) في بيئة الإنتاج. لا يمكن التراجع عن هذا الإجراء.'
                  : 'The invoice will be submitted for Clearance in Production. This action cannot be undone.'
              ) : (
                language === 'ar' 
                  ? 'سيتم إرسال الفاتورة للإبلاغ (Reporting) في بيئة الإنتاج. لا يمكن التراجع عن هذا الإجراء.'
                  : 'The invoice will be submitted for Reporting in Production. This action cannot be undone.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {language === 'ar' ? 'إلغاء' : 'Cancel'}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleSubmit}>
              {language === 'ar' ? 'إرسال' : 'Submit'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
