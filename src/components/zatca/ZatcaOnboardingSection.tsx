import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { 
  Rocket, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  ExternalLink,
  Loader2,
  ArrowRight
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface ZatcaOnboardingSectionProps {
  onboardingStatus: string;
  onStartOnboarding: (otp: string) => void;
  onCompleteCompliance: () => void;
  onRequestProductionCSID: () => void;
  isLoading?: boolean;
}

export function ZatcaOnboardingSection({
  onboardingStatus,
  onStartOnboarding,
  onCompleteCompliance,
  onRequestProductionCSID,
  isLoading,
}: ZatcaOnboardingSectionProps) {
  const { language } = useLanguage();
  const [otp, setOtp] = useState('');

  const steps = [
    {
      id: 'start',
      title: language === 'ar' ? 'البدء' : 'Start',
      description: language === 'ar' ? 'إدخال OTP والتسجيل' : 'Enter OTP and register',
      completed: ['in_progress', 'compliance_done', 'production_ready', 'completed'].includes(onboardingStatus),
      current: onboardingStatus === 'not_started',
    },
    {
      id: 'compliance',
      title: language === 'ar' ? 'اختبار الامتثال' : 'Compliance Testing',
      description: language === 'ar' ? 'إرسال فواتير اختبارية' : 'Submit test invoices',
      completed: ['compliance_done', 'production_ready', 'completed'].includes(onboardingStatus),
      current: onboardingStatus === 'in_progress',
    },
    {
      id: 'production',
      title: language === 'ar' ? 'شهادة الإنتاج' : 'Production Certificate',
      description: language === 'ar' ? 'الحصول على CSID للإنتاج' : 'Get production CSID',
      completed: ['production_ready', 'completed'].includes(onboardingStatus),
      current: onboardingStatus === 'compliance_done',
    },
    {
      id: 'complete',
      title: language === 'ar' ? 'مكتمل' : 'Complete',
      description: language === 'ar' ? 'جاهز للعمل' : 'Ready to operate',
      completed: onboardingStatus === 'completed',
      current: onboardingStatus === 'production_ready',
    },
  ];

  const handleStartOnboarding = () => {
    if (otp.trim()) {
      onStartOnboarding(otp.trim());
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Rocket className="h-5 w-5" />
          <CardTitle>
            {language === 'ar' ? 'التسجيل والاعتماد' : 'Onboarding & Certification'}
          </CardTitle>
        </div>
        <CardDescription>
          {language === 'ar' 
            ? 'خطوات التسجيل في منظومة الفوترة الإلكترونية'
            : 'Steps to register in the e-invoicing system'
          }
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Progress Steps */}
        <div className="flex items-center justify-between">
          {steps.map((step, index) => (
            <div key={step.id} className="flex items-center">
              <div className="flex flex-col items-center">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 ${
                  step.completed 
                    ? 'bg-green-500 border-green-500 text-white'
                    : step.current
                      ? 'bg-primary border-primary text-primary-foreground'
                      : 'bg-muted border-muted-foreground/20'
                }`}>
                  {step.completed ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : step.current ? (
                    <Clock className="h-5 w-5" />
                  ) : (
                    <span className="text-sm font-medium">{index + 1}</span>
                  )}
                </div>
                <div className="mt-2 text-center">
                  <div className="text-sm font-medium">{step.title}</div>
                  <div className="text-xs text-muted-foreground hidden md:block">{step.description}</div>
                </div>
              </div>
              {index < steps.length - 1 && (
                <ArrowRight className="h-5 w-5 text-muted-foreground mx-2 hidden md:block" />
              )}
            </div>
          ))}
        </div>

        {/* Action Section Based on Status */}
        <div className="p-4 rounded-lg border bg-muted/50">
          {onboardingStatus === 'not_started' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium">
                    {language === 'ar' ? 'للبدء، تحتاج رمز OTP' : 'To start, you need an OTP code'}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {language === 'ar' 
                      ? 'احصل على رمز OTP من بوابة Fatoora'
                      : 'Get the OTP code from Fatoora portal'
                    }
                  </div>
                  <Button variant="link" className="px-0 h-auto mt-1" asChild>
                    <a 
                      href="https://fatoora.zatca.gov.sa/" 
                      target="_blank" 
                      rel="noopener noreferrer"
                    >
                      {language === 'ar' ? 'فتح بوابة Fatoora' : 'Open Fatoora Portal'}
                      <ExternalLink className="w-4 h-4 mr-1" />
                    </a>
                  </Button>
                </div>
              </div>
              
              <div className="flex gap-3">
                <div className="flex-1">
                  <Label htmlFor="otp">
                    {language === 'ar' ? 'رمز OTP' : 'OTP Code'}
                  </Label>
                  <Input
                    id="otp"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    placeholder={language === 'ar' ? 'أدخل رمز OTP' : 'Enter OTP code'}
                    className="mt-1"
                  />
                </div>
                <div className="flex items-end">
                  <Button 
                    onClick={handleStartOnboarding} 
                    disabled={!otp.trim() || isLoading}
                  >
                    {isLoading && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
                    {language === 'ar' ? 'بدء التسجيل' : 'Start Registration'}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {onboardingStatus === 'in_progress' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-yellow-500" />
                <div>
                  <div className="font-medium">
                    {language === 'ar' ? 'جاري اختبارات الامتثال' : 'Compliance Testing in Progress'}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {language === 'ar' 
                      ? 'يجب إرسال 6 فواتير اختبارية للمتابعة'
                      : 'You need to submit 6 test invoices to proceed'
                    }
                  </div>
                </div>
              </div>
              <Button onClick={onCompleteCompliance} disabled={isLoading}>
                {isLoading && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
                {language === 'ar' ? 'إكمال اختبارات الامتثال' : 'Complete Compliance Testing'}
              </Button>
            </div>
          )}

          {onboardingStatus === 'compliance_done' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <div>
                  <div className="font-medium">
                    {language === 'ar' ? 'تم اجتياز اختبارات الامتثال' : 'Compliance Testing Passed'}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {language === 'ar' 
                      ? 'يمكنك الآن طلب شهادة الإنتاج'
                      : 'You can now request the production certificate'
                    }
                  </div>
                </div>
              </div>
              <Button onClick={onRequestProductionCSID} disabled={isLoading}>
                {isLoading && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
                {language === 'ar' ? 'طلب شهادة الإنتاج' : 'Request Production Certificate'}
              </Button>
            </div>
          )}

          {(onboardingStatus === 'production_ready' || onboardingStatus === 'completed') && (
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <div>
                <div className="font-medium">
                  {language === 'ar' ? 'التسجيل مكتمل!' : 'Registration Complete!'}
                </div>
                <div className="text-sm text-muted-foreground">
                  {language === 'ar' 
                    ? 'يمكنك الآن إرسال الفواتير للهيئة'
                    : 'You can now submit invoices to ZATCA'
                  }
                </div>
              </div>
              <Badge variant="default" className="mr-auto">
                {language === 'ar' ? 'نشط' : 'Active'}
              </Badge>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
