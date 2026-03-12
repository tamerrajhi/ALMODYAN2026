import { ModuleConfig } from '@/core/types/module.types';

export const hrModuleConfig: ModuleConfig = {
  id: 'hr',
  name: { ar: 'الموارد البشرية', en: 'Human Resources' },
  description: { ar: 'إدارة الموظفين والرواتب', en: 'Employees and Payroll Management' },
  icon: 'Users',
  enabled: true,
  version: '1.0.0',
  displayOrder: 8,
  
  dependencies: [],
  
  routes: [
    { path: '/hr/employees', component: 'EmployeesPage', permission: 'employees' },
    { path: '/hr/payroll', component: 'PayrollPage', permission: 'payroll' },
    { path: '/hr/attendance', component: 'AttendancePage', permission: 'attendance' },
    { path: '/hr/leaves', component: 'LeavesPage', permission: 'leaves' },
  ],
  
  permissions: [
    'employees',
    'payroll',
    'attendance',
    'leaves',
  ],
  
  menuItems: [
    { href: '/hr/employees', label: 'menu.employees', icon: 'Users' },
    { href: '/hr/payroll', label: 'menu.payroll', icon: 'DollarSign' },
    { href: '/hr/attendance', label: 'menu.attendance', icon: 'Clock' },
    { href: '/hr/leaves', label: 'menu.leaves', icon: 'CalendarOff' },
  ],

  menuStyle: {
    bgColor: 'bg-cyan-50',
    iconColor: 'text-cyan-600',
    borderColor: 'border-cyan-200',
  },
};

export default hrModuleConfig;
