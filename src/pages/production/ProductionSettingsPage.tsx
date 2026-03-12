import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';
import MainLayout from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Loader2, Settings, Building2, Save } from 'lucide-react';

interface AccountOption {
  id: string;
  account_code: string;
  account_name: string;
}

interface ProductionSettings {
  id?: string;
  branch_id: string | null;
  wip_account_id: string | null;
  raw_material_account_id: string | null;
  finished_goods_account_id: string | null;
  scrap_loss_account_id: string | null;
  is_journal_auto_enabled: boolean;
}

export default function ProductionSettingsPage() {
  const queryClient = useQueryClient();
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [settings, setSettings] = useState<ProductionSettings>({
    branch_id: null,
    wip_account_id: null,
    raw_material_account_id: null,
    finished_goods_account_id: null,
    scrap_loss_account_id: null,
    is_journal_auto_enabled: true,
  });

  const { data: accounts = [], isLoading: loadingAccounts } = useQuery({
    queryKey: ['chart-of-accounts-assets'],
    queryFn: async () => {
      const res = await fetch('/api/chart-of-accounts', { credentials: 'include' });
      if (!res.ok && res.status === 501) return [];
      if (!res.ok) return [];
      return await res.json() as AccountOption[];
    },
  });

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const res = await fetch('/api/active-branches', { credentials: 'include' });
      if (!res.ok && res.status === 501) return [];
      if (!res.ok) return [];
      return await res.json();
    },
  });

  const { data: existingSettings, isLoading: loadingSettings } = useQuery({
    queryKey: ['production-settings', selectedBranchId],
    queryFn: async () => {
      const res = await fetch('/api/production-account-settings', { credentials: 'include' });
      if (!res.ok && res.status === 501) return null;
      if (!res.ok) return null;
      const data = await res.json();
      if (Array.isArray(data)) {
        if (selectedBranchId) {
          return data.find((s: any) => s.branch_id === selectedBranchId) || null;
        } else {
          return data.find((s: any) => !s.branch_id) || null;
        }
      }
      return data;
    },
  });

  useEffect(() => {
    if (existingSettings) {
      setSettings({
        id: existingSettings.id,
        branch_id: existingSettings.branch_id,
        wip_account_id: existingSettings.wip_account_id,
        raw_material_account_id: existingSettings.raw_material_account_id,
        finished_goods_account_id: existingSettings.finished_goods_account_id,
        scrap_loss_account_id: existingSettings.scrap_loss_account_id,
        is_journal_auto_enabled: existingSettings.is_journal_auto_enabled,
      });
    } else {
      setSettings({
        branch_id: selectedBranchId,
        wip_account_id: null,
        raw_material_account_id: null,
        finished_goods_account_id: null,
        scrap_loss_account_id: null,
        is_journal_auto_enabled: true,
      });
    }
  }, [existingSettings, selectedBranchId]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (settings.id) {
        forbidDirectWrite('update', 'ProductionSettingsPage.tsx:132');
      } else {
        forbidDirectWrite('insert', 'ProductionSettingsPage.tsx:138');
      }
    },
    onSuccess: () => {
      toast.success('تم حفظ الإعدادات بنجاح');
      queryClient.invalidateQueries({ queryKey: ['production-settings'] });
    },
    onError: (error) => {
      console.error('Error saving settings:', error);
      toast.error('حدث خطأ أثناء حفظ الإعدادات');
    },
  });

  if (loadingAccounts || loadingSettings) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-96">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-foreground">إعدادات الإنتاج</h1>
            <p className="text-muted-foreground">تكوين حسابات الإنتاج والقيود المحاسبية</p>
          </div>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? (
              <Loader2 className="w-4 h-4 ml-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 ml-2" />
            )}
            حفظ الإعدادات
          </Button>
        </div>

        <Tabs defaultValue="global" onValueChange={(v) => setSelectedBranchId(v === 'global' ? null : v)}>
          <TabsList>
            <TabsTrigger value="global" className="gap-2">
              <Settings className="w-4 h-4" />
              الإعدادات العامة
            </TabsTrigger>
            {branches.map((branch: any) => (
              <TabsTrigger key={branch.id} value={branch.id} className="gap-2">
                <Building2 className="w-4 h-4" />
                {branch.branch_name}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="global" className="mt-6">
            <SettingsForm
              settings={settings}
              setSettings={setSettings}
              accounts={accounts}
              title="الإعدادات العامة"
              description="هذه الإعدادات تطبق على جميع الفروع ما لم يتم تخصيص إعدادات لفرع معين"
            />
          </TabsContent>

          {branches.map((branch: any) => (
            <TabsContent key={branch.id} value={branch.id} className="mt-6">
              <SettingsForm
                settings={settings}
                setSettings={setSettings}
                accounts={accounts}
                title={`إعدادات فرع ${branch.branch_name}`}
                description="هذه الإعدادات تتجاوز الإعدادات العامة لهذا الفرع فقط"
              />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </MainLayout>
  );
}

function SettingsForm({
  settings,
  setSettings,
  accounts,
  title,
  description,
}: {
  settings: ProductionSettings;
  setSettings: React.Dispatch<React.SetStateAction<ProductionSettings>>;
  accounts: AccountOption[];
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div>
              <Label className="text-base">تفعيل القيود المحاسبية التلقائية</Label>
              <p className="text-sm text-muted-foreground">
                عند تعطيل هذا الخيار، لن يتم إنشاء قيود محاسبية تلقائياً عند عمليات الإنتاج
              </p>
            </div>
            <Switch
              checked={settings.is_journal_auto_enabled}
              onCheckedChange={(checked) =>
                setSettings((prev) => ({ ...prev, is_journal_auto_enabled: checked }))
              }
            />
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label>حساب مخزون تحت التشغيل (WIP)</Label>
              <Select
                value={settings.wip_account_id || 'none'}
                onValueChange={(v) => setSettings((prev) => ({ ...prev, wip_account_id: v === 'none' ? null : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="اختر الحساب" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">بدون تحديد</SelectItem>
                  {accounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.account_code} - {acc.account_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                يُستخدم لتسجيل تكلفة المواد أثناء عملية الإنتاج
              </p>
            </div>

            <div className="space-y-2">
              <Label>حساب مخزون المواد الخام</Label>
              <Select
                value={settings.raw_material_account_id || 'none'}
                onValueChange={(v) => setSettings((prev) => ({ ...prev, raw_material_account_id: v === 'none' ? null : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="اختر الحساب" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">بدون تحديد</SelectItem>
                  {accounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.account_code} - {acc.account_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                يُخصم منه عند بدء الإنتاج
              </p>
            </div>

            <div className="space-y-2">
              <Label>حساب مخزون الإنتاج التام</Label>
              <Select
                value={settings.finished_goods_account_id || 'none'}
                onValueChange={(v) => setSettings((prev) => ({ ...prev, finished_goods_account_id: v === 'none' ? null : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="اختر الحساب" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">بدون تحديد</SelectItem>
                  {accounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.account_code} - {acc.account_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                يُضاف إليه عند إتمام الإنتاج
              </p>
            </div>

            <div className="space-y-2">
              <Label>حساب خسائر هالك الإنتاج</Label>
              <Select
                value={settings.scrap_loss_account_id || 'none'}
                onValueChange={(v) => setSettings((prev) => ({ ...prev, scrap_loss_account_id: v === 'none' ? null : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="اختر الحساب" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">بدون تحديد</SelectItem>
                  {accounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.account_code} - {acc.account_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                يُسجل فيه قيمة الهالك والفاقد
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="pt-6">
          <h3 className="font-semibold text-blue-900 mb-2">ملاحظة هامة</h3>
          <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
            <li>القيد رقم 1: يُنشأ عند اعتماد أمر الإنتاج (من المواد الخام إلى تحت التشغيل)</li>
            <li>التحويلات الداخلية بين مراحل الإنتاج لا تُنشئ أي قيود محاسبية</li>
            <li>القيد رقم 3: يُنشأ عند إتمام الإنتاج (من تحت التشغيل إلى الإنتاج التام)</li>
            <li>يجب التأكد من وجود الحسابات في دليل الحسابات قبل اختيارها</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
