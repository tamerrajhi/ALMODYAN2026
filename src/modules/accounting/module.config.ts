import { ModuleConfig } from '@/core/types/module.types';

export const accountingModuleConfig: ModuleConfig = {
  id: 'accounting',
  name: { ar: 'المحاسبة', en: 'Accounting' },
  description: { ar: 'إدارة الحسابات والقيود المحاسبية', en: 'Accounts and Journal Entries Management' },
  icon: 'Calculator',
  enabled: true,
  version: '1.0.0',
  displayOrder: 4,
  
  dependencies: [],
  
  routes: [
    { path: '/accounting', component: 'AccountingDashboard', permission: 'accounting_dashboard' },
    { path: '/accounting/chart-of-accounts', component: 'ChartOfAccountsPage', permission: 'chart_of_accounts' },
    { path: '/accounting/journal-entries', component: 'JournalEntriesPage', permission: 'journal_entries' },
    { path: '/accounting/invoices', component: 'InvoicesPage', permission: 'invoices' },
    { path: '/accounting/payments', component: 'PaymentsPage', permission: 'payments' },
    { path: '/accounting/ledger/:accountId', component: 'AccountLedgerPage', permission: 'account_ledger' },
    { path: '/accounting/reports', component: 'FinancialReportsPage', permission: 'financial_reports' },
    { path: '/accounting/monitoring', component: 'AccountingMonitoringPage', permission: 'accounting_monitoring' },
    { path: '/accounting/health-check', component: 'AccountingHealthCheckPage', permission: 'accounting_health_check' },
  ],
  
  permissions: [
    'accounting_dashboard',
    'chart_of_accounts',
    'journal_entries',
    'invoices',
    'payments',
    'account_ledger',
    'financial_reports',
    'accounting_monitoring',
    'accounting_health_check',
  ],
  
  menuItems: [
    { href: '/accounting', label: 'menu.accountingDashboard', icon: 'LayoutDashboard' },
    { href: '/accounting/chart-of-accounts', label: 'menu.chartOfAccounts', icon: 'List' },
    { href: '/accounting/journal-entries', label: 'menu.journalEntries', icon: 'BookOpen' },
    { href: '/accounting/invoices', label: 'menu.invoices', icon: 'FileText' },
    { href: '/accounting/payments', label: 'menu.payments', icon: 'CreditCard' },
    { href: '/accounting/reports', label: 'menu.financialReports', icon: 'PieChart' },
    { href: '/accounting/monitoring', label: 'menu.accountingMonitoring', icon: 'Activity' },
    { href: '/accounting/health-check', label: 'menu.accountingHealthCheck', icon: 'HeartPulse' },
  ],

  menuStyle: {
    bgColor: 'bg-emerald-50',
    iconColor: 'text-emerald-600',
    borderColor: 'border-emerald-200',
  },
};

export default accountingModuleConfig;
