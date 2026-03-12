import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Building2, 
  Phone, 
  FileText, 
  CreditCard, 
  Settings, 
  Loader2,
  X,
  Plus
} from 'lucide-react';
import { 
  Supplier, 
  SupplierFormData, 
  defaultSupplierFormData,
  supplierTypeLabels,
  businessTypeLabels,
  paymentTermsLabels,
  paymentMethodLabels,
  statusLabels,
} from '@/types/supplier.types';
import { useSupplierMutations } from '@/hooks/useSuppliers';

interface SupplierFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplier?: Supplier | null;
  onSuccess?: (supplier: any) => void;
}

export function SupplierFormDialog({ open, onOpenChange, supplier, onSuccess }: SupplierFormDialogProps) {
  const isEditing = !!supplier;
  const { createSupplier, updateSupplier } = useSupplierMutations();
  
  const [formData, setFormData] = useState<SupplierFormData>({ ...defaultSupplierFormData });
  const [newTag, setNewTag] = useState('');
  const [activeTab, setActiveTab] = useState('basic');

  // تحديث بيانات النموذج عند تغيير المورد أو فتح الـ Dialog
  useEffect(() => {
    if (open) {
      if (supplier) {
        setFormData({
          supplier_name: supplier.supplier_name || '',
          supplier_type: supplier.supplier_type || 'company',
          business_type: supplier.business_type || 'products',
          business_activity: supplier.business_activity || '',
          country: supplier.country || 'السعودية',
          city: supplier.city || '',
          address: supplier.address || '',
          detailed_address: supplier.detailed_address || '',
          mobile_phone: supplier.mobile_phone || '',
          office_phone: supplier.office_phone || '',
          email: supplier.email || '',
          website: supplier.website || '',
          contact_person: supplier.contact_person || '',
          contact_position: supplier.contact_position || '',
          vat_number: supplier.vat_number || '',
          commercial_register: supplier.commercial_register || '',
          national_id: supplier.national_id || '',
          license_expiry_date: supplier.license_expiry_date || '',
          default_currency: supplier.default_currency || 'SAR',
          payment_terms: supplier.payment_terms || 'net_30',
          credit_limit: supplier.credit_limit || 0,
          opening_balance: supplier.opening_balance || 0,
          default_payment_method: supplier.default_payment_method || 'cash',
          status: supplier.status || 'active',
          internal_notes: supplier.internal_notes || '',
          tags: supplier.tags || [],
        });
      } else {
        setFormData({ ...defaultSupplierFormData });
      }
      setActiveTab('basic');
      setNewTag('');
    }
  }, [open, supplier]);

  const handleChange = (field: keyof SupplierFormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleAddTag = () => {
    if (newTag.trim() && !formData.tags.includes(newTag.trim())) {
      setFormData(prev => ({ ...prev, tags: [...prev.tags, newTag.trim()] }));
      setNewTag('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    setFormData(prev => ({ ...prev, tags: prev.tags.filter(t => t !== tag) }));
  };

  const handleSubmit = async () => {
    if (!formData.supplier_name.trim()) {
      return;
    }

    try {
      let result;
      if (isEditing && supplier) {
        result = await updateSupplier.mutateAsync({ 
          id: supplier.id, 
          data: formData,
          oldData: supplier 
        });
      } else {
        result = await createSupplier.mutateAsync(formData);
      }
      
      onOpenChange(false);
      onSuccess?.(result);
    } catch (error) {
      // Error is handled in mutation
    }
  };

  const isLoading = createSupplier.isPending || updateSupplier.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-primary" />
            {isEditing ? 'تعديل بيانات المورد' : 'إضافة مورد جديد'}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(90vh-140px)]">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-5 mb-4">
              <TabsTrigger value="basic" className="flex items-center gap-1">
                <Building2 className="w-4 h-4" />
                <span className="hidden sm:inline">البيانات الأساسية</span>
              </TabsTrigger>
              <TabsTrigger value="contact" className="flex items-center gap-1">
                <Phone className="w-4 h-4" />
                <span className="hidden sm:inline">الاتصال</span>
              </TabsTrigger>
              <TabsTrigger value="official" className="flex items-center gap-1">
                <FileText className="w-4 h-4" />
                <span className="hidden sm:inline">البيانات الرسمية</span>
              </TabsTrigger>
              <TabsTrigger value="financial" className="flex items-center gap-1">
                <CreditCard className="w-4 h-4" />
                <span className="hidden sm:inline">المالية</span>
              </TabsTrigger>
              <TabsTrigger value="settings" className="flex items-center gap-1">
                <Settings className="w-4 h-4" />
                <span className="hidden sm:inline">الإعدادات</span>
              </TabsTrigger>
            </TabsList>

            {/* Basic Info Tab */}
            <TabsContent value="basic">
              <Card>
                <CardContent className="p-4 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>اسم المورد *</Label>
                      <Input
                        value={formData.supplier_name}
                        onChange={(e) => handleChange('supplier_name', e.target.value)}
                        placeholder="أدخل اسم المورد"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>فئة المورد</Label>
                      <Select 
                        value={formData.supplier_type} 
                        onValueChange={(v) => handleChange('supplier_type', v)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(supplierTypeLabels).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>نوع المورد</Label>
                      <Select 
                        value={formData.business_type} 
                        onValueChange={(v) => handleChange('business_type', v)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(businessTypeLabels).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>النشاط التجاري</Label>
                      <Input
                        value={formData.business_activity}
                        onChange={(e) => handleChange('business_activity', e.target.value)}
                        placeholder="مثال: مجوهرات، أحجار كريمة..."
                      />
                    </div>
                  </div>

                  <div className="border-t pt-4 mt-4">
                    <h4 className="font-medium mb-3">العنوان</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label>الدولة</Label>
                        <Input
                          value={formData.country}
                          onChange={(e) => handleChange('country', e.target.value)}
                          placeholder="الدولة"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>المدينة</Label>
                        <Input
                          value={formData.city}
                          onChange={(e) => handleChange('city', e.target.value)}
                          placeholder="المدينة"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>العنوان</Label>
                        <Input
                          value={formData.address}
                          onChange={(e) => handleChange('address', e.target.value)}
                          placeholder="العنوان"
                        />
                      </div>
                    </div>

                    <div className="mt-4 space-y-2">
                      <Label>العنوان التفصيلي</Label>
                      <Textarea
                        value={formData.detailed_address}
                        onChange={(e) => handleChange('detailed_address', e.target.value)}
                        placeholder="العنوان التفصيلي..."
                        rows={2}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Contact Tab */}
            <TabsContent value="contact">
              <Card>
                <CardContent className="p-4 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>الهاتف المحمول</Label>
                      <Input
                        value={formData.mobile_phone}
                        onChange={(e) => handleChange('mobile_phone', e.target.value)}
                        placeholder="+966 5XX XXX XXXX"
                        dir="ltr"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>هاتف المكتب</Label>
                      <Input
                        value={formData.office_phone}
                        onChange={(e) => handleChange('office_phone', e.target.value)}
                        placeholder="+966 XX XXX XXXX"
                        dir="ltr"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>البريد الإلكتروني</Label>
                      <Input
                        type="email"
                        value={formData.email}
                        onChange={(e) => handleChange('email', e.target.value)}
                        placeholder="email@example.com"
                        dir="ltr"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>الموقع الإلكتروني</Label>
                      <Input
                        value={formData.website}
                        onChange={(e) => handleChange('website', e.target.value)}
                        placeholder="https://www.example.com"
                        dir="ltr"
                      />
                    </div>
                  </div>

                  <div className="border-t pt-4 mt-4">
                    <h4 className="font-medium mb-3">شخص الاتصال</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>اسم جهة الاتصال</Label>
                        <Input
                          value={formData.contact_person}
                          onChange={(e) => handleChange('contact_person', e.target.value)}
                          placeholder="اسم الشخص المسؤول"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>المسمى الوظيفي</Label>
                        <Input
                          value={formData.contact_position}
                          onChange={(e) => handleChange('contact_position', e.target.value)}
                          placeholder="مثال: مدير المبيعات"
                        />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Official Data Tab */}
            <TabsContent value="official">
              <Card>
                <CardContent className="p-4 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>الرقم الضريبي (VAT)</Label>
                      <Input
                        value={formData.vat_number}
                        onChange={(e) => handleChange('vat_number', e.target.value)}
                        placeholder="3XXXXXXXXXX00003"
                        dir="ltr"
                        maxLength={15}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>رقم السجل التجاري</Label>
                      <Input
                        value={formData.commercial_register}
                        onChange={(e) => handleChange('commercial_register', e.target.value)}
                        placeholder="رقم السجل التجاري"
                        dir="ltr"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>رقم الهوية (للأفراد)</Label>
                      <Input
                        value={formData.national_id}
                        onChange={(e) => handleChange('national_id', e.target.value)}
                        placeholder="رقم الهوية"
                        dir="ltr"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>تاريخ انتهاء الترخيص</Label>
                      <Input
                        type="date"
                        value={formData.license_expiry_date}
                        onChange={(e) => handleChange('license_expiry_date', e.target.value)}
                        dir="ltr"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Financial Tab */}
            <TabsContent value="financial">
              <Card>
                <CardContent className="p-4 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>العملة الافتراضية</Label>
                      <Select 
                        value={formData.default_currency} 
                        onValueChange={(v) => handleChange('default_currency', v)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="SAR">ريال سعودي (SAR)</SelectItem>
                          <SelectItem value="USD">دولار أمريكي (USD)</SelectItem>
                          <SelectItem value="EUR">يورو (EUR)</SelectItem>
                          <SelectItem value="AED">درهم إماراتي (AED)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>شروط الدفع</Label>
                      <Select 
                        value={formData.payment_terms} 
                        onValueChange={(v) => handleChange('payment_terms', v)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(paymentTermsLabels).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>الحد الائتماني</Label>
                      <Input
                        type="number"
                        value={formData.credit_limit}
                        onChange={(e) => handleChange('credit_limit', parseFloat(e.target.value) || 0)}
                        placeholder="0.00"
                        dir="ltr"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>الرصيد الافتتاحي</Label>
                      <Input
                        type="number"
                        value={formData.opening_balance}
                        onChange={(e) => handleChange('opening_balance', parseFloat(e.target.value) || 0)}
                        placeholder="0.00"
                        dir="ltr"
                        disabled={isEditing}
                      />
                      {isEditing && (
                        <p className="text-xs text-muted-foreground">لا يمكن تعديل الرصيد الافتتاحي</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>طريقة الدفع الافتراضية</Label>
                      <Select 
                        value={formData.default_payment_method} 
                        onValueChange={(v) => handleChange('default_payment_method', v)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(paymentMethodLabels).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Settings Tab */}
            <TabsContent value="settings">
              <Card>
                <CardContent className="p-4 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>حالة الحساب</Label>
                      <Select 
                        value={formData.status} 
                        onValueChange={(v) => handleChange('status', v)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(statusLabels).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>ملاحظات داخلية</Label>
                    <Textarea
                      value={formData.internal_notes}
                      onChange={(e) => handleChange('internal_notes', e.target.value)}
                      placeholder="ملاحظات داخلية للمورد..."
                      rows={3}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>التصنيفات (Tags)</Label>
                    <div className="flex gap-2">
                      <Input
                        value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                        placeholder="أضف تصنيف..."
                        onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
                      />
                      <Button type="button" variant="outline" onClick={handleAddTag}>
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>
                    {formData.tags.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {formData.tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="gap-1">
                            {tag}
                            <button 
                              type="button" 
                              onClick={() => handleRemoveTag(tag)}
                              className="hover:text-destructive"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </ScrollArea>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            إلغاء
          </Button>
          <Button onClick={handleSubmit} disabled={!formData.supplier_name.trim() || isLoading}>
            {isLoading && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
            {isEditing ? 'حفظ التعديلات' : 'إضافة المورد'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
