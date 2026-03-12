import React, { useState, useEffect } from 'react';
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
import { Loader2, Gem, DollarSign, Scale, Tag } from 'lucide-react';
import { AccountCombobox } from '@/components/accounting/AccountCombobox';

export interface JewelryItem {
  id: string;
  item_code: string;
  stockcode: string | null;
  model: string | null;
  description: string | null;
  division: string | null;
  type: string | null;
  metal: string | null;
  rate_type: string | null;
  clarity: string | null;
  stone: string | null;
  m_value: string | null;
  supp_ref: string | null;
  g_weight: number | null;
  d_weight: number | null;
  b_weight: number | null;
  mq_weight: number | null;
  cs_weight: number | null;
  stone_weight: number | null;
  metal_weight: number | null;
  m_weight: number | null;
  cost: number | null;
  tag_price: number | null;
  minimum_price: number | null;
  gemstone_cost: number | null;
  vat_amount: number | null;
  total_with_vat: number | null;
  tag1: string | null;
  tag2: string | null;
  tag3: string | null;
  tag4: string | null;
  tag5: string | null;
  warehouse_id: string | null;
  inventory_account_id: string | null;
  is_available_for_sale: boolean | null;
  sale_status: string | null;
}

export interface JewelryItemFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jewelryItem?: JewelryItem | null;
  onSuccess: (item: JewelryItem) => void;
  context?: 'standalone' | 'purchase-invoice';
  defaultCode?: string;
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

interface Branch {
  id: string;
  branch_code: string;
  branch_name: string;
}

const METAL_TYPES = [
  { value: 'GOLD', labelAr: 'ذهب', labelEn: 'Gold' },
  { value: 'SILVER', labelAr: 'فضة', labelEn: 'Silver' },
  { value: 'PLATINUM', labelAr: 'بلاتين', labelEn: 'Platinum' },
  { value: 'WHITE_GOLD', labelAr: 'ذهب أبيض', labelEn: 'White Gold' },
  { value: 'ROSE_GOLD', labelAr: 'ذهب وردي', labelEn: 'Rose Gold' },
];

const RATE_TYPES = [
  { value: 'by_weight', labelAr: 'بالوزن', labelEn: 'By Weight' },
  { value: 'by_piece', labelAr: 'بالقطعة', labelEn: 'By Piece' },
];

const DIVISION_TYPES = [
  { value: 'jewelry', labelAr: 'مجوهرات', labelEn: 'Jewelry' },
  { value: 'diamonds', labelAr: 'ألماس', labelEn: 'Diamonds' },
  { value: 'watches', labelAr: 'ساعات', labelEn: 'Watches' },
  { value: 'accessories', labelAr: 'إكسسوارات', labelEn: 'Accessories' },
];

const ITEM_TYPES = [
  { value: 'ring', labelAr: 'خاتم', labelEn: 'Ring' },
  { value: 'necklace', labelAr: 'عقد', labelEn: 'Necklace' },
  { value: 'bracelet', labelAr: 'سوار', labelEn: 'Bracelet' },
  { value: 'earring', labelAr: 'حلق', labelEn: 'Earring' },
  { value: 'pendant', labelAr: 'تعليقة', labelEn: 'Pendant' },
  { value: 'chain', labelAr: 'سلسلة', labelEn: 'Chain' },
  { value: 'set', labelAr: 'طقم', labelEn: 'Set' },
  { value: 'other', labelAr: 'أخرى', labelEn: 'Other' },
];

