import { ModuleConfig } from '@/core/types/module.types';

export const productionModuleConfig: ModuleConfig = {
  id: 'production',
  name: { ar: 'الإنتاج', en: 'Production' },
  description: { ar: 'إدارة الإنتاج وأوامر التشغيل', en: 'Production and Work Orders Management' },
  icon: 'Factory',
  enabled: true,
  version: '1.0.0',
  displayOrder: 5,
  
  dependencies: ['inventory'],
  
  routes: [
    { path: '/production/wip', component: 'WIPPage', permission: 'wip' },
    { path: '/production/finished-goods-factory', component: 'FinishedGoodsFactoryPage', permission: 'finished_goods_factory' },
    { path: '/production/finished-goods-showroom', component: 'FinishedGoodsShowroomPage', permission: 'finished_goods_showroom' },
    { path: '/production/work-orders/:id', component: 'WorkOrderDetailsPage', permission: 'work_orders' },
    { path: '/production/planning', component: 'ProductionPlanningPage', permission: 'production_planning' },
    { path: '/production/loss-report', component: 'ProductionLossReportPage', permission: 'production_loss_report' },
    { path: '/production/settings', component: 'ProductionSettingsPage', permission: 'production_settings' },
    { path: '/production/cost-centers', component: 'CostCentersPage', permission: 'cost_centers' },
  ],
  
  permissions: [
    'wip',
    'finished_goods_factory',
    'finished_goods_showroom',
    'work_orders',
    'production_planning',
    'production_loss_report',
    'production_settings',
    'cost_centers',
  ],
  
  menuItems: [
    { href: '/production/wip', label: 'menu.wip', icon: 'Cog' },
    { href: '/production/finished-goods-factory', label: 'menu.finishedGoodsFactory', icon: 'Factory' },
    { href: '/production/finished-goods-showroom', label: 'menu.finishedGoodsShowroom', icon: 'Store' },
    { href: '/production/planning', label: 'menu.productionPlanning', icon: 'CalendarClock' },
    { href: '/production/loss-report', label: 'menu.productionLoss', icon: 'TrendingDown' },
    { href: '/production/cost-centers', label: 'menu.costCenters', icon: 'Building2' },
    { href: '/production/settings', label: 'menu.productionSettings', icon: 'Settings' },
  ],

  menuStyle: {
    bgColor: 'bg-orange-50',
    iconColor: 'text-orange-600',
    borderColor: 'border-orange-200',
  },
};

export default productionModuleConfig;
