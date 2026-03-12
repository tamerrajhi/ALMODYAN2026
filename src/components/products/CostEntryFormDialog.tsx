import { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import * as dataGateway from '@/lib/dataGateway';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Loader2, DollarSign, Wrench, Building2, TrendingDown, Settings } from 'lucide-react';
import { AccountCombobox } from '@/components/accounting/AccountCombobox';

interface CostEntry {
  id: string;
  cost_code: string;
  name_ar: string;
  name_en: string | null;
  description: string | null;
  cost_type: string;
  gl_account_id: string;
  cost_center_id: string | null;
  tax_rate: number;
  is_active: boolean;
}

interface CostEntryFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  costEntry?: CostEntry | null;
  onSuccess: () => void;
}

interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_name_en: string | null;
  account_type: string;
  parent_id: string | null;
  is_active: boolean;
}

interface HierarchicalAccount {
  id: string;
  account_code: string;
  account_name: string;
  parent_id: string | null;
  level: number;
  isLeaf: boolean;
  fullPath: string;
}

interface CostCenter {
  id: string;
  center_code: string;
  center_name: string;
  center_name_en: string | null;
}

const COST_TYPES = [
  { value: 'service', labelAr: 'خدمة', labelEn: 'Service', icon: Wrench, color: 'orange' },
  { value: 'fixed_asset', labelAr: 'أصل ثابت', labelEn: 'Fixed Asset', icon: Building2, color: 'blue' },
  { value: 'direct_expense', labelAr: 'مصروف مباشر', labelEn: 'Direct Expense', icon: TrendingDown, color: 'red' },
  { value: 'indirect_overhead', labelAr: 'مصروف عمومي/إداري', labelEn: 'Indirect/Overhead', icon: Settings, color: 'purple' },
];

import React from 'react';

