import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { KeyRound, Save, Info } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface CSRSettings {
  csr_common_name: string | null;
  csr_organization_unit: string | null;
  csr_organization: string | null;
  csr_country: string | null;
  csr_serial_number: string | null;
  csr_location: string | null;
  csr_industry: string | null;
}

interface ZatcaCertificateSettingsProps {
  settings: CSRSettings;
  onSave: (settings: Partial<CSRSettings>) => void;
  isLoading?: boolean;
  suggestedSerialSuffix?: string;
}

export function ZatcaCertificateSettings({
  settings,
  onSave,
  isLoading,
  suggestedSerialSuffix = 'MAIN',
}: ZatcaCertificateSettingsProps) {
  const { language } = useLanguage();
  const [formData, setFormData] = useState<CSRSettings>({
    csr_common_name: settings.csr_common_name || '',
    csr_organization_unit: settings.csr_organization_unit || '',
    csr_organization: settings.csr_organization || '',
    csr_country: settings.csr_country || 'SA',
    csr_serial_number: settings.csr_serial_number || '',
    csr_location: settings.csr_location || '',
    csr_industry: settings.csr_industry || '',
  });

  useEffect(() => {
    setFormData({
      csr_common_name: settings.csr_common_name || '',
      csr_organization_unit: settings.csr_organization_unit || '',
      csr_organization: settings.csr_organization || '',
      csr_country: settings.csr_country || 'SA',
      csr_serial_number: settings.csr_serial_number || '',
      csr_location: settings.csr_location || '',
      csr_industry: settings.csr_industry || '',
    });
  }, [settings]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  const fields = [
    {
      key: 'csr_common_name',
      label: language === 'ar' ? 'الاسم الشائع (CN)' : 'Common Name (CN)',
      placeholder: language === 'ar' ? 'مثال: EGS1-Jewelry-POS' : 'Example: EGS1-Jewelry-POS',
      tooltip: language === 'ar' 
        ? 'اسم معرف الجهاز - يبدأ بـ EGS متبوعاً برقم ثم اسم النظام' 
        : 'Device identifier name - starts with EGS followed by number and system name',
      required: true,
      example: 'EGS1-MyCompany-POS',
    },
    {
      key: 'csr_organization_unit',
      label: language === 'ar' ? 'الوحدة التنظيمية (OU)' : 'Organization Unit (OU)',
      placeholder: language === 'ar' ? 'مثال: 310175397400003' : 'Example: 310175397400003',
      tooltip: language === 'ar' 
        ? 'الرقم الضريبي للمنشأة (VAT) - 15 رقم' 
        : 'Organization VAT number - 15 digits',
      required: true,
      example: '310175397400003',
    },
    {
      key: 'csr_organization',
      label: language === 'ar' ? 'المنظمة (O)' : 'Organization (O)',
      placeholder: language === 'ar' ? 'مثال: شركة الذهب للمجوهرات' : 'Example: Gold Jewelry Company',
      tooltip: language === 'ar' 
        ? 'الاسم القانوني للمنشأة كما هو مسجل في السجل التجاري' 
        : 'Legal name of the organization as registered',
      required: true,
      example: language === 'ar' ? 'شركة المجوهرات الذهبية' : 'Golden Jewelry Co.',
    },
    {
      key: 'csr_country',
      label: language === 'ar' ? 'الدولة (C)' : 'Country (C)',
      placeholder: 'SA',
      tooltip: language === 'ar' 
        ? 'رمز الدولة ISO - SA للمملكة العربية السعودية (ثابت)' 
        : 'ISO Country code - SA for Saudi Arabia (fixed)',
      required: true,
      disabled: true,
      example: 'SA',
    },
    {
      key: 'csr_serial_number',
      label: language === 'ar' ? 'الرقم التسلسلي للجهاز' : 'Device Serial Number',
      placeholder: language === 'ar' 
        ? `مثال: 1-JewelryPOS|2-1.0|3-${suggestedSerialSuffix}` 
        : `Example: 1-JewelryPOS|2-1.0|3-${suggestedSerialSuffix}`,
      tooltip: language === 'ar' 
        ? `التنسيق: 1-[اسم النظام]|2-[الإصدار]|3-[معرف الفرع]. مثال: 1-JewelryPOS|2-1.0|3-${suggestedSerialSuffix}` 
        : `Format: 1-[System Name]|2-[Version]|3-[Branch ID]. Example: 1-JewelryPOS|2-1.0|3-${suggestedSerialSuffix}`,
      required: true,
      example: `1-JewelryPOS|2-1.0|3-${suggestedSerialSuffix}`,
    },
    {
      key: 'csr_location',
      label: language === 'ar' ? 'الموقع (L)' : 'Location (L)',
      placeholder: language === 'ar' ? 'مثال: الرياض' : 'Example: Riyadh',
      tooltip: language === 'ar' 
        ? 'اسم المدينة التي يوجد بها مقر المنشأة' 
        : 'City name where the organization is located',
      required: false,
      example: language === 'ar' ? 'الرياض' : 'Riyadh',
    },
    {
      key: 'csr_industry',
      label: language === 'ar' ? 'القطاع' : 'Industry',
      placeholder: language === 'ar' ? 'مثال: تجارة المجوهرات' : 'Example: Jewelry Retail',
      tooltip: language === 'ar' 
        ? 'نوع النشاط التجاري للمنشأة' 
        : 'Business activity type of the organization',
      required: false,
      example: language === 'ar' ? 'تجارة المجوهرات' : 'Jewelry Retail',
    },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" />
          <CardTitle>
            {language === 'ar' ? 'إعدادات الشهادة (CSR)' : 'Certificate Settings (CSR)'}
          </CardTitle>
        </div>
        <CardDescription>
          {language === 'ar' 
            ? 'بيانات طلب توقيع الشهادة المطلوبة للتسجيل في ZATCA'
            : 'Certificate Signing Request data required for ZATCA registration'
          }
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {fields.map((field) => (
              <div key={field.key} className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor={field.key}>
                    {field.label}
                    {field.required && <span className="text-destructive">*</span>}
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">{field.tooltip}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Input
                  id={field.key}
                  value={formData[field.key as keyof CSRSettings] || ''}
                  onChange={(e) => setFormData({ ...formData, [field.key]: e.target.value })}
                  placeholder={field.placeholder}
                  disabled={field.disabled}
                  required={field.required}
                />
              </div>
            ))}
          </div>

          <div className="pt-4 border-t">
            <Button type="submit" disabled={isLoading}>
              <Save className="w-4 h-4 ml-2" />
              {language === 'ar' ? 'حفظ الإعدادات' : 'Save Settings'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
