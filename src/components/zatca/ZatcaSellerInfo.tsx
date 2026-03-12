import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Building2, MapPin, Phone, Mail, FileText, ExternalLink } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useNavigate } from 'react-router-dom';

interface CompanySettings {
  company_name: string;
  company_name_en: string | null;
  tax_number: string | null;
  commercial_registration: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
}

interface ZatcaSellerInfoProps {
  companySettings: CompanySettings | null;
}

export function ZatcaSellerInfo({ companySettings }: ZatcaSellerInfoProps) {
  const { language } = useLanguage();
  const navigate = useNavigate();

  if (!companySettings) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            {language === 'ar' ? 'بيانات البائع' : 'Seller Information'}
          </CardTitle>
          <CardDescription>
            {language === 'ar' 
              ? 'يجب إعداد بيانات الشركة أولاً'
              : 'Company settings must be configured first'
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => navigate('/settings')}>
            {language === 'ar' ? 'الذهاب للإعدادات' : 'Go to Settings'}
            <ExternalLink className="w-4 h-4 mr-2" />
          </Button>
        </CardContent>
      </Card>
    );
  }

  const isComplete = companySettings.company_name && companySettings.tax_number && companySettings.address;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            <CardTitle>
              {language === 'ar' ? 'بيانات البائع' : 'Seller Information'}
            </CardTitle>
          </div>
          <Badge variant={isComplete ? 'default' : 'destructive'}>
            {isComplete 
              ? (language === 'ar' ? 'مكتمل' : 'Complete')
              : (language === 'ar' ? 'غير مكتمل' : 'Incomplete')
            }
          </Badge>
        </div>
        <CardDescription>
          {language === 'ar' 
            ? 'بيانات البائع المستخدمة في الفواتير الإلكترونية'
            : 'Seller data used in e-invoices'
          }
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Company Name */}
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">
              {language === 'ar' ? 'اسم الشركة' : 'Company Name'}
            </div>
            <div className="font-medium">
              {language === 'ar' ? companySettings.company_name : (companySettings.company_name_en || companySettings.company_name)}
            </div>
          </div>

          {/* VAT Number */}
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground flex items-center gap-1">
              <FileText className="h-4 w-4" />
              {language === 'ar' ? 'الرقم الضريبي' : 'VAT Number'}
            </div>
            <div className="font-mono font-medium">
              {companySettings.tax_number || (
                <span className="text-destructive">
                  {language === 'ar' ? 'مطلوب' : 'Required'}
                </span>
              )}
            </div>
          </div>

          {/* Commercial Registration */}
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">
              {language === 'ar' ? 'السجل التجاري' : 'Commercial Registration'}
            </div>
            <div className="font-mono">
              {companySettings.commercial_registration || '-'}
            </div>
          </div>

          {/* Address */}
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground flex items-center gap-1">
              <MapPin className="h-4 w-4" />
              {language === 'ar' ? 'العنوان' : 'Address'}
            </div>
            <div>
              {companySettings.address || (
                <span className="text-destructive">
                  {language === 'ar' ? 'مطلوب' : 'Required'}
                </span>
              )}
            </div>
          </div>

          {/* City & Country */}
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">
              {language === 'ar' ? 'المدينة / الدولة' : 'City / Country'}
            </div>
            <div>
              {[companySettings.city, companySettings.country].filter(Boolean).join(', ') || '-'}
            </div>
          </div>

          {/* Contact */}
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">
              {language === 'ar' ? 'التواصل' : 'Contact'}
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              {companySettings.phone && (
                <span className="flex items-center gap-1">
                  <Phone className="h-3 w-3" />
                  {companySettings.phone}
                </span>
              )}
              {companySettings.email && (
                <span className="flex items-center gap-1">
                  <Mail className="h-3 w-3" />
                  {companySettings.email}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="pt-4 border-t">
          <Button variant="outline" size="sm" onClick={() => navigate('/settings')}>
            {language === 'ar' ? 'تعديل بيانات الشركة' : 'Edit Company Settings'}
            <ExternalLink className="w-4 h-4 mr-2" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
