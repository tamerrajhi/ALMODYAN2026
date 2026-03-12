import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/contexts/LanguageContext';
import { Building2, Save, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';

interface CompanySettings {
  id: string;
  company_name: string;
  company_name_en: string | null;
  tax_number: string | null;
  commercial_registration: string | null;
  address: string | null;
  address_en: string | null;
  city: string | null;
  city_en: string | null;
  country: string | null;
  country_en: string | null;
  postal_code: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logo_url: string | null;
}

export function CompanySettingsForm() {
  const { language } = useLanguage();
  const isRTL = language === 'ar';
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState<Partial<CompanySettings>>({});
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch company settings
  const { data: companySettings, isLoading } = useQuery({
    queryKey: ['company-settings'],
    queryFn: async () => {
      const res = await fetch('/api/company-settings', { credentials: 'include' });
      if (res.status === 501) return null;
      if (!res.ok) throw new Error('Failed to fetch company settings');
      return (await res.json()) as CompanySettings | null;
    },
  });

  // Update form data when settings are fetched
  useEffect(() => {
    if (companySettings) {
      setFormData(companySettings);
      setHasChanges(false);
    }
  }, [companySettings]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (data: Partial<CompanySettings>) => {
      if (companySettings?.id) {
        forbidDirectWrite('update', 'CompanySettingsForm.tsx:saveMutation:update');
      } else {
        forbidDirectWrite('insert', 'CompanySettingsForm.tsx:saveMutation:insert');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-settings'] });
      queryClient.invalidateQueries({ queryKey: ['zatca-settings'] });
      setHasChanges(false);
      toast({
        title: isRTL ? 'تم الحفظ بنجاح' : 'Saved successfully',
        description: isRTL ? 'تم حفظ بيانات الشركة' : 'Company data has been saved',
      });
    },
    onError: (error: any) => {
      toast({
        title: isRTL ? 'خطأ في الحفظ' : 'Save error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleChange = (field: keyof CompanySettings, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  const handleSave = () => {
    saveMutation.mutate(formData);
  };

  // Check if essential fields for ZATCA are complete
  const isZatcaComplete = Boolean(
    formData.company_name &&
    formData.tax_number &&
    formData.address &&
    formData.city &&
    formData.country
  );

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg">
              {isRTL ? 'بيانات الشركة' : 'Company Information'}
            </CardTitle>
          </div>
          <Badge variant={isZatcaComplete ? 'default' : 'secondary'} className="gap-1">
            {isZatcaComplete ? (
              <>
                <CheckCircle2 className="w-3 h-3" />
                {isRTL ? 'مكتمل لـ ZATCA' : 'ZATCA Ready'}
              </>
            ) : (
              <>
                <AlertCircle className="w-3 h-3" />
                {isRTL ? 'غير مكتمل' : 'Incomplete'}
              </>
            )}
          </Badge>
        </div>
        <CardDescription>
          {isRTL
            ? 'بيانات الشركة المستخدمة في الفواتير وإعدادات ZATCA'
            : 'Company data used in invoices and ZATCA settings'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Company Name */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="company_name">
              {isRTL ? 'اسم الشركة (عربي)' : 'Company Name (Arabic)'} *
            </Label>
            <Input
              id="company_name"
              value={formData.company_name || ''}
              onChange={(e) => handleChange('company_name', e.target.value)}
              placeholder={isRTL ? 'اسم الشركة بالعربية' : 'Company name in Arabic'}
              dir="rtl"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="company_name_en">
              {isRTL ? 'اسم الشركة (إنجليزي)' : 'Company Name (English)'}
            </Label>
            <Input
              id="company_name_en"
              value={formData.company_name_en || ''}
              onChange={(e) => handleChange('company_name_en', e.target.value)}
              placeholder={isRTL ? 'اسم الشركة بالإنجليزية' : 'Company name in English'}
              dir="ltr"
            />
          </div>
        </div>

        {/* Tax & Registration */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="tax_number">
              {isRTL ? 'الرقم الضريبي (VAT)' : 'VAT Number'} *
            </Label>
            <Input
              id="tax_number"
              value={formData.tax_number || ''}
              onChange={(e) => handleChange('tax_number', e.target.value)}
              placeholder="300000000000003"
              maxLength={15}
              dir="ltr"
            />
            <p className="text-xs text-muted-foreground">
              {isRTL ? '15 رقم - مطلوب لـ ZATCA' : '15 digits - Required for ZATCA'}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="commercial_registration">
              {isRTL ? 'السجل التجاري' : 'Commercial Registration'}
            </Label>
            <Input
              id="commercial_registration"
              value={formData.commercial_registration || ''}
              onChange={(e) => handleChange('commercial_registration', e.target.value)}
              placeholder={isRTL ? 'رقم السجل التجاري' : 'CR Number'}
              dir="ltr"
            />
          </div>
        </div>

        {/* Address */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="address">
              {isRTL ? 'العنوان (عربي)' : 'Address (Arabic)'} *
            </Label>
            <Textarea
              id="address"
              value={formData.address || ''}
              onChange={(e) => handleChange('address', e.target.value)}
              placeholder={isRTL ? 'الشارع، الحي، المبنى' : 'Street, District, Building'}
              dir="rtl"
              rows={2}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="address_en">
              {isRTL ? 'العنوان (إنجليزي)' : 'Address (English)'}
            </Label>
            <Textarea
              id="address_en"
              value={formData.address_en || ''}
              onChange={(e) => handleChange('address_en', e.target.value)}
              placeholder="Street, District, Building"
              dir="ltr"
              rows={2}
            />
          </div>
        </div>

        {/* City & Country */}
        <div className="grid gap-4 md:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="city">
              {isRTL ? 'المدينة' : 'City'} *
            </Label>
            <Input
              id="city"
              value={formData.city || ''}
              onChange={(e) => handleChange('city', e.target.value)}
              placeholder={isRTL ? 'الرياض' : 'Riyadh'}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="city_en">
              {isRTL ? 'المدينة (إنجليزي)' : 'City (English)'}
            </Label>
            <Input
              id="city_en"
              value={formData.city_en || ''}
              onChange={(e) => handleChange('city_en', e.target.value)}
              placeholder="Riyadh"
              dir="ltr"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="country">
              {isRTL ? 'الدولة' : 'Country'} *
            </Label>
            <Input
              id="country"
              value={formData.country || ''}
              onChange={(e) => handleChange('country', e.target.value)}
              placeholder={isRTL ? 'المملكة العربية السعودية' : 'Saudi Arabia'}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="postal_code">
              {isRTL ? 'الرمز البريدي' : 'Postal Code'}
            </Label>
            <Input
              id="postal_code"
              value={formData.postal_code || ''}
              onChange={(e) => handleChange('postal_code', e.target.value)}
              placeholder="12345"
              dir="ltr"
            />
          </div>
        </div>

        {/* Contact Info */}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="phone">
              {isRTL ? 'رقم الهاتف' : 'Phone'}
            </Label>
            <Input
              id="phone"
              value={formData.phone || ''}
              onChange={(e) => handleChange('phone', e.target.value)}
              placeholder="+966 5X XXX XXXX"
              dir="ltr"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">
              {isRTL ? 'البريد الإلكتروني' : 'Email'}
            </Label>
            <Input
              id="email"
              type="email"
              value={formData.email || ''}
              onChange={(e) => handleChange('email', e.target.value)}
              placeholder="info@company.com"
              dir="ltr"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="website">
              {isRTL ? 'الموقع الإلكتروني' : 'Website'}
            </Label>
            <Input
              id="website"
              value={formData.website || ''}
              onChange={(e) => handleChange('website', e.target.value)}
              placeholder="https://www.company.com"
              dir="ltr"
            />
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end pt-4 border-t">
          <Button
            onClick={handleSave}
            disabled={!hasChanges || saveMutation.isPending}
            className="gap-2"
          >
            {saveMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {isRTL ? 'حفظ التغييرات' : 'Save Changes'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
