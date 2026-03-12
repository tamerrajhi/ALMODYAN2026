-- Add screen for daily settlements
INSERT INTO public.screens (screen_key, screen_name, screen_name_en, screen_path, parent_key, sort_order)
VALUES ('daily_settlements', 'مطابقة نهاية اليوم', 'Daily Settlements', '/vaults/settlements', 'vaults', 30)
ON CONFLICT (screen_key) DO NOTHING;

-- Add permissions for relevant roles
DO $$
DECLARE
  r RECORD;
  scr RECORD;
BEGIN
  SELECT id INTO scr FROM public.screens WHERE screen_key = 'daily_settlements';
  
  IF scr.id IS NOT NULL THEN
    FOR r IN SELECT id FROM public.custom_roles WHERE role_name IN ('مدير الخزينة', 'المدير العام', 'نائب المدير العام', 'مدير النظام', 'مدير الفرع')
    LOOP
      INSERT INTO public.role_permissions (role_id, screen_id, can_view, can_create, can_edit, can_delete)
      VALUES (r.id, scr.id, true, true, true, true)
      ON CONFLICT (role_id, screen_id) DO UPDATE SET can_view = true, can_create = true, can_edit = true, can_delete = true;
    END LOOP;
    
    FOR r IN SELECT id FROM public.custom_roles WHERE role_name IN ('كاشير', 'موظف مبيعات')
    LOOP
      INSERT INTO public.role_permissions (role_id, screen_id, can_view, can_create, can_edit, can_delete)
      VALUES (r.id, scr.id, true, true, false, false)
      ON CONFLICT (role_id, screen_id) DO UPDATE SET can_view = true, can_create = true;
    END LOOP;
  END IF;
END $$;