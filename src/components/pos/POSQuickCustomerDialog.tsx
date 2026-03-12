import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { User, Building2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Customer {
  id: string;
  customer_code: string;
  full_name: string;
  phone: string | null;
  loyalty_points: number;
  vat_number?: string | null;
  address?: string | null;
  customer_type?: 'individual' | 'company';
  company_name?: string | null;
}

interface POSQuickCustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefillPhone?: string;
  onCustomerCreated: (customer: Customer) => void;
}

type CustomerType = 'individual' | 'company';

interface FormData {
  full_name: string;
  phone: string;
  email: string;
  vat_number: string;
  customer_type: CustomerType;
  company_name: string;
}

export default function POSQuickCustomerDialog({
  open,
  onOpenChange,
  prefillPhone = '',
  onCustomerCreated,
}: POSQuickCustomerDialogProps) {
  const queryClient = useQueryClient();
  
  const [formData, setFormData] = useState<FormData>({
    full_name: '',
    phone: prefillPhone,
    email: '',
    vat_number: '',
    customer_type: 'individual',
    company_name: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Update phone when prefillPhone changes
  useEffect(() => {
    if (prefillPhone) {
      setFormData(prev => ({ ...prev, phone: prefillPhone }));
    }
  }, [prefillPhone]);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setFormData({
        full_name: '',
        phone: prefillPhone,
        email: '',
        vat_number: '',
        customer_type: 'individual',
        company_name: '',
      });
      setErrors({});
    }
  }, [open, prefillPhone]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.full_name.trim()) {
      newErrors.full_name = 'الاسم مطلوب';
    }

    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'البريد الإلكتروني غير صالح';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          full_name: data.full_name,
          phone: data.phone,
          email: data.email || null,
          vat_number: data.vat_number || null,
          customer_type: data.customer_type,
          company_name: data.company_name || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'فشل في إضافة العميل');
      }
      return await res.json();
    },
    onSuccess: (newCustomer) => {
      toast.success('تم إضافة العميل بنجاح');
      queryClient.invalidateQueries({ queryKey: ['pos-customers'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      
      // Return the new customer
      onCustomerCreated(newCustomer as Customer);
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
      onOpenChange(false);
    }
  };

  // Format phone for display
  const formatPhoneDisplay = (phone: string): string => {
    if (phone.startsWith('+966')) {
      return phone;
    }
    return phone;
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[450px]" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="w-5 h-5 text-primary" />
            إضافة عميل جديد
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Phone Display (Read-only) */}
          <div className="space-y-2">
            <Label>رقم الجوال</Label>
            <div className="flex items-center h-10 px-3 bg-muted border rounded-md text-sm font-mono" dir="ltr">
              {formatPhoneDisplay(formData.phone)}
            </div>
            <p className="text-xs text-muted-foreground">
              سيتم ربط العميل بهذا الرقم
            </p>
          </div>

          {/* Customer Type Toggle */}
          <div className="space-y-2">
            <Label>نوع العميل</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={formData.customer_type === 'individual' ? 'default' : 'outline'}
                className="flex-1 gap-2"
                onClick={() => setFormData({ ...formData, customer_type: 'individual', company_name: '', vat_number: '' })}
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
            <Label htmlFor="full_name">
              {formData.customer_type === 'company' ? 'اسم المسؤول' : 'الاسم الكامل'} *
            </Label>
            <Input
              id="full_name"
              value={formData.full_name}
              onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
              className={errors.full_name ? 'border-destructive' : ''}
              placeholder="أدخل الاسم"
              autoFocus
            />
            {errors.full_name && (
              <p className="text-xs text-destructive">{errors.full_name}</p>
            )}
          </div>

          {/* Company-specific fields */}
          {formData.customer_type === 'company' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="company_name">اسم الشركة</Label>
                <Input
                  id="company_name"
                  value={formData.company_name}
                  onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                  placeholder="أدخل اسم الشركة"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vat_number">الرقم الضريبي</Label>
                <Input
                  id="vat_number"
                  value={formData.vat_number}
                  onChange={(e) => setFormData({ ...formData, vat_number: e.target.value })}
                  placeholder="3XXXXXXXXXX0003"
                  dir="ltr"
                  className="font-mono"
                />
              </div>
            </>
          )}

          {/* Email (Optional) */}
          <div className="space-y-2">
            <Label htmlFor="email">البريد الإلكتروني (اختياري)</Label>
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

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={createMutation.isPending}
            >
              إلغاء
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin ml-2" />
                  جاري الحفظ...
                </>
              ) : (
                'حفظ وربط بالفاتورة'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
