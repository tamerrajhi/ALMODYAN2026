import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import { Loader2, Plus, Trash2, Copy, Package, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { 
  getPurchaseRequisitionFormData, 
  getPurchaseRequisitionForEdit,
  PRLineItemDTO,
} from '@/domain/purchasing/purchasingReadService';
import { 
  upsertPurchaseRequisition,
  PRLineItemCommand,
} from '@/domain/purchasing/purchasingWriteService';

interface PRFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requisition?: any;
  mode: 'create' | 'edit';
}

interface LineItem {
  id?: string;
  itemDescription: string;
  itemCode: string;
  jewelryItemId: string;
  quantity: number;
  unit: string;
  estimatedUnitPrice: number;
  supplierId: string;
  warehouseId: string;
  costCenterId: string;
  notes: string;
}

const emptyItem: LineItem = {
  itemDescription: '',
  itemCode: '',
  jewelryItemId: '',
  quantity: 1,
  unit: 'قطعة',
  estimatedUnitPrice: 0,
  supplierId: '',
  warehouseId: '',
  costCenterId: '',
  notes: '',
};

const REQUEST_TYPES = [
  { value: 'materials', label: 'مواد خام' },
  { value: 'spare_parts', label: 'قطع غيار' },
  { value: 'services', label: 'خدمات' },
  { value: 'equipment', label: 'معدات' },
  { value: 'consumables', label: 'مستهلكات' },
  { value: 'other', label: 'أخرى' },
];

