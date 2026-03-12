-- إضافة شاشات المنتجات إلى جدول screens
INSERT INTO public.screens (screen_key, screen_name, screen_name_en, screen_path, icon, sort_order)
VALUES
  ('products', 'جميع المنتجات', 'All Products', '/products', 'Package', 25),
  ('products_jewelry', 'منتجات المجوهرات', 'Jewelry Products', '/products/jewelry', 'Gem', 26),
  ('products_services', 'الخدمات', 'Services', '/products/services', 'Wrench', 27),
  ('products_general', 'المنتجات العامة', 'General Products', '/products/general', 'Box', 28)
ON CONFLICT (screen_key) DO UPDATE SET
  screen_name = EXCLUDED.screen_name,
  screen_name_en = EXCLUDED.screen_name_en,
  screen_path = EXCLUDED.screen_path,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order;