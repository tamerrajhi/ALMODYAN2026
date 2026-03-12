// تصدير جميع تعريفات الموديولات
import { dashboardModuleConfig } from '@/modules/dashboard/module.config';
import { salesModuleConfig } from '@/modules/sales/module.config';
import { purchasesModuleConfig } from '@/modules/purchases/module.config';
import { productsModuleConfig } from '@/modules/products/module.config';
import { inventoryModuleConfig } from '@/modules/inventory/module.config';
import { productionModuleConfig } from '@/modules/production/module.config';
import { accountingModuleConfig } from '@/modules/accounting/module.config';
import { vaultsModuleConfig } from '@/modules/vaults/module.config';
import { hrModuleConfig } from '@/modules/hr/module.config';
import { reportsModuleConfig } from '@/modules/reports/module.config';
import { settingsModuleConfig } from '@/modules/settings/module.config';
import { ModuleConfig } from '@/core/types/module.types';

// قائمة جميع الموديولات
export const allModuleConfigs: ModuleConfig[] = [
  dashboardModuleConfig,
  salesModuleConfig,
  purchasesModuleConfig,
  productsModuleConfig,
  inventoryModuleConfig,
  productionModuleConfig,
  accountingModuleConfig,
  vaultsModuleConfig,
  hrModuleConfig,
  reportsModuleConfig,
  settingsModuleConfig,
];

// تصدير كل موديول على حدة
export {
  dashboardModuleConfig,
  salesModuleConfig,
  purchasesModuleConfig,
  productsModuleConfig,
  inventoryModuleConfig,
  productionModuleConfig,
  accountingModuleConfig,
  vaultsModuleConfig,
  hrModuleConfig,
  reportsModuleConfig,
  settingsModuleConfig,
};

// دالة لتسجيل جميع الموديولات في الـ Registry
export function registerAllModules(registry: { registerAll: (modules: ModuleConfig[]) => void }) {
  registry.registerAll(allModuleConfigs);
}