export function PRFormDialog({ open, onOpenChange, requisition, mode }: PRFormDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('general');
  
  // Get today's date in local timezone (YYYY-MM-DD format)
  const getTodayDate = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const [formData, setFormData] = useState({
    branchId: '',
    departmentId: '',
    warehouseId: '',
    costCenterId: '',
    requiredDate: getTodayDate(),
    priority: 'normal',
    requisitionType: 'materials',
    justification: '',
    notes: '',
  });

  const [items, setItems] = useState<LineItem[]>([{ ...emptyItem }]);

  // Fetch dropdown data via read service
  const { data: formDropdowns } = useQuery({
    queryKey: ['pr-form-dropdowns'],
    queryFn: getPurchaseRequisitionFormData,
  });

  // Fetch PR for edit mode via read service
  const { data: editData } = useQuery({
    queryKey: ['pr-for-edit', requisition?.id],
    queryFn: () => getPurchaseRequisitionForEdit(requisition?.id),
    enabled: mode === 'edit' && !!requisition?.id && open,
  });

  // Load edit data when available
  useEffect(() => {
    if (mode === 'edit' && editData && open) {
      setFormData({
        branchId: editData.branchId || '',
        departmentId: editData.departmentId || '',
        warehouseId: editData.warehouseId || '',
        costCenterId: editData.costCenterId || '',
        requiredDate: editData.requiredDate || '',
        priority: editData.priority || 'normal',
        requisitionType: editData.requisitionType || 'materials',
        justification: editData.justification || '',
        notes: editData.notes || '',
      });
      if (editData.items.length > 0) {
        setItems(editData.items.map((item: PRLineItemDTO) => ({
          id: item.id,
          itemDescription: item.itemDescription,
          itemCode: item.itemCode || '',
          jewelryItemId: item.jewelryItemId || '',
          quantity: item.quantity,
          unit: item.unit,
          estimatedUnitPrice: item.estimatedUnitPrice,
          supplierId: item.supplierId || '',
          warehouseId: item.warehouseId || '',
          costCenterId: item.costCenterId || '',
          notes: item.notes || '',
        })));
      }
    } else if (mode === 'create' && open) {
      resetForm();
    }
  }, [mode, editData, open]);

  const resetForm = () => {
    setFormData({
      branchId: '',
      departmentId: '',
      warehouseId: '',
      costCenterId: '',
      requiredDate: getTodayDate(),
      priority: 'normal',
      requisitionType: 'materials',
      justification: '',
      notes: '',
    });
    setItems([{ ...emptyItem }]);
    setActiveTab('general');
  };

  const addItem = () => {
    setItems([...items, { ...emptyItem }]);
  };

  const duplicateItem = (index: number) => {
    const itemToDuplicate = { ...items[index] };
    delete itemToDuplicate.id;
    setItems([...items, itemToDuplicate]);
    toast.success('تم نسخ البند');
  };

  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index));
    }
  };

  const updateItem = (index: number, field: keyof LineItem, value: any) => {
    setItems(items.map((item, i) => {
      if (i !== index) return item;
      
      const updated = { ...item, [field]: value };
      
      // If jewelry item selected, populate description and code
      if (field === 'jewelryItemId' && value) {
        const jewel = formDropdowns?.jewelryItems.find(j => j.id === value);
        if (jewel) {
          updated.itemDescription = jewel.description || '';
          updated.itemCode = jewel.itemCode || '';
        }
      }
      
      return updated;
    }));
  };

  const totalEstimated = items.reduce((sum, item) => sum + (item.quantity * item.estimatedUnitPrice), 0);

  const getRequiredApprovalLevel = (amount: number) => {
    if (amount <= 5000) return 1;
    if (amount <= 25000) return 2;
    return 3;
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('المستخدم غير مسجل');

      const commandItems: PRLineItemCommand[] = items.map(item => ({
        id: item.id,
        itemDescription: item.itemDescription,
        itemCode: item.itemCode || undefined,
        jewelryItemId: item.jewelryItemId || undefined,
        quantity: item.quantity,
        unit: item.unit,
        estimatedUnitPrice: item.estimatedUnitPrice,
        supplierId: item.supplierId || undefined,
        warehouseId: item.warehouseId || undefined,
        costCenterId: item.costCenterId || undefined,
        notes: item.notes || undefined,
      }));

      const result = await upsertPurchaseRequisition({
        id: mode === 'edit' ? requisition?.id : undefined,
        branchId: formData.branchId || undefined,
        departmentId: formData.departmentId || undefined,
        warehouseId: formData.branchId || undefined,
        costCenterId: formData.costCenterId || undefined,
        requiredDate: formData.requiredDate || undefined,
        priority: formData.priority,
        requisitionType: formData.requisitionType,
        justification: formData.justification || undefined,
        notes: formData.notes || undefined,
        items: commandItems,
        userId: user.id,
        userName: user.email || 'مستخدم',
      });

      if (!result.success) {
        throw new Error(result.error);
      }

      return result;
    },
    onSuccess: () => {
      toast.success(mode === 'create' ? 'تم إنشاء طلب الشراء بنجاح' : 'تم تعديل طلب الشراء بنجاح');
      onOpenChange(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['purchase-requisitions'] });
    },
    onError: (error: any) => {
      toast.error(error.message || 'فشل في حفظ طلب الشراء');
    },
  });

  const handleSubmit = () => {
    saveMutation.mutate();
  };

  const isPending = saveMutation.isPending;

  const branches = formDropdowns?.branches || [];
  const departments = formDropdowns?.departments || [];
  const suppliers = formDropdowns?.suppliers || [];
  const warehouses = formDropdowns?.warehouses || [];
  const costCenters = formDropdowns?.costCenters || [];
  const jewelryItems = formDropdowns?.jewelryItems || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? 'طلب شراء جديد' : 'تعديل طلب الشراء'}
          </DialogTitle>
        </DialogHeader>
        
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="general" className="gap-2">
              <FileText className="w-4 h-4" />
              بيانات عامة
            </TabsTrigger>
            <TabsTrigger value="items" className="gap-2">
              <Package className="w-4 h-4" />
              البنود ({items.length})
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 px-1">
            <TabsContent value="general" className="mt-4 space-y-6">
              {/* Basic Info */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <Label>الفرع *</Label>
                  <Select value={formData.branchId} onValueChange={(v) => setFormData({ ...formData, branchId: v })}>
                    <SelectTrigger>
                      <SelectValue placeholder="اختر الفرع" />
                    </SelectTrigger>
                    <SelectContent>
                      {branches.map((branch) => (
                        <SelectItem key={branch.id} value={branch.id}>
                          {branch.branchName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>القسم الطالب *</Label>
                  <Select value={formData.departmentId} onValueChange={(v) => setFormData({ ...formData, departmentId: v })}>
                    <SelectTrigger>
                      <SelectValue placeholder="اختر القسم" />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.map((dept) => (
                        <SelectItem key={dept.id} value={dept.id}>
                          {dept.departmentName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {/* Note: Warehouse = Branch (auto-synced via database trigger) */}
                <div>
                  <Label>مركز التكلفة</Label>
                  <Select value={formData.costCenterId} onValueChange={(v) => setFormData({ ...formData, costCenterId: v })}>
                    <SelectTrigger>
                      <SelectValue placeholder="اختر مركز التكلفة" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">بدون تحديد</SelectItem>
                      {costCenters.map((cc) => (
                        <SelectItem key={cc.id} value={cc.id}>
                          {cc.centerCode} - {cc.centerName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>نوع الطلب</Label>
                  <Select value={formData.requisitionType} onValueChange={(v) => setFormData({ ...formData, requisitionType: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REQUEST_TYPES.map(type => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>تاريخ الحاجة المتوقعة</Label>
                  <Input
                    type="date"
                    value={formData.requiredDate}
                    onChange={(e) => setFormData({ ...formData, requiredDate: e.target.value })}
                  />
                </div>
                <div>
                  <Label>الأولوية</Label>
                  <Select value={formData.priority} onValueChange={(v) => setFormData({ ...formData, priority: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">منخفض</SelectItem>
                      <SelectItem value="normal">عادي</SelectItem>
                      <SelectItem value="high">عالي</SelectItem>
                      <SelectItem value="urgent">عاجل</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label>مبررات الطلب *</Label>
                <Textarea
                  value={formData.justification}
                  onChange={(e) => setFormData({ ...formData, justification: e.target.value })}
                  placeholder="اشرح سبب الحاجة لهذا الطلب..."
                  rows={3}
                />
              </div>

              <div>
                <Label>ملاحظات عامة</Label>
                <Textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="ملاحظات إضافية..."
                  rows={2}
                />
              </div>

              {/* Summary */}
              <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                <div className="text-sm text-muted-foreground">
                  مستوى الموافقة المطلوب: <strong>{getRequiredApprovalLevel(totalEstimated)}</strong>
                  {totalEstimated <= 5000 && ' (مدير القسم)'}
                  {totalEstimated > 5000 && totalEstimated <= 25000 && ' (مدير القسم + المشتريات)'}
                  {totalEstimated > 25000 && ' (مدير القسم + المشتريات + الإدارة)'}
                </div>
                <div className="text-lg font-bold">
                  الإجمالي: {totalEstimated.toLocaleString()} ر.س
                </div>
              </div>
            </TabsContent>

            <TabsContent value="items" className="mt-4 space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-lg font-semibold">البنود المطلوبة</Label>
                <Button variant="outline" size="sm" onClick={addItem}>
                  <Plus className="w-4 h-4 ml-1" />
                  إضافة بند
                </Button>
              </div>

              {items.map((item, index) => (
                <Card key={index} className="p-4">
                  <div className="grid grid-cols-12 gap-3">
                    <div className="col-span-3">
                      <Label className="text-xs">اختر من المخزون</Label>
                      <Select 
                        value={item.jewelryItemId || "__none__"} 
                        onValueChange={(v) => updateItem(index, 'jewelryItemId', v === "__none__" ? "" : v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="اختياري" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">بدون ربط</SelectItem>
                          {jewelryItems.map((j) => (
                            <SelectItem key={j.id} value={j.id}>
                              {j.itemCode} - {j.description?.substring(0, 30)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-3">
                      <Label className="text-xs">الوصف *</Label>
                      <Input
                        value={item.itemDescription}
                        onChange={(e) => updateItem(index, 'itemDescription', e.target.value)}
                        placeholder="وصف البند"
                      />
                    </div>
                    <div className="col-span-1">
                      <Label className="text-xs">الكمية *</Label>
                      <Input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => updateItem(index, 'quantity', parseFloat(e.target.value) || 1)}
                      />
                    </div>
                    <div className="col-span-1">
                      <Label className="text-xs">الوحدة</Label>
                      <Input
                        value={item.unit}
                        onChange={(e) => updateItem(index, 'unit', e.target.value)}
                      />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs">السعر التقديري</Label>
                      <Input
                        type="number"
                        min="0"
                        value={item.estimatedUnitPrice}
                        onChange={(e) => updateItem(index, 'estimatedUnitPrice', parseFloat(e.target.value) || 0)}
                      />
                    </div>
                    <div className="col-span-2 flex items-end gap-1">
                      <div className="flex-1">
                        <Label className="text-xs">الإجمالي</Label>
                        <div className="h-10 flex items-center font-medium text-sm">
                          {(item.quantity * item.estimatedUnitPrice).toLocaleString()} ر.س
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => duplicateItem(index)}
                        title="نسخ البند"
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                      {items.length > 1 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => removeItem(index)}
                          title="حذف البند"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Extended fields */}
                  <div className="grid grid-cols-12 gap-3 mt-3 pt-3 border-t">
                    <div className="col-span-3">
                      <Label className="text-xs">المورد المقترح</Label>
                      <Select 
                        value={item.supplierId || "__none__"} 
                        onValueChange={(v) => updateItem(index, 'supplierId', v === "__none__" ? "" : v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="اختياري" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">بدون تحديد</SelectItem>
                          {suppliers.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.supplierName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-3">
                      <Label className="text-xs">المستودع المستهدف</Label>
                      <Select 
                        value={item.warehouseId || "__none__"} 
                        onValueChange={(v) => updateItem(index, 'warehouseId', v === "__none__" ? "" : v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="كما في الرأس" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">كما في الرأس</SelectItem>
                          {warehouses.map((wh) => (
                            <SelectItem key={wh.id} value={wh.id}>
                              {wh.branchName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-3">
                      <Label className="text-xs">مركز التكلفة</Label>
                      <Select 
                        value={item.costCenterId || "__none__"} 
                        onValueChange={(v) => updateItem(index, 'costCenterId', v === "__none__" ? "" : v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="كما في الرأس" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">كما في الرأس</SelectItem>
                          {costCenters.map((cc) => (
                            <SelectItem key={cc.id} value={cc.id}>
                              {cc.centerCode} - {cc.centerName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-3">
                      <Label className="text-xs">ملاحظات البند</Label>
                      <Input
                        value={item.notes}
                        onChange={(e) => updateItem(index, 'notes', e.target.value)}
                        placeholder="ملاحظات..."
                      />
                    </div>
                  </div>
                </Card>
              ))}

              <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                <div className="text-sm text-muted-foreground">
                  عدد البنود: <strong>{items.filter(i => i.itemDescription.trim()).length}</strong>
                </div>
                <div className="text-lg font-bold">
                  الإجمالي: {totalEstimated.toLocaleString()} ر.س
                </div>
              </div>
            </TabsContent>
          </ScrollArea>
        </Tabs>

        <DialogFooter className="border-t pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || !items.some(i => i.itemDescription.trim())}
          >
            {isPending && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
            {mode === 'create' ? 'حفظ كمسودة' : 'حفظ التعديلات'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