const CostEntryFormDialog = React.forwardRef<HTMLDivElement, CostEntryFormDialogProps>(({
  open,
  onOpenChange,
  costEntry,
  onSuccess,
}, ref) => {
  const { language } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState<HierarchicalAccount[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  
  const [formData, setFormData] = useState({
    cost_code: '',
    name_ar: '',
    name_en: '',
    description: '',
    cost_type: 'service',
    gl_account_id: '',
    cost_center_id: '',
    tax_rate: '15',
    is_active: true,
  });

  useEffect(() => {
    if (open) {
      fetchAccounts();
      fetchCostCenters();
      
      if (costEntry) {
        setFormData({
          cost_code: costEntry.cost_code,
          name_ar: costEntry.name_ar,
          name_en: costEntry.name_en || '',
          description: costEntry.description || '',
          cost_type: costEntry.cost_type,
          gl_account_id: costEntry.gl_account_id,
          cost_center_id: costEntry.cost_center_id || '',
          tax_rate: costEntry.tax_rate?.toString() || '15',
          is_active: costEntry.is_active,
        });
      } else {
        // Reset form for new entry
        setFormData({
          cost_code: '',
          name_ar: '',
          name_en: '',
          description: '',
          cost_type: 'service',
          gl_account_id: '',
          cost_center_id: '',
          tax_rate: '15',
          is_active: true,
        });
      }
    }
  }, [open, costEntry]);

  const fetchAccounts = async () => {
    try {
      const { data, error } = await dataGateway.queryTable('chart_of_accounts', {
        select: 'id, account_code, account_name, account_name_en, account_type, parent_id, is_active',
        filters: [{ type: 'eq', column: 'is_active', value: true }],
        order: { column: 'account_code', ascending: true },
      });
      
      if (error) throw error;
      
      const rawAccounts = (data as any[]) || [];
      const accountMap = new Map(rawAccounts.map(a => [a.id, a]));
      
      const getLevel = (acc: typeof rawAccounts[0]): number => {
        if (!acc.parent_id) return 0;
        const parent = accountMap.get(acc.parent_id);
        return parent ? getLevel(parent) + 1 : 0;
      };
      
      const isLeaf = (acc: typeof rawAccounts[0]): boolean => {
        return !rawAccounts.some(a => a.parent_id === acc.id);
      };
      
      const getFullPath = (acc: typeof rawAccounts[0]): string => {
        const parts: string[] = [acc.account_name];
        let current = acc;
        while (current.parent_id) {
          const parent = accountMap.get(current.parent_id);
          if (parent) {
            parts.unshift(parent.account_name);
            current = parent;
          } else break;
        }
        return parts.join(' > ');
      };
      
      const hierarchicalAccounts: HierarchicalAccount[] = rawAccounts.map(acc => ({
        id: acc.id,
        account_code: acc.account_code,
        account_name: acc.account_name,
        parent_id: acc.parent_id,
        level: getLevel(acc),
        isLeaf: isLeaf(acc),
        fullPath: getFullPath(acc),
      }));
      
      setAccounts(hierarchicalAccounts);
    } catch (error) {
      console.error('Error fetching accounts:', error);
    }
  };

  const fetchCostCenters = async () => {
    try {
      const { data, error } = await dataGateway.queryTable('cost_centers', {
        select: 'id, center_code, center_name, center_name_en',
        filters: [{ type: 'eq', column: 'is_active', value: true }],
        order: { column: 'center_code', ascending: true },
      });
      
      if (error) throw error;
      setCostCenters((data as any[]) || []);
    } catch (error) {
      console.error('Error fetching cost centers:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name_ar) {
      toast.error(language === 'ar' ? 'الرجاء إدخال اسم المصروف' : 'Please enter cost name');
      return;
    }

    if (!formData.gl_account_id) {
      toast.error(language === 'ar' ? 'الرجاء اختيار الحساب المحاسبي' : 'Please select GL account');
      return;
    }

    setLoading(true);

    try {
      const entryData = {
        name_ar: formData.name_ar,
        name_en: formData.name_en || null,
        description: formData.description || null,
        cost_type: formData.cost_type,
        gl_account_id: formData.gl_account_id,
        cost_center_id: formData.cost_center_id || null,
        tax_rate: parseFloat(formData.tax_rate) || 15,
        is_active: formData.is_active,
      };

      const clientRequestId = crypto.randomUUID();

      if (costEntry) {
        // Update existing cost entry
        const { data: result, error } = await dataGateway.rpc('cost_entry_update_atomic', {
          p_client_request_id: clientRequestId,
          p_cost_entry_id: costEntry.id,
          p_name_ar: entryData.name_ar,
          p_name_en: entryData.name_en,
          p_description: entryData.description,
          p_cost_type: entryData.cost_type,
          p_gl_account_id: entryData.gl_account_id,
          p_cost_center_id: entryData.cost_center_id,
          p_tax_rate: entryData.tax_rate,
          p_is_active: entryData.is_active,
        });

        if (error) throw error;
        if (!result?.success) {
          throw new Error(result?.error || 'فشل تحديث المصروف');
        }

        toast.success(language === 'ar' ? 'تم تحديث المصروف بنجاح' : 'Cost entry updated successfully');
        onSuccess();
      } else {
        // Create new cost entry
        const { data: result, error } = await dataGateway.rpc('cost_entry_create_atomic', {
          p_client_request_id: clientRequestId,
          p_name_ar: entryData.name_ar,
          p_cost_type: entryData.cost_type,
          p_gl_account_id: entryData.gl_account_id,
          p_name_en: entryData.name_en,
          p_description: entryData.description,
          p_cost_center_id: entryData.cost_center_id,
          p_tax_rate: entryData.tax_rate,
        });

        if (error) throw error;
        if (!result?.success) {
          throw new Error(result?.error || 'فشل إنشاء المصروف');
        }

        toast.success(language === 'ar' ? 'تم إضافة المصروف بنجاح' : 'Cost entry added successfully');
        onSuccess();
      }
      
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error saving cost entry:', error);
      if (error.code === '23505') {
        toast.error(language === 'ar' ? 'كود المصروف موجود مسبقاً' : 'Cost code already exists');
      } else {
        toast.error(language === 'ar' ? 'حدث خطأ' : 'An error occurred');
      }
    } finally {
      setLoading(false);
    }
  };

  const selectedType = COST_TYPES.find(t => t.value === formData.cost_type);
  const TypeIcon = selectedType?.icon || DollarSign;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-primary" />
            {costEntry 
              ? (language === 'ar' ? 'تعديل التكلفة' : 'Edit Cost Entry')
              : (language === 'ar' ? 'إضافة تكلفة جديدة' : 'Add New Cost Entry')
            }
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Cost Type Selection */}
          <div className="space-y-2">
            <Label>{language === 'ar' ? 'نوع المصروف *' : 'Cost Type *'}</Label>
            <div className="grid grid-cols-2 gap-2">
              {COST_TYPES.map((type) => {
                const Icon = type.icon;
                const isSelected = formData.cost_type === type.value;
                return (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, cost_type: type.value }))}
                    className={`p-3 rounded-lg border-2 transition-all flex items-center gap-2 ${
                      isSelected 
                        ? `border-${type.color}-500 bg-${type.color}-50 text-${type.color}-700` 
                        : 'border-border hover:border-muted-foreground/50'
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${isSelected ? `text-${type.color}-600` : 'text-muted-foreground'}`} />
                    <span className="text-sm font-medium">
                      {language === 'ar' ? type.labelAr : type.labelEn}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Cost Code - Auto-generated or shown if editing */}
          {costEntry && (
            <div className="space-y-2">
              <Label>{language === 'ar' ? 'كود المصروف' : 'Cost Code'}</Label>
              <Input
                value={formData.cost_code}
                disabled
                className="font-mono bg-muted"
              />
            </div>
          )}

          {/* Names */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{language === 'ar' ? 'اسم المصروف (عربي) *' : 'Cost Name (Arabic) *'}</Label>
              <Input
                value={formData.name_ar}
                onChange={(e) => setFormData(prev => ({ ...prev, name_ar: e.target.value }))}
                placeholder={language === 'ar' ? 'مثال: مصاريف صيانة' : 'e.g. Maintenance Expenses'}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>{language === 'ar' ? 'اسم المصروف (إنجليزي)' : 'Cost Name (English)'}</Label>
              <Input
                value={formData.name_en}
                onChange={(e) => setFormData(prev => ({ ...prev, name_en: e.target.value }))}
                placeholder="e.g. Maintenance Expenses"
              />
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label>{language === 'ar' ? 'الوصف' : 'Description'}</Label>
            <Textarea
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              rows={2}
              placeholder={language === 'ar' ? 'وصف إضافي...' : 'Additional description...'}
            />
          </div>

          {/* GL Account - Required */}
          <div className="space-y-2 p-4 bg-muted/50 rounded-lg border">
            <Label className="text-base font-semibold flex items-center gap-2">
              <DollarSign className="w-4 h-4" />
              {language === 'ar' ? 'الربط المحاسبي *' : 'Accounting Link *'}
            </Label>
            <p className="text-xs text-muted-foreground mb-3">
              {language === 'ar' 
                ? 'اختر الحساب من شجرة الحسابات الذي سيتم التسجيل فيه عند استخدام هذا المصروف'
                : 'Select the GL account where transactions will be recorded when using this cost entry'}
            </p>
            <AccountCombobox
              accounts={accounts}
              value={formData.gl_account_id}
              onValueChange={(value) => setFormData(prev => ({ ...prev, gl_account_id: value }))}
              showOnlyLeaf={true}
            />
          </div>

          {/* Cost Center - Optional */}
          <div className="space-y-2">
            <Label>{language === 'ar' ? 'مركز التكلفة (اختياري)' : 'Cost Center (Optional)'}</Label>
            <Select
              value={formData.cost_center_id || 'none'}
              onValueChange={(value) => setFormData(prev => ({ ...prev, cost_center_id: value === 'none' ? '' : value }))}
            >
              <SelectTrigger>
                <SelectValue placeholder={language === 'ar' ? 'اختر مركز التكلفة' : 'Select Cost Center'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{language === 'ar' ? 'بدون مركز تكلفة' : 'No Cost Center'}</SelectItem>
                {costCenters.map((cc) => (
                  <SelectItem key={cc.id} value={cc.id}>
                    {cc.center_code} - {language === 'ar' ? cc.center_name : (cc.center_name_en || cc.center_name)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Tax Rate */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{language === 'ar' ? 'نسبة الضريبة %' : 'Tax Rate %'}</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={formData.tax_rate}
                onChange={(e) => setFormData(prev => ({ ...prev, tax_rate: e.target.value }))}
                dir="ltr"
              />
            </div>
            <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
              <Label>{language === 'ar' ? 'مفعّل' : 'Active'}</Label>
              <Switch
                checked={formData.is_active}
                onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_active: checked }))}
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {language === 'ar' ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {costEntry 
                ? (language === 'ar' ? 'تحديث' : 'Update')
                : (language === 'ar' ? 'إضافة' : 'Add')
              }
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
});

CostEntryFormDialog.displayName = 'CostEntryFormDialog';

export default CostEntryFormDialog;
