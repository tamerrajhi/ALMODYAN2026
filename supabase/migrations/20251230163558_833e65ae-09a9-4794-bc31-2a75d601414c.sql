-- إضافة شاشة POS Return للصلاحيات
INSERT INTO public.screens (screen_key, screen_name, screen_name_en, screen_path, icon, sort_order)
VALUES ('pos_return', 'مرتجع مبيعات POS', 'POS Return', '/pos/return', 'RotateCcw', 26)
ON CONFLICT (screen_key) DO NOTHING;