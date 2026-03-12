import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { AlertTriangle, Server, Shield, TestTube } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
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

interface ZatcaEnvironmentSettingsProps {
  environment: 'sandbox' | 'production';
  isActive: boolean;
  onEnvironmentChange: (env: 'sandbox' | 'production') => void;
  onActiveChange: (active: boolean) => void;
  isLoading?: boolean;
}

export function ZatcaEnvironmentSettings({
  environment,
  isActive,
  onEnvironmentChange,
  onActiveChange,
  isLoading,
}: ZatcaEnvironmentSettingsProps) {
  const { language } = useLanguage();
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingEnvironment, setPendingEnvironment] = useState<'sandbox' | 'production' | null>(null);

  const handleEnvironmentChange = (value: string) => {
    if (value === 'production' && environment === 'sandbox') {
      setPendingEnvironment('production');
      setShowConfirmDialog(true);
    } else {
      onEnvironmentChange(value as 'sandbox' | 'production');
    }
  };

  const confirmEnvironmentChange = () => {
    if (pendingEnvironment) {
      onEnvironmentChange(pendingEnvironment);
    }
    setShowConfirmDialog(false);
    setPendingEnvironment(null);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            <CardTitle>
              {language === 'ar' ? 'إعدادات البيئة' : 'Environment Settings'}
            </CardTitle>
          </div>
          <CardDescription>
            {language === 'ar' 
              ? 'اختر بيئة العمل وتفعيل التكامل'
              : 'Choose working environment and enable integration'
            }
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Environment Selection */}
          <div className="space-y-4">
            <Label>
              {language === 'ar' ? 'البيئة' : 'Environment'}
            </Label>
            <RadioGroup 
              value={environment} 
              onValueChange={handleEnvironmentChange}
              className="grid grid-cols-1 md:grid-cols-2 gap-4"
            >
              {/* Sandbox */}
              <div className={`flex items-start space-x-4 space-x-reverse p-4 rounded-lg border-2 cursor-pointer transition-colors ${
                environment === 'sandbox' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
              }`}>
                <RadioGroupItem value="sandbox" id="sandbox" className="mt-1" />
                <div className="flex-1">
                  <Label htmlFor="sandbox" className="cursor-pointer flex items-center gap-2">
                    <TestTube className="h-4 w-4 text-blue-500" />
                    {language === 'ar' ? 'بيئة التجربة (Sandbox)' : 'Sandbox Environment'}
                  </Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    {language === 'ar' 
                      ? 'للاختبار والتطوير - لا يتم إرسال الفواتير للهيئة'
                      : 'For testing and development - invoices are not sent to ZATCA'
                    }
                  </p>
                </div>
              </div>

              {/* Production */}
              <div className={`flex items-start space-x-4 space-x-reverse p-4 rounded-lg border-2 cursor-pointer transition-colors ${
                environment === 'production' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
              }`}>
                <RadioGroupItem value="production" id="production" className="mt-1" />
                <div className="flex-1">
                  <Label htmlFor="production" className="cursor-pointer flex items-center gap-2">
                    <Shield className="h-4 w-4 text-green-500" />
                    {language === 'ar' ? 'بيئة الإنتاج (Production)' : 'Production Environment'}
                  </Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    {language === 'ar' 
                      ? 'للعمل الفعلي - يتم إرسال الفواتير للهيئة'
                      : 'For live operations - invoices are sent to ZATCA'
                    }
                  </p>
                </div>
              </div>
            </RadioGroup>
          </div>

          {/* Active Toggle */}
          <div className="flex items-center justify-between p-4 rounded-lg border">
            <div className="space-y-0.5">
              <Label>
                {language === 'ar' ? 'تفعيل التكامل' : 'Enable Integration'}
              </Label>
              <p className="text-sm text-muted-foreground">
                {language === 'ar' 
                  ? 'تفعيل أو تعطيل إرسال الفواتير للهيئة'
                  : 'Enable or disable sending invoices to ZATCA'
                }
              </p>
            </div>
            <Switch
              checked={isActive}
              onCheckedChange={onActiveChange}
              disabled={isLoading}
            />
          </div>

          {/* Warning for production */}
          {environment === 'production' && isActive && (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
              <AlertTriangle className="h-5 w-5 text-yellow-600 shrink-0 mt-0.5" />
              <div className="text-sm text-yellow-800 dark:text-yellow-200">
                {language === 'ar' 
                  ? 'تحذير: أنت في بيئة الإنتاج. جميع الفواتير سيتم إرسالها للهيئة ولا يمكن التراجع عنها.'
                  : 'Warning: You are in production mode. All invoices will be sent to ZATCA and cannot be reversed.'
                }
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              {language === 'ar' ? 'تأكيد التحويل للإنتاج' : 'Confirm Production Switch'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {language === 'ar' 
                ? 'هل أنت متأكد من التحويل لبيئة الإنتاج؟ جميع الفواتير سيتم إرسالها للهيئة ولا يمكن التراجع عنها.'
                : 'Are you sure you want to switch to production? All invoices will be sent to ZATCA and cannot be reversed.'
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {language === 'ar' ? 'إلغاء' : 'Cancel'}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmEnvironmentChange}>
              {language === 'ar' ? 'تأكيد' : 'Confirm'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
