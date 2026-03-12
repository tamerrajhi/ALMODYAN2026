import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/contexts/LanguageContext';
import { 
  CheckCircle2, 
  XCircle, 
  Clock, 
  AlertTriangle,
  MinusCircle,
  Send
} from 'lucide-react';

interface ZatcaStatusBadgeProps {
  status: string | null;
  showIcon?: boolean;
  isVirtual?: boolean;
}

export function ZatcaStatusBadge({ status, showIcon = true, isVirtual = false }: ZatcaStatusBadgeProps) {
  const { language } = useLanguage();

  const getStatusConfig = () => {
    if (isVirtual && (!status || status === 'not_submitted')) {
      return {
        label: language === 'ar' ? 'تجريبي (Virtual)' : 'Virtual',
        variant: 'outline' as const,
        className: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
        icon: MinusCircle,
      };
    }

    switch (status) {
      case 'cleared':
        return {
          label: language === 'ar' ? 'معتمدة' : 'Cleared',
          variant: 'default' as const,
          className: 'bg-green-500/20 text-green-700 border-green-500/30',
          icon: CheckCircle2,
        };
      case 'reported':
        return {
          label: language === 'ar' ? 'تم الإبلاغ' : 'Reported',
          variant: 'default' as const,
          className: 'bg-blue-500/20 text-blue-700 border-blue-500/30',
          icon: CheckCircle2,
        };
      case 'approved':
        return {
          label: language === 'ar' ? 'مقبولة' : 'Approved',
          variant: 'default' as const,
          className: 'bg-green-500/20 text-green-700 border-green-500/30',
          icon: CheckCircle2,
        };
      case 'pending':
        return {
          label: language === 'ar' ? 'قيد المعالجة' : 'Pending',
          variant: 'secondary' as const,
          className: 'bg-yellow-500/20 text-yellow-700 border-yellow-500/30',
          icon: Clock,
        };
      case 'submitted':
        return {
          label: language === 'ar' ? 'مرسلة' : 'Submitted',
          variant: 'secondary' as const,
          className: 'bg-blue-500/20 text-blue-700 border-blue-500/30',
          icon: Send,
        };
      case 'rejected':
        return {
          label: language === 'ar' ? 'مرفوضة' : 'Rejected',
          variant: 'destructive' as const,
          className: 'bg-red-500/20 text-red-700 border-red-500/30',
          icon: XCircle,
        };
      case 'warning':
        return {
          label: language === 'ar' ? 'تحذيرات' : 'Warnings',
          variant: 'secondary' as const,
          className: 'bg-orange-500/20 text-orange-700 border-orange-500/30',
          icon: AlertTriangle,
        };
      case 'not_submitted':
      default:
        return {
          label: language === 'ar' ? 'لم ترسل' : 'Not Submitted',
          variant: 'outline' as const,
          className: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
          icon: MinusCircle,
        };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className={config.className}>
      {showIcon && <Icon className="w-3 h-3 ml-1" />}
      {config.label}
    </Badge>
  );
}
