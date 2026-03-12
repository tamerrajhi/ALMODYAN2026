import { ModuleConfig } from '@/core/types/module.types';

export const vaultsModuleConfig: ModuleConfig = {
  id: 'vaults',
  name: { ar: 'الخزائن', en: 'Vaults' },
  description: { ar: 'إدارة خزائن النقد والذهب', en: 'Cash and Gold Vaults Management' },
  icon: 'Vault',
  enabled: true,
  version: '1.0.0',
  displayOrder: 7,
  
  dependencies: ['accounting'],
  
  routes: [
    { path: '/cash-vault', component: 'CashVaultPage', permission: 'cash_vault' },
    { path: '/gold/vault', component: 'GoldVaultPage', permission: 'gold_vault' },
    { path: '/gold/prices', component: 'GoldPricesPage', permission: 'gold_prices' },
    { path: '/gold/karats', component: 'GoldKaratsPage', permission: 'gold_karats' },
    { path: '/gold/scrap', component: 'GoldScrapPage', permission: 'gold_scrap' },
    { path: '/gemstones', component: 'GemstonesPage', permission: 'gemstones' },
    { path: '/gemstones/link/:id', component: 'LinkGemstoneToProduct', permission: 'gemstones' },
    { path: '/daily-settlements', component: 'DailySettlementsPage', permission: 'daily_settlements' },
  ],
  
  permissions: [
    'cash_vault',
    'gold_vault',
    'gold_prices',
    'gold_karats',
    'gold_scrap',
    'gemstones',
    'daily_settlements',
  ],
  
  menuItems: [
    { href: '/cash-vault', label: 'menu.cashVault', icon: 'Wallet' },
    { href: '/gold/vault', label: 'menu.goldVault', icon: 'Gem' },
    { href: '/gold/prices', label: 'menu.goldPrices', icon: 'TrendingUp' },
    { href: '/gold/karats', label: 'menu.goldKarats', icon: 'Scale' },
    { href: '/gold/scrap', label: 'menu.goldScrap', icon: 'Recycle' },
    { href: '/gemstones', label: 'menu.gemstones', icon: 'Diamond' },
    { href: '/daily-settlements', label: 'menu.dailySettlements', icon: 'CalendarCheck' },
  ],

  menuStyle: {
    bgColor: 'bg-yellow-50',
    iconColor: 'text-yellow-600',
    borderColor: 'border-yellow-200',
  },
};

export default vaultsModuleConfig;
