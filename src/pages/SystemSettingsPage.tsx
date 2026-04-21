import { useState, useCallback, useEffect } from 'react';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useLanguage } from '@/contexts/LanguageContext';
import { Settings, Globe, Palette, AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { CompanySettingsForm } from '@/components/settings/CompanySettingsForm';
import { useModules } from '@/core/contexts';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

export default function SystemSettingsPage() {
  const { language, setLanguage, t, isRTL } = useLanguage();
  const [selectedLanguage, setSelectedLanguage] = useState(language);
  const { isAdmin } = useModules();

  const [resetOpen, setResetOpen] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  useEffect(() => {
    setSelectedLanguage(language);
  }, [language]);

  const handleLanguageChange = (value: 'ar' | 'en') => {
    setSelectedLanguage(value);
    setLanguage(value);
    toast({
      title: t.settings.saved,
      description: value === 'ar' ? 'تم تغيير اللغة إلى العربية' : 'Language changed to English',
    });
  };

  const handleExecuteReset = useCallback(async () => {
    setResetLoading(true);
    try {
      const res = await fetch('/api/admin/factory-reset', {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        toast({
          title: isRTL ? 'فشل' : 'Failed',
          description: res.status === 403
            ? (isRTL ? 'غير مسموح في Production' : 'Not allowed in production')
            : (data.error || 'Reset failed'),
          variant: 'destructive',
        });
        return;
      }
      toast({
        title: isRTL ? 'تم إعادة التعيين بنجاح' : 'Factory Reset Complete',
        description: isRTL
          ? `تم مسح ${data.truncatedTablesCount} جدول | الإعدادات محفوظة (${data.keptTablesCount} جدول)`
          : `Truncated ${data.truncatedTablesCount} tables | ${data.keptTablesCount} kept`,
      });
      setResetOpen(false);
      setTimeout(() => window.location.reload(), 500);
    } catch {
      toast({ title: isRTL ? 'خطأ في الاتصال' : 'Connection error', variant: 'destructive' });
    } finally {
      setResetLoading(false);
    }
  }, [isRTL]);

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-gold flex items-center justify-center shadow-gold">
            <Settings className="w-6 h-6 text-navy" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{t.settings.title}</h1>
            <p className="text-muted-foreground text-sm">{t.settings.general}</p>
          </div>
        </div>

        {/* Company Settings - Full Width */}
        <CompanySettingsForm />

        <div className="grid gap-6 md:grid-cols-2">
          {/* Language Settings */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Globe className="w-5 h-5 text-primary" />
                <CardTitle className="text-lg">{t.settings.language}</CardTitle>
              </div>
              <CardDescription>{t.settings.languageDescription}</CardDescription>
            </CardHeader>
            <CardContent>
              <RadioGroup
                value={selectedLanguage}
                onValueChange={(value) => handleLanguageChange(value as 'ar' | 'en')}
                className="space-y-3"
              >
                <div
                  className={cn(
                    "flex items-center space-x-3 space-x-reverse p-4 rounded-lg border-2 cursor-pointer transition-all",
                    selectedLanguage === 'ar'
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  )}
                  onClick={() => handleLanguageChange('ar')}
                >
                  <RadioGroupItem value="ar" id="lang-ar" />
                  <Label
                    htmlFor="lang-ar"
                    className="flex-1 cursor-pointer font-medium"
                  >
                    <div className="flex items-center justify-between">
                      <span>العربية</span>
                      <span className="text-xs text-muted-foreground">RTL</span>
                    </div>
                    <p className="text-sm text-muted-foreground font-normal mt-1">
                      واجهة المستخدم باللغة العربية
                    </p>
                  </Label>
                </div>

                <div
                  className={cn(
                    "flex items-center space-x-3 space-x-reverse p-4 rounded-lg border-2 cursor-pointer transition-all",
                    selectedLanguage === 'en'
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  )}
                  onClick={() => handleLanguageChange('en')}
                >
                  <RadioGroupItem value="en" id="lang-en" />
                  <Label
                    htmlFor="lang-en"
                    className="flex-1 cursor-pointer font-medium"
                  >
                    <div className="flex items-center justify-between">
                      <span>English</span>
                      <span className="text-xs text-muted-foreground">LTR</span>
                    </div>
                    <p className="text-sm text-muted-foreground font-normal mt-1">
                      User interface in English
                    </p>
                  </Label>
                </div>
              </RadioGroup>
            </CardContent>
          </Card>

          {/* Theme Settings - Placeholder for future */}
          <Card className="opacity-60">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Palette className="w-5 h-5 text-primary" />
                <CardTitle className="text-lg">{t.settings.theme}</CardTitle>
              </div>
              <CardDescription>{t.settings.themeDescription}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-muted-foreground text-center py-8">
                {isRTL ? 'قريباً...' : 'Coming soon...'}
              </div>
            </CardContent>
          </Card>
        </div>

        {isAdmin && (
          <Card className="border-destructive/30" data-testid="card-developer-tools">
            <CardHeader>
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-destructive" />
                <CardTitle className="text-lg">{isRTL ? 'أدوات المطور' : 'Developer Tools'}</CardTitle>
              </div>
              <CardDescription>{isRTL ? 'أدوات متقدمة للمشرفين فقط' : 'Advanced tools for admins only'}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="destructive" onClick={() => setResetOpen(true)} disabled={resetLoading} data-testid="button-factory-reset">
                {resetLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
                <span>{isRTL ? 'إعادة تعيين المصنع (Dev)' : 'Factory Reset (Dev)'}</span>
              </Button>
            </CardContent>
          </Card>
        )}

        <Dialog open={resetOpen} onOpenChange={(v) => { if (!resetLoading) setResetOpen(v); }}>
          <DialogContent className="max-w-sm" dir={isRTL ? 'rtl' : 'ltr'}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="w-5 h-5" />
                {isRTL ? 'تأكيد إعادة التعيين' : 'Confirm Factory Reset'}
              </DialogTitle>
              <DialogDescription>
                {isRTL
                  ? 'سيتم حذف جميع بيانات التشغيل نهائيًا. هل أنت متأكد؟'
                  : 'All operational data will be permanently deleted. Are you sure?'}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setResetOpen(false)} disabled={resetLoading} data-testid="button-cancel-reset">
                {isRTL ? 'إلغاء' : 'Cancel'}
              </Button>
              <Button variant="destructive" onClick={handleExecuteReset} disabled={resetLoading} data-testid="button-confirm-reset">
                {resetLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{isRTL ? 'جارٍ التنفيذ...' : 'Executing...'}</span>
                  </>
                ) : (
                  isRTL ? 'تأكيد' : 'Confirm'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
