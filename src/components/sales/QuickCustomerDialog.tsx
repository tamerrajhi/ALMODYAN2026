import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as dataGateway from '@/lib/dataGateway';
import { useLanguage } from '@/contexts/LanguageContext';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';
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
import { User, Building2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface QuickCustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCustomerCreated?: (customerId: string) => void;
}

type CustomerType = 'individual' | 'company';

interface FormData {
  full_name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  vat_number: string;
  customer_type: CustomerType;
  company_name: string;
}

const initialFormData: FormData = {
  full_name: '',
  phone: '',
  email: '',
  address: '',
  notes: '',
  vat_number: '',
  customer_type: 'individual',
  company_name: '',
};

export default function QuickCustomerDialog({
  open,
  onOpenChange,
  onCustomerCreated,
}: QuickCustomerDialogProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.full_name.trim()) {
      newErrors.full_name = 'الاسم الكامل مطلوب';
    }

    if (!formData.phone.trim()) {
      newErrors.phone = 'رقم الهاتف مطلوب';
    }

    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'البريد الإلكتروني غير صالح';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const { data: codeData } = await dataGateway.rpc('generate_customer_code', {});
      
      forbidDirectWrite('insert', 'QuickCustomerDialog.tsx:createMutation');
    },
    onSuccess: (newCustomer) => {
      toast.success('تم إضافة العميل بنجاح');
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customers-combobox'] });
      
      // Auto-select the new customer
      if (onCustomerCreated && newCustomer) {
        onCustomerCreated(newCustomer.id);
      }
      
      // Reset and close
      setFormData(initialFormData);
      setErrors({});
      onOpenChange(false);
    },
    onError: (error: any) => {
      console.error('Error creating customer:', error);
      toast.error(error.message || 'فشل في إضافة العميل');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateForm()) {
      createMutation.mutate(formData);
    }
  };

  const handleClose = () => {
    if (!createMutation.isPending) {
      setFormData(initialFormData);
      setErrors({});
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]" dir="rtl">
        <DialogHeader>
          <DialogTitle>{t.customers?.addCustomer || 'إضافة عميل جديد'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Customer Type Toggle */}
          <div className="space-y-2">
            <Label>نوع العميل *</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={formData.customer_type === 'individual' ? 'default' : 'outline'}
                className="flex-1 gap-2"
                onClick={() => setFormData({ ...formData, customer_type: 'individual' })}
              >
                <User className="h-4 w-4" />
                فرد
              </Button>
              <Button
                type="button"
                variant={formData.customer_type === 'company' ? 'default' : 'outline'}
                className="flex-1 gap-2"
                onClick={() => setFormData({ ...formData, customer_type: 'company' })}
              >
                <Building2 className="h-4 w-4" />
                شركة
              </Button>
            </div>
          </div>

          {/* Full Name */}
          <div className="space-y-2">
            <Label htmlFor="full_name">{t.customers?.fullName || 'الاسم الكامل'} *</Label>
            <Input
              id="full_name"
              value={formData.full_name}
              onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
              className={errors.full_name ? 'border-destructive' : ''}
              placeholder="أدخل اسم العميل"
            />
            {errors.full_name && (
              <p className="text-xs text-destructive">{errors.full_name}</p>
            )}
          </div>

          {/* Phone & Email Row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="phone">{t.common?.phone || 'رقم الهاتف'} *</Label>
              <Input
                id="phone"
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className={errors.phone ? 'border-destructive' : ''}
                placeholder="05XXXXXXXX"
                dir="ltr"
              />
              {errors.phone && (
                <p className="text-xs text-destructive">{errors.phone}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">{t.common?.email || 'البريد الإلكتروني'}</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className={errors.email ? 'border-destructive' : ''}
                placeholder="email@example.com"
                dir="ltr"
              />
              {errors.email && (
                <p className="text-xs text-destructive">{errors.email}</p>
              )}
            </div>
          </div>

          {/* Company Name (only for company type) */}
          {formData.customer_type === 'company' && (
            <div className="space-y-2">
              <Label htmlFor="company_name">{t.customers?.companyName || 'اسم الشركة'}</Label>
              <Input
                id="company_name"
                value={formData.company_name}
                onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                placeholder="أدخل اسم الشركة"
              />
            </div>
          )}

          {/* VAT Number (for companies) */}
          {formData.customer_type === 'company' && (
            <div className="space-y-2">
              <Label htmlFor="vat_number">{t.customers?.vatNumber || 'الرقم الضريبي'}</Label>
              <Input
                id="vat_number"
                value={formData.vat_number}
                onChange={(e) => setFormData({ ...formData, vat_number: e.target.value })}
                placeholder="3XXXXXXXXXX0003"
                dir="ltr"
              />
            </div>
          )}

          {/* Address */}
          <div className="space-y-2">
            <Label htmlFor="address">{t.common?.address || 'العنوان'}</Label>
            <Input
              id="address"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              placeholder="أدخل العنوان"
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">{t.common?.notes || 'ملاحظات'}</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="ملاحظات إضافية..."
              rows={2}
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={createMutation.isPending}
            >
              {t.common?.cancel || 'إلغاء'}
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin ml-2" />
                  جاري الحفظ...
                </>
              ) : (
                t.common?.save || 'حفظ'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
