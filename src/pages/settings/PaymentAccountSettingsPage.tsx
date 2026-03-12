import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '@/contexts/LanguageContext';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';
import { Save, Settings, AlertCircle, CheckCircle, Banknote, CreditCard, Building2, FileCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChartAccount {
  id: string;
  account_code: string;
  account_name: string;
  account_name_en: string | null;
  account_type: string;
}

interface PaymentAccountSettings {
  id?: string;
  branch_id: string | null;
  cash_account_id: string | null;
  bank_transfer_account_id: string | null;
  check_account_id: string | null;
  card_account_id: string | null;
}

interface Branch {
  id: string;
  branch_name: string;
  branch_code: string;
}

export default function PaymentAccountSettingsPage() {
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<string>('general');
  const [settings, setSettings] = useState<Record<string, PaymentAccountSettings>>({});
  const [hasChanges, setHasChanges] = useState(false);

  const { data: accounts = [], isLoading: accountsLoading } = useQuery({
    queryKey: ['chart-of-accounts-payment-types'],
    queryFn: async () => {
      const res = await fetch('/api/chart-of-accounts-payment-types', { credentials: 'include' });
      if (!res.ok && res.status === 501) return [];
      if (!res.ok) return [];
      return await res.json() as ChartAccount[];
    }
  });

  const { data: branches = [] } = useQuery({
    queryKey: ['branches-active'],
    queryFn: async () => {
      const res = await fetch('/api/active-branches', { credentials: 'include' });
      if (!res.ok && res.status === 501) return [];
      if (!res.ok) return [];
      return await res.json() as Branch[];
    }
  });

  const { data: existingSettings, isLoading: settingsLoading } = useQuery({
    queryKey: ['payment-account-settings'],
    queryFn: async () => {
      const res = await fetch('/api/payment-account-settings', { credentials: 'include' });
      if (!res.ok && res.status === 501) return [];
      if (!res.ok) return [];
      return await res.json();
    }
  });

  useEffect(() => {
    if (existingSettings) {
      const settingsMap: Record<string, PaymentAccountSettings> = {};
      const settingsArray = Array.isArray(existingSettings) ? existingSettings : (existingSettings ? [existingSettings] : []);
      
      settingsArray.forEach((setting: any) => {
        const key = setting.branch_id || 'general';
        settingsMap[key] = {
          id: setting.id,
          branch_id: setting.branch_id,
          cash_account_id: setting.cash_account_id,
          bank_transfer_account_id: setting.bank_transfer_account_id,
          check_account_id: setting.check_account_id,
          card_account_id: setting.card_account_id,
        };
      });
      
      setSettings(settingsMap);
    }
  }, [existingSettings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const settingsToSave = Object.entries(settings).map(([key, value]) => ({
        ...value,
        branch_id: key === 'general' ? null : key,
      }));

      const res = await fetch('/api/payment-account-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(settingsToSave),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || 'Failed to save settings');
      }
      return await res.json();
    },
    onSuccess: () => {
      toast.success(language === 'ar' ? 'تم حفظ الإعدادات بنجاح' : 'Settings saved successfully');
      setHasChanges(false);
      queryClient.invalidateQueries({ queryKey: ['payment-account-settings'] });
    },
    onError: (error) => {
      console.error('Error saving settings:', error);
      toast.error(language === 'ar' ? 'حدث خطأ أثناء الحفظ' : 'Error saving settings');
    }
  });

  const updateSetting = (
    tabKey: string,
    field: keyof PaymentAccountSettings,
    value: string | null
  ) => {
    setSettings(prev => ({
      ...prev,
      [tabKey]: {
        ...prev[tabKey],
        branch_id: tabKey === 'general' ? null : tabKey,
        [field]: value,
      }
    }));
    setHasChanges(true);
  };

  const getAccountName = (accountId: string | null) => {
    if (!accountId) return null;
    const account = accounts.find(a => a.id === accountId);
    if (!account) return null;
    return language === 'ar' ? account.account_name : (account.account_name_en || account.account_name);
  };

  const getCurrentSettings = () => {
    return settings[activeTab] || {
      branch_id: activeTab === 'general' ? null : activeTab,
      cash_account_id: null,
      bank_transfer_account_id: null,
      check_account_id: null,
      card_account_id: null,
    };
  };

  const currentSettings = getCurrentSettings();

  const isComplete = currentSettings.cash_account_id && 
                     currentSettings.bank_transfer_account_id && 
                     currentSettings.check_account_id && 
                     currentSettings.card_account_id;

  const renderAccountSelect = (
    label: string,
    icon: React.ReactNode,
    field: keyof PaymentAccountSettings,
    description: string
  ) => (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {icon}
        <Label className="text-base font-medium">{label}</Label>
      </div>
      <Select
        value={currentSettings[field] as string || ''}
        onValueChange={(value) => updateSetting(activeTab, field, value || null)}
      >
        <SelectTrigger className="w-full bg-background">
          <SelectValue placeholder={language === 'ar' ? 'اختر حساب...' : 'Select account...'} />
        </SelectTrigger>
        <SelectContent className="bg-background border shadow-lg z-50">
          {accounts.map((account) => (
            <SelectItem key={account.id} value={account.id}>
              <span className="flex items-center gap-2">
                <span className="text-muted-foreground">{account.account_code}</span>
                <span>-</span>
                <span>{language === 'ar' ? account.account_name : (account.account_name_en || account.account_name)}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );

  if (accountsLoading || settingsLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Settings className="h-8 w-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">
                {language === 'ar' ? 'إعدادات الحسابات النقدية' : 'Payment Account Settings'}
              </h1>
              <p className="text-muted-foreground">
                {language === 'ar' 
                  ? 'ربط وسائل الدفع بحساباتها في شجرة الحسابات لسندات القبض والصرف'
                  : 'Link payment methods to their accounts in chart of accounts for receipts and payments'}
              </p>
            </div>
          </div>
          <Button 
            onClick={() => saveMutation.mutate()}
            disabled={!hasChanges || saveMutation.isPending}
            className="gap-2"
          >
            <Save className="h-4 w-4" />
            {language === 'ar' ? 'حفظ الإعدادات' : 'Save Settings'}
          </Button>
        </div>

        {!isComplete && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {language === 'ar' 
                ? 'يجب تحديد جميع الحسابات لضمان عمل القيود اليومية بشكل صحيح'
                : 'All accounts must be configured to ensure journal entries work correctly'}
            </AlertDescription>
          </Alert>
        )}

        {isComplete && (
          <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-700 dark:text-green-300">
              {language === 'ar' 
                ? 'تم ضبط جميع الحسابات بنجاح'
                : 'All accounts are configured successfully'}
            </AlertDescription>
          </Alert>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-muted">
            <TabsTrigger value="general" className="gap-2">
              <Building2 className="h-4 w-4" />
              {language === 'ar' ? 'الإعدادات العامة' : 'General Settings'}
            </TabsTrigger>
            {branches.map((branch) => (
              <TabsTrigger key={branch.id} value={branch.id}>
                {branch.branch_name}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value={activeTab} className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>
                  {activeTab === 'general' 
                    ? (language === 'ar' ? 'الإعدادات العامة' : 'General Settings')
                    : branches.find(b => b.id === activeTab)?.branch_name
                  }
                </CardTitle>
                <CardDescription>
                  {activeTab === 'general'
                    ? (language === 'ar' 
                        ? 'هذه الإعدادات تُطبق على جميع الفروع ما لم يتم تخصيص إعدادات خاصة لكل فرع'
                        : 'These settings apply to all branches unless branch-specific settings are configured')
                    : (language === 'ar'
                        ? 'إعدادات خاصة بهذا الفرع تتجاوز الإعدادات العامة'
                        : 'Branch-specific settings that override general settings')
                  }
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {renderAccountSelect(
                    language === 'ar' ? 'حساب النقدية (كاش)' : 'Cash Account',
                    <Banknote className="h-5 w-5 text-green-600" />,
                    'cash_account_id',
                    language === 'ar' 
                      ? 'يُستخدم عند اختيار طريقة الدفع "نقداً" في سندات القبض والصرف'
                      : 'Used when payment method is "Cash" in receipts and payments'
                  )}

                  {renderAccountSelect(
                    language === 'ar' ? 'حساب التحويل البنكي' : 'Bank Transfer Account',
                    <Building2 className="h-5 w-5 text-blue-600" />,
                    'bank_transfer_account_id',
                    language === 'ar' 
                      ? 'يُستخدم عند اختيار طريقة الدفع "تحويل بنكي" في سندات القبض والصرف'
                      : 'Used when payment method is "Bank Transfer" in receipts and payments'
                  )}

                  {renderAccountSelect(
                    language === 'ar' ? 'حساب الشيكات' : 'Check Account',
                    <FileCheck className="h-5 w-5 text-orange-600" />,
                    'check_account_id',
                    language === 'ar' 
                      ? 'يُستخدم عند اختيار طريقة الدفع "شيك" في سندات القبض والصرف'
                      : 'Used when payment method is "Check" in receipts and payments'
                  )}

                  {renderAccountSelect(
                    language === 'ar' ? 'حساب بطاقة الائتمان' : 'Credit Card Account',
                    <CreditCard className="h-5 w-5 text-purple-600" />,
                    'card_account_id',
                    language === 'ar' 
                      ? 'يُستخدم عند اختيار طريقة الدفع "بطاقة ائتمان" في سندات القبض والصرف'
                      : 'Used when payment method is "Credit Card" in receipts and payments'
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Card className="bg-muted/50">
          <CardContent className="pt-6">
            <div className="flex gap-4">
              <AlertCircle className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
              <div className="space-y-2">
                <p className="font-medium">
                  {language === 'ar' ? 'ملاحظات هامة:' : 'Important Notes:'}
                </p>
                <ul className={cn(
                  "text-sm text-muted-foreground space-y-1",
                  language === 'ar' ? 'list-disc list-inside' : 'list-disc list-inside'
                )}>
                  <li>
                    {language === 'ar' 
                      ? 'التغييرات تُطبق على السندات الجديدة فقط ولا تؤثر على القيود السابقة'
                      : 'Changes apply to new vouchers only and do not affect existing entries'}
                  </li>
                  <li>
                    {language === 'ar' 
                      ? 'يمكن تخصيص إعدادات مختلفة لكل فرع بشكل مستقل'
                      : 'Different settings can be configured for each branch independently'}
                  </li>
                  <li>
                    {language === 'ar' 
                      ? 'في حالة عدم وجود إعدادات خاصة بالفرع، يتم استخدام الإعدادات العامة'
                      : 'If no branch-specific settings exist, general settings are used'}
                  </li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
