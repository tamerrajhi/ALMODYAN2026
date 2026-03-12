import { ModuleConfig } from '@/core/types/module.types';

export const settingsModuleConfig: ModuleConfig = {
  id: 'settings',
  name: { ar: 'الإعدادات', en: 'Settings' },
  description: { ar: 'إعدادات النظام والمستخدمين', en: 'System and Users Settings' },
  icon: 'Settings',
  enabled: true,
  version: '1.0.0',
  displayOrder: 10,
  
  dependencies: [],
  
  routes: [
    { path: '/settings', component: 'SystemSettingsPage', permission: 'settings' },
    { path: '/settings/modules', component: 'ModuleManagementPage', permission: 'module_management' },
    { path: '/settings/departments', component: 'DepartmentsPage', permission: 'departments' },
    { path: '/settings/zatca', component: 'ZatcaSettingsPage', permission: 'zatca_settings' },
    { path: '/users', component: 'UsersPage', permission: 'users' },
    { path: '/roles', component: 'RolesPage', permission: 'roles' },
    { path: '/audit-logs', component: 'AuditLogsPage', permission: 'audit_logs' },
    { path: '/backup', component: 'BackupPage', permission: 'backup' },
  ],
  
  permissions: [
    'settings',
    'module_management',
    'departments',
    'zatca_settings',
    'users',
    'roles',
    'audit_logs',
    'backup',
  ],
  
  menuItems: [
    { href: '/settings', label: 'menu.settings', icon: 'Settings' },
    { href: '/settings/modules', label: 'menu.moduleManagement', icon: 'Boxes' },
    { href: '/settings/departments', label: 'menu.departments', icon: 'Building2' },
    { href: '/settings/zatca', label: 'menu.zatcaSettings', icon: 'FileCheck' },
    { href: '/users', label: 'menu.systemUsers', icon: 'UserCog' },
    { href: '/roles', label: 'menu.roles', icon: 'Shield' },
    { href: '/audit-logs', label: 'menu.auditLogs', icon: 'FileSearch' },
    { href: '/backup', label: 'menu.backup', icon: 'HardDrive' },
  ],

  menuStyle: {
    bgColor: 'bg-slate-50',
    iconColor: 'text-slate-600',
    borderColor: 'border-slate-200',
  },
};

export default settingsModuleConfig;
