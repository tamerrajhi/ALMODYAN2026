import { ModuleConfig } from '@/core/types/module.types';

export const productsModuleConfig: ModuleConfig = {
  id: 'products',
  name: { ar: 'المنتجات والتكاليف', en: 'Products & Costs' },
  description: { ar: 'إدارة المنتجات والتكاليف والمصروفات', en: 'Manage products, costs and expenses' },
  icon: 'Package',
  enabled: true,
  version: '1.0.0',
  displayOrder: 3,
  
  dependencies: [],
  
  routes: [
    { path: '/products', component: 'ProductsPage', permission: 'products' },
    { path: '/products/jewelry', component: 'ProductsPage', permission: 'products' },
    { path: '/products/services', component: 'ProductsPage', permission: 'products' },
    { path: '/products/general', component: 'ProductsPage', permission: 'products' },
  ],
  
  permissions: [
    'products',
    'products_create',
    'products_edit',
    'products_delete',
  ],
  
  menuItems: [
    { href: '/products', label: 'menu.productsAndCosts', icon: 'Package' },
  ],

  menuStyle: {
    bgColor: 'bg-indigo-50',
    iconColor: 'text-indigo-600',
    borderColor: 'border-indigo-200',
  },
};

export default productsModuleConfig;
