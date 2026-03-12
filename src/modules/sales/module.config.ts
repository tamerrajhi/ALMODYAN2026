import { ModuleConfig } from '@/core/types/module.types';

export const salesModuleConfig: ModuleConfig = {
  id: 'sales',
  name: { ar: 'المبيعات', en: 'Sales' },
  description: { ar: 'إدارة المبيعات والعملاء', en: 'Sales and Customers Management' },
  icon: 'ShoppingCart',
  enabled: true,
  version: '1.0.0',
  displayOrder: 2,
  
  dependencies: ['inventory', 'accounting'],
  
  routes: [
    { path: '/customers', component: 'CustomersPage', permission: 'customers' },
    { path: '/sales/invoices', component: 'SalesInvoicesPage', permission: 'sales_invoices' },
    { path: '/sales/invoices/new', component: 'CreateSalesInvoicePage', permission: 'sales_invoices' },
    { path: '/sales/invoices/:id', component: 'CreateSalesInvoicePage', permission: 'sales_invoices' },
    { path: '/sales/receipts', component: 'CustomerReceiptsPage', permission: 'customer_receipts' },
    { path: '/sales/credit-notes', component: 'CreditNotesPage', permission: 'credit_notes' },
    { path: '/sales/receipt-vouchers', component: 'ReceiptVouchersPage', permission: 'receipt_vouchers' },
    { path: '/sales/returns', component: 'SalesReturnsPage', permission: 'sales_returns' },
  ],
  
  permissions: [
    'pos',
    'sales_history',
    'returns',
    'customers',
    'sales_invoices',
    'customer_receipts',
    'credit_notes',
    'receipt_vouchers',
    'sales_returns',
    'pos_credit_note',
    'pos_return',
    'pos_return_view',
    'pos_return_create',
    'pos_return_approve',
    'pos_return_unlimited',
  ],
  
  menuItems: [
    { href: '/sales/invoices', label: 'menu.salesInvoices', icon: 'FileText' },
    { href: '/sales/credit-notes', label: 'menu.creditNotes', icon: 'FileX' },
    { href: '/sales/receipt-vouchers', label: 'menu.receiptVouchers', icon: 'ArrowDownCircle' },
    { href: '/sales/receipts', label: 'menu.customerReceipts', icon: 'Receipt' },
    { href: '/customers', label: 'menu.customers', icon: 'Users' },
  ],

  menuStyle: {
    bgColor: 'bg-green-50',
    iconColor: 'text-green-600',
    borderColor: 'border-green-200',
  },
};

export default salesModuleConfig;