import { ModuleConfig } from '@/core/types/module.types';

export const purchasesModuleConfig: ModuleConfig = {
  id: 'purchases',
  name: { ar: 'المشتريات', en: 'Purchases' },
  description: { ar: 'إدارة المشتريات والموردين', en: 'Purchases and Suppliers Management' },
  icon: 'ShoppingBag',
  enabled: true,
  version: '1.0.0',
  displayOrder: 3,
  
  dependencies: ['inventory', 'accounting'],
  
  routes: [
    { path: '/batches', component: 'BatchesPage', permission: 'batches' },
    { path: '/batches/:id', component: 'BatchDetailPage', permission: 'batches' },
    { path: '/purchasing/orders', component: 'PurchaseOrdersPage', permission: 'purchase_orders' },
    { path: '/purchasing/orders/:id', component: 'PurchaseOrderDetailPage', permission: 'purchase_orders' },
    { path: '/purchasing/receive/:id', component: 'ReceivePurchaseOrderPage', permission: 'purchase_orders' },
    { path: '/purchasing/requisitions', component: 'PurchaseRequisitionsPage', permission: 'purchase_requisitions' },
    { path: '/purchasing/requisitions/thresholds', component: 'PRApprovalThresholdsPage', permission: 'purchase_requisitions' },
    { path: '/purchasing/invoices', component: 'PurchaseInvoicesPage', permission: 'purchase_invoices' },
    { path: '/purchasing/invoices/new', component: 'PurchaseInvoiceFormPage', permission: 'purchase_invoices' },
    { path: '/purchasing/invoices/:id/view', component: 'PurchaseInvoiceViewPage', permission: 'purchase_invoices' },
    { path: '/purchasing/invoices/:id', component: 'PurchaseInvoiceFormPage', permission: 'purchase_invoices' },
    { path: '/purchasing/payment-vouchers', component: 'PaymentVouchersPage', permission: 'payment_vouchers' },
    { path: '/purchasing/import-payments', component: 'ImportPaymentsPage', permission: 'payment_vouchers' },
    { path: '/purchasing/returns', component: 'PurchaseReturnsListPage', permission: 'purchase_returns' },
    { path: '/suppliers', component: 'SuppliersPage', permission: 'suppliers' },
    { path: '/import', component: 'ImportPage', permission: 'import' },
    { path: '/imported-pieces', component: 'ImportedPiecesPage', permission: 'imported_pieces' },
  ],
  
  permissions: [
    'batches',
    'purchase_orders',
    'purchase_requisitions',
    'purchase_invoices',
    'payment_vouchers',
    'purchase_returns',
    'suppliers',
    'import',
    'imported_pieces',
  ],
  
  menuItems: [
    { href: '/purchasing/invoices', label: 'menu.purchaseInvoices', icon: 'Receipt' },
    { href: '/purchasing/payment-vouchers', label: 'menu.paymentVouchers', icon: 'ArrowUpCircle' },
    { href: '/purchasing/returns-hub', label: 'menu.purchaseReturns', icon: 'RotateCcw' },
    { href: '/imported-pieces', label: 'menu.importedPieces', icon: 'Gem' },
    { href: '/batches', label: 'menu.batches', icon: 'Package' },
    { href: '/purchasing/orders', label: 'menu.purchaseOrders', icon: 'FileText' },
    { href: '/purchasing/requisitions', label: 'menu.requisitions', icon: 'FileInput' },
    { href: '/suppliers', label: 'menu.suppliers', icon: 'Building2' },
    { href: '/import', label: 'menu.import', icon: 'Upload' },
    { href: '/purchasing/monitoring', label: 'menu.purchasingMonitoring', icon: 'Activity' },
    { href: '/purchasing/health-check', label: 'menu.purchasingHealthCheck', icon: 'HeartPulse' },
  ],

  menuStyle: {
    bgColor: 'bg-amber-50',
    iconColor: 'text-amber-600',
    borderColor: 'border-amber-200',
  },
};

export default purchasesModuleConfig;
