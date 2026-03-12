import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  CheckCircle2, 
  XCircle, 
  Clock, 
  AlertTriangle,
  Shield,
  FileCheck,
  Server,
  Calendar
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';

interface ZatcaStatusCardProps {
  onboardingStatus: string;
  environment: string;
  isActive: boolean;
  csidExpiry: string | null;
  invoiceCounter: number;
}

export function ZatcaStatusCard({
  onboardingStatus,
  environment,
  isActive,
  csidExpiry,
  invoiceCounter,
}: ZatcaStatusCardProps) {
  const { t, language } = useLanguage();

  const getStatusInfo = () => {
    switch (onboardingStatus) {
      case 'completed':
        return {
          icon: CheckCircle2,
          color: 'text-green-500',
          bgColor: 'bg-green-500/10',
          label: language === 'ar' ? 'مسجل ونشط' : 'Registered & Active',
        };
      case 'production_ready':
        return {
          icon: FileCheck,
          color: 'text-blue-500',
          bgColor: 'bg-blue-500/10',
          label: language === 'ar' ? 'جاهز للإنتاج' : 'Production Ready',
        };
      case 'compliance_done':
        return {
          icon: Shield,
          color: 'text-yellow-500',
          bgColor: 'bg-yellow-500/10',
          label: language === 'ar' ? 'تم اختبار الامتثال' : 'Compliance Done',
        };
      case 'in_progress':
        return {
          icon: Clock,
          color: 'text-orange-500',
          bgColor: 'bg-orange-500/10',
          label: language === 'ar' ? 'قيد التسجيل' : 'In Progress',
        };
      default:
        return {
          icon: XCircle,
          color: 'text-gray-500',
          bgColor: 'bg-gray-500/10',
          label: language === 'ar' ? 'غير مسجل' : 'Not Registered',
        };
    }
  };

  const statusInfo = getStatusInfo();
  const StatusIcon = statusInfo.icon;

  const isExpiringSoon = csidExpiry 
    ? new Date(csidExpiry).getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000 
    : false;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Registration Status */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">
            {language === 'ar' ? 'حالة التسجيل' : 'Registration Status'}
          </CardTitle>
          <StatusIcon className={`h-5 w-5 ${statusInfo.color}`} />
        </CardHeader>
        <CardContent>
          <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full ${statusInfo.bgColor}`}>
            <span className={`text-sm font-medium ${statusInfo.color}`}>
              {statusInfo.label}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Environment */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">
            {language === 'ar' ? 'البيئة' : 'Environment'}
          </CardTitle>
          <Server className="h-5 w-5 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <Badge variant={environment === 'production' ? 'default' : 'secondary'}>
            {environment === 'production' 
              ? (language === 'ar' ? 'إنتاج' : 'Production')
              : (language === 'ar' ? 'تجريبي' : 'Sandbox')
            }
          </Badge>
          <div className="mt-1 text-xs text-muted-foreground">
            {isActive 
              ? (language === 'ar' ? 'مفعّل' : 'Active')
              : (language === 'ar' ? 'معطّل' : 'Inactive')
            }
          </div>
        </CardContent>
      </Card>

      {/* Certificate Expiry */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">
            {language === 'ar' ? 'انتهاء الشهادة' : 'Certificate Expiry'}
          </CardTitle>
          {isExpiringSoon ? (
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
          ) : (
            <Calendar className="h-5 w-5 text-muted-foreground" />
          )}
        </CardHeader>
        <CardContent>
          {csidExpiry ? (
            <>
              <div className="text-lg font-bold">
                {format(new Date(csidExpiry), 'yyyy/MM/dd', { locale: language === 'ar' ? ar : undefined })}
              </div>
              {isExpiringSoon && (
                <div className="text-xs text-yellow-600 mt-1">
                  {language === 'ar' ? 'ستنتهي قريباً!' : 'Expiring soon!'}
                </div>
              )}
            </>
          ) : (
            <div className="text-muted-foreground">
              {language === 'ar' ? 'غير محدد' : 'Not set'}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Invoice Counter */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">
            {language === 'ar' ? 'عداد الفواتير' : 'Invoice Counter'}
          </CardTitle>
          <FileCheck className="h-5 w-5 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{invoiceCounter.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground mt-1">
            {language === 'ar' ? 'فاتورة مرسلة' : 'invoices submitted'}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
