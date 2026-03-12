import { ModuleConfig } from '@/core/types/module.types';

export const dashboardModuleConfig: ModuleConfig = {
  id: 'dashboard',
  name: { ar: 'لوحة التحكم', en: 'Dashboard' },
  description: { ar: 'لوحة التحكم الرئيسية', en: 'Main Dashboard' },
  icon: 'LayoutDashboard',
  enabled: true,
  version: '1.0.0',
  displayOrder: 1,
  
  dependencies: [],
  
  routes: [
    { path: '/', component: 'Index', permission: 'dashboard' },
    { path: '/dashboard', component: 'DashboardPage', permission: 'dashboard' },
    { path: '/dashboard-settings', component: 'DashboardSettingsPage', permission: 'dashboard_settings' },
  ],
  
  permissions: [
    'dashboard',
    'dashboard_settings',
  ],
  
  menuItems: [
    { href: '/dashboard', label: 'menu.dashboard', icon: 'LayoutDashboard' },
  ],

  menuStyle: {
    bgColor: 'bg-blue-50',
    iconColor: 'text-blue-600',
    borderColor: 'border-blue-200',
  },
};

export default dashboardModuleConfig;
