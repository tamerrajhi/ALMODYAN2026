import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { quickCreateSupplier } from '@/domain/purchasing/purchasingWriteService';

interface QuickSupplierDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSupplierCreated: (supplierId: string) => void;
}

export const QuickSupplierDialog = ({ open, onOpenChange, onSupplierCreated }: QuickSupplierDialogProps) => {
  const { t } = useLanguage();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    supplier_name: '',
    supplier_type: 'company',
    mobile_phone: '',
    email: '',
    vat_number: '',
    country: 'السعودية',
    city: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.supplier_name.trim()) {
      toast.error(t.validation.required);
      return;
    }

    setIsLoading(true);
    try {
      const result = await quickCreateSupplier({
        supplierName: formData.supplier_name,
        supplierType: formData.supplier_type,
        mobilePhone: formData.mobile_phone || null,
        email: formData.email || null,
        vatNumber: formData.vat_number || null,
        country: formData.country || 'السعودية',
        city: formData.city || null,
      });

      if (!result.success) {
        toast.error(result.error || t.common.error);
        return;
      }

      toast.success(t.common.success);
      onSupplierCreated(result.supplierId!);
      setFormData({ 
        supplier_name: '', 
        supplier_type: 'company',
        mobile_phone: '', 
        email: '', 
        vat_number: '', 
        country: 'السعودية',
        city: '',
      });
      onOpenChange(false);
    } catch (error) {
      console.error('Error creating supplier:', error);
      toast.error(t.common.error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.purchaseInvoices.addSupplier}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>{t.suppliers.supplierName} *</Label>
            <Input
              value={formData.supplier_name}
              onChange={(e) => setFormData(prev => ({ ...prev, supplier_name: e.target.value }))}
              placeholder={t.suppliers.supplierName}
              required
            />
          </div>

          <div className="space-y-2">
            <Label>{t.suppliers.supplierType || 'فئة المورد'}</Label>
            <Select 
              value={formData.supplier_type} 
              onValueChange={(v) => setFormData(prev => ({ ...prev, supplier_type: v }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="company">شركة</SelectItem>
                <SelectItem value="individual">فرد</SelectItem>
                <SelectItem value="government">جهة حكومية</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t.suppliers.country || 'الدولة'}</Label>
              <Input
                value={formData.country}
                onChange={(e) => setFormData(prev => ({ ...prev, country: e.target.value }))}
                placeholder="الدولة"
              />
            </div>
            <div className="space-y-2">
              <Label>{t.suppliers.city || 'المدينة'}</Label>
              <Input
                value={formData.city}
                onChange={(e) => setFormData(prev => ({ ...prev, city: e.target.value }))}
                placeholder="المدينة"
              />
            </div>
          </div>
          
          <div className="space-y-2">
            <Label>{t.common.phone}</Label>
            <Input
              value={formData.mobile_phone}
              onChange={(e) => setFormData(prev => ({ ...prev, mobile_phone: e.target.value }))}
              placeholder={t.common.phone}
              dir="ltr"
            />
          </div>
          
          <div className="space-y-2">
            <Label>{t.common.email}</Label>
            <Input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
              placeholder={t.common.email}
              dir="ltr"
            />
          </div>
          
          <div className="space-y-2">
            <Label>{t.purchaseInvoices.vatNumber}</Label>
            <Input
              value={formData.vat_number}
              onChange={(e) => setFormData(prev => ({ ...prev, vat_number: e.target.value }))}
              placeholder="3XXXXXXXXXX00003"
              dir="ltr"
              maxLength={15}
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t.common.save}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default QuickSupplierDialog;
