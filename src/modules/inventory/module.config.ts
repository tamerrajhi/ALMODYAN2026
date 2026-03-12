import { ModuleConfig } from '@/core/types/module.types';

export const inventoryModuleConfig: ModuleConfig = {
  id: 'inventory',
  name: { ar: 'المخزون', en: 'Inventory' },
  description: { ar: 'إدارة المخزون والتحويلات', en: 'Inventory and Transfers Management' },
  icon: 'Boxes',
  enabled: true,
  version: '1.0.0',
  displayOrder: 4,
  
  dependencies: [],
  
  routes: [
    { path: '/inventory/raw-materials', component: 'RawMaterialsPage', permission: 'raw_materials' },
    { path: '/inventory/item-movements', component: 'ItemMovementsPage', permission: 'item_history' },
    { path: '/transfers', component: 'TransfersCenterPage', permission: 'transfers' },
    { path: '/transfer-requests', component: 'TransferRequestsPage', permission: 'transfer_requests' },
    { path: '/inventory/counts', component: 'InventoryCountsPage', permission: 'inventory_counts' },
    { path: '/inventory/counts/:id', component: 'InventoryCountDetailPage', permission: 'inventory_counts' },
    { path: '/inventory/count-report', component: 'InventoryCountReportPage', permission: 'inventory_counts' },
    { path: '/branches', component: 'BranchesPage', permission: 'branches' },
  ],
  
  permissions: [
    'raw_materials',
    'item_history',
    'transfers',
    'transfer_requests',
    'inventory_counts',
    'branches',
  ],
  
  menuItems: [
    { href: '/inventory/raw-materials', label: 'menu.rawMaterials', icon: 'Gem' },
    { href: '/inventory/item-movements', label: 'menu.itemMovements', icon: 'History' },
    { href: '/transfers', label: 'menu.transfers', icon: 'ArrowLeftRight' },
    { href: '/transfer-requests', label: 'menu.transferRequests', icon: 'GitPullRequest' },
    { href: '/inventory/counts', label: 'menu.inventoryCounts', icon: 'ClipboardCheck' },
    { href: '/branches', label: 'menu.branches', icon: 'Building' },
  ],

  menuStyle: {
    bgColor: 'bg-purple-50',
    iconColor: 'text-purple-600',
    borderColor: 'border-purple-200',
  },
};

export default inventoryModuleConfig;
