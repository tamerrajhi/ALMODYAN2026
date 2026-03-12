import * as apiClient from './apiClient';

export const dataBackend = apiClient.dataBackend;

export function getActiveBackend(): 'neon' {
  return 'neon';
}

export function isNeonBackend(): boolean {
  return true;
}

export async function rpc<T = any>(
  fnName: string, 
  args: Record<string, any>
): Promise<{ data: T | null; error: { message: string } | null }> {
  return apiClient.rpc<T>(fnName, args);
}

export async function fetchTable<T = any>(
  tableName: string,
  options?: {
    select?: string;
    filters?: Record<string, any>;
    order?: { column: string; ascending?: boolean };
    limit?: number;
    single?: boolean;
  }
): Promise<{ data: T | null; error: { message: string } | null }> {
  const apiPath = `/api/${tableName.replace(/_/g, '-')}`;
  const { data, error } = await apiClient.get<T>(apiPath, options?.filters as any);
  return { data, error };
}

export async function fetchJewelrySets(options?: {
  model?: string;
  limit?: number;
}): Promise<{ data: Array<{ id: string; model: string }> | null; error: { message: string } | null }> {
  const params: Record<string, any> = {};
  if (options?.model) params.model = options.model;
  if (options?.limit) params.limit = options.limit;
  return apiClient.get('/api/jewelry-sets', params);
}

export async function fetchBranches(options?: { onlyActive?: boolean }): Promise<{ data: any[] | null; error: { message: string } | null }> {
  const params = options?.onlyActive ? { active: 'true' } : {};
  return apiClient.get('/api/branches', params);
}

export async function fetchModuleSettings(): Promise<{ data: any[] | null; error: { message: string } | null }> {
  return apiClient.get('/api/module-settings');
}

export async function fetchUserRole(userId: string): Promise<{ data: any[] | null; error: { message: string } | null }> {
  return apiClient.get('/api/user-role', { user_id: userId });
}

export async function fetchSuppliers(): Promise<{ data: any[] | null; error: { message: string } | null }> {
  return apiClient.get('/api/suppliers');
}

export async function fetchInvoices(options?: {
  invoice_type?: string;
  status?: string;
  limit?: number;
}): Promise<{ data: any[] | null; error: { message: string } | null }> {
  return apiClient.get('/api/invoices', options as any);
}

export async function purchaseInvoiceSuppInvPrecheck(
  supplierId: string,
  suppInvs: string[]
): Promise<{ data: any; error: { message: string } | null }> {
  return rpc('purchase_invoice_supp_inv_precheck', {
    p_supplier_id: supplierId,
    p_supp_invs: suppInvs
  });
}

export async function generateInvoiceNumber(
  invoiceType: string,
  branchCode: string
): Promise<{ data: string | null; error: { message: string } | null }> {
  return rpc('generate_invoice_number', {
    invoice_type_param: invoiceType,
    branch_code_param: branchCode
  });
}

export async function generateBatchNo(): Promise<{ data: string | null; error: { message: string } | null }> {
  return rpc('generate_batch_no', {});
}

export async function importJewelrySetsUpsertAtomic(
  clientRequestId: string,
  payload: Record<string, any>
): Promise<{ data: any; error: { message: string } | null }> {
  return rpc('import_jewelry_sets_upsert_atomic', {
    p_client_request_id: clientRequestId,
    p_payload: payload
  });
}

export async function fetchJewelrySetsByModels(
  models: string[]
): Promise<{ data: Array<{ id: string; model: string }> | null; error: { message: string } | null }> {
  return apiClient.get('/api/jewelry-sets', { model: models.join(','), limit: 1000 });
}

export async function fetchCustomers(): Promise<{ data: any[] | null; error: { message: string } | null }> {
  return apiClient.get('/api/customers');
}

export async function fetchGoldPrices(): Promise<{ data: any[] | null; error: { message: string } | null }> {
  return apiClient.get('/api/gold-prices');
}

export async function fetchGoldKarats(): Promise<{ data: any[] | null; error: { message: string } | null }> {
  return apiClient.get('/api/gold-karats');
}

export async function fetchJournalEntries(options?: {
  limit?: number;
  status?: string;
}): Promise<{ data: any[] | null; error: { message: string } | null }> {
  return apiClient.get('/api/journal-entries', options as any);
}

export async function fetchChartOfAccounts(): Promise<{ data: any[] | null; error: { message: string } | null }> {
  return apiClient.get('/api/chart-of-accounts');
}

export async function fetchJewelryItems(options?: {
  branch_id?: string;
  status?: string;
  limit?: number;
}): Promise<{ data: any[] | null; error: { message: string } | null }> {
  return apiClient.get('/api/jewelry-items', options as any);
}

export async function fetchProducts(): Promise<{ data: any[] | null; error: { message: string } | null }> {
  return apiClient.get('/api/products');
}

export async function syncItemCodeSequence(): Promise<{ data: any; error: { message: string } | null }> {
  return rpc('sync_item_code_sequence', {});
}

export async function syncSetCodeSequence(): Promise<{ data: any; error: { message: string } | null }> {
  return rpc('sync_set_code_sequence', {});
}

export async function importBackupLogCreateAtomic(
  clientRequestId: string,
  params: {
    p_backup_type: string;
    p_file_name: string;
    p_tables_included: string[];
    p_total_records: number;
    p_created_by: string | null;
    p_notes: string | null;
  }
): Promise<{ data: any; error: { message: string } | null }> {
  return rpc('import_backup_log_create_atomic', {
    p_client_request_id: clientRequestId,
    ...params
  });
}

export async function importRowErrorsCreateAtomic(
  clientRequestId: string,
  params: {
    p_batch_id: string;
    p_errors: any[];
  }
): Promise<{ data: any; error: { message: string } | null }> {
  return rpc('import_row_errors_create_atomic', {
    p_client_request_id: clientRequestId,
    ...params
  });
}

export async function hasRole(userId: string, role: string): Promise<{ data: boolean | null; error: { message: string } | null }> {
  return rpc('has_role', { p_user_id: userId, p_role_name: role });
}

export async function generateCustomerCode(): Promise<{ data: string | null; error: { message: string } | null }> {
  return rpc('generate_customer_code', {});
}

export async function completePOSSaleAtomic(payload: Record<string, any>): Promise<{ data: any; error: { message: string } | null }> {
  return rpc('complete_pos_sale_atomic', { p_payload: payload });
}

export async function getMonitoringSummary(): Promise<{ data: any; error: { message: string } | null }> {
  return rpc('get_monitoring_summary', {});
}

const ALLOWED_MONITORING_LISTS = [
  'get_hb_legacy_list',
  'get_hb_new_violations_list',
  'get_allow_unallocated_list',
  'get_formula_mismatch_list',
  'get_negative_remaining_list',
  'get_overpaid_list',
  'get_stuck_workflows_list',
  'get_unbalanced_je_list',
] as const;

type MonitoringListName = typeof ALLOWED_MONITORING_LISTS[number];

export async function getMonitoringList(listName: MonitoringListName): Promise<{ data: any[]; error: { message: string } | null }> {
  if (!ALLOWED_MONITORING_LISTS.includes(listName)) {
    return { data: [], error: { message: `Invalid monitoring list: ${listName}` } };
  }
  return rpc(listName, {});
}

export async function fetchDashboardStats(branchIds?: string[]): Promise<{ 
  data: {
    totalItems: number;
    totalSets: number;
    totalBatches: number;
    totalCustomers: number;
    totalSales: number;
    totalSalesAmount: number;
  } | null; 
  error: { message: string } | null 
}> {
  const params = branchIds?.length ? { branch_ids: branchIds.join(',') } : {};
  return apiClient.get('/api/dashboard-stats', params);
}

export { checkNeonHealth } from './apiClient';

export async function getNextItemCodes(count: number): Promise<{ data: string[] | null; error: { message: string } | null }> {
  if (count <= 0) return { data: [], error: null };
  return rpc<string[]>('get_next_item_codes_array', { count_needed: count, p_count: count, count });
}

export async function getNextSetCodes(count: number): Promise<{ data: string[] | null; error: { message: string } | null }> {
  if (count <= 0) return { data: [], error: null };
  return rpc<string[]>('get_next_set_codes_array', { count_needed: count, p_count: count, count });
}

export interface PosBeginResult {
  idempotent: boolean;
  status: string;
  retry?: boolean;
  entity_id?: string;
  result?: Record<string, unknown>;
}

export async function posBeginRequest(params: {
  clientRequestId: string;
  workflowType: string;
  payload: any;
}): Promise<{ data: PosBeginResult | null; error: { message: string } | null }> {
  return rpc<PosBeginResult>('pos_begin_request', {
    p_client_request_id: params.clientRequestId,
    p_workflow_type: params.workflowType,
    p_payload: params.payload,
  });
}

export async function posFailRequest(params: {
  clientRequestId: string;
  errorCode: string;
  errorMessage: string;
}): Promise<{ data: any; error: { message: string } | null }> {
  return rpc('pos_fail_request', {
    p_client_request_id: params.clientRequestId,
    p_error_code: params.errorCode,
    p_error_message: params.errorMessage,
  });
}

export async function posSucceedRequest(params: {
  clientRequestId: string;
  entityId: string;
  result: any;
}): Promise<{ data: any; error: { message: string } | null }> {
  return rpc('pos_succeed_request', {
    p_client_request_id: params.clientRequestId,
    p_entity_id: params.entityId,
    p_result: params.result,
  });
}

export async function fetchTableWithCount(
  tableName: string,
  options?: {
    filters?: Record<string, any>;
    orFilters?: string;
  }
): Promise<{ count: number; error: { message: string } | null }> {
  const apiPath = `/api/${tableName.replace(/_/g, '-')}/count`;
  const { data, error } = await apiClient.get<{ count: number }>(apiPath, options?.filters as any);
  return { count: data?.count || 0, error };
}

export async function fetchChartOfAccountsById(accountId: string): Promise<{ 
  data: { is_system: boolean; current_balance: number } | null; 
  error: { message: string } | null 
}> {
  return apiClient.get(`/api/chart-of-accounts/${accountId}`);
}

export async function fetchJournalEntryLinesCount(accountId: string): Promise<{ 
  count: number; 
  error: { message: string } | null 
}> {
  const { data, error } = await apiClient.get<{ count: number }>('/api/journal-entry-lines/count', { account_id: accountId });
  return { count: data?.count || 0, error };
}

export async function fetchChildAccountsCount(parentId: string): Promise<{ 
  count: number; 
  error: { message: string } | null 
}> {
  const { data, error } = await apiClient.get<{ count: number }>('/api/chart-of-accounts/count', { parent_id: parentId });
  return { count: data?.count || 0, error };
}

export async function fetchCashVaults(): Promise<{ data: any[] | null; error: { message: string } | null }> {
  return apiClient.get('/api/cash-vaults');
}

export async function fetchGoldVaults(): Promise<{ data: any[] | null; error: { message: string } | null }> {
  return apiClient.get('/api/gold-vaults');
}

export async function fetchCostEntries(): Promise<{ data: any[] | null; error: { message: string } | null }> {
  return apiClient.get('/api/cost-entries');
}

export async function fetchJewelryItemsForLinkage(): Promise<{ data: any[] | null; error: { message: string } | null }> {
  return apiClient.get('/api/jewelry-items', { select: 'inventory_account_id' });
}

export async function fetchProductsForLinkage(): Promise<{ data: any[] | null; error: { message: string } | null }> {
  return apiClient.get('/api/products', { select: 'inventory_account_id,expense_account_id' });
}

export async function fetchBranchInventoryAccounts(): Promise<{ data: any[] | null; error: { message: string } | null }> {
  return apiClient.get('/api/branch-inventory-accounts');
}

export async function fetchSuppliersForLinkage(): Promise<{ data: any[] | null; error: { message: string } | null }> {
  return apiClient.get('/api/suppliers', { select: 'account_id' });
}

export async function fetchPaymentAccountSettings(): Promise<{ data: any[] | null; error: { message: string } | null }> {
  return apiClient.get('/api/payment-account-settings');
}

export async function fetchProductionAccountSettings(): Promise<{ data: any[] | null; error: { message: string } | null }> {
  return apiClient.get('/api/production-account-settings');
}

export async function fetchPurchaseInvoiceLinesForLinkage(): Promise<{ data: any[] | null; error: { message: string } | null }> {
  return apiClient.get('/api/purchase-invoice-lines', { select: 'account_id,inventory_account_id,expense_account_id' });
}

export async function fetchReturnsForLinkage(): Promise<{ data: any[] | null; error: { message: string } | null }> {
  return apiClient.get('/api/returns', { select: 'bank_account_id' });
}

export async function getUserBranches(userId: string): Promise<{ data: any[] | null; error: { message: string } | null }> {
  return rpc<any[]>('get_user_branches', { p_user_id: userId });
}

export async function getUserCustomRoles(userId: string): Promise<{ data: any[] | null; error: { message: string } | null }> {
  return apiClient.get('/api/user-custom-roles', { user_id: userId });
}

export async function getRolePermissionsWithScreens(roleIds: string[]): Promise<{ data: any[] | null; error: { message: string } | null }> {
  return apiClient.get('/api/role-permissions-with-screens', { role_ids: roleIds.join(',') });
}

export async function getCustomerAccountCode(customerId: string): Promise<{ data: { account_code: string | null } | null; error: { message: string } | null }> {
  return apiClient.get(`/api/customer-account-code/${customerId}`);
}

export async function getSupplierAccountCode(supplierId: string): Promise<{ data: { account_code: string | null } | null; error: { message: string } | null }> {
  return apiClient.get(`/api/supplier-account-code/${supplierId}`);
}

export async function getPaymentAccountSettingsResolved(branchId?: string | null): Promise<{ data: any | null; error: { message: string } | null }> {
  const params: Record<string, any> = {};
  if (branchId) params.branch_id = branchId;
  return apiClient.get('/api/payment-account-settings-resolved', params);
}

export async function getChartOfAccountsById(accountId: string): Promise<{ data: any | null; error: { message: string } | null }> {
  return apiClient.get(`/api/chart-of-accounts-by-id/${accountId}`);
}

export async function getJournalEntryWithLines(entryId: string): Promise<{ data: any | null; error: { message: string } | null }> {
  return apiClient.get(`/api/journal-entries/${entryId}/with-lines`);
}

export async function getJournalEntryLinesCount(entryId: string): Promise<{ data: { count: number } | null; error: { message: string } | null }> {
  return apiClient.get('/api/journal-entry-lines/count', { journal_entry_id: entryId });
}

export async function getPaymentWithRelations(paymentId: string): Promise<{ data: any | null; error: { message: string } | null }> {
  return apiClient.get(`/api/payments/${paymentId}/with-relations`);
}

export async function getModuleSettings(moduleName: string): Promise<{ data: any; error: { message: string } | null }> {
  return rpc('get_module_settings', { p_module: moduleName, module_name: moduleName });
}

export async function saveModuleSetting(moduleName: string, key: string, value: any): Promise<{ data: any; error: { message: string } | null }> {
  return rpc('save_module_setting', { 
    p_module: moduleName, 
    module_name: moduleName, 
    p_key: key, 
    setting_key: key, 
    p_value: value, 
    setting_value: value 
  });
}

export type FilterOp = 
  | { type: 'eq'; column: string; value: any }
  | { type: 'neq'; column: string; value: any }
  | { type: 'gt'; column: string; value: any }
  | { type: 'gte'; column: string; value: any }
  | { type: 'lt'; column: string; value: any }
  | { type: 'lte'; column: string; value: any }
  | { type: 'in'; column: string; value: any[] }
  | { type: 'is'; column: string; value: null | boolean }
  | { type: 'ilike'; column: string; value: string }
  | { type: 'like'; column: string; value: string }
  | { type: 'or'; value: string }
  | { type: 'not'; column: string; operator: string; value: any }
  | { type: 'contains'; column: string; value: any };

export interface QueryOptions {
  select?: string;
  filters?: FilterOp[];
  order?: { column: string; ascending?: boolean } | Array<{ column: string; ascending?: boolean }>;
  limit?: number;
  single?: boolean;
  maybeSingle?: boolean;
  count?: 'exact' | 'planned' | 'estimated';
  head?: boolean;
  range?: { from: number; to: number };
}

export async function queryTable<T = any>(
  tableName: string,
  options?: QueryOptions
): Promise<{ data: T | null; error: { message: string } | null; count?: number | null }> {
  try {
    const response = await fetch('/api/table-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table: tableName,
        select: options?.select,
        filters: options?.filters,
        order: options?.order,
        limit: options?.limit,
        single: options?.single,
        maybeSingle: options?.maybeSingle,
        count: options?.count,
        head: options?.head,
        range: options?.range,
      }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return { data: null, error: { message: err?.error?.message || `HTTP ${response.status}` } };
    }
    const result = await response.json();
    return { data: result.data as T, error: result.error, count: result.count };
  } catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : 'Network error' } };
  }
}

export async function fetchPurchasingInvoiceWithRelations(invoiceId: string): Promise<{ data: any | null; error: { message: string } | null }> {
  return apiClient.get(`/api/purchasing/invoice-with-relations/${invoiceId}`);
}


export async function fetchUniqueInvoiceItems(invoiceId: string, params?: Record<string, string>): Promise<{ data: any | null; error: { message: string } | null }> {
  const result = await apiClient.get(`/api/purchasing/unique-invoice-items/${invoiceId}`, params);
  if (result.data && result.data.data) {
    return { data: result.data.data, error: result.data.error || result.error };
  }
  return result;
}

export async function fetchPurchasingInvoicesList(filters?: {
  branchId?: string; supplierId?: string; status?: string; invoiceType?: string;
  purchaseType?: string; dateFrom?: string; dateTo?: string; limit?: number; search?: string;
}): Promise<{ data: any[] | null; error: { message: string } | null }> {
  const params: Record<string, string> = {};
  if (filters?.branchId) params.branch_id = filters.branchId;
  if (filters?.supplierId) params.supplier_id = filters.supplierId;
  if (filters?.status) params.status = filters.status;
  if (filters?.invoiceType) params.invoice_type = filters.invoiceType;
  if (filters?.purchaseType) params.purchase_type = filters.purchaseType;
  if (filters?.dateFrom) params.date_from = filters.dateFrom;
  if (filters?.dateTo) params.date_to = filters.dateTo;
  if (filters?.limit) params.limit = String(filters.limit);
  if (filters?.search) params.search = filters.search;
  const result = await apiClient.get('/api/purchasing/invoices-list', params);
  if (result.data && result.data.data && Array.isArray(result.data.data)) {
    return { data: result.data.data, error: result.data.error || result.error };
  }
  return result;
}

export async function fetchTransfersList(filters?: {
  branch_id?: string; from_branch_id?: string; to_branch_id?: string;
  status?: string; date_from?: string; date_to?: string; search?: string;
}): Promise<{ data: any[] | null; error: { message: string } | null }> {
  const params: Record<string, string> = {};
  if (filters?.branch_id) params.branch_id = filters.branch_id;
  if (filters?.from_branch_id) params.from_branch_id = filters.from_branch_id;
  if (filters?.to_branch_id) params.to_branch_id = filters.to_branch_id;
  if (filters?.status) params.status = filters.status;
  if (filters?.date_from) params.date_from = filters.date_from;
  if (filters?.date_to) params.date_to = filters.date_to;
  if (filters?.search) params.search = filters.search;
  const result = await apiClient.get('/api/transfers/list', params);
  const inner = result.data;
  if (inner && typeof inner === 'object' && 'data' in inner) {
    return { data: inner.data, error: inner.error || result.error };
  }
  return result;
}

export async function fetchTransferDetails(transferId: string): Promise<{ data: any | null; error: { message: string } | null }> {
  const result = await apiClient.get(`/api/transfers/${transferId}/details`);
  const inner = result.data;
  if (inner && typeof inner === 'object' && 'data' in inner) {
    return { data: inner.data, error: inner.error || result.error };
  }
  return result;
}

export async function fetchPurchasingReturnsList(filters?: {
  branchId?: string; supplierId?: string; status?: string; returnType?: string;
}): Promise<{ data: any[] | null; error: { message: string } | null }> {
  const params: Record<string, string> = {};
  if (filters?.branchId) params.branch_id = filters.branchId;
  if (filters?.supplierId) params.supplier_id = filters.supplierId;
  if (filters?.status) params.status = filters.status;
  if (filters?.returnType) params.return_type = filters.returnType;
  return apiClient.get('/api/purchasing/returns-list', params);
}
