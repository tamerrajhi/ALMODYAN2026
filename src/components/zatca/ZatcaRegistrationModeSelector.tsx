import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Building2, GitBranch } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface ZatcaRegistrationModeSelectorProps {
  mode: 'unified' | 'per_branch';
  onModeChange: (mode: 'unified' | 'per_branch') => void;
  isLoading?: boolean;
}

export function ZatcaRegistrationModeSelector({
  mode,
  onModeChange,
  isLoading,
}: ZatcaRegistrationModeSelectorProps) {
  const { language } = useLanguage();

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {language === 'ar' ? 'وضع التسجيل' : 'Registration Mode'}
        </CardTitle>
        <CardDescription>
          {language === 'ar' 
            ? 'اختر طريقة تسجيل الشهادات في ZATCA'
            : 'Choose how to register certificates with ZATCA'
          }
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RadioGroup
          value={mode}
          onValueChange={(value) => onModeChange(value as 'unified' | 'per_branch')}
          className="grid grid-cols-1 md:grid-cols-2 gap-4"
          disabled={isLoading}
        >
          <Label
            htmlFor="unified"
            className={`flex items-start gap-4 p-4 border rounded-lg cursor-pointer transition-colors ${
              mode === 'unified' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
            }`}
          >
            <RadioGroupItem value="unified" id="unified" className="mt-1" />
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <Building2 className="h-5 w-5 text-primary" />
                <span className="font-medium">
                  {language === 'ar' ? 'إعدادات موحدة للشركة' : 'Unified Company Settings'}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {language === 'ar' 
                  ? 'شهادة واحدة وإعدادات CSR موحدة لجميع الفروع. مناسب للشركات ذات الفرع الواحد أو نقطة البيع الواحدة.'
                  : 'Single certificate and unified CSR settings for all branches. Suitable for single-branch or single POS companies.'
                }
              </p>
            </div>
          </Label>

          <Label
            htmlFor="per_branch"
            className={`flex items-start gap-4 p-4 border rounded-lg cursor-pointer transition-colors ${
              mode === 'per_branch' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
            }`}
          >
            <RadioGroupItem value="per_branch" id="per_branch" className="mt-1" />
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <GitBranch className="h-5 w-5 text-primary" />
                <span className="font-medium">
                  {language === 'ar' ? 'إعدادات منفصلة لكل فرع' : 'Separate Settings Per Branch'}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {language === 'ar' 
                  ? 'كل فرع له شهادة ورقم تسلسلي خاص. مطلوب إذا كان لديك عدة أجهزة نقاط بيع أو فروع متعددة.'
                  : 'Each branch has its own certificate and serial number. Required if you have multiple POS devices or branches.'
                }
              </p>
            </div>
          </Label>
        </RadioGroup>
      </CardContent>
    </Card>
  );
}
