// أنواع الموديولات
export interface RouteConfig {
  path: string;
  component: string;
  permission?: string;
  children?: RouteConfig[];
}

export interface MenuItem {
  href: string;
  label: string;
  icon: string;
  children?: MenuItem[];
}

export interface ModuleConfig {
  id: string;
  name: { ar: string; en: string };
  description?: { ar: string; en: string };
  icon: string;
  enabled: boolean;
  version: string;
  displayOrder: number;
  
  // Dependencies على موديولات أخرى
  dependencies: string[];
  
  // Routes الخاصة بالموديول
  routes: RouteConfig[];
  
  // الصلاحيات الخاصة بالموديول
  permissions: string[];
  
  // عناصر القائمة الجانبية
  menuItems: MenuItem[];
  
  // Menu section styling
  menuStyle?: {
    bgColor: string;
    iconColor: string;
    borderColor: string;
  };
}

export interface ModuleSettings {
  id: string;
  module_id: string;
  is_enabled: boolean;
  settings: unknown;
  display_order: number;
  created_at: string;
  updated_at: string;
}
