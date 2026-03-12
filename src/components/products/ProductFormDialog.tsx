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
import { Loader2, Package, DollarSign, Warehouse } from 'lucide-react';
import { AccountCombobox } from '@/components/accounting/AccountCombobox';

interface Product {
  id: string;
  product_code: string;
  name_ar: string;
  name_en: string | null;
  description: string | null;
  product_type: string;
  product_sub_type: string | null;
  category: string | null;
  unit: string;
  barcode: string | null;
  sku: string | null;
  cost_price: number;
  selling_price: number;
  min_price: number | null;
  tax_rate: number;
  is_tax_inclusive: boolean;
  is_active: boolean;
  is_service: boolean;
  inventory_account_id: string | null;
  expense_account_id: string | null;
  default_warehouse_id: string | null;
}

interface ProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product?: Product | null;
  onSuccess: (product: Product) => void;
  defaultType?: 'consumable' | 'raw_material' | 'general';
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

const PRODUCT_SUB_TYPES = [
  { value: 'consumable', labelAr: 'مستلزمات تشغيل', labelEn: 'Consumables' },
  { value: 'raw_material', labelAr: 'مواد خام', labelEn: 'Raw Materials' },
  { value: 'general', labelAr: 'منتج عام', labelEn: 'General Product' },
];

const ProductFormDialog = React.forwardRef<HTMLDivElement, ProductFormDialogProps>(({
  open,
  onOpenChange,
  product,
  onSuccess,
  defaultType = 'general',
}, ref) => {
  const { language } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState<HierarchicalAccount[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  
  const [formData, setFormData] = useState<{
    product_code: string;
    name_ar: string;
    name_en: string;
    description: string;
    category: string;
    unit: string;
    barcode: string;
    sku: string;
    product_sub_type: string;
    cost_price: string;
    selling_price: string;
    min_price: string;
    tax_rate: string;
    is_tax_inclusive: boolean;
    is_active: boolean;
    inventory_account_id: string;
    expense_account_id: string;
    default_warehouse_id: string;
  }>({
    product_code: '',
    name_ar: '',
    name_en: '',
    description: '',
    category: '',
    unit: 'piece',
    barcode: '',
    sku: '',
    product_sub_type: defaultType,
    cost_price: '',
    selling_price: '',
    min_price: '',
    tax_rate: '15',
    is_tax_inclusive: false,
    is_active: true,
    inventory_account_id: '',
    expense_account_id: '',
    default_warehouse_id: '',
  });

  useEffect(() => {
    if (open) {
      fetchAccounts();
      fetchBranches();
      
      if (product) {
        setFormData({
          product_code: product.product_code,
          name_ar: product.name_ar,
          name_en: product.name_en || '',
          description: product.description || '',
          category: product.category || '',
          unit: product.unit || 'piece',
          barcode: product.barcode || '',
          sku: product.sku || '',
          product_sub_type: product.product_sub_type || 'general',
          cost_price: product.cost_price?.toString() || '',
          selling_price: product.selling_price?.toString() || '',
          min_price: (product.min_price as number | null)?.toString() || '',
          tax_rate: (product.tax_rate as number)?.toString() || '15',
          is_tax_inclusive: product.is_tax_inclusive || false,
          is_active: product.is_active,
          inventory_account_id: product.inventory_account_id || '',
          expense_account_id: product.expense_account_id || '',
          default_warehouse_id: product.default_warehouse_id || '',
        });
      } else {
        generateProductCode();
        setFormData(prev => ({
          ...prev,
          product_code: '',
          name_ar: '',
          name_en: '',
          description: '',
          category: '',
          unit: 'piece',
          barcode: '',
          sku: '',
          product_sub_type: defaultType,
          cost_price: '',
          selling_price: '',
          min_price: '',
          tax_rate: '15',
          is_tax_inclusive: false,
          is_active: true,
          inventory_account_id: '',
          expense_account_id: '',
          default_warehouse_id: '',
        }));
      }
    }
  }, [product, open]);

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

  const generateProductCode = async () => {
    try {
      const { data } = await dataGateway.queryTable('products', {
        select: 'product_code',
        filters: [{ type: 'ilike', column: 'product_code', value: 'PRD-%' }],
        order: { column: 'product_code', ascending: false },
        limit: 1,
      });

      let nextNumber = 1;
      if (data && data.length > 0) {
        const lastCode = data[0].product_code;
        const lastNumber = parseInt(lastCode.split('-')[1]) || 0;
        nextNumber = lastNumber + 1;
      }

      setFormData(prev => ({
        ...prev,
        product_code: `PRD-${String(nextNumber).padStart(4, '0')}`,
      }));
    } catch (error) {
      console.error('Error generating code:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.product_code || !formData.name_ar) {
      toast.error(language === 'ar' ? 'الرجاء تعبئة الحقول المطلوبة' : 'Please fill required fields');
      return;
    }

    setLoading(true);

    try {
      const productData = {
        product_code: formData.product_code,
        name_ar: formData.name_ar,
        name_en: formData.name_en || null,
        description: formData.description || null,
        product_type: 'general',
        product_sub_type: formData.product_sub_type,
        category: formData.category || null,
        unit: formData.unit,
        barcode: formData.barcode || null,
        sku: formData.sku || null,
        cost_price: parseFloat(formData.cost_price) || 0,
        selling_price: parseFloat(formData.selling_price) || 0,
        min_price: parseFloat(formData.min_price) || null,
        is_service: false,
        tax_rate: parseFloat(formData.tax_rate) || 15,
        is_tax_inclusive: formData.is_tax_inclusive,
        is_active: formData.is_active,
        inventory_account_id: formData.inventory_account_id || null,
        expense_account_id: formData.expense_account_id || null,
        default_warehouse_id: formData.default_warehouse_id || null,
      };

      const clientRequestId = crypto.randomUUID();

      if (product) {
        // Update existing product
        const { data: result, error } = await dataGateway.rpc('product_update_atomic', {
          p_client_request_id: clientRequestId,
          p_product_id: product.id,
          p_name_ar: productData.name_ar,
          p_name_en: productData.name_en,
          p_description: productData.description,
          p_product_sub_type: productData.product_sub_type,
          p_category: productData.category,
          p_unit: productData.unit,
          p_barcode: productData.barcode,
          p_sku: productData.sku,
          p_cost_price: productData.cost_price,
          p_selling_price: productData.selling_price,
          p_min_price: productData.min_price,
          p_tax_rate: productData.tax_rate,
          p_is_tax_inclusive: productData.is_tax_inclusive,
          p_is_active: productData.is_active,
          p_inventory_account_id: productData.inventory_account_id,
          p_expense_account_id: productData.expense_account_id,
          p_default_warehouse_id: productData.default_warehouse_id,
        });

        if (error) throw error;
        if (!result?.success) {
          throw new Error(result?.error || 'فشل تحديث المنتج');
        }

        toast.success(language === 'ar' ? 'تم تحديث المنتج بنجاح' : 'Product updated successfully');
        onSuccess({ ...product, ...productData } as Product);
      } else {
        // Create new product
        const { data: result, error } = await dataGateway.rpc('product_create_atomic', {
          p_client_request_id: clientRequestId,
          p_name_ar: productData.name_ar,
          p_name_en: productData.name_en,
          p_description: productData.description,
          p_product_type: productData.product_type,
          p_product_sub_type: productData.product_sub_type,
          p_category: productData.category,
          p_unit: productData.unit,
          p_barcode: productData.barcode,
          p_sku: productData.sku,
          p_cost_price: productData.cost_price,
          p_selling_price: productData.selling_price,
          p_min_price: productData.min_price,
          p_tax_rate: productData.tax_rate,
          p_is_tax_inclusive: productData.is_tax_inclusive,
          p_is_service: productData.is_service,
          p_inventory_account_id: productData.inventory_account_id,
          p_expense_account_id: productData.expense_account_id,
          p_default_warehouse_id: productData.default_warehouse_id,
        });

        if (error) throw error;
        if (!result?.success) {
          throw new Error(result?.error || 'فشل إنشاء المنتج');
        }

        toast.success(language === 'ar' ? 'تم إضافة المنتج بنجاح' : 'Product added successfully');
        onSuccess({
          id: result.product_id,
          product_code: result.product_code,
          ...productData,
        } as Product);
      }
      
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error saving product:', error);
      if (error.code === '23505') {
        toast.error(language === 'ar' ? 'كود المنتج موجود مسبقاً' : 'Product code already exists');
      } else {
        toast.error(language === 'ar' ? 'حدث خطأ' : 'An error occurred');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-5 h-5 text-primary" />
            {product 
              ? (language === 'ar' ? 'تعديل المنتج' : 'Edit Product')
              : (language === 'ar' ? 'إضافة منتج جديد' : 'Add New Product')
            }
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Product Sub Type */}
          <div className="space-y-2">
            <Label>{language === 'ar' ? 'نوع المنتج *' : 'Product Type *'}</Label>
            <div className="grid grid-cols-3 gap-2">
              {PRODUCT_SUB_TYPES.map((type) => {
                const isSelected = formData.product_sub_type === type.value;
                return (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, product_sub_type: type.value }))}
                    className={`p-3 rounded-lg border-2 transition-all text-center ${
                      isSelected 
                        ? 'border-primary bg-primary/10 text-primary font-medium' 
                        : 'border-border hover:border-muted-foreground/50'
                    }`}
                  >
                    <span className="text-sm">
                      {language === 'ar' ? type.labelAr : type.labelEn}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{language === 'ar' ? 'كود المنتج *' : 'Product Code *'}</Label>
              <Input
                value={formData.product_code}
                onChange={(e) => setFormData(prev => ({ ...prev, product_code: e.target.value }))}
                placeholder="PRD-0001"
                required
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label>{language === 'ar' ? 'الباركود' : 'Barcode'}</Label>
              <Input
                value={formData.barcode}
                onChange={(e) => setFormData(prev => ({ ...prev, barcode: e.target.value }))}
                placeholder="1234567890123"
                dir="ltr"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{language === 'ar' ? 'الاسم (عربي) *' : 'Name (Arabic) *'}</Label>
              <Input
                value={formData.name_ar}
                onChange={(e) => setFormData(prev => ({ ...prev, name_ar: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>{language === 'ar' ? 'الاسم (إنجليزي)' : 'Name (English)'}</Label>
              <Input
                value={formData.name_en}
                onChange={(e) => setFormData(prev => ({ ...prev, name_en: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{language === 'ar' ? 'SKU' : 'SKU'}</Label>
              <Input
                value={formData.sku}
                onChange={(e) => setFormData(prev => ({ ...prev, sku: e.target.value }))}
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label>{language === 'ar' ? 'الوحدة' : 'Unit'}</Label>
              <Select
                value={formData.unit}
                onValueChange={(value) => setFormData(prev => ({ ...prev, unit: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="piece">{language === 'ar' ? 'قطعة' : 'Piece'}</SelectItem>
                  <SelectItem value="gram">{language === 'ar' ? 'جرام' : 'Gram'}</SelectItem>
                  <SelectItem value="kg">{language === 'ar' ? 'كيلوجرام' : 'Kilogram'}</SelectItem>
                  <SelectItem value="meter">{language === 'ar' ? 'متر' : 'Meter'}</SelectItem>
                  <SelectItem value="box">{language === 'ar' ? 'علبة' : 'Box'}</SelectItem>
                  <SelectItem value="liter">{language === 'ar' ? 'لتر' : 'Liter'}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>{language === 'ar' ? 'الوصف' : 'Description'}</Label>
            <Textarea
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              rows={2}
            />
          </div>

          {/* Pricing Section */}
          <div className="p-4 bg-muted/50 rounded-lg border space-y-4">
            <h4 className="font-semibold flex items-center gap-2">
              <DollarSign className="w-4 h-4" />
              {language === 'ar' ? 'التكاليف والأسعار' : 'Costs & Pricing'}
            </h4>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'سعر الشراء' : 'Purchase Price'}</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.cost_price}
                  onChange={(e) => setFormData(prev => ({ ...prev, cost_price: e.target.value }))}
                  dir="ltr"
                />
              </div>
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'سعر البيع' : 'Selling Price'}</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.selling_price}
                  onChange={(e) => setFormData(prev => ({ ...prev, selling_price: e.target.value }))}
                  dir="ltr"
                />
              </div>
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
            </div>
          </div>

          {/* Accounting Link Section */}
          <div className="p-4 bg-blue-50 rounded-lg border border-blue-200 space-y-4">
            <h4 className="font-semibold flex items-center gap-2 text-blue-700">
              <DollarSign className="w-4 h-4" />
              {language === 'ar' ? 'الربط المحاسبي' : 'Accounting Link'}
            </h4>
            <p className="text-xs text-muted-foreground">
              {language === 'ar' 
                ? 'اختر الحسابات المحاسبية للتسجيل التلقائي عند الشراء والبيع'
                : 'Select GL accounts for automatic recording on purchase and sale'}
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'حساب المخزون' : 'Inventory Account'}</Label>
                <AccountCombobox
                  accounts={accounts}
                  value={formData.inventory_account_id}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, inventory_account_id: value }))}
                  showOnlyLeaf={true}
                />
              </div>
              <div className="space-y-2">
                <Label>{language === 'ar' ? 'حساب التكلفة/المصروف' : 'Cost/Expense Account'}</Label>
                <AccountCombobox
                  accounts={accounts}
                  value={formData.expense_account_id}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, expense_account_id: value }))}
                  showOnlyLeaf={true}
                />
              </div>
            </div>
          </div>

          {/* Warehouse Link Section */}
          <div className="p-4 bg-green-50 rounded-lg border border-green-200 space-y-4">
            <h4 className="font-semibold flex items-center gap-2 text-green-700">
              <Warehouse className="w-4 h-4" />
              {language === 'ar' ? 'الربط بالمخازن' : 'Warehouse Link'}
            </h4>
            <div className="space-y-2">
              <Label>{language === 'ar' ? 'المخزن الافتراضي' : 'Default Warehouse'}</Label>
              <Select
                value={formData.default_warehouse_id || 'none'}
                onValueChange={(value) => setFormData(prev => ({ ...prev, default_warehouse_id: value === 'none' ? '' : value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={language === 'ar' ? 'اختر المخزن' : 'Select Warehouse'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{language === 'ar' ? 'بدون مخزن افتراضي' : 'No Default Warehouse'}</SelectItem>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.branch_code} - {branch.branch_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Status */}
          <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
            <Label>{language === 'ar' ? 'المنتج نشط' : 'Product Active'}</Label>
            <Switch
              checked={formData.is_active}
              onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_active: checked }))}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {language === 'ar' ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {product 
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

ProductFormDialog.displayName = 'ProductFormDialog';

export default ProductFormDialog;