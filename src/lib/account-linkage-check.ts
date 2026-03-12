import * as dataGateway from '@/lib/dataGateway';

export interface AccountLinkageResult {
  hasJournalEntries: boolean;
  journalEntriesCount: number;
  hasBalance: boolean;
  balance: number;
  hasChildren: boolean;
  childrenCount: number;
  isSystem: boolean;
  linkedEntities: {
    cashVaults: number;
    goldVaults: number;
    costEntries: number;
    jewelryItems: number;
    products: number;
    branchInventory: number;
    suppliers: number;
    paymentSettings: number;
    productionSettings: number;
    purchaseInvoiceLines: number;
    returns: number;
  };
  totalLinkages: number;
  canEdit: boolean;
  canDelete: boolean;
  protectionReasons: string[];
}

export async function checkAccountLinkages(
  accountId: string,
  accountStats?: { entryCounts: Record<string, number>; balances: Record<string, number> },
  allAccounts?: { id: string; parent_id: string | null; is_system: boolean }[]
): Promise<AccountLinkageResult> {
  const linkedEntities = {
    cashVaults: 0,
    goldVaults: 0,
    costEntries: 0,
    jewelryItems: 0,
    products: 0,
    branchInventory: 0,
    suppliers: 0,
    paymentSettings: 0,
    productionSettings: 0,
    purchaseInvoiceLines: 0,
    returns: 0,
  };

  const protectionReasons: string[] = [];

  let journalEntriesCount = 0;
  let balance = 0;
  let isSystem = false;
  let childrenCount = 0;

  if (accountStats && allAccounts) {
    journalEntriesCount = accountStats.entryCounts[accountId] || 0;
    balance = accountStats.balances[accountId] || 0;
    const account = allAccounts.find(a => a.id === accountId);
    isSystem = account?.is_system || false;
    childrenCount = allAccounts.filter(a => a.parent_id === accountId).length;
  } else {
    const [accountRes, statsRes] = await Promise.all([
      dataGateway.fetchChartOfAccountsById(accountId),
      dataGateway.fetchJournalEntryLinesCount(accountId),
    ]);

    isSystem = accountRes.data?.is_system || false;
    balance = accountRes.data?.current_balance || 0;
    journalEntriesCount = statsRes.count || 0;

    const childrenRes = await dataGateway.fetchChildAccountsCount(accountId);
    childrenCount = childrenRes.count || 0;
  }

  const [
    cashVaultsRes,
    goldVaultsRes,
    costEntriesRes,
    jewelryItemsRes,
    productsRes,
    branchInventoryRes,
    suppliersRes,
    paymentSettingsRes,
    productionSettingsRes,
    purchaseInvoiceLinesRes,
    returnsRes,
  ] = await Promise.all([
    dataGateway.fetchTableWithCount('cash_vaults', { filters: { account_id: accountId } }),
    dataGateway.fetchTableWithCount('gold_vaults', { filters: { account_id: accountId } }),
    dataGateway.fetchTableWithCount('cost_entries', { filters: { gl_account_id: accountId } }),
    dataGateway.fetchTableWithCount('unique_items', { filters: { inventory_account_id: accountId } }),
    dataGateway.fetchTableWithCount('products', { orFilters: `inventory_account_id.eq.${accountId},expense_account_id.eq.${accountId}` }),
    dataGateway.fetchTableWithCount('branch_inventory_accounts', { orFilters: `general_inventory_account_id.eq.${accountId},imported_pieces_account_id.eq.${accountId}` }),
    dataGateway.fetchTableWithCount('suppliers', { filters: { account_id: accountId } }),
    dataGateway.fetchTableWithCount('payment_account_settings', { orFilters: `cash_account_id.eq.${accountId},bank_transfer_account_id.eq.${accountId},check_account_id.eq.${accountId},credit_card_account_id.eq.${accountId}` }),
    dataGateway.fetchTableWithCount('production_account_settings', { orFilters: `wip_account_id.eq.${accountId},raw_materials_account_id.eq.${accountId},finished_goods_account_id.eq.${accountId},scrap_loss_account_id.eq.${accountId}` }),
    dataGateway.fetchTableWithCount('purchase_invoice_lines', { orFilters: `account_id.eq.${accountId},inventory_account_id.eq.${accountId},expense_account_id.eq.${accountId}` }),
    dataGateway.fetchTableWithCount('returns', { filters: { bank_account_id: accountId } }),
  ]);

  linkedEntities.cashVaults = cashVaultsRes.count || 0;
  linkedEntities.goldVaults = goldVaultsRes.count || 0;
  linkedEntities.costEntries = costEntriesRes.count || 0;
  linkedEntities.jewelryItems = jewelryItemsRes.count || 0;
  linkedEntities.products = productsRes.count || 0;
  linkedEntities.branchInventory = branchInventoryRes.count || 0;
  linkedEntities.suppliers = suppliersRes.count || 0;
  linkedEntities.paymentSettings = paymentSettingsRes.count || 0;
  linkedEntities.productionSettings = productionSettingsRes.count || 0;
  linkedEntities.purchaseInvoiceLines = purchaseInvoiceLinesRes.count || 0;
  linkedEntities.returns = returnsRes.count || 0;

  const totalLinkages = Object.values(linkedEntities).reduce((sum, count) => sum + count, 0);

  if (isSystem) {
    protectionReasons.push('حساب نظامي');
  }
  if (journalEntriesCount > 0) {
    protectionReasons.push(`${journalEntriesCount} قيد محاسبي`);
  }
  if (balance !== 0) {
    protectionReasons.push('رصيد غير صفري');
  }
  if (childrenCount > 0) {
    protectionReasons.push(`${childrenCount} حساب فرعي`);
  }
  if (linkedEntities.cashVaults > 0) {
    protectionReasons.push('مرتبط بخزينة نقدية');
  }
  if (linkedEntities.goldVaults > 0) {
    protectionReasons.push('مرتبط بخزينة ذهب');
  }
  if (linkedEntities.costEntries > 0) {
    protectionReasons.push('مرتبط ببنود تكلفة');
  }
  if (linkedEntities.jewelryItems > 0) {
    protectionReasons.push('مرتبط بأصناف مجوهرات');
  }
  if (linkedEntities.products > 0) {
    protectionReasons.push('مرتبط بمنتجات');
  }
  if (linkedEntities.branchInventory > 0) {
    protectionReasons.push('مرتبط بحسابات مخزون الفروع');
  }
  if (linkedEntities.suppliers > 0) {
    protectionReasons.push('مرتبط بموردين');
  }
  if (linkedEntities.paymentSettings > 0) {
    protectionReasons.push('مرتبط بإعدادات الدفع');
  }
  if (linkedEntities.productionSettings > 0) {
    protectionReasons.push('مرتبط بإعدادات الإنتاج');
  }
  if (linkedEntities.purchaseInvoiceLines > 0) {
    protectionReasons.push('مرتبط بفواتير مشتريات');
  }
  if (linkedEntities.returns > 0) {
    protectionReasons.push('مرتبط بمرتجعات');
  }

  const canEdit = !isSystem && journalEntriesCount === 0 && balance === 0 && totalLinkages === 0;
  const canDelete = canEdit && childrenCount === 0;

  return {
    hasJournalEntries: journalEntriesCount > 0,
    journalEntriesCount,
    hasBalance: balance !== 0,
    balance,
    hasChildren: childrenCount > 0,
    childrenCount,
    isSystem,
    linkedEntities,
    totalLinkages,
    canEdit,
    canDelete,
    protectionReasons,
  };
}

export async function checkAllAccountsLinkages(
  accountIds: string[],
  accountStats: { entryCounts: Record<string, number>; balances: Record<string, number> },
  allAccounts: { id: string; parent_id: string | null; is_system: boolean }[]
): Promise<Record<string, AccountLinkageResult>> {
  const results: Record<string, AccountLinkageResult> = {};

  const [
    cashVaultsRes,
    goldVaultsRes,
    costEntriesRes,
    jewelryItemsRes,
    productsRes,
    branchInventoryRes,
    suppliersRes,
    paymentSettingsRes,
    productionSettingsRes,
    purchaseInvoiceLinesRes,
    returnsRes,
  ] = await Promise.all([
    dataGateway.fetchCashVaults(),
    dataGateway.fetchGoldVaults(),
    dataGateway.fetchCostEntries(),
    dataGateway.fetchJewelryItemsForLinkage(),
    dataGateway.fetchProductsForLinkage(),
    dataGateway.fetchBranchInventoryAccounts(),
    dataGateway.fetchSuppliersForLinkage(),
    dataGateway.fetchPaymentAccountSettings(),
    dataGateway.fetchProductionAccountSettings(),
    dataGateway.fetchPurchaseInvoiceLinesForLinkage(),
    dataGateway.fetchReturnsForLinkage(),
  ]);

  const linkageCounts: Record<string, AccountLinkageResult['linkedEntities']> = {};
  
  const initLinkages = () => ({
    cashVaults: 0,
    goldVaults: 0,
    costEntries: 0,
    jewelryItems: 0,
    products: 0,
    branchInventory: 0,
    suppliers: 0,
    paymentSettings: 0,
    productionSettings: 0,
    purchaseInvoiceLines: 0,
    returns: 0,
  });

  accountIds.forEach(id => {
    linkageCounts[id] = initLinkages();
  });

  cashVaultsRes.data?.forEach((row: any) => {
    if (row.account_id && linkageCounts[row.account_id]) {
      linkageCounts[row.account_id].cashVaults++;
    }
  });

  goldVaultsRes.data?.forEach((row: any) => {
    if (row.account_id && linkageCounts[row.account_id]) {
      linkageCounts[row.account_id].goldVaults++;
    }
  });

  costEntriesRes.data?.forEach((row: any) => {
    if (row.gl_account_id && linkageCounts[row.gl_account_id]) {
      linkageCounts[row.gl_account_id].costEntries++;
    }
  });

  jewelryItemsRes.data?.forEach((row: any) => {
    if (row.inventory_account_id && linkageCounts[row.inventory_account_id]) {
      linkageCounts[row.inventory_account_id].jewelryItems++;
    }
  });

  productsRes.data?.forEach((row: any) => {
    if (row.inventory_account_id && linkageCounts[row.inventory_account_id]) {
      linkageCounts[row.inventory_account_id].products++;
    }
    if (row.expense_account_id && linkageCounts[row.expense_account_id]) {
      linkageCounts[row.expense_account_id].products++;
    }
  });

  branchInventoryRes.data?.forEach((row: any) => {
    if (row.general_inventory_account_id && linkageCounts[row.general_inventory_account_id]) {
      linkageCounts[row.general_inventory_account_id].branchInventory++;
    }
    if (row.imported_pieces_account_id && linkageCounts[row.imported_pieces_account_id]) {
      linkageCounts[row.imported_pieces_account_id].branchInventory++;
    }
  });

  suppliersRes.data?.forEach((row: any) => {
    if (row.account_id && linkageCounts[row.account_id]) {
      linkageCounts[row.account_id].suppliers++;
    }
  });

  paymentSettingsRes.data?.forEach((row: any) => {
    ['cash_account_id', 'bank_transfer_account_id', 'check_account_id', 'credit_card_account_id'].forEach(col => {
      const id = row[col];
      if (id && linkageCounts[id]) {
        linkageCounts[id].paymentSettings++;
      }
    });
  });

  productionSettingsRes.data?.forEach((row: any) => {
    ['wip_account_id', 'raw_materials_account_id', 'finished_goods_account_id', 'scrap_loss_account_id'].forEach(col => {
      const id = row[col];
      if (id && linkageCounts[id]) {
        linkageCounts[id].productionSettings++;
      }
    });
  });

  purchaseInvoiceLinesRes.data?.forEach((row: any) => {
    ['account_id', 'inventory_account_id', 'expense_account_id'].forEach(col => {
      const id = row[col];
      if (id && linkageCounts[id]) {
        linkageCounts[id].purchaseInvoiceLines++;
      }
    });
  });

  returnsRes.data?.forEach((row: any) => {
    if (row.bank_account_id && linkageCounts[row.bank_account_id]) {
      linkageCounts[row.bank_account_id].returns++;
    }
  });

  for (const accountId of accountIds) {
    const account = allAccounts.find(a => a.id === accountId);
    const isSystem = account?.is_system || false;
    const journalEntriesCount = accountStats.entryCounts[accountId] || 0;
    const balance = accountStats.balances[accountId] || 0;
    const childrenCount = allAccounts.filter(a => a.parent_id === accountId).length;
    const linkedEntities = linkageCounts[accountId] || initLinkages();
    const totalLinkages = Object.values(linkedEntities).reduce((sum, count) => sum + count, 0);

    const protectionReasons: string[] = [];
    if (isSystem) protectionReasons.push('حساب نظامي');
    if (journalEntriesCount > 0) protectionReasons.push(`${journalEntriesCount} قيد محاسبي`);
    if (balance !== 0) protectionReasons.push('رصيد غير صفري');
    if (childrenCount > 0) protectionReasons.push(`${childrenCount} حساب فرعي`);
    if (linkedEntities.cashVaults > 0) protectionReasons.push('مرتبط بخزينة نقدية');
    if (linkedEntities.goldVaults > 0) protectionReasons.push('مرتبط بخزينة ذهب');
    if (linkedEntities.costEntries > 0) protectionReasons.push('مرتبط ببنود تكلفة');
    if (linkedEntities.jewelryItems > 0) protectionReasons.push('مرتبط بأصناف مجوهرات');
    if (linkedEntities.products > 0) protectionReasons.push('مرتبط بمنتجات');
    if (linkedEntities.branchInventory > 0) protectionReasons.push('مرتبط بحسابات مخزون الفروع');
    if (linkedEntities.suppliers > 0) protectionReasons.push('مرتبط بموردين');
    if (linkedEntities.paymentSettings > 0) protectionReasons.push('مرتبط بإعدادات الدفع');
    if (linkedEntities.productionSettings > 0) protectionReasons.push('مرتبط بإعدادات الإنتاج');
    if (linkedEntities.purchaseInvoiceLines > 0) protectionReasons.push('مرتبط بفواتير مشتريات');
    if (linkedEntities.returns > 0) protectionReasons.push('مرتبط بمرتجعات');

    const canEdit = !isSystem && journalEntriesCount === 0 && balance === 0 && totalLinkages === 0;
    const canDelete = canEdit && childrenCount === 0;

    results[accountId] = {
      hasJournalEntries: journalEntriesCount > 0,
      journalEntriesCount,
      hasBalance: balance !== 0,
      balance,
      hasChildren: childrenCount > 0,
      childrenCount,
      isSystem,
      linkedEntities,
      totalLinkages,
      canEdit,
      canDelete,
      protectionReasons,
    };
  }

  return results;
}
