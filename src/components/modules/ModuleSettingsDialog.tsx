import { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import * as dataGateway from '@/lib/dataGateway';
import { toast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Save, Settings2, Info } from 'lucide-react';
import { Separator } from '@/components/ui/separator';

interface ModuleSetting {
  setting_key: string;
  setting_label: { ar: string; en: string };
  setting_type: string;
  default_value: string;
  current_value: string;
  options: Array<{ value: string; label: { ar: string; en: string } }> | null;
  description: { ar: string; en: string } | null;
  display_order: number;
  is_required: boolean;
  min_value: number | null;
  max_value: number | null;
}

interface ModuleSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  moduleId: string;
  moduleName: { ar: string; en: string };
}

export function ModuleSettingsDialog({
  open,
  onOpenChange,
  moduleId,
  moduleName,
}: ModuleSettingsDialogProps) {
  const { language } = useLanguage();
  const [settings, setSettings] = useState<ModuleSetting[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (open && moduleId) {
      loadSettings();
    }
  }, [open, moduleId]);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const { data, error } = await dataGateway.rpc('get_module_settings', {
        p_module_id: moduleId,
      });

      if (error) throw error;

      const settingsData = (data || []) as ModuleSetting[];
      setSettings(settingsData);
      
      // Initialize values
      const initialValues: Record<string, string> = {};
      settingsData.forEach((s) => {
        initialValues[s.setting_key] = s.current_value || s.default_value || '';
      });
      setValues(initialValues);
      setHasChanges(false);
    } catch (error) {
      console.error('Error loading settings:', error);
      toast({
        title: 'خطأ',
        description: 'فشل في تحميل الإعدادات',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleValueChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const setting of settings) {
        const currentValue = values[setting.setting_key];
        if (currentValue !== setting.current_value) {
          const { error } = await dataGateway.rpc('save_module_setting', {
            p_module_id: moduleId,
            p_setting_key: setting.setting_key,
            p_value: currentValue,
          });
          if (error) throw error;
        }
      }

      toast({
        title: 'تم الحفظ',
        description: 'تم حفظ إعدادات الموديول بنجاح',
      });
      setHasChanges(false);
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving settings:', error);
      toast({
        title: 'خطأ',
        description: 'فشل في حفظ الإعدادات',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const renderSettingInput = (setting: ModuleSetting) => {
    const value = values[setting.setting_key] || '';
    const label = language === 'ar' ? setting.setting_label.ar : setting.setting_label.en;
    const description = setting.description
      ? language === 'ar'
        ? setting.description.ar
        : setting.description.en
      : null;

    switch (setting.setting_type) {
      case 'boolean':
        return (
          <div className="flex items-center justify-between py-3">
            <div className="space-y-0.5">
              <Label className="text-base">{label}</Label>
              {description && (
                <p className="text-sm text-muted-foreground">{description}</p>
              )}
            </div>
            <Switch
              checked={value === 'true'}
              onCheckedChange={(checked) =>
                handleValueChange(setting.setting_key, checked.toString())
              }
            />
          </div>
        );

      case 'number':
        return (
          <div className="space-y-2 py-3">
            <Label>{label}</Label>
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
            <Input
              type="number"
              value={value}
              onChange={(e) => handleValueChange(setting.setting_key, e.target.value)}
              min={setting.min_value ?? undefined}
              max={setting.max_value ?? undefined}
              className="max-w-[200px]"
            />
            {(setting.min_value !== null || setting.max_value !== null) && (
              <p className="text-xs text-muted-foreground">
                {setting.min_value !== null && `الحد الأدنى: ${setting.min_value}`}
                {setting.min_value !== null && setting.max_value !== null && ' - '}
                {setting.max_value !== null && `الحد الأقصى: ${setting.max_value}`}
              </p>
            )}
          </div>
        );

      case 'select':
        const options = setting.options || [];
        return (
          <div className="space-y-2 py-3">
            <Label>{label}</Label>
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
            <Select
              value={value}
              onValueChange={(v) => handleValueChange(setting.setting_key, v)}
            >
              <SelectTrigger className="max-w-[300px]">
                <SelectValue placeholder="اختر..." />
              </SelectTrigger>
              <SelectContent>
                {options.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {language === 'ar' ? opt.label.ar : opt.label.en}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );

      case 'text':
      default:
        return (
          <div className="space-y-2 py-3">
            <Label>{label}</Label>
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
            <Input
              value={value}
              onChange={(e) => handleValueChange(setting.setting_key, e.target.value)}
            />
          </div>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-5 h-5" />
            إعدادات {language === 'ar' ? moduleName.ar : moduleName.en}
          </DialogTitle>
          <DialogDescription>
            تخصيص إعدادات هذا الموديول حسب احتياجات العمل
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : settings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Info className="w-12 h-12 mb-4" />
            <p>لا توجد إعدادات متاحة لهذا الموديول</p>
          </div>
        ) : (
          <div className="space-y-1">
            {settings.map((setting, index) => (
              <div key={setting.setting_key}>
                {renderSettingInput(setting)}
                {index < settings.length - 1 && <Separator />}
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button onClick={handleSave} disabled={saving || !hasChanges}>
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin ml-2" />
            ) : (
              <Save className="w-4 h-4 ml-2" />
            )}
            حفظ الإعدادات
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
