import { ModuleConfig } from '@/core/types/module.types';

export const reportsModuleConfig: ModuleConfig = {
  id: 'reports',
  name: { ar: 'التقارير', en: 'Reports' },
  description: { ar: 'التقارير والإحصائيات', en: 'Reports and Statistics' },
  icon: 'BarChart3',
  enabled: true,
  version: '1.0.0',
  displayOrder: 9,
  
  dependencies: [],
  
  routes: [
    { path: '/reports', component: 'ReportsPage', permission: 'reports' },
  ],
  
  permissions: [
    'reports',
  ],
  
  menuItems: [
    { href: '/reports', label: 'menu.reports', icon: 'BarChart3' },
  ],

  menuStyle: {
    bgColor: 'bg-indigo-50',
    iconColor: 'text-indigo-600',
    borderColor: 'border-indigo-200',
  },
};

export default reportsModuleConfig;
