import { useLanguage } from '@/contexts/LanguageContext';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ShieldAlert, RefreshCw } from 'lucide-react';
import { differenceInDays } from 'date-fns';

interface ZatcaCsidExpiryAlertProps {
  csidExpiry: string | null;
  onRenew?: () => void;
  isRenewing?: boolean;
}

export function ZatcaCsidExpiryAlert({
  csidExpiry,
  onRenew,
  isRenewing = false,
}: ZatcaCsidExpiryAlertProps) {
  const { language } = useLanguage();

  if (!csidExpiry) return null;

  const expiryDate = new Date(csidExpiry);
  const today = new Date();
  const daysRemaining = differenceInDays(expiryDate, today);

  // Don't show alert if more than 30 days remaining
  if (daysRemaining > 30) return null;

  const isExpired = daysRemaining < 0;
  const isCritical = daysRemaining <= 7;
  const isWarning = daysRemaining <= 30 && daysRemaining > 7;

  const getAlertVariant = () => {
    if (isExpired || isCritical) return 'destructive';
    return 'default';
  };

  const getTitle = () => {
    if (isExpired) {
      return language === 'ar' 
        ? 'انتهت صلاحية شهادة CSID!' 
        : 'CSID Certificate Expired!';
    }
    if (isCritical) {
      return language === 'ar' 
        ? 'تنبيه: شهادة CSID على وشك الانتهاء!' 
        : 'Alert: CSID Certificate Expiring Soon!';
    }
    return language === 'ar' 
      ? 'تذكير: شهادة CSID ستنتهي قريباً' 
      : 'Reminder: CSID Certificate Expiring Soon';
  };

  const getMessage = () => {
    if (isExpired) {
      const daysPast = Math.abs(daysRemaining);
      return language === 'ar'
        ? `انتهت صلاحية الشهادة منذ ${daysPast} ${daysPast === 1 ? 'يوم' : 'أيام'}. يجب تجديد الشهادة فوراً لاستمرار إرسال الفواتير.`
        : `Certificate expired ${daysPast} day${daysPast === 1 ? '' : 's'} ago. Renew immediately to continue submitting invoices.`;
    }
    if (isCritical) {
      return language === 'ar'
        ? `ستنتهي صلاحية الشهادة خلال ${daysRemaining} ${daysRemaining === 1 ? 'يوم' : 'أيام'}. يُرجى التجديد فوراً لتجنب انقطاع الخدمة.`
        : `Certificate expires in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}. Please renew immediately to avoid service interruption.`;
    }
    return language === 'ar'
      ? `ستنتهي صلاحية الشهادة خلال ${daysRemaining} يوماً. يُنصح بالتجديد قبل انتهاء الصلاحية.`
      : `Certificate expires in ${daysRemaining} days. Consider renewing before expiry.`;
  };

  const Icon = isExpired || isCritical ? ShieldAlert : AlertTriangle;

  return (
    <Alert variant={getAlertVariant()} className="mb-4">
      <Icon className="h-5 w-5" />
      <AlertTitle className="flex items-center justify-between">
        <span>{getTitle()}</span>
        {onRenew && (
          <Button
            variant={isCritical || isExpired ? 'destructive' : 'outline'}
            size="sm"
            onClick={onRenew}
            disabled={isRenewing}
            className="mr-auto"
          >
            {isRenewing ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="mr-2">
              {language === 'ar' ? 'تجديد الشهادة' : 'Renew Certificate'}
            </span>
          </Button>
        )}
      </AlertTitle>
      <AlertDescription>{getMessage()}</AlertDescription>
    </Alert>
  );
}