const JewelryItemFormDialog = React.forwardRef<HTMLDivElement, JewelryItemFormDialogProps>(({
  open,
  onOpenChange,
  jewelryItem,
  onSuccess,
  context = 'standalone',
  defaultCode = '',
}, ref) => {
  const { language } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState<HierarchicalAccount[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  
  const [formData, setFormData] = useState({
    item_code: defaultCode,
    stockcode: '',
    model: '',
    supp_ref: '',
    description: '',
    division: '',
    type: '',
    metal: 'GOLD',
    rate_type: 'by_weight',
    clarity: '',
    stone: '',
    m_value: '',
    g_weight: '',
    d_weight: '',
    b_weight: '',
    mq_weight: '',
    cs_weight: '',
    stone_weight: '',
    metal_weight: '',
    m_weight: '',
    cost: '',
    tag_price: '',
    minimum_price: '',
    gemstone_cost: '',
    vat_amount: '',
    total_with_vat: '',
    tag1: '',
    tag2: '',
    tag3: '',
    tag4: '',
    tag5: '',
    inventory_account_id: '',
    is_available_for_sale: true,
  });

  useEffect(() => {
    if (open) {
      fetchAccounts();
      fetchBranches();
      
      if (jewelryItem) {
        setFormData({
          item_code: jewelryItem.item_code,
          stockcode: jewelryItem.stockcode || '',
          model: jewelryItem.model || '',
          supp_ref: jewelryItem.supp_ref || '',
          description: jewelryItem.description || '',
          division: jewelryItem.division || '',
          type: jewelryItem.type || '',
          metal: jewelryItem.metal || 'GOLD',
          rate_type: jewelryItem.rate_type || 'by_weight',
          clarity: jewelryItem.clarity || '',
          stone: jewelryItem.stone || '',
          m_value: jewelryItem.m_value || '',
          g_weight: jewelryItem.g_weight?.toString() || '',
          d_weight: jewelryItem.d_weight?.toString() || '',
          b_weight: jewelryItem.b_weight?.toString() || '',
          mq_weight: jewelryItem.mq_weight?.toString() || '',
          cs_weight: jewelryItem.cs_weight?.toString() || '',
          stone_weight: jewelryItem.stone_weight?.toString() || '',
          metal_weight: jewelryItem.metal_weight?.toString() || '',
          m_weight: jewelryItem.m_weight?.toString() || '',
          cost: jewelryItem.cost?.toString() || '',
          tag_price: jewelryItem.tag_price?.toString() || '',
          minimum_price: jewelryItem.minimum_price?.toString() || '',
          gemstone_cost: jewelryItem.gemstone_cost?.toString() || '',
          vat_amount: jewelryItem.vat_amount?.toString() || '',
          total_with_vat: jewelryItem.total_with_vat?.toString() || '',
          tag1: jewelryItem.tag1 || '',
          tag2: jewelryItem.tag2 || '',
          tag3: jewelryItem.tag3 || '',
          tag4: jewelryItem.tag4 || '',
          tag5: jewelryItem.tag5 || '',
          inventory_account_id: jewelryItem.inventory_account_id || '',
          is_available_for_sale: jewelryItem.is_available_for_sale ?? true,
        });
      } else {
        generateItemCode();
        resetForm();
      }
    }
  }, [jewelryItem, open]);

  useEffect(() => {
    if (open && defaultCode && !jewelryItem) {
      setFormData(prev => ({ ...prev, item_code: defaultCode }));
    }
  }, [open, defaultCode, jewelryItem]);

  const resetForm = () => {
    setFormData({
      item_code: defaultCode || '',
      stockcode: '',
      model: '',
      supp_ref: '',
      description: '',
      division: '',
      type: '',
      metal: 'GOLD',
      rate_type: 'by_weight',
      clarity: '',
      stone: '',
      m_value: '',
      g_weight: '',
      d_weight: '',
      b_weight: '',
      mq_weight: '',
      cs_weight: '',
      stone_weight: '',
      metal_weight: '',
      m_weight: '',
      cost: '',
      tag_price: '',
      minimum_price: '',
      gemstone_cost: '',
      vat_amount: '',
      total_with_vat: '',
      tag1: '',
      tag2: '',
      tag3: '',
      tag4: '',
      tag5: '',
      inventory_account_id: '',
      is_available_for_sale: true,
    });
  };

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

  const fetchBranches = async () => {
    try {
      const { data, error } = await dataGateway.queryTable('branches', {
        select: 'id, branch_code, name',
        filters: [{ type: 'eq', column: 'is_active', value: true }],
        order: { column: 'branch_code', ascending: true },
      });
      
      if (error) throw error;
      setBranches((data as any[] || []).map((b: any) => ({ id: b.id, branch_code: b.branch_code, branch_name: b.name })));
    } catch (error) {
      console.error('Error fetching branches:', error);
    }
  };

  const generateItemCode = async () => {
    try {
      const { data } = await dataGateway.queryTable('unique_items', {
        select: 'item_code',
        filters: [{ type: 'ilike', column: 'item_code', value: 'JWL-%' }],
        order: { column: 'item_code', ascending: false },
        limit: 1,
      });

      let nextNumber = 1;
      if (data && data.length > 0) {
        const lastCode = data[0].item_code;
        const match = lastCode.match(/JWL-(\d+)/);
        if (match) {
          nextNumber = parseInt(match[1]) + 1;
        }
      }

      if (!defaultCode) {
        setFormData(prev => ({
          ...prev,
          item_code: `JWL-${String(nextNumber).padStart(6, '0')}`,
        }));
      }
    } catch (error) {
      console.error('Error generating code:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.item_code) {
      toast.error(language === 'ar' ? 'الرجاء إدخال كود الصنف' : 'Please enter item code');
      return;
    }

    setLoading(true);

    try {
      if (formData.model) {
        const { data: existingModel } = await dataGateway.queryTable('jewelry_sets', {
          select: 'id, model',
          filters: [{ type: 'ilike', column: 'model', value: formData.model }],
          limit: 1,
        });

        if (existingModel && existingModel.length > 0) {
          toast.error(
            language === 'ar' 
              ? `هذا الموديل مسجل مسبقاً بالنظام\nMODEL: ${formData.model}\nلا يمكن تكرار نفس الموديل`
              : `This model already exists\nMODEL: ${formData.model}\nDuplicate models not allowed`
          );
          setLoading(false);
          return;
        }
      }

      const itemData = {
        item_code: formData.item_code,
        stockcode: formData.stockcode || formData.item_code,
        model: formData.model || null,
        supp_ref: formData.supp_ref || null,
        description: formData.description || null,
        division: formData.division || null,
        type: formData.type || null,
        metal: formData.metal || null,
        rate_type: formData.rate_type || null,
        clarity: formData.clarity || null,
        stone: formData.stone || null,
        m_value: formData.m_value || null,
        g_weight: parseFloat(formData.g_weight) || 0,
        d_weight: parseFloat(formData.d_weight) || 0,
        b_weight: parseFloat(formData.b_weight) || 0,
        mq_weight: parseFloat(formData.mq_weight) || 0,
        cs_weight: parseFloat(formData.cs_weight) || 0,
        stone_weight: parseFloat(formData.stone_weight) || 0,
        metal_weight: parseFloat(formData.metal_weight) || 0,
        m_weight: parseFloat(formData.m_weight) || 0,
        cost: parseFloat(formData.cost) || 0,
        tag_price: parseFloat(formData.tag_price) || 0,
        minimum_price: parseFloat(formData.minimum_price) || null,
        gemstone_cost: parseFloat(formData.gemstone_cost) || 0,
        vat_amount: parseFloat(formData.vat_amount) || 0,
        total_with_vat: parseFloat(formData.total_with_vat) || 0,
        tag1: formData.tag1 || null,
        tag2: formData.tag2 || null,
        tag3: formData.tag3 || null,
        tag4: formData.tag4 || null,
        tag5: formData.tag5 || null,
        inventory_account_id: formData.inventory_account_id || null,
        is_available_for_sale: formData.is_available_for_sale,
        sale_status: 'available',
      };

      const clientRequestId = crypto.randomUUID();

      if (jewelryItem) {
        // Update existing jewelry item
        const { data: result, error } = await dataGateway.rpc('jewelry_item_update_atomic', {
          p_client_request_id: clientRequestId,
          p_item_id: jewelryItem.id,
          p_name: itemData.description || formData.item_code,
          p_category: itemData.division,
          p_karat: itemData.metal,
          p_weight_grams: itemData.g_weight,
          p_unit_cost: itemData.cost,
          p_selling_price: itemData.tag_price,
          p_status: itemData.sale_status,
        });

        if (error) throw error;
        if (!result?.success) {
          throw new Error(result?.error || 'فشل تحديث القطعة');
        }

        toast.success(language === 'ar' ? 'تم تحديث القطعة بنجاح' : 'Item updated successfully');
        onSuccess({ ...jewelryItem, ...itemData } as JewelryItem);
      } else {
        // Create new jewelry item
        const { data: result, error } = await dataGateway.rpc('jewelry_item_create_atomic', {
          p_client_request_id: clientRequestId,
          p_name: itemData.description || formData.item_code,
          p_category: itemData.division,
          p_karat: itemData.metal,
          p_weight_grams: itemData.g_weight,
          p_unit_cost: itemData.cost,
          p_selling_price: itemData.tag_price,
        });

        if (error) throw error;
        if (!result?.success) {
          throw new Error(result?.error || 'فشل إنشاء القطعة');
        }

        toast.success(language === 'ar' ? 'تم إضافة القطعة بنجاح' : 'Item added successfully');
        onSuccess({
          id: result.item_id,
          item_code: result.item_code,
          ...itemData,
        } as JewelryItem);
      }
      
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error saving item:', error);
      if (error.code === '23505') {
        toast.error(language === 'ar' ? 'كود الصنف موجود مسبقاً' : 'Item code already exists');
      } else {
        toast.error(language === 'ar' ? 'حدث خطأ' : 'An error occurred');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gem className="w-5 h-5 text-primary" />
            {jewelryItem 
              ? (language === 'ar' ? 'تعديل صنف المجوهرات' : 'Edit Jewelry Item')
              : (language === 'ar' ? 'إضافة صنف جديد' : 'Add New Item')
            }
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Basic Info Section */}
          <div className="p-4 bg-muted/50 rounded-lg border space-y-4">
            <h4 className="font-semibold flex items-center gap-2">
              <Gem className="w-4 h-4" />
              {language === 'ar' ? 'المعلومات الأساسية' : 'Basic Information'}
            </h4>
            
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'كود الصنف *' : 'Item Code *'}</Label>
                <Input
                  value={formData.item_code}
                  onChange={(e) => setFormData(prev => ({ ...prev, item_code: e.target.value }))}
                  placeholder="JWL-000001"
                  required
                  dir="ltr"
                  className="font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'كود المخزون' : 'Stock Code'}</Label>
                <Input
                  value={formData.stockcode}
                  onChange={(e) => setFormData(prev => ({ ...prev, stockcode: e.target.value }))}
                  placeholder="STK-001"
                  dir="ltr"
                />
              </div>
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'مرجع المورد' : 'Supplier Ref'}</Label>
                <Input
                  value={formData.supp_ref}
                  onChange={(e) => setFormData(prev => ({ ...prev, supp_ref: e.target.value }))}
                  dir="ltr"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>{language === 'ar' ? 'الموديل' : 'Model'}</Label>
              <Input
                value={formData.model}
                onChange={(e) => setFormData(prev => ({ ...prev, model: e.target.value }))}
                placeholder="M8698"
                dir="ltr"
              />
            </div>

            <div className="space-y-2">
              <Label>{language === 'ar' ? 'الوصف' : 'Description'}</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                rows={2}
              />
            </div>
          </div>

          {/* Classification Section */}
          <div className="p-4 bg-muted/50 rounded-lg border space-y-4">
            <h4 className="font-semibold">
              {language === 'ar' ? 'التصنيف' : 'Classification'}
            </h4>
            
            <div className="grid grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'القسم' : 'Division'}</Label>
                <Select
                  value={formData.division}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, division: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={language === 'ar' ? 'اختر...' : 'Select...'} />
                  </SelectTrigger>
                  <SelectContent>
                    {DIVISION_TYPES.map(type => (
                      <SelectItem key={type.value} value={type.value}>
                        {language === 'ar' ? type.labelAr : type.labelEn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'النوع' : 'Type'}</Label>
                <Select
                  value={formData.type}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, type: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={language === 'ar' ? 'اختر...' : 'Select...'} />
                  </SelectTrigger>
                  <SelectContent>
                    {ITEM_TYPES.map(type => (
                      <SelectItem key={type.value} value={type.value}>
                        {language === 'ar' ? type.labelAr : type.labelEn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'نوع المعدن' : 'Metal Type'}</Label>
                <Select
                  value={formData.metal}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, metal: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {METAL_TYPES.map(type => (
                      <SelectItem key={type.value} value={type.value}>
                        {language === 'ar' ? type.labelAr : type.labelEn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'نوع السعر' : 'Rate Type'}</Label>
                <Select
                  value={formData.rate_type}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, rate_type: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RATE_TYPES.map(type => (
                      <SelectItem key={type.value} value={type.value}>
                        {language === 'ar' ? type.labelAr : type.labelEn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Weights Section */}
          <div className="p-4 bg-muted/50 rounded-lg border space-y-4">
            <h4 className="font-semibold flex items-center gap-2">
              <Scale className="w-4 h-4" />
              {language === 'ar' ? 'الأوزان (جرام)' : 'Weights (Grams)'}
            </h4>
            
            <div className="grid grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'وزن الذهب' : 'Gold Weight'}</Label>
                <Input
                  type="number"
                  step="0.001"
                  min="0"
                  value={formData.g_weight}
                  onChange={(e) => setFormData(prev => ({ ...prev, g_weight: e.target.value }))}
                  dir="ltr"
                />
              </div>
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'وزن الألماس' : 'Diamond Weight'}</Label>
                <Input
                  type="number"
                  step="0.001"
                  min="0"
                  value={formData.d_weight}
                  onChange={(e) => setFormData(prev => ({ ...prev, d_weight: e.target.value }))}
                  dir="ltr"
                />
              </div>
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'وزن الفصوص' : 'B Weight'}</Label>
                <Input
                  type="number"
                  step="0.001"
                  min="0"
                  value={formData.b_weight}
                  onChange={(e) => setFormData(prev => ({ ...prev, b_weight: e.target.value }))}
                  dir="ltr"
                />
              </div>
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'وزن الأحجار' : 'Stone Weight'}</Label>
                <Input
                  type="number"
                  step="0.001"
                  min="0"
                  value={formData.stone_weight}
                  onChange={(e) => setFormData(prev => ({ ...prev, stone_weight: e.target.value }))}
                  dir="ltr"
                />
              </div>
            </div>
            
            <div className="grid grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>MQ Weight</Label>
                <Input
                  type="number"
                  step="0.001"
                  min="0"
                  value={formData.mq_weight}
                  onChange={(e) => setFormData(prev => ({ ...prev, mq_weight: e.target.value }))}
                  dir="ltr"
                />
              </div>
              <div className="space-y-2">
                <Label>CS Weight</Label>
                <Input
                  type="number"
                  step="0.001"
                  min="0"
                  value={formData.cs_weight}
                  onChange={(e) => setFormData(prev => ({ ...prev, cs_weight: e.target.value }))}
                  dir="ltr"
                />
              </div>
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'وزن المعدن' : 'Metal Weight'}</Label>
                <Input
                  type="number"
                  step="0.001"
                  min="0"
                  value={formData.metal_weight}
                  onChange={(e) => setFormData(prev => ({ ...prev, metal_weight: e.target.value }))}
                  dir="ltr"
                />
              </div>
              <div className="space-y-2">
                <Label>M Weight</Label>
                <Input
                  type="number"
                  step="0.001"
                  min="0"
                  value={formData.m_weight}
                  onChange={(e) => setFormData(prev => ({ ...prev, m_weight: e.target.value }))}
                  dir="ltr"
                />
              </div>
            </div>
          </div>

          {/* Pricing Section */}
          <div className="p-4 bg-muted/50 rounded-lg border space-y-4">
            <h4 className="font-semibold flex items-center gap-2">
              <DollarSign className="w-4 h-4" />
              {language === 'ar' ? 'التسعير' : 'Pricing'}
            </h4>
            
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'التكلفة' : 'Cost'}</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.cost}
                  onChange={(e) => setFormData(prev => ({ ...prev, cost: e.target.value }))}
                  dir="ltr"
                />
              </div>
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'سعر البطاقة' : 'Tag Price'}</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.tag_price}
                  onChange={(e) => setFormData(prev => ({ ...prev, tag_price: e.target.value }))}
                  dir="ltr"
                />
              </div>
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'الحد الأدنى للسعر' : 'Minimum Price'}</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.minimum_price}
                  onChange={(e) => setFormData(prev => ({ ...prev, minimum_price: e.target.value }))}
                  dir="ltr"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'تكلفة الفصوص' : 'Gemstone Cost'}</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.gemstone_cost}
                  onChange={(e) => setFormData(prev => ({ ...prev, gemstone_cost: e.target.value }))}
                  dir="ltr"
                />
              </div>
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'مبلغ الضريبة' : 'VAT Amount'}</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.vat_amount}
                  onChange={(e) => setFormData(prev => ({ ...prev, vat_amount: e.target.value }))}
                  dir="ltr"
                />
              </div>
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'الإجمالي + الضريبة' : 'Total with VAT'}</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.total_with_vat}
                  onChange={(e) => setFormData(prev => ({ ...prev, total_with_vat: e.target.value }))}
                  dir="ltr"
                />
              </div>
            </div>
          </div>

          {/* Additional Properties Section */}
          <div className="p-4 bg-muted/50 rounded-lg border space-y-4">
            <h4 className="font-semibold flex items-center gap-2">
              <Tag className="w-4 h-4" />
              {language === 'ar' ? 'خصائص إضافية' : 'Additional Properties'}
            </h4>
            
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'الأحجار' : 'Stone'}</Label>
                <Input
                  value={formData.stone}
                  onChange={(e) => setFormData(prev => ({ ...prev, stone: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'النقاوة' : 'Clarity'}</Label>
                <Input
                  value={formData.clarity}
                  onChange={(e) => setFormData(prev => ({ ...prev, clarity: e.target.value }))}
                  placeholder="VVS, VS, SI..."
                />
              </div>
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'قيمة M' : 'M Value'}</Label>
                <Input
                  value={formData.m_value}
                  onChange={(e) => setFormData(prev => ({ ...prev, m_value: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-5 gap-4">
              <div className="space-y-2">
                <Label>Tag 1</Label>
                <Input
                  value={formData.tag1}
                  onChange={(e) => setFormData(prev => ({ ...prev, tag1: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Tag 2</Label>
                <Input
                  value={formData.tag2}
                  onChange={(e) => setFormData(prev => ({ ...prev, tag2: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Tag 3</Label>
                <Input
                  value={formData.tag3}
                  onChange={(e) => setFormData(prev => ({ ...prev, tag3: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Tag 4</Label>
                <Input
                  value={formData.tag4}
                  onChange={(e) => setFormData(prev => ({ ...prev, tag4: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Tag 5</Label>
                <Input
                  value={formData.tag5}
                  onChange={(e) => setFormData(prev => ({ ...prev, tag5: e.target.value }))}
                />
              </div>
            </div>
          </div>

          {/* Accounting & Warehouse Section */}
          <div className="p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800 space-y-4">
            <h4 className="font-semibold flex items-center gap-2 text-blue-700 dark:text-blue-300">
              <DollarSign className="w-4 h-4" />
              {language === 'ar' ? 'الربط المحاسبي' : 'Accounting Link'}
            </h4>
            <p className="text-xs text-muted-foreground">
              {language === 'ar' 
                ? 'اختر حساب المخزون للتسجيل المحاسبي التلقائي'
                : 'Select inventory account for automatic GL recording'}
            </p>
            <div className="space-y-2">
              <Label>{language === 'ar' ? 'حساب المخزون' : 'Inventory Account'}</Label>
              <AccountCombobox
                accounts={accounts}
                value={formData.inventory_account_id}
                onValueChange={(value) => setFormData(prev => ({ ...prev, inventory_account_id: value }))}
                showOnlyLeaf={true}
              />
            </div>
          </div>

          {/* Note: Warehouse is auto-synced with branch_id via database trigger */}

          {/* Status */}
          <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
            <Label>{language === 'ar' ? 'متاح للبيع' : 'Available for Sale'}</Label>
            <Switch
              checked={formData.is_available_for_sale}
              onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_available_for_sale: checked }))}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {language === 'ar' ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {jewelryItem 
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

JewelryItemFormDialog.displayName = 'JewelryItemFormDialog';

export default JewelryItemFormDialog;
