-- إنشاء جدول إعدادات الموديولات
CREATE TABLE IF NOT EXISTS public.module_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id VARCHAR(50) UNIQUE NOT NULL,
  is_enabled BOOLEAN DEFAULT true,
  settings JSONB DEFAULT '{}',
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- تعبئة بالموديولات الافتراضية (جميعها مفعّلة)
INSERT INTO public.module_settings (module_id, is_enabled, display_order) VALUES
  ('dashboard', true, 1),
  ('sales', true, 2),
  ('purchases', true, 3),
  ('inventory', true, 4),
  ('production', true, 5),
  ('accounting', true, 6),
  ('vaults', true, 7),
  ('hr', true, 8),
  ('reports', true, 9),
  ('settings', true, 10)
ON CONFLICT (module_id) DO NOTHING;

-- تفعيل RLS
ALTER TABLE public.module_settings ENABLE ROW LEVEL SECURITY;

-- سياسة للمسؤولين للتحكم الكامل
CREATE POLICY "Admins can manage module settings" 
ON public.module_settings 
FOR ALL 
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- سياسة للمستخدمين المصادق عليهم للقراءة فقط
CREATE POLICY "Authenticated users can view module settings" 
ON public.module_settings 
FOR SELECT 
USING (auth.role() = 'authenticated');

-- Trigger لتحديث updated_at
CREATE TRIGGER update_module_settings_updated_at
BEFORE UPDATE ON public.module_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();