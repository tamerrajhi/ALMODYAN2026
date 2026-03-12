/**
 * Purchasing Read Service
 * Central service for all purchasing domain reads - returns DTOs only
 * This is the ONLY place that queries purchasing tables for UI components
 */

import * as dataGateway from '@/lib/dataGateway';
import type { QueryOptions, FilterOp } from '@/lib/dataGateway';
import type { 
  PurchaseInvoiceDTO, 
  PurchaseInvoiceLineDTO,
  PurchaseReturnDTO,
  JewelryItemDTO,
  PurchaseInvoiceFilters,
  PurchaseReturnFilters,
} from './dto';
import { 
  mapInvoiceRowToDTO, 
  mapInvoiceLineRowToDTO,
  mapGeneralReturnToDTO,
  mapUniqueReturnToDTO,
  mapJewelryItemRowToDTO,
} from './mappers';

// ===========================
// Form Select DTOs (minimal for dropdowns)
// ===========================

export interface SupplierSelectDTO {
  id: string;
  supplierName: string;
  supplierRef: string;
  phone: string | null;
  email: string | null;
  vatNumber: string | null;
  address: string | null;
}

export interface BranchSelectDTO {
  id: string;
  branchName: string;
  branchCode: string;
  branchType: string;
  isActive: boolean;
}

export interface JewelryItemSelectDTO {
  id: string;
  itemCode: string;
  description: string | null;
}

export interface ProductSelectDTO {
  id: string;
  productCode: string;
  nameAr: string;
  productType: string;
  inventoryAccountId: string | null;
  expenseAccountId: string | null;
  taxRate: number;
}

export interface CostEntrySelectDTO {
  id: string;
  costCode: string;
  nameAr: string;
  costType: string;
  glAccountId: string;
  taxRate: number;
}

export interface PurchaseOrderSelectDTO {
  id: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;
  totalAmount: number;
  status: string;
  orderDate: string;
}

export interface PurchaseOrderItemDTO {
  id: string;
  poId: string;
  itemType: string;
  description: string;
  quantity: number;
  unitPrice: number;
  warehouseId: string | null;
}

export interface PurchaseInvoiceForEditDTO {
  id: string;
  invoiceNumber: string;
  supplierInvoiceNo: string | null;  // NEW: Supplier Invoice Number
  invoiceDate: string;
  dueDate: string | null;
  supplierId: string | null;
  branchId: string | null;
  notes: string | null;
  poId: string | null;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  status: string;
}

export interface PurchaseInvoiceLineForEditDTO {
  id: string;
  lineNumber: number;
  productId: string | null;
  itemType: string;
  productCode: string;
  description: string;
  quantity: number;
  unitPrice: number;
  isInclusive: boolean;
  discountAmount: number;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
  glAccountId: string | null;
  warehouseAccountId: string | null;
}

// ===========================
// Form Select Functions (for dropdowns)
// ===========================

/**
 * List suppliers for select dropdown
 */
export async function listSuppliersForSelect(): Promise<SupplierSelectDTO[]> {
  const { data, error } = await dataGateway.queryTable('suppliers', {
    select: 'id, supplier_name, supplier_ref, phone, email, vat_number, address',
    order: { column: 'supplier_name', ascending: true },
  });
  
  if (error) throw new Error(error.message);
  
  return (data || []).map((row: any) => ({
    id: row.id,
    supplierName: row.supplier_name,
    supplierRef: row.supplier_ref,
    phone: row.phone,
    email: row.email,
    vatNumber: row.vat_number,
    address: row.address,
  }));
}

/**
 * Search suppliers for select dropdown (with optional search query)
 * DTO-first for SupplierSelect component
 */
export async function searchSuppliersForSelect(params: {
  q?: string;
  limit?: number;
}): Promise<SupplierSelectDTO[]> {
  const hasSearch = params.q && params.q.length >= 2;
  const limit = params.limit || (hasSearch ? 20 : 10);
  
  const filters: FilterOp[] = [
    { type: 'eq', column: 'status', value: 'active' },
  ];
  
  if (hasSearch) {
    filters.push({ type: 'or', value: `supplier_name.ilike.%${params.q}%,supplier_code.ilike.%${params.q}%,phone.ilike.%${params.q}%` });
  }
  
  const { data, error } = await dataGateway.queryTable('suppliers', {
    select: 'id, supplier_name, supplier_code, supplier_ref, phone, email, vat_number, address',
    filters,
    order: hasSearch
      ? { column: 'supplier_name', ascending: true }
      : { column: 'created_at', ascending: false },
    limit,
  });
  if (error) throw new Error(error.message);
  
  return (data || []).map((row: any) => ({
    id: row.id,
    supplierName: row.supplier_name,
    supplierRef: row.supplier_ref ?? row.supplier_code ?? '',
    phone: row.phone,
    email: row.email,
    vatNumber: row.vat_number,
    address: row.address,
  }));
}

/**
 * Get a single supplier by ID for display
 */
export async function getSupplierById(id: string): Promise<SupplierSelectDTO | null> {
  const { data, error } = await dataGateway.queryTable('suppliers', {
    select: 'id, supplier_name, supplier_code, supplier_ref, phone, email, vat_number, address',
    filters: [{ type: 'eq', column: 'id', value: id }],
    single: true,
  });
  
  if (error || !data) return null;
  
  return {
    id: data.id,
    supplierName: data.supplier_name,
    supplierRef: data.supplier_ref ?? data.supplier_code ?? '',
    phone: data.phone,
    email: data.email,
    vatNumber: data.vat_number,
    address: data.address,
  };
}

/**
 * List active branches for select dropdown
 */
export async function listBranchesForSelect(): Promise<BranchSelectDTO[]> {
  const { data, error } = await dataGateway.queryTable('branches', {
    select: 'id, branch_name, branch_code, branch_type, is_active',
    filters: [{ type: 'eq', column: 'is_active', value: true }],
    order: { column: 'branch_name', ascending: true },
  });
  
  if (error) throw new Error(error.message);
  
  return (data || []).map((row: any) => ({
    id: row.id,
    branchName: row.branch_name,
    branchCode: row.branch_code,
    branchType: row.branch_type,
    isActive: row.is_active,
  }));
}

/**
 * Search jewelry items for invoice form (available only)
 */
export async function searchJewelryItemsForInvoiceForm(params?: {
  search?: string;
  limit?: number;
}): Promise<JewelryItemSelectDTO[]> {
  const filters: FilterOp[] = [
    { type: 'is', column: 'sale_id', value: null },
  ];
  
  if (params?.search) {
    filters.push({ type: 'or', value: `item_code.ilike.%${params.search}%,description.ilike.%${params.search}%` });
  }
  
  const { data, error } = await dataGateway.queryTable('unique_items', {
    select: 'id, item_code, description',
    filters,
    order: { column: 'item_code', ascending: true },
    limit: params?.limit || 500,
  });
  if (error) throw new Error(error.message);
  
  return (data || []).map((row: any) => ({
    id: row.id,
    itemCode: row.item_code,
    description: row.description,
  }));
}

/**
 * List products for invoice form
 */
export async function listProductsForInvoiceForm(params?: {
  search?: string;
}): Promise<ProductSelectDTO[]> {
  const filters: FilterOp[] = [
    { type: 'eq', column: 'is_active', value: true },
  ];
  
  if (params?.search) {
    filters.push({ type: 'or', value: `product_code.ilike.%${params.search}%,name_ar.ilike.%${params.search}%` });
  }
  
  const { data, error } = await dataGateway.queryTable('products', {
    select: 'id, product_code, name_ar, product_type, inventory_account_id, expense_account_id, tax_rate',
    filters,
    order: { column: 'product_code', ascending: true },
  });
  if (error) throw new Error(error.message);
  
  return (data || []).map((row: any) => ({
    id: row.id,
    productCode: row.product_code,
    nameAr: row.name_ar,
    productType: row.product_type,
    inventoryAccountId: row.inventory_account_id,
    expenseAccountId: row.expense_account_id,
    taxRate: row.tax_rate ?? 15,
  }));
}

/**
 * List cost entries for invoice form
 */
export async function listCostEntriesForInvoiceForm(params?: {
  search?: string;
}): Promise<CostEntrySelectDTO[]> {
  const filters: FilterOp[] = [
    { type: 'eq', column: 'is_active', value: true },
  ];
  
  if (params?.search) {
    filters.push({ type: 'or', value: `cost_code.ilike.%${params.search}%,name_ar.ilike.%${params.search}%` });
  }
  
  const { data, error } = await dataGateway.queryTable('cost_entries', {
    select: 'id, cost_code, name_ar, cost_type, gl_account_id, tax_rate',
    filters,
    order: { column: 'cost_code', ascending: true },
  });
  if (error) throw new Error(error.message);
  
  return (data || []).map((row: any) => ({
    id: row.id,
    costCode: row.cost_code,
    nameAr: row.name_ar,
    costType: row.cost_type,
    glAccountId: row.gl_account_id,
    taxRate: row.tax_rate ?? 15,
  }));
}

/**
 * List purchase orders available for import
 */
export async function listPurchaseOrdersForImport(params?: {
  supplierId?: string;
  search?: string;
  limit?: number;
}): Promise<PurchaseOrderSelectDTO[]> {
  const filters: FilterOp[] = [
    { type: 'in', column: 'status', value: ['approved', 'partially_received', 'fully_received'] },
  ];
  
  if (params?.supplierId) {
    filters.push({ type: 'eq', column: 'supplier_id', value: params.supplierId });
  }
  
  const { data, error } = await dataGateway.queryTable('purchase_orders', {
    select: 'id, po_number, supplier_id, total_amount, status, order_date',
    filters,
    order: { column: 'order_date', ascending: false },
    limit: params?.limit || 50,
  });
  if (error) throw new Error(error.message);
  
  return (data || []).map((row: any) => ({
    id: row.id,
    poNumber: row.po_number,
    supplierId: row.supplier_id,
    supplierName: row.suppliers?.supplier_name || '',
    totalAmount: row.total_amount ?? 0,
    status: row.status,
    orderDate: row.order_date,
  }));
}

/**
 * Get purchase order items for import
 */
export async function listPurchaseOrderItems(poId: string): Promise<PurchaseOrderItemDTO[]> {
  const { data, error } = await dataGateway.queryTable('purchase_order_items', {
    select: 'id, po_id, item_type, description, quantity, unit_price, warehouse_id',
    filters: [{ type: 'eq', column: 'po_id', value: poId }],
  });
  
  if (error) throw new Error(error.message);
  
  return (data || []).map((row: any) => ({
    id: row.id,
    poId: row.po_id,
    itemType: row.item_type || 'jewelry',
    description: row.description || '',
    quantity: row.quantity ?? 1,
    unitPrice: row.unit_price ?? 0,
    warehouseId: row.warehouse_id,
  }));
}

/**
 * Get purchase order header for import
 */
export async function getPurchaseOrderForImport(poId: string): Promise<{
  supplierId: string | null;
  branchId: string | null;
  warehouseId: string | null;
} | null> {
  const { data, error } = await dataGateway.queryTable('purchase_orders', {
    select: 'supplier_id, branch_id, warehouse_id',
    filters: [{ type: 'eq', column: 'id', value: poId }],
    single: true,
  });
  
  if (error) {
    if (error.message?.includes('PGRST116') || error.message?.includes('no rows')) return null;
    throw new Error(error.message);
  }
  
  if (!data) return null;
  
  return {
    supplierId: data.supplier_id,
    branchId: data.branch_id,
    warehouseId: data.warehouse_id,
  };
}

/**
 * Get purchase invoice for edit (header only)
 */
export async function getPurchaseInvoiceForEdit(invoiceId: string): Promise<PurchaseInvoiceForEditDTO | null> {
  const { data, error } = await dataGateway.queryTable('invoices', {
    select: 'id, invoice_number, supplier_invoice_no, invoice_date, due_date, supplier_id, branch_id, notes, po_id, subtotal, tax_amount, total_amount, status',
    filters: [{ type: 'eq', column: 'id', value: invoiceId }],
    single: true,
  });
  
  if (error) {
    if (error.message?.includes('PGRST116') || error.message?.includes('no rows')) return null;
    throw new Error(error.message);
  }
  
  if (!data) return null;
  
  // Type cast to bypass outdated generated types (column exists in DB, types not regenerated)
  const row = data as any;
  
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    supplierInvoiceNo: row.supplier_invoice_no,  // NEW: Map supplier invoice no
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    supplierId: row.supplier_id,
    branchId: row.branch_id,
    notes: row.notes,
    poId: row.po_id,
    subtotal: row.subtotal ?? 0,
    taxAmount: row.tax_amount ?? 0,
    totalAmount: row.total_amount ?? 0,
    status: row.status,
  };
}

/**
 * Get purchase invoice lines for edit
 */
export async function listPurchaseInvoiceLinesForEdit(invoiceId: string): Promise<PurchaseInvoiceLineForEditDTO[]> {
  const { data, error } = await dataGateway.queryTable('purchase_invoice_lines', {
    select: 'id, line_number, product_id, item_type, product_code, description, quantity, unit_price, is_inclusive, discount_amount, subtotal, tax_rate, tax_amount, total_amount, gl_account_id, warehouse_account_id',
    filters: [{ type: 'eq', column: 'invoice_id', value: invoiceId }],
    order: { column: 'line_number', ascending: true },
  });
  
  if (error) throw new Error(error.message);
  
  return (data || []).map((row: any) => ({
    id: row.id,
    lineNumber: row.line_number,
    productId: row.product_id,
    itemType: row.item_type || 'jewelry',
    productCode: row.product_code || '',
    description: row.description || '',
    quantity: row.quantity ?? 1,
    unitPrice: row.unit_price ?? 0,
    isInclusive: row.is_inclusive ?? false,
    discountAmount: row.discount_amount ?? 0,
    subtotal: row.subtotal ?? 0,
    taxRate: row.tax_rate ?? 15,
    taxAmount: row.tax_amount ?? 0,
    totalAmount: row.total_amount ?? 0,
    glAccountId: row.gl_account_id,
    warehouseAccountId: row.warehouse_account_id,
  }));
}

/**
 * Check if invoice reference already exists (for duplicate check)
 */
export async function checkInvoiceReferenceDuplicate(
  reference: string,
  supplierId: string,
  excludeInvoiceId?: string
): Promise<boolean> {
  const filters: FilterOp[] = [
    { type: 'eq', column: 'invoice_number', value: reference },
    { type: 'eq', column: 'supplier_id', value: supplierId },
    { type: 'eq', column: 'invoice_type', value: 'purchase' },
  ];
  
  if (excludeInvoiceId) {
    filters.push({ type: 'neq', column: 'id', value: excludeInvoiceId });
  }
  
  const { data, error } = await dataGateway.queryTable('invoices', {
    select: 'id',
    filters,
  });
  if (error) throw new Error(error.message);
  
  return (data || []).length > 0;
}

// ===========================
// Purchase Invoices
// ===========================

/**
 * List purchase invoices with optional filters
 */
export async function listPurchaseInvoices(
  filters: PurchaseInvoiceFilters = {}
): Promise<PurchaseInvoiceDTO[]> {
  const queryFilters: FilterOp[] = [
    { type: 'eq', column: 'invoice_type', value: 'purchase' },
  ];

  if (filters.branchId) {
    queryFilters.push({ type: 'eq', column: 'branch_id', value: filters.branchId });
  }
  if (filters.supplierId) {
    queryFilters.push({ type: 'eq', column: 'supplier_id', value: filters.supplierId });
  }
  if (filters.status) {
    queryFilters.push({ type: 'eq', column: 'status', value: filters.status });
  }
  if (filters.purchaseType) {
    queryFilters.push({ type: 'eq', column: 'purchase_type', value: filters.purchaseType });
  }
  if (filters.dateFrom) {
    queryFilters.push({ type: 'gte', column: 'invoice_date', value: filters.dateFrom });
  }
  if (filters.dateTo) {
    queryFilters.push({ type: 'lte', column: 'invoice_date', value: filters.dateTo });
  }

  const { data, error } = await dataGateway.fetchPurchasingInvoicesList({
    branchId: filters.branchId,
    supplierId: filters.supplierId,
    status: filters.status,
    invoiceType: 'purchase',
    purchaseType: filters.purchaseType,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    search: filters.searchQuery,
  });
  if (error) throw new Error(error.message);

  const invoices = (data || []).map((row: any) => mapInvoiceRowToDTO(row as any));

  const importInvoicesNeedingCheck = invoices.filter(
    inv => inv.purchaseType === 'import' && !['cancelled', 'voided', 'returned'].includes(inv.status)
  );

  if (importInvoicesNeedingCheck.length > 0) {
    const batchIds = importInvoicesNeedingCheck
      .map(inv => inv.batchId)
      .filter((bid): bid is string => !!bid);

    if (batchIds.length > 0) {
      const { data: itemStatusData } = await dataGateway.queryTable('unique_items', {
        select: 'batch_id, status',
        filters: [{ type: 'in', column: 'batch_id', value: batchIds }],
      });

      if (itemStatusData && itemStatusData.length > 0) {
        const statusByBatch = new Map<string, { total: number; returned: number }>();
        for (const item of itemStatusData as any[]) {
          const entry = statusByBatch.get(item.batch_id) || { total: 0, returned: 0 };
          entry.total++;
          if (item.status === 'returned_to_supplier') entry.returned++;
          statusByBatch.set(item.batch_id, entry);
        }

        for (const inv of importInvoicesNeedingCheck) {
          if (!inv.batchId) continue;
          const stats = statusByBatch.get(inv.batchId);
          if (!stats || stats.total === 0) continue;

          if (stats.returned === stats.total) {
            (inv as any).status = 'returned';
            (inv as any).remainingAmount = 0;
          } else if (stats.returned > 0) {
            (inv as any).status = 'partially_returned';
            (inv as any).remainingAmount = Math.max(0, inv.totalAmount * (1 - stats.returned / stats.total));
          }
        }
      }
    }
  }

  return invoices;
}

/**
 * Get single purchase invoice by ID with lines
 */
export async function getPurchaseInvoice(
  id: string
): Promise<PurchaseInvoiceDTO | null> {
  const result = await dataGateway.fetchPurchasingInvoiceWithRelations(id);
  const unwrapped = (result.data && result.data.data) ? result.data : { data: result.data, error: result.error };
  const invoiceData = unwrapped.data;
  const invoiceError = unwrapped.error || result.error;

  if (invoiceError) throw new Error(invoiceError.message);
  if (!invoiceData) return null;

  const lines = invoiceData.lines || [];
  const purchaseType = invoiceData.purchase_type;

  if (purchaseType === 'import') {
    let effectiveStatus = invoiceData.status || 'posted';
    let effectiveRemainingAmount = invoiceData.remaining_amount != null ? Number(invoiceData.remaining_amount) : (Number(invoiceData.total_amount) || 0);

    if (effectiveStatus !== 'cancelled' && effectiveStatus !== 'voided') {
      const batchOrInvoiceFilter = invoiceData.batch_id
        ? [{ type: 'eq' as const, column: 'batch_id', value: invoiceData.batch_id }]
        : [{ type: 'eq' as const, column: 'unique_invoice_id', value: invoiceData.id }];

      const { data: itemStatusData } = await dataGateway.queryTable('unique_items', {
        select: 'status',
        filters: batchOrInvoiceFilter,
      });

      if (itemStatusData && itemStatusData.length > 0) {
        const allReturned = itemStatusData.every((item: any) => item.status === 'returned_to_supplier');
        const someReturned = itemStatusData.some((item: any) => item.status === 'returned_to_supplier');

        if (allReturned) {
          effectiveStatus = 'returned';
          effectiveRemainingAmount = 0;
        } else if (someReturned) {
          effectiveStatus = 'partially_returned';
          const returnedCount = itemStatusData.filter((item: any) => item.status === 'returned_to_supplier').length;
          const totalCount = itemStatusData.length;
          const totalAmount = Number(invoiceData.total_amount) || 0;
          effectiveRemainingAmount = Math.max(0, totalAmount * (1 - returnedCount / totalCount));
        }
      }
    }

    return {
      id: invoiceData.id,
      invoiceNumber: invoiceData.invoice_number,
      supplierInvoiceNo: invoiceData.supplier_invoice_no || invoiceData.supp_inv,
      invoiceDate: invoiceData.invoice_date,
      dueDate: null,
      invoiceType: 'purchase',
      purchaseType: 'import',
      supplierId: invoiceData.supplier_id,
      supplierName: invoiceData.supplier_name || '',
      supplierEmail: null,
      supplierPhone: null,
      supplierVatNumber: invoiceData.supplier_vat || null,
      supplierAddress: null,
      branchId: invoiceData.branch_id,
      branchName: invoiceData.branch_name || '',
      subtotal: Number(invoiceData.subtotal) || 0,
      discountAmount: 0,
      taxAmount: Number(invoiceData.tax_amount) || 0,
      totalAmount: Number(invoiceData.total_amount) || 0,
      paidAmount: Number(invoiceData.paid_amount) || 0,
      remainingAmount: effectiveRemainingAmount,
      status: effectiveStatus,
      notes: invoiceData.notes,
      linkedInvoiceId: null,
      journalEntryId: invoiceData.journal_entry_id,
      batchId: invoiceData.batch_id,
      uploadedFileName: invoiceData.uploaded_file_name || null,
      hasImportedItems: true,
      lines: lines.map((line: any, idx: number) => ({
        id: line.id,
        invoiceId: invoiceData.id,
        lineNumber: line.line_number ?? idx + 1,
        uniqueItemId: line.unique_item_id || null,
        itemType: 'jewelry' as const,
        lineKind: 'import_summary',
        productId: null,
        costEntryId: null,
        productCode: line.item_code || line.serial_no || '',
        description: line.description || '',
        quantity: Number(line.quantity) || 1,
        returnedQty: 0,
        remainingQty: Number(line.quantity) || 1,
        unitPrice: Number(line.unit_cost) || 0,
        isInclusive: false,
        discountAmount: 0,
        subtotal: Number(line.line_total) || 0,
        taxRate: 0.15,
        taxAmount: 0,
        totalAmount: Number(line.line_total) || 0,
        glAccountId: null,
        warehouseAccountId: null,
      })),
      createdAt: invoiceData.created_at,
      updatedAt: invoiceData.created_at,
    };
  }

  return mapInvoiceRowToDTO(invoiceData as any, lines as any);
}

/**
 * Get invoice lines for a specific invoice
 */
export async function getInvoiceLines(
  invoiceId: string
): Promise<PurchaseInvoiceLineDTO[]> {
  const { data, error } = await dataGateway.queryTable('purchase_invoice_lines', {
    select: '*',
    filters: [{ type: 'eq', column: 'invoice_id', value: invoiceId }],
    order: { column: 'line_number', ascending: true },
  });

  if (error) throw new Error(error.message);

  return (data || []).map((row: any) => mapInvoiceLineRowToDTO(row as any));
}

// ===========================
// Purchase Returns (Unified)
// ===========================

/**
 * List all purchase returns - merges general (invoices) and unique (purchase_returns)
 * Returns unified array sorted by date desc
 */
export async function listPurchaseReturns(
  filters: PurchaseReturnFilters = {}
): Promise<PurchaseReturnDTO[]> {
  // Fetch general returns from invoices table
  const generalFilters: FilterOp[] = [
    { type: 'eq', column: 'invoice_type', value: 'purchase_return' },
  ];
  if (filters.branchId) {
    generalFilters.push({ type: 'eq', column: 'branch_id', value: filters.branchId });
  }
  if (filters.supplierId) {
    generalFilters.push({ type: 'eq', column: 'supplier_id', value: filters.supplierId });
  }
  if (filters.status) {
    generalFilters.push({ type: 'eq', column: 'status', value: filters.status });
  }
  if (filters.dateFrom) {
    generalFilters.push({ type: 'gte', column: 'invoice_date', value: filters.dateFrom });
  }
  if (filters.dateTo) {
    generalFilters.push({ type: 'lte', column: 'invoice_date', value: filters.dateTo });
  }

  const { data: generalData, error: generalError } = await dataGateway.queryTable('invoices', {
    select: '*',
    filters: generalFilters,
    order: { column: 'invoice_date', ascending: false },
  });
  if (generalError) throw new Error(generalError.message);

  // Fetch unique returns from purchase_returns table
  const uniqueFilters: FilterOp[] = [];
  if (filters.branchId) {
    uniqueFilters.push({ type: 'eq', column: 'branch_id', value: filters.branchId });
  }
  if (filters.supplierId) {
    uniqueFilters.push({ type: 'eq', column: 'supplier_id', value: filters.supplierId });
  }
  if (filters.status) {
    uniqueFilters.push({ type: 'eq', column: 'status', value: filters.status });
  }
  if (filters.dateFrom) {
    uniqueFilters.push({ type: 'gte', column: 'return_date', value: filters.dateFrom });
  }
  if (filters.dateTo) {
    uniqueFilters.push({ type: 'lte', column: 'return_date', value: filters.dateTo });
  }

  const { data: uniqueData, error: uniqueError } = await dataGateway.queryTable('purchase_returns', {
    select: '*',
    filters: uniqueFilters,
    order: { column: 'return_date', ascending: false },
  });
  if (uniqueError) throw new Error(uniqueError.message);

  // Map both to DTOs
  const generalReturns = (generalData || []).map((row: any) => mapGeneralReturnToDTO(row as any));
  const uniqueReturns = (uniqueData || []).map((row: any) => mapUniqueReturnToDTO(row as any));

  // Merge and sort by date desc
  const allReturns = [...generalReturns, ...uniqueReturns];
  allReturns.sort((a, b) => {
    const dateA = new Date(a.returnDate).getTime();
    const dateB = new Date(b.returnDate).getTime();
    return dateB - dateA;
  });

  // Apply search filter if provided (post-merge)
  if (filters.searchQuery) {
    const query = filters.searchQuery.toLowerCase();
    return allReturns.filter(ret =>
      ret.returnNumber.toLowerCase().includes(query) ||
      ret.supplierName.toLowerCase().includes(query)
    );
  }

  return allReturns;
}

/**
 * Get a single purchase return by ID - tries invoices first, then purchase_returns
 */
export async function getPurchaseReturnUniversal(
  id: string
): Promise<PurchaseReturnDTO | null> {
  // Try general return (invoices table) first
  const { data: generalData, error: generalError } = await dataGateway.queryTable('invoices', {
    select: '*',
    filters: [
      { type: 'eq', column: 'id', value: id },
      { type: 'eq', column: 'invoice_type', value: 'purchase_return' },
    ],
    maybeSingle: true,
  });

  if (generalError) throw new Error(generalError.message);

  if (generalData) {
    // Fetch lines for general return
    const { data: linesData } = await dataGateway.queryTable('purchase_invoice_lines', {
      select: '*',
      filters: [{ type: 'eq', column: 'invoice_id', value: id }],
      order: { column: 'line_number', ascending: true },
    });

    return mapGeneralReturnToDTO(generalData as any, linesData as any);
  }

  // Try unique return (purchase_returns table)
  const { data: uniqueData, error: uniqueError } = await dataGateway.queryTable('purchase_returns', {
    select: '*',
    filters: [{ type: 'eq', column: 'id', value: id }],
    maybeSingle: true,
  });

  if (uniqueError) throw new Error(uniqueError.message);

  if (uniqueData) {
    // Fetch items for unique return
    const { data: itemsData } = await dataGateway.queryTable('purchase_return_items', {
      select: '*',
      filters: [{ type: 'eq', column: 'return_id', value: id }],
    });

    return mapUniqueReturnToDTO(uniqueData as any, (itemsData || []) as any);
  }

  return null;
}

// ===========================
// General Returns Only (for specific screens)
// ===========================

/**
 * List only general returns from invoices table
 * Used by screens that only show invoice-based returns
 */
export async function listGeneralReturns(
  filters: PurchaseReturnFilters = {}
): Promise<PurchaseReturnDTO[]> {
  const queryFilters: FilterOp[] = [
    { type: 'eq', column: 'invoice_type', value: 'purchase_return' },
  ];

  if (filters.branchId) {
    queryFilters.push({ type: 'eq', column: 'branch_id', value: filters.branchId });
  }
  if (filters.supplierId) {
    queryFilters.push({ type: 'eq', column: 'supplier_id', value: filters.supplierId });
  }
  if (filters.status) {
    queryFilters.push({ type: 'eq', column: 'status', value: filters.status });
  }
  if (filters.dateFrom) {
    queryFilters.push({ type: 'gte', column: 'invoice_date', value: filters.dateFrom });
  }
  if (filters.dateTo) {
    queryFilters.push({ type: 'lte', column: 'invoice_date', value: filters.dateTo });
  }

  const { data, error } = await dataGateway.queryTable('invoices', {
    select: '*',
    filters: queryFilters,
    order: { column: 'invoice_date', ascending: false },
  });
  if (error) throw new Error(error.message);

  let returns = (data || []).map((row: any) => mapGeneralReturnToDTO(row as any));

  // Apply search filter
  if (filters.searchQuery) {
    const q = filters.searchQuery.toLowerCase();
    returns = returns.filter(ret =>
      ret.returnNumber.toLowerCase().includes(q) ||
      ret.supplierName.toLowerCase().includes(q)
    );
  }

  return returns;
}

// ===========================
// Jewelry Items
// ===========================

/**
 * Get jewelry items for a specific invoice (non-paginated)
 */
export async function getInvoiceJewelryItems(
  invoiceId: string
): Promise<JewelryItemDTO[]> {
  const { data, error } = await dataGateway.queryTable('unique_items', {
    select: 'id, item_code, description, sale_status, g_weight, cost, branch_id, supplier_id, purchase_invoice_id, batch_id',
    filters: [{ type: 'eq', column: 'purchase_invoice_id', value: invoiceId }],
  });

  if (error) throw new Error(error.message);

  // Map to DTOs using actual column names
  return (data || []).map((row: any) => ({
    id: row.id,
    itemCode: row.item_code,
    description: row.description,
    status: 'available',
    saleStatus: row.sale_status ?? 'available',
    goldWeight: row.g_weight ?? 0,
    totalWeight: row.g_weight ?? 0,
    karatId: null,
    karatName: null,
    unitPrice: row.cost ?? 0,
    totalCost: row.cost ?? 0,
    branchId: row.branch_id,
    branchName: null,
    supplierId: row.supplier_id,
    supplierName: null,
    purchaseInvoiceId: row.purchase_invoice_id,
    batchId: row.batch_id,
  }));
}

// ===========================
// Paginated Jewelry Items for Invoice
// ===========================

export interface PaginatedJewelryItemsResult {
  items: InvoiceJewelryItemDTO[];
  total: number;
  pageSize: number;
  page: number;
}

export interface InvoiceJewelryItemDTO {
  id: string;
  itemCode: string;
  serialNo: string;
  suppInv: string;
  model: string | null;
  description: string | null;
  cost: number;
  gWeight: number;
  dWeight: number;
  saleStatus: string;
  createdAt: string;
}

/**
 * List paginated jewelry items for a specific invoice
 * Used by ImportedItemsTab
 */
export async function listInvoiceJewelryItems(
  invoiceId: string,
  page: number = 0,
  search?: string,
  pageSize: number = 50
): Promise<PaginatedJewelryItemsResult> {
  // First get total count
  const countFilters: FilterOp[] = [
    { type: 'eq', column: 'purchase_invoice_id', value: invoiceId },
  ];

  if (search) {
    countFilters.push({ type: 'or', value: `item_code.ilike.%${search}%,model.ilike.%${search}%` });
  }

  const { count, error: countError } = await dataGateway.queryTable('unique_items', {
    select: 'id',
    filters: countFilters,
    count: 'exact',
    head: true,
  });
  if (countError) throw new Error(countError.message);

  // Then get paginated items
  const itemFilters: FilterOp[] = [
    { type: 'eq', column: 'purchase_invoice_id', value: invoiceId },
  ];

  if (search) {
    itemFilters.push({ type: 'or', value: `item_code.ilike.%${search}%,model.ilike.%${search}%` });
  }

  const { data, error } = await dataGateway.queryTable('unique_items', {
    select: 'id, item_code, model, description, cost, g_weight, d_weight, sale_status, created_at',
    filters: itemFilters,
    order: { column: 'created_at', ascending: true },
    range: { from: page * pageSize, to: (page + 1) * pageSize - 1 },
  });
  if (error) throw new Error(error.message);

  return {
    items: (data || []).map((row: any) => ({
      id: row.id,
      itemCode: row.item_code,
      serialNo: row.serial_no || row.item_code || '',
      suppInv: '',
      model: row.model,
      description: row.description,
      cost: row.cost ?? 0,
      gWeight: row.g_weight ?? 0,
      dWeight: row.d_weight ?? 0,
      saleStatus: row.sale_status ?? 'available',
      createdAt: row.created_at,
    })),
    total: count || 0,
    pageSize,
    page,
  };
}

/**
 * List unique items for an import invoice from unique_items table
 */
export async function listUniqueInvoiceItems(
  invoiceId: string,
  page: number = 0,
  search?: string,
  pageSize: number = 50
): Promise<PaginatedJewelryItemsResult> {
  const params: Record<string, string> = {
    page: String(page),
    page_size: String(pageSize),
  };
  if (search) params.search = search;

  const result = await dataGateway.fetchUniqueInvoiceItems(invoiceId, params);
  const unwrapped = result.data;

  if (!unwrapped || !unwrapped.items) {
    return { items: [], total: 0, pageSize, page };
  }

  return {
    items: (unwrapped.items || []).map((row: any) => ({
      id: row.id,
      itemCode: row.stockcode || row.serial_no || '',
      serialNo: row.serial_no || '',
      suppInv: row.supp_inv || '',
      model: row.model,
      description: row.description,
      cost: Number(row.cost) || 0,
      gWeight: Number(row.g_weight) || 0,
      dWeight: Number(row.d_weight) || 0,
      saleStatus: row.status || (row.sale_id ? 'sold' : 'available'),
      createdAt: row.created_at,
    })),
    total: unwrapped.total || 0,
    pageSize,
    page,
  };
}

// ===========================
// Invoice for Actions (Print/PDF/Duplicate)
// ===========================

export interface InvoiceForActionsDTO {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  supplierId: string | null;
  supplierName: string;
  supplierEmail: string | null;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  lines: InvoiceActionLineDTO[];
}

export interface InvoiceActionLineDTO {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  itemType: string | null;
  productId: string | null;
  costEntryId: string | null;
  glAccountId: string | null;
  taxRate: number;
  taxAmount: number;
  discountAmount: number;
}

/**
 * Get minimal invoice data needed for print/PDF/duplicate actions
 */
export async function getInvoiceForActions(
  invoiceId: string
): Promise<InvoiceForActionsDTO | null> {
  // Fetch invoice header with relations
  const { data: invoiceData, error: invoiceError } = await dataGateway.fetchPurchasingInvoiceWithRelations(invoiceId);

  if (invoiceError) throw new Error(invoiceError.message);
  if (!invoiceData) return null;

  // Fetch invoice lines (actual DB columns: id, invoice_id, item_id, description, quantity, unit_price, total_price, line_number, branch_id, account_id, inventory_account_id, expense_account_id)
  const { data: linesData, error: linesError } = await dataGateway.queryTable('purchase_invoice_lines', {
    select: 'id, description, quantity, unit_price, total_price, item_id, account_id, inventory_account_id, expense_account_id, line_number, branch_id',
    filters: [{ type: 'eq', column: 'invoice_id', value: invoiceId }],
    order: { column: 'line_number', ascending: true },
  });

  if (linesError) throw new Error(linesError.message);

  const supplier = (invoiceData as any).supplier;

  return {
    id: invoiceData.id,
    invoiceNumber: invoiceData.invoice_number,
    invoiceDate: invoiceData.invoice_date,
    supplierId: invoiceData.supplier_id,
    supplierName: supplier?.supplier_name || '',
    supplierEmail: supplier?.email || null,
    totalAmount: invoiceData.total_amount ?? 0,
    paidAmount: invoiceData.paid_amount ?? 0,
    remainingAmount: invoiceData.remaining_amount ?? 0,
    lines: (linesData || []).map((line: any) => ({
      id: line.id,
      description: line.description || '',
      quantity: line.quantity ?? 1,
      unitPrice: line.unit_price ?? 0,
      totalAmount: line.total_price ?? 0,
      itemType: null,
      productId: line.item_id,
      costEntryId: null,
      glAccountId: line.account_id,
      taxRate: 0.15,
      taxAmount: 0,
      discountAmount: 0,
    })),
  };
}

// rebuildImportSummary moved to purchasingWriteService.ts (boundary violation fix)

// ===========================
// PO Receipts
// ===========================

/**
 * DTO for PO receipt display
 */
export interface POReceiptDTO {
  id: string;
  receiptNumber: string;
  itemType: string;
  quantityReceived: number;
  weightReceived: number;
  totalAmount: number;
  receivedBy: string | null;
  createdAt: string;
  notes: string | null;
}

/**
 * List purchase order receipts by poId
 */
export async function listPOReceipts(params: {
  poId: string;
}): Promise<POReceiptDTO[]> {
  const { data, error } = await dataGateway.queryTable('purchase_order_receipts', {
    select: '*',
    filters: [{ type: 'eq', column: 'po_id', value: params.poId }],
    order: { column: 'created_at', ascending: false },
  });

  if (error) throw new Error(error.message);

  return (data || []).map((row: any) => ({
    id: row.id,
    receiptNumber: row.receipt_number || '',
    itemType: row.item_type || '',
    quantityReceived: row.quantity_received ?? 0,
    weightReceived: row.weight_received ?? 0,
    totalAmount: row.total_amount ?? 0,
    receivedBy: row.received_by,
    createdAt: row.created_at,
    notes: row.notes,
  }));
}

// ===========================
// Reports Support
// ===========================

/**
 * Get purchase totals for a date range (for reports)
 */
export async function getPurchaseTotals(
  dateFrom: string,
  dateTo: string,
  branchId?: string
): Promise<{ totalPurchases: number; totalReturns: number; netPurchases: number }> {
  // Get purchases
  const purchaseFilters: FilterOp[] = [
    { type: 'eq', column: 'invoice_type', value: 'purchase' },
    { type: 'gte', column: 'invoice_date', value: dateFrom },
    { type: 'lte', column: 'invoice_date', value: dateTo },
  ];

  if (branchId && branchId !== 'all') {
    purchaseFilters.push({ type: 'eq', column: 'branch_id', value: branchId });
  }

  const { data: purchases } = await dataGateway.queryTable('invoices', {
    select: 'total_amount',
    filters: purchaseFilters,
  });

  // Get returns
  const returnFilters: FilterOp[] = [
    { type: 'eq', column: 'invoice_type', value: 'purchase_return' },
    { type: 'gte', column: 'invoice_date', value: dateFrom },
    { type: 'lte', column: 'invoice_date', value: dateTo },
  ];

  if (branchId && branchId !== 'all') {
    returnFilters.push({ type: 'eq', column: 'branch_id', value: branchId });
  }

  const { data: returns } = await dataGateway.queryTable('invoices', {
    select: 'total_amount',
    filters: returnFilters,
  });

  const totalPurchases = (purchases || []).reduce((sum: number, p: any) => sum + (p.total_amount || 0), 0);
  const totalReturns = (returns || []).reduce((sum: number, r: any) => sum + (r.total_amount || 0), 0);

  return {
    totalPurchases,
    totalReturns,
    netPurchases: totalPurchases - totalReturns,
  };
}

/**
 * Get supplier balances (for reports)
 */
export async function getSupplierPurchaseBalances(): Promise<{
  supplierId: string;
  totalPurchases: number;
  totalReturns: number;
}[]> {
  // Get purchase totals by supplier
  const { data: purchases } = await dataGateway.queryTable('invoices', {
    select: 'supplier_id, total_amount',
    filters: [
      { type: 'eq', column: 'invoice_type', value: 'purchase' },
      { type: 'neq', column: 'status', value: 'cancelled' },
    ],
  });

  // Get return totals by supplier
  const { data: returns } = await dataGateway.queryTable('invoices', {
    select: 'supplier_id, total_amount',
    filters: [
      { type: 'eq', column: 'invoice_type', value: 'purchase_return' },
      { type: 'neq', column: 'status', value: 'cancelled' },
    ],
  });

  // Aggregate by supplier
  const purchaseTotals: Record<string, number> = {};
  const returnTotals: Record<string, number> = {};

  (purchases || []).forEach((inv: any) => {
    if (inv.supplier_id) {
      purchaseTotals[inv.supplier_id] = (purchaseTotals[inv.supplier_id] || 0) + (inv.total_amount || 0);
    }
  });

  (returns || []).forEach((ret: any) => {
    if (ret.supplier_id) {
      returnTotals[ret.supplier_id] = (returnTotals[ret.supplier_id] || 0) + (ret.total_amount || 0);
    }
  });

  // Merge into array
  const allSupplierIds = new Set([...Object.keys(purchaseTotals), ...Object.keys(returnTotals)]);
  
  return Array.from(allSupplierIds).map(supplierId => ({
    supplierId,
    totalPurchases: purchaseTotals[supplierId] || 0,
    totalReturns: returnTotals[supplierId] || 0,
  }));
}

// ===========================
// Purchase Requisition DTOs & Functions
// ===========================

export interface PRFormDropdownsDTO {
  branches: Array<{ id: string; branchName: string }>;
  departments: Array<{ id: string; departmentName: string }>;
  suppliers: Array<{ id: string; supplierName: string }>;
  warehouses: Array<{ id: string; branchName: string }>;
  costCenters: Array<{ id: string; centerName: string; centerCode: string }>;
  jewelryItems: Array<{ id: string; itemCode: string; description: string | null }>;
}

export interface PRLineItemDTO {
  id?: string;
  itemDescription: string;
  itemCode: string;
  jewelryItemId: string;
  quantity: number;
  unit: string;
  estimatedUnitPrice: number;
  supplierId: string;
  warehouseId: string;
  costCenterId: string;
  notes: string;
}

export interface PREditDTO {
  id: string;
  requisitionNumber: string;
  branchId: string | null;
  departmentId: string | null;
  warehouseId: string | null;
  costCenterId: string | null;
  requiredDate: string | null;
  priority: string;
  requisitionType: string;
  justification: string | null;
  notes: string | null;
  status: string;
  currentApprovalLevel: number;
  requiredApprovalLevel: number;
  totalEstimatedAmount: number;
  items: PRLineItemDTO[];
}

/**
 * Get all dropdown data for PR Form
 */
export async function getPurchaseRequisitionFormData(): Promise<PRFormDropdownsDTO> {
  const [branchesRes, departmentsRes, suppliersRes, costCentersRes] = await Promise.all([
    dataGateway.queryTable('branches', {
      select: 'id, branch_name',
      filters: [{ type: 'eq', column: 'is_active', value: true }],
    }),
    dataGateway.queryTable('departments', {
      select: 'id, department_name',
      filters: [{ type: 'eq', column: 'is_active', value: true }],
    }),
    dataGateway.queryTable('suppliers', {
      select: 'id, supplier_name',
    }),
    dataGateway.queryTable('cost_centers', {
      select: 'id, center_name, center_code',
      filters: [{ type: 'eq', column: 'is_active', value: true }],
    }),
  ]);

  // Separate query for unique_items
  const jewelryRes = await dataGateway.queryTable('unique_items', {
    select: 'id, item_code, description',
    filters: [{ type: 'is', column: 'sold_at', value: null }],
    limit: 500,
  });

  return {
    branches: (branchesRes.data || []).map((b: any) => ({ id: b.id, branchName: b.branch_name })),
    departments: (departmentsRes.data || []).map((d: any) => ({ id: d.id, departmentName: d.department_name })),
    suppliers: (suppliersRes.data || []).map((s: any) => ({ id: s.id, supplierName: s.supplier_name })),
    warehouses: (branchesRes.data || []).map((w: any) => ({ id: w.id, branchName: w.branch_name })),
    costCenters: (costCentersRes.data || []).map((c: any) => ({ id: c.id, centerName: c.center_name, centerCode: c.center_code })),
    jewelryItems: (jewelryRes.data || []).map((j: any) => ({ id: j.id, itemCode: j.item_code, description: j.description })),
  };
}

/**
 * Get PR for edit mode
 */
export async function getPurchaseRequisitionForEdit(prId: string): Promise<PREditDTO | null> {
  const { data: pr, error } = await dataGateway.queryTable('purchase_requisitions', {
    select: '*',
    filters: [{ type: 'eq', column: 'id', value: prId }],
    single: true,
  });

  if (error || !pr) return null;

  const { data: items } = await dataGateway.queryTable('purchase_requisition_items', {
    select: '*',
    filters: [{ type: 'eq', column: 'requisition_id', value: prId }],
  });

  return {
    id: pr.id,
    requisitionNumber: pr.requisition_number,
    branchId: pr.branch_id,
    departmentId: pr.department_id,
    warehouseId: pr.warehouse_id,
    costCenterId: pr.cost_center_id,
    requiredDate: pr.required_date,
    priority: pr.priority || 'normal',
    requisitionType: pr.requisition_type || 'materials',
    justification: pr.justification,
    notes: pr.notes,
    status: pr.status,
    currentApprovalLevel: pr.current_approval_level || 0,
    requiredApprovalLevel: pr.required_approval_level || 1,
    totalEstimatedAmount: pr.total_estimated_amount || 0,
    items: (items || []).map((item: any) => ({
      id: item.id,
      itemDescription: item.item_description || '',
      itemCode: item.item_code || '',
      jewelryItemId: item.jewelry_item_id || '',
      quantity: item.quantity || 1,
      unit: item.unit || 'قطعة',
      estimatedUnitPrice: item.estimated_unit_price || 0,
      supplierId: item.supplier_id || '',
      warehouseId: item.warehouse_id || '',
      costCenterId: item.cost_center_id || '',
      notes: item.notes || '',
    })),
  };
}

// ===========================
// Purchase Requisition Approval DTO & Function
// ===========================

export interface PurchaseRequisitionApprovalDTO {
  id: string;
  requisitionNumber: string;
  status: string;
  totalEstimatedAmount: number;
  currentApprovalLevel: number;
  requiredApprovalLevel: number;
  justification: string | null;
  createdBy: string | null;
  departmentId: string | null;
  createdAt: string | null;
}

/**
 * Get PR data for approval dialog
 */
export async function getPurchaseRequisitionForApproval(prId: string): Promise<PurchaseRequisitionApprovalDTO | null> {
  const { data: pr, error } = await dataGateway.queryTable('purchase_requisitions', {
    select: 'id, requisition_number, status, total_estimated_amount, current_approval_level, required_approval_level, justification, requested_by, department_id, created_at',
    filters: [{ type: 'eq', column: 'id', value: prId }],
    maybeSingle: true,
  });

  if (error || !pr) return null;

  return {
    id: pr.id,
    requisitionNumber: pr.requisition_number,
    status: pr.status || 'draft',
    totalEstimatedAmount: pr.total_estimated_amount || 0,
    currentApprovalLevel: pr.current_approval_level || 0,
    requiredApprovalLevel: pr.required_approval_level || 1,
    justification: pr.justification,
    createdBy: pr.requested_by,
    departmentId: pr.department_id,
    createdAt: pr.created_at,
  };
}

// ===========================
// Import Payment DTOs & Functions
// ===========================

export interface ImportPaymentInvoiceDTO {
  id: string;
  invoiceNumber: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  supplierId: string | null;
}

export interface ImportPaymentExpenseDTO {
  expenseType: string;
  amount: number;
  localAmount: number;
}

export interface ImportPaymentDTO {
  id: string;
  paymentNumber: string;
  paymentDate: string;
  amount: number;
  currency: string;
  exchangeRate: number;
  localAmount: number;
  paymentMethod: string;
  documentNumber: string | null;
  notes: string | null;
  status: string;
  invoiceId: string | null;
  supplierId: string | null;
  createdAt: string;
  invoice: {
    invoiceNumber: string;
    totalAmount: number;
    paidAmount: number;
    remainingAmount: number;
    status: string;
    invoiceDate: string;
  } | null;
  supplier: {
    supplierName: string;
    supplierCode: string;
  } | null;
  expenses: ImportPaymentExpenseDTO[];
}

export interface ListImportPaymentsParams {
  supplierId?: string | null;
  invoiceId?: string | null;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
}

/**
 * List import payments with filters
 */
export async function listImportPayments(params: ListImportPaymentsParams = {}): Promise<ImportPaymentDTO[]> {
  const filters: FilterOp[] = [
    { type: 'eq', column: 'payment_type', value: 'payment' },
  ];

  if (params.supplierId) {
    filters.push({ type: 'eq', column: 'supplier_id', value: params.supplierId });
  }
  if (params.invoiceId) {
    filters.push({ type: 'eq', column: 'invoice_id', value: params.invoiceId });
  }
  if (params.dateFrom) {
    filters.push({ type: 'gte', column: 'payment_date', value: params.dateFrom });
  }
  if (params.dateTo) {
    filters.push({ type: 'lte', column: 'payment_date', value: params.dateTo });
  }

  const { data, error } = await dataGateway.queryTable('payments', {
    select: '*',
    filters,
    order: { column: 'payment_date', ascending: false },
  });
  if (error) throw new Error(error.message);

  // Fetch expenses for all payments
  const paymentIds = data?.map((p: any) => p.id) || [];
  let expenses: any[] = [];

  if (paymentIds.length > 0) {
    const { data: expensesData } = await dataGateway.queryTable('import_expenses', {
      select: '*',
      filters: [{ type: 'in', column: 'payment_id', value: paymentIds }],
    });
    expenses = expensesData || [];
  }

  // For each payment, fetch invoice and supplier data
  const invoiceIds = [...new Set((data || []).map((p: any) => p.invoice_id).filter(Boolean))];
  const supplierIds = [...new Set((data || []).map((p: any) => p.supplier_id).filter(Boolean))];

  let invoiceMap: Record<string, any> = {};
  let supplierMap: Record<string, any> = {};

  if (invoiceIds.length > 0) {
    const { data: invoicesData } = await dataGateway.queryTable('invoices', {
      select: 'id, invoice_number, total_amount, paid_amount, remaining_amount, status, invoice_date',
      filters: [{ type: 'in', column: 'id', value: invoiceIds }],
    });
    (invoicesData || []).forEach((inv: any) => { invoiceMap[inv.id] = inv; });
  }

  if (supplierIds.length > 0) {
    const { data: suppliersData } = await dataGateway.queryTable('suppliers', {
      select: 'id, supplier_name, supplier_code',
      filters: [{ type: 'in', column: 'id', value: supplierIds }],
    });
    (suppliersData || []).forEach((s: any) => { supplierMap[s.id] = s; });
  }

  // Map to DTO
  return (data || []).map((payment: any) => {
    const paymentExpenses = expenses.filter((e: any) => e.payment_id === payment.id);
    const inv = payment.invoice_id ? invoiceMap[payment.invoice_id] : null;
    const sup = payment.supplier_id ? supplierMap[payment.supplier_id] : null;
    return {
      id: payment.id,
      paymentNumber: payment.payment_number || '',
      paymentDate: payment.payment_date,
      amount: payment.amount || 0,
      currency: payment.currency || 'SAR',
      exchangeRate: payment.exchange_rate || 1,
      localAmount: (payment.amount || 0) * (payment.exchange_rate || 1),
      paymentMethod: payment.payment_method || '',
      documentNumber: payment.document_number,
      notes: payment.notes,
      status: payment.status || 'completed',
      invoiceId: payment.invoice_id,
      supplierId: payment.supplier_id,
      createdAt: payment.created_at,
      invoice: inv ? {
        invoiceNumber: inv.invoice_number || '',
        totalAmount: inv.total_amount || 0,
        paidAmount: inv.paid_amount || 0,
        remainingAmount: inv.remaining_amount || 0,
        status: inv.status || '',
        invoiceDate: inv.invoice_date || '',
      } : null,
      supplier: sup ? {
        supplierName: sup.supplier_name || '',
        supplierCode: sup.supplier_code || '',
      } : null,
      expenses: paymentExpenses.map((e: any) => ({
        expenseType: e.expense_type,
        amount: e.amount || 0,
        localAmount: e.local_amount || e.amount || 0,
      })),
    };
  });
}

/**
 * Get import payment by ID
 */
export async function getImportPaymentById(paymentId: string): Promise<ImportPaymentDTO | null> {
  const { data: payment, error } = await dataGateway.queryTable('payments', {
    select: '*',
    filters: [{ type: 'eq', column: 'id', value: paymentId }],
    maybeSingle: true,
  });

  if (error || !payment) return null;

  // Fetch invoice if linked
  let inv: any = null;
  if (payment.invoice_id) {
    const { data: invData } = await dataGateway.queryTable('invoices', {
      select: 'invoice_number, total_amount, paid_amount, remaining_amount, status, invoice_date',
      filters: [{ type: 'eq', column: 'id', value: payment.invoice_id }],
      single: true,
    });
    inv = invData;
  }

  // Fetch supplier if linked
  let sup: any = null;
  if (payment.supplier_id) {
    const { data: supData } = await dataGateway.queryTable('suppliers', {
      select: 'supplier_name, supplier_code',
      filters: [{ type: 'eq', column: 'id', value: payment.supplier_id }],
      single: true,
    });
    sup = supData;
  }

  // Fetch expenses
  const { data: expensesData } = await dataGateway.queryTable('import_expenses', {
    select: '*',
    filters: [{ type: 'eq', column: 'payment_id', value: paymentId }],
  });

  return {
    id: payment.id,
    paymentNumber: payment.payment_number || '',
    paymentDate: payment.payment_date,
    amount: payment.amount || 0,
    currency: payment.currency || 'SAR',
    exchangeRate: payment.exchange_rate || 1,
    localAmount: (payment.amount || 0) * (payment.exchange_rate || 1),
    paymentMethod: payment.payment_method || '',
    documentNumber: payment.document_number,
    notes: payment.notes,
    status: payment.status || 'completed',
    invoiceId: payment.invoice_id,
    supplierId: payment.supplier_id,
    createdAt: payment.created_at,
    invoice: inv ? {
      invoiceNumber: inv.invoice_number || '',
      totalAmount: inv.total_amount || 0,
      paidAmount: inv.paid_amount || 0,
      remainingAmount: inv.remaining_amount || 0,
      status: inv.status || '',
      invoiceDate: inv.invoice_date || '',
    } : null,
    supplier: sup ? {
      supplierName: sup.supplier_name || '',
      supplierCode: sup.supplier_code || '',
    } : null,
    expenses: (expensesData || []).map((e: any) => ({
      expenseType: e.expense_type,
      amount: e.amount || 0,
      localAmount: e.local_amount || e.amount || 0,
    })),
  };
}

/**
 * List purchase invoices for payment dropdown
 */
export async function listInvoicesForPayment(supplierId?: string | null): Promise<ImportPaymentInvoiceDTO[]> {
  const filters: FilterOp[] = [
    { type: 'eq', column: 'invoice_type', value: 'purchase' },
    { type: 'neq', column: 'status', value: 'cancelled' },
  ];

  if (supplierId) {
    filters.push({ type: 'eq', column: 'supplier_id', value: supplierId });
  }

  const { data, error } = await dataGateway.queryTable('invoices', {
    select: 'id, invoice_number, total_amount, paid_amount, remaining_amount, supplier_id',
    filters,
    order: { column: 'invoice_date', ascending: false },
  });
  if (error) throw new Error(error.message);

  return (data || []).map((inv: any) => ({
    id: inv.id,
    invoiceNumber: inv.invoice_number || '',
    totalAmount: inv.total_amount || 0,
    paidAmount: inv.paid_amount || 0,
    remainingAmount: inv.remaining_amount || 0,
    supplierId: inv.supplier_id,
  }));
}

// ===========================
// Purchase Orders Service
// ===========================

export interface PurchaseOrderDTO {
  id: string;
  poNumber: string;
  orderDate: string;
  expectedDeliveryDate: string | null;
  orderType: string;
  status: string;
  totalGoldWeight: number;
  totalAmount: number;
  supplierName: string | null;
  branchName: string | null;
}

// ===========================
// Purchase Order Detail DTOs
// ===========================

export interface PurchaseOrderDetailDTO {
  id: string;
  poNumber: string;
  orderDate: string;
  status: string;
  totalAmount: number;
  totalGoldWeight: number;
  paymentTerms: string | null;
  deliveryTerms: string | null;
  sentToSupplier: boolean;
  sentAt: string | null;
  supplierName: string | null;
  branchName: string | null;
}

export interface POItemDTO {
  id: string;
  itemType: string;
  description: string | null;
  quantity: number;
  weightGrams: number | null;
  unitPrice: number | null;
  totalPrice: number | null;
  receivedQuantity: number;
  receivedWeight: number;
  status: string;
  karatId: string | null;
  gemstoneTypeId: string | null;
  rawMaterialId: string | null;
  karatName: string | null;
  gemstoneTypeName: string | null;
}

export interface PODetailFormDropdownsDTO {
  karats: { id: string; karatName: string }[];
  gemstoneTypes: { id: string; typeName: string }[];
  rawMaterials: { id: string; materialName: string }[];
}

export interface PODetailDataDTO {
  po: PurchaseOrderDetailDTO;
  items: POItemDTO[];
  linkedPRsCount: number;
  dropdowns: PODetailFormDropdownsDTO;
}

/**
 * Get full Purchase Order detail for the detail page
 */
export async function getPurchaseOrderDetail(poId: string): Promise<PODetailDataDTO | null> {
  try {
    // Parallel fetch: PO header, items, linked PRs count, and dropdowns
    const [poRes, itemsRes, linkedPRsRes, karatsRes, gemstonesRes, rawMaterialsRes] = await Promise.all([
      dataGateway.queryTable('purchase_orders', {
        select: 'id, po_number, order_date, status, total_amount, total_gold_weight, payment_terms, delivery_terms, sent_to_supplier, sent_at, supplier_id, branch_id',
        filters: [{ type: 'eq', column: 'id', value: poId }],
        single: true,
      }),
      dataGateway.queryTable('purchase_order_items', {
        select: 'id, item_type, description, quantity, weight_grams, unit_price, total_price, received_quantity, received_weight, status, karat_id, gemstone_type_id, raw_material_id',
        filters: [{ type: 'eq', column: 'po_id', value: poId }],
        order: { column: 'created_at', ascending: true },
      }),
      dataGateway.queryTable('po_pr_links', {
        select: 'id',
        filters: [{ type: 'eq', column: 'po_id', value: poId }],
        count: 'exact',
        head: true,
      }),
      dataGateway.queryTable('gold_karats', {
        select: 'id, karat_name',
        filters: [{ type: 'eq', column: 'is_active', value: true }],
      }),
      dataGateway.queryTable('gemstone_types', {
        select: 'id, type_name',
        filters: [{ type: 'eq', column: 'is_active', value: true }],
      }),
      dataGateway.queryTable('raw_materials', {
        select: 'id, material_name',
        filters: [{ type: 'eq', column: 'is_active', value: true }],
      }),
    ]);

    if (poRes.error || !poRes.data) {
      console.error('getPurchaseOrderDetail PO error:', poRes.error);
      return null;
    }

    const poRow = poRes.data as any;

    // Fetch supplier and branch names separately
    let supplierName: string | null = null;
    let branchName: string | null = null;

    if (poRow.supplier_id) {
      const { data: supData } = await dataGateway.queryTable('suppliers', {
        select: 'supplier_name',
        filters: [{ type: 'eq', column: 'id', value: poRow.supplier_id }],
        single: true,
      });
      supplierName = supData?.supplier_name || null;
    }

    if (poRow.branch_id) {
      const { data: brData } = await dataGateway.queryTable('branches', {
        select: 'branch_name',
        filters: [{ type: 'eq', column: 'id', value: poRow.branch_id }],
        single: true,
      });
      branchName = brData?.branch_name || null;
    }

    // Fetch karat and gemstone names for items
    const karatIds = [...new Set((itemsRes.data || []).map((r: any) => r.karat_id).filter(Boolean))];
    const gemstoneIds = [...new Set((itemsRes.data || []).map((r: any) => r.gemstone_type_id).filter(Boolean))];
    let karatMap: Record<string, string> = {};
    let gemstoneMap: Record<string, string> = {};

    if (karatIds.length > 0) {
      const { data: kData } = await dataGateway.queryTable('gold_karats', {
        select: 'id, karat_name',
        filters: [{ type: 'in', column: 'id', value: karatIds }],
      });
      (kData || []).forEach((k: any) => { karatMap[k.id] = k.karat_name; });
    }

    if (gemstoneIds.length > 0) {
      const { data: gData } = await dataGateway.queryTable('gemstone_types', {
        select: 'id, type_name',
        filters: [{ type: 'in', column: 'id', value: gemstoneIds }],
      });
      (gData || []).forEach((g: any) => { gemstoneMap[g.id] = g.type_name; });
    }

    const po: PurchaseOrderDetailDTO = {
      id: poRow.id,
      poNumber: poRow.po_number || '',
      orderDate: poRow.order_date || '',
      status: poRow.status || 'draft',
      totalAmount: poRow.total_amount || 0,
      totalGoldWeight: poRow.total_gold_weight || 0,
      paymentTerms: poRow.payment_terms,
      deliveryTerms: poRow.delivery_terms,
      sentToSupplier: poRow.sent_to_supplier ?? false,
      sentAt: poRow.sent_at,
      supplierName,
      branchName,
    };

    const items: POItemDTO[] = (itemsRes.data || []).map((row: any) => ({
      id: row.id,
      itemType: row.item_type || '',
      description: row.description,
      quantity: row.quantity || 0,
      weightGrams: row.weight_grams,
      unitPrice: row.unit_price,
      totalPrice: row.total_price,
      receivedQuantity: row.received_quantity || 0,
      receivedWeight: row.received_weight || 0,
      status: row.status || 'pending',
      karatId: row.karat_id,
      gemstoneTypeId: row.gemstone_type_id,
      rawMaterialId: row.raw_material_id,
      karatName: row.karat_id ? karatMap[row.karat_id] || null : null,
      gemstoneTypeName: row.gemstone_type_id ? gemstoneMap[row.gemstone_type_id] || null : null,
    }));

    const dropdowns: PODetailFormDropdownsDTO = {
      karats: (karatsRes.data || []).map((k: any) => ({ id: k.id, karatName: k.karat_name })),
      gemstoneTypes: (gemstonesRes.data || []).map((g: any) => ({ id: g.id, typeName: g.type_name })),
      rawMaterials: (rawMaterialsRes.data || []).map((r: any) => ({ id: r.id, materialName: r.material_name })),
    };

    return {
      po,
      items,
      linkedPRsCount: linkedPRsRes.count || 0,
      dropdowns,
    };
  } catch (err) {
    console.error('getPurchaseOrderDetail error:', err);
    return null;
  }
}

export interface PurchaseOrderFilters {
  status?: string;
}

export interface POFormDropdownsDTO {
  suppliers: SupplierSelectDTO[];
  branches: BranchSelectDTO[];
}

/**
 * List purchase orders with optional filters
 */
export async function listPurchaseOrders(params?: PurchaseOrderFilters): Promise<PurchaseOrderDTO[]> {
  const filters: FilterOp[] = [];

  if (params?.status && params.status !== 'all') {
    filters.push({ type: 'eq', column: 'status', value: params.status });
  }

  const { data, error } = await dataGateway.queryTable('purchase_orders', {
    select: 'id, po_number, order_date, expected_delivery_date, order_type, status, total_gold_weight, total_amount, supplier_id, branch_id',
    filters,
    order: { column: 'created_at', ascending: false },
  });
  if (error) throw new Error(error.message);

  // Fetch supplier and branch names
  const supplierIds = [...new Set((data || []).map((po: any) => po.supplier_id).filter(Boolean))];
  const branchIds = [...new Set((data || []).map((po: any) => po.branch_id).filter(Boolean))];

  let supplierMap: Record<string, string> = {};
  let branchMap: Record<string, string> = {};

  if (supplierIds.length > 0) {
    const { data: supData } = await dataGateway.queryTable('suppliers', {
      select: 'id, supplier_name',
      filters: [{ type: 'in', column: 'id', value: supplierIds }],
    });
    (supData || []).forEach((s: any) => { supplierMap[s.id] = s.supplier_name; });
  }

  if (branchIds.length > 0) {
    const { data: brData } = await dataGateway.queryTable('branches', {
      select: 'id, branch_name',
      filters: [{ type: 'in', column: 'id', value: branchIds }],
    });
    (brData || []).forEach((b: any) => { branchMap[b.id] = b.branch_name; });
  }

  return (data || []).map((po: any) => ({
    id: po.id,
    poNumber: po.po_number || '',
    orderDate: po.order_date || '',
    expectedDeliveryDate: po.expected_delivery_date,
    orderType: po.order_type || '',
    status: po.status || '',
    totalGoldWeight: po.total_gold_weight || 0,
    totalAmount: po.total_amount || 0,
    supplierName: po.supplier_id ? supplierMap[po.supplier_id] || null : null,
    branchName: po.branch_id ? branchMap[po.branch_id] || null : null,
  }));
}

/**
 * Get dropdown data for PO create form
 */
export async function getPurchaseOrderForCreateForm(): Promise<POFormDropdownsDTO> {
  const [suppliersRes, branchesRes] = await Promise.all([
    dataGateway.queryTable('suppliers', {
      select: 'id, supplier_name, supplier_code, phone, email, vat_number, address',
    }),
    dataGateway.queryTable('branches', {
      select: 'id, branch_name, branch_code, branch_type, is_active',
      filters: [{ type: 'eq', column: 'is_active', value: true }],
    }),
  ]);

  if (suppliersRes.error) throw new Error(suppliersRes.error.message);
  if (branchesRes.error) throw new Error(branchesRes.error.message);

  return {
    suppliers: (suppliersRes.data || []).map((s: any) => ({
      id: s.id,
      supplierName: s.supplier_name || '',
      supplierRef: s.supplier_code || '',
      phone: s.phone,
      email: s.email,
      vatNumber: s.vat_number,
      address: s.address,
    })),
    branches: (branchesRes.data || []).map((b: any) => ({
      id: b.id,
      branchName: b.branch_name || '',
      branchCode: b.branch_code || '',
      branchType: b.branch_type || '',
      isActive: b.is_active ?? true,
    })),
  };
}

// ===========================
// PO Receive Page DTOs
// ===========================

export interface POForReceiveDTO {
  id: string;
  poNumber: string;
  supplierId: string | null;
  supplierName: string | null;
  branchId: string | null;
  branchName: string | null;
  defaultWarehouseId: string | null;
  status: string;
}

export interface POItemForReceiveDTO {
  id: string;
  itemType: string;
  description: string | null;
  quantity: number;
  weightGrams: number | null;
  unitPrice: number | null;
  receivedQuantity: number;
  receivedWeight: number;
  karatId: string | null;
  karatName: string | null;
  gemstoneTypeId: string | null;
  gemstoneTypeName: string | null;
  warehouseId: string | null;
}

export interface GoldVaultSelectDTO {
  id: string;
  vaultName: string;
}

export interface POReceiveDataDTO {
  po: POForReceiveDTO;
  items: POItemForReceiveDTO[];
  goldVaults: GoldVaultSelectDTO[];
}

/**
 * Get PO data for receive page (header + items + gold vaults)
 */
export async function getPOForReceive(poId: string): Promise<POReceiveDataDTO | null> {
  try {
    // Fetch PO header
    const { data: poRow, error: poError } = await dataGateway.queryTable('purchase_orders', {
      select: 'id, po_number, supplier_id, branch_id, warehouse_id, status',
      filters: [{ type: 'eq', column: 'id', value: poId }],
      single: true,
    });

    if (poError || !poRow) {
      console.error('getPOForReceive PO error:', poError);
      return null;
    }

    // Fetch supplier and branch names
    let supplierName: string | null = null;
    let branchName: string | null = null;

    if (poRow.supplier_id) {
      const { data: supData } = await dataGateway.queryTable('suppliers', {
        select: 'id, supplier_name',
        filters: [{ type: 'eq', column: 'id', value: poRow.supplier_id }],
        single: true,
      });
      supplierName = supData?.supplier_name || null;
    }

    if (poRow.branch_id) {
      const { data: brData } = await dataGateway.queryTable('branches', {
        select: 'id, branch_name',
        filters: [{ type: 'eq', column: 'id', value: poRow.branch_id }],
        single: true,
      });
      branchName = brData?.branch_name || null;
    }

    const po: POForReceiveDTO = {
      id: poRow.id,
      poNumber: poRow.po_number,
      supplierId: poRow.supplier_id,
      supplierName,
      branchId: poRow.branch_id,
      branchName,
      defaultWarehouseId: poRow.warehouse_id,
      status: poRow.status || '',
    };

    // Fetch PO items (not fully received)
    const { data: itemRows, error: itemsError } = await dataGateway.queryTable('purchase_order_items', {
      select: 'id, item_type, description, quantity, weight_grams, unit_price, received_quantity, received_weight, karat_id, gemstone_type_id, warehouse_id',
      filters: [
        { type: 'eq', column: 'po_id', value: poId },
        { type: 'neq', column: 'status', value: 'received' },
      ],
      order: { column: 'created_at', ascending: true },
    });

    if (itemsError) {
      console.error('getPOForReceive items error:', itemsError);
    }

    // Fetch karat and gemstone names for items
    const karatIds = [...new Set((itemRows || []).map((r: any) => r.karat_id).filter(Boolean))];
    const gemstoneIds = [...new Set((itemRows || []).map((r: any) => r.gemstone_type_id).filter(Boolean))];
    let karatMap: Record<string, string> = {};
    let gemstoneMap: Record<string, string> = {};

    if (karatIds.length > 0) {
      const { data: kData } = await dataGateway.queryTable('gold_karats', {
        select: 'id, karat_name',
        filters: [{ type: 'in', column: 'id', value: karatIds }],
      });
      (kData || []).forEach((k: any) => { karatMap[k.id] = k.karat_name; });
    }

    if (gemstoneIds.length > 0) {
      const { data: gData } = await dataGateway.queryTable('gemstone_types', {
        select: 'id, type_name',
        filters: [{ type: 'in', column: 'id', value: gemstoneIds }],
      });
      (gData || []).forEach((g: any) => { gemstoneMap[g.id] = g.type_name; });
    }

    const items: POItemForReceiveDTO[] = (itemRows || []).map((row: any) => ({
      id: row.id,
      itemType: row.item_type || '',
      description: row.description,
      quantity: row.quantity || 0,
      weightGrams: row.weight_grams,
      unitPrice: row.unit_price,
      receivedQuantity: row.received_quantity || 0,
      receivedWeight: row.received_weight || 0,
      karatId: row.karat_id,
      karatName: row.karat_id ? karatMap[row.karat_id] || null : null,
      gemstoneTypeId: row.gemstone_type_id,
      gemstoneTypeName: row.gemstone_type_id ? gemstoneMap[row.gemstone_type_id] || null : null,
      warehouseId: row.warehouse_id,
    }));

    // Fetch gold vaults for branch
    let goldVaults: GoldVaultSelectDTO[] = [];
    if (po.branchId) {
      const { data: vaultRows } = await dataGateway.queryTable('gold_vaults', {
        select: 'id, vault_name',
        filters: [
          { type: 'eq', column: 'is_active', value: true },
          { type: 'eq', column: 'branch_id', value: po.branchId },
        ],
      });

      goldVaults = (vaultRows || []).map((v: any) => ({
        id: v.id,
        vaultName: v.vault_name,
      }));
    }

    return { po, items, goldVaults };
  } catch (err) {
    console.error('getPOForReceive error:', err);
    return null;
  }
}

// ===========================
// Payment Vouchers DTOs
// ===========================

export interface PaymentVoucherRowDTO {
  id: string;
  paymentNumber: string;
  paymentType: string;
  paymentDate: string;
  amount: number;
  paymentMethod: string;
  notes: string | null;
  invoiceId: string | null;
  supplierId: string | null;
  journalEntryId: string | null;
  createdAt: string;
  supplierName: string | null;
  invoiceNumber: string | null;
  invoiceTotalAmount: number | null;
  invoicePaidAmount: number | null;
  invoiceRemainingAmount: number | null;
  invoiceStatus: string | null;
}

export interface SupplierDropdownDTO {
  id: string;
  supplierName: string;
}

export interface UnpaidPurchaseInvoiceDTO {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: string;
}

export interface PaymentAccountSettingsDTO {
  cashAccountId: string | null;
  bankTransferAccountId: string | null;
  checkAccountId: string | null;
  cardAccountId: string | null;
  isComplete: boolean;
}

export interface CompanySettingsForPrintDTO {
  companyName: string;
  companyNameEn: string | null;
  logoUrl: string | null;
  commercialRegistration: string | null;
  taxNumber: string | null;
  address: string | null;
  addressEn: string | null;
  city: string | null;
  cityEn: string | null;
  country: string | null;
  countryEn: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  postalCode: string | null;
}

export interface JournalEntryLineDTO {
  id: string;
  accountCode: string;
  accountName: string;
  debitAmount: number;
  creditAmount: number;
  description: string | null;
}

export interface JournalEntryPreviewDTO {
  id: string;
  entryNumber: string;
  entryDate: string;
  description: string | null;
  totalDebit: number;
  totalCredit: number;
  lines: JournalEntryLineDTO[];
}

// ===========================
// Payment Vouchers Read Functions
// ===========================

export interface ListPaymentVouchersParams {
  supplierId?: string;
  fromDate?: string;
  toDate?: string;
  search?: string;
}

export async function listPaymentVouchers(
  params?: ListPaymentVouchersParams
): Promise<PaymentVoucherRowDTO[]> {
  try {
    const filters: FilterOp[] = [
      { type: 'eq', column: 'payment_type', value: 'payment' },
    ];

    if (params?.supplierId) {
      filters.push({ type: 'eq', column: 'supplier_id', value: params.supplierId });
    }
    if (params?.fromDate) {
      filters.push({ type: 'gte', column: 'payment_date', value: params.fromDate });
    }
    if (params?.toDate) {
      filters.push({ type: 'lte', column: 'payment_date', value: params.toDate });
    }

    const { data, error } = await dataGateway.queryTable('payments', {
      select: '*',
      filters,
      order: { column: 'created_at', ascending: false },
    });
    if (error) {
      console.error('listPaymentVouchers error:', error);
      return [];
    }

    // Fetch supplier and invoice data
    const supplierIds = [...new Set((data || []).map((r: any) => r.supplier_id).filter(Boolean))];
    const invoiceIds = [...new Set((data || []).map((r: any) => r.invoice_id).filter(Boolean))];

    let supplierMap: Record<string, any> = {};
    let invoiceMap: Record<string, any> = {};

    if (supplierIds.length > 0) {
      const { data: supData } = await dataGateway.queryTable('suppliers', {
        select: 'id, supplier_name',
        filters: [{ type: 'in', column: 'id', value: supplierIds }],
      });
      (supData || []).forEach((s: any) => { supplierMap[s.id] = s; });
    }

    if (invoiceIds.length > 0) {
      const { data: invData } = await dataGateway.queryTable('invoices', {
        select: 'id, invoice_number, total_amount, paid_amount, remaining_amount, status',
        filters: [{ type: 'in', column: 'id', value: invoiceIds }],
      });
      (invData || []).forEach((inv: any) => { invoiceMap[inv.id] = inv; });
    }

    return (data || []).map((row: any) => {
      const sup = row.supplier_id ? supplierMap[row.supplier_id] : null;
      const inv = row.invoice_id ? invoiceMap[row.invoice_id] : null;
      return {
        id: row.id,
        paymentNumber: row.payment_number,
        paymentType: row.payment_type,
        paymentDate: row.payment_date,
        amount: Number(row.amount) || 0,
        paymentMethod: row.payment_method,
        notes: row.notes,
        invoiceId: row.invoice_id,
        supplierId: row.supplier_id,
        journalEntryId: row.journal_entry_id,
        createdAt: row.created_at,
        supplierName: sup?.supplier_name || null,
        invoiceNumber: inv?.invoice_number || null,
        invoiceTotalAmount: inv?.total_amount != null ? Number(inv.total_amount) : null,
        invoicePaidAmount: inv?.paid_amount != null ? Number(inv.paid_amount) : null,
        invoiceRemainingAmount: inv?.remaining_amount != null ? Number(inv.remaining_amount) : null,
        invoiceStatus: inv?.status || null,
      };
    });
  } catch (err) {
    console.error('listPaymentVouchers exception:', err);
    return [];
  }
}

export async function listSuppliersForPaymentVouchers(): Promise<SupplierDropdownDTO[]> {
  try {
    const { data, error } = await dataGateway.queryTable('suppliers', {
      select: 'id, supplier_name',
      order: { column: 'supplier_name', ascending: true },
    });

    if (error) {
      console.error('listSuppliersForPaymentVouchers error:', error);
      return [];
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      supplierName: row.supplier_name,
    }));
  } catch (err) {
    console.error('listSuppliersForPaymentVouchers exception:', err);
    return [];
  }
}

export async function getPaymentAccountSettingsCheck(): Promise<PaymentAccountSettingsDTO | null> {
  try {
    const { data, error } = await dataGateway.queryTable('payment_account_settings', {
      select: '*',
      filters: [{ type: 'is', column: 'branch_id', value: null }],
      maybeSingle: true,
    });

    if (error) {
      console.error('getPaymentAccountSettingsCheck error:', error);
      return null;
    }

    if (!data) return null;

    return {
      cashAccountId: data.cash_account_id,
      bankTransferAccountId: data.bank_transfer_account_id,
      checkAccountId: data.check_account_id,
      cardAccountId: data.card_account_id,
      isComplete: !!(
        data.cash_account_id &&
        data.bank_transfer_account_id &&
        data.check_account_id &&
        data.card_account_id
      ),
    };
  } catch (err) {
    console.error('getPaymentAccountSettingsCheck exception:', err);
    return null;
  }
}

export async function getCompanySettingsForVoucherPrint(): Promise<CompanySettingsForPrintDTO | null> {
  try {
    const { data, error } = await dataGateway.queryTable('app_settings', {
      select: 'key, value',
    });

    if (error) {
      console.error('getCompanySettingsForVoucherPrint error:', error);
      return null;
    }

    if (!data || data.length === 0) return null;

    const settings: Record<string, string> = {};
    (data as any[]).forEach((row: any) => { settings[row.key] = row.value; });

    return {
      companyName: settings['company_name'] || 'متجر المجوهرات',
      companyNameEn: settings['company_name_en'] || null,
      logoUrl: settings['logo_url'] || null,
      commercialRegistration: settings['commercial_registration'] || null,
      taxNumber: settings['tax_number'] || null,
      address: settings['address'] || null,
      addressEn: settings['address_en'] || null,
      city: settings['city'] || null,
      cityEn: settings['city_en'] || null,
      country: settings['country'] || null,
      countryEn: settings['country_en'] || null,
      phone: settings['phone'] || null,
      email: settings['email'] || null,
      website: settings['website'] || null,
      postalCode: settings['postal_code'] || null,
    };
  } catch (err) {
    console.error('getCompanySettingsForVoucherPrint exception:', err);
    return null;
  }
}

export async function listUnpaidPurchaseInvoicesBySupplier(
  supplierId: string
): Promise<UnpaidPurchaseInvoiceDTO[]> {
  if (!supplierId) return [];

  try {
    // A. Fetch from general invoices table
    const { data, error } = await dataGateway.queryTable('invoices', {
      select: 'id, invoice_number, invoice_date, total_amount, paid_amount, remaining_amount, status',
      filters: [
        { type: 'eq', column: 'invoice_type', value: 'purchase' },
        { type: 'eq', column: 'supplier_id', value: supplierId },
        { type: 'in', column: 'status', value: ['pending', 'partially_paid', 'posted', 'partial'] },
      ],
      order: { column: 'invoice_date', ascending: false },
    });

    if (error) {
      console.error('listUnpaidPurchaseInvoicesBySupplier error (invoices):', error);
    }

    // B. Fetch from unique_purchase_invoices (UINV) table
    const { data: uinvData, error: uinvError } = await dataGateway.queryTable('unique_purchase_invoices', {
      select: 'id, invoice_number, invoice_date, total_amount, paid_amount, remaining_amount, status',
      filters: [
        { type: 'eq', column: 'supplier_id', value: supplierId },
        { type: 'in', column: 'status', value: ['pending', 'partially_paid', 'posted', 'partial'] },
      ],
      order: { column: 'invoice_date', ascending: false },
    });

    if (uinvError) {
      console.error('listUnpaidPurchaseInvoicesBySupplier error (unique_purchase_invoices):', uinvError);
    }

    const allInvoices = [...(data || []), ...(uinvData || [])];

    // Fetch payments for these invoices to calculate actual paid
    const invoiceIds = allInvoices.map((inv: any) => inv.id);
    let paymentsMap: Record<string, number> = {};

    if (invoiceIds.length > 0) {
      const { data: paymentsData } = await dataGateway.queryTable('payments', {
        select: 'invoice_id, amount',
        filters: [{ type: 'in', column: 'invoice_id', value: invoiceIds }],
      });
      (paymentsData || []).forEach((p: any) => {
        if (p.invoice_id) {
          paymentsMap[p.invoice_id] = (paymentsMap[p.invoice_id] || 0) + (p.amount || 0);
        }
      });
    }

    return allInvoices
      .map((inv: any) => {
        const actualPaid = paymentsMap[inv.id] || inv.paid_amount || 0;
        const calculatedRemaining = inv.remaining_amount != null
          ? Number(inv.remaining_amount)
          : inv.total_amount - actualPaid;
        return {
          id: inv.id,
          invoiceNumber: inv.invoice_number,
          invoiceDate: inv.invoice_date,
          totalAmount: inv.total_amount,
          paidAmount: actualPaid,
          remainingAmount: calculatedRemaining,
          status: inv.status,
        };
      })
      .filter((inv: UnpaidPurchaseInvoiceDTO) => inv.remainingAmount > 0)
      .sort((a, b) => new Date(b.invoiceDate).getTime() - new Date(a.invoiceDate).getTime());
  } catch (err) {
    console.error('listUnpaidPurchaseInvoicesBySupplier exception:', err);
    return [];
  }
}

export async function getPaymentVoucherJournalEntryPreview(
  journalEntryId: string
): Promise<JournalEntryPreviewDTO | null> {
  if (!journalEntryId) return null;

  try {
    const { data: je, error } = await dataGateway.queryTable('journal_entries', {
      select: 'id, entry_number, entry_date, description, total_debit, total_credit',
      filters: [{ type: 'eq', column: 'id', value: journalEntryId }],
      single: true,
    });

    if (error || !je) {
      console.error('getPaymentVoucherJournalEntryPreview error:', error);
      return null;
    }

    // Fetch journal entry lines
    const { data: linesData } = await dataGateway.queryTable('journal_entry_lines', {
      select: 'id, debit_amount, credit_amount, description, account_id',
      filters: [{ type: 'eq', column: 'journal_entry_id', value: journalEntryId }],
    });

    // Fetch account details for lines
    const accountIds = [...new Set((linesData || []).map((l: any) => l.account_id).filter(Boolean))];
    let accountMap: Record<string, any> = {};

    if (accountIds.length > 0) {
      const { data: accData } = await dataGateway.queryTable('chart_of_accounts', {
        select: 'id, account_code, account_name',
        filters: [{ type: 'in', column: 'id', value: accountIds }],
      });
      (accData || []).forEach((a: any) => { accountMap[a.id] = a; });
    }

    return {
      id: je.id,
      entryNumber: je.entry_number,
      entryDate: je.entry_date,
      description: je.description,
      totalDebit: je.total_debit,
      totalCredit: je.total_credit,
      lines: (linesData || []).map((line: any) => {
        const account = line.account_id ? accountMap[line.account_id] : null;
        return {
          id: line.id,
          accountCode: account?.account_code || '',
          accountName: account?.account_name || '',
          debitAmount: line.debit_amount,
          creditAmount: line.credit_amount,
          description: line.description,
        };
      }),
    };
  } catch (err) {
    console.error('getPaymentVoucherJournalEntryPreview exception:', err);
    return null;
  }
}

// =========================================================================
// Convert PR to PO - Read APIs
// =========================================================================

import type { PRForConvertDTO, PRItemForConvertDTO } from './commands';

/**
 * Fetches purchase requisitions for conversion to PO
 */
export async function getPurchaseRequisitionsForConvert(prIds: string[]): Promise<PRForConvertDTO[]> {
  if (!prIds.length) return [];
  
  const { data, error } = await dataGateway.queryTable('purchase_requisitions', {
    select: 'id, requisition_number, status, branch_id, requested_by, created_at, notes',
    filters: [{ type: 'in', column: 'id', value: prIds }],
  });

  if (error) {
    console.error('getPurchaseRequisitionsForConvert error:', error);
    return [];
  }

  // Fetch branch names
  const branchIds = [...new Set((data || []).map((pr: any) => pr.branch_id).filter(Boolean))];
  let branchMap: Record<string, string> = {};

  if (branchIds.length > 0) {
    const { data: brData } = await dataGateway.queryTable('branches', {
      select: 'id, branch_name',
      filters: [{ type: 'in', column: 'id', value: branchIds }],
    });
    (brData || []).forEach((b: any) => { branchMap[b.id] = b.branch_name; });
  }

  // Fetch user names for requested_by
  const userIds = [...new Set((data || []).map((pr: any) => pr.requested_by).filter(Boolean))] as string[];
  let userMap: Record<string, string> = {};
  
  if (userIds.length > 0) {
    const { data: profiles } = await dataGateway.queryTable('profiles', {
      select: 'id, full_name',
      filters: [{ type: 'in', column: 'id', value: userIds }],
    });
    
    userMap = (profiles || []).reduce((acc: Record<string, string>, p: any) => {
      acc[p.id] = p.full_name || '';
      return acc;
    }, {} as Record<string, string>);
  }

  return (data || []).map((pr: any) => ({
    id: pr.id,
    prNumber: pr.requisition_number,
    status: pr.status,
    branchId: pr.branch_id,
    branchName: pr.branch_id ? branchMap[pr.branch_id] || '' : '',
    requestedBy: pr.requested_by,
    requestedByName: pr.requested_by ? userMap[pr.requested_by] || null : null,
    createdAt: pr.created_at,
    notes: pr.notes,
  }));
}

/**
 * Fetches purchase requisition items for conversion to PO
 */
export async function getPRItemsForConvert(prIds: string[]): Promise<PRItemForConvertDTO[]> {
  if (!prIds.length) return [];

  const { data, error } = await dataGateway.queryTable('purchase_requisition_items', {
    select: 'id, requisition_id, jewelry_item_id, item_code, item_description, quantity, converted_quantity, estimated_unit_price, notes',
    filters: [{ type: 'in', column: 'requisition_id', value: prIds }],
  });

  if (error) {
    console.error('getPRItemsForConvert error:', error);
    return [];
  }

  return (data || []).map((item: any) => ({
    id: item.id,
    requisitionId: item.requisition_id,
    productId: item.jewelry_item_id,
    productCode: item.item_code || null,
    productName: null, // Not available directly, item_description serves as name
    description: item.item_description,
    quantity: item.quantity,
    convertedQuantity: item.converted_quantity || 0,
    remainingQuantity: item.quantity - (item.converted_quantity || 0),
    estimatedPrice: item.estimated_unit_price,
    notes: item.notes,
  }));
}

/**
 * Wrapper for listBranchesForSelect - already exists, re-export for convenience
 * If listBranchesForSelect doesn't exist with the same signature, use this
 */
export async function listBranchesDropdown(): Promise<BranchSelectDTO[]> {
  return listBranchesForSelect();
}

/**
 * Gets user profile name by user ID
 */
export async function getUserProfileName(userId: string): Promise<{ fullName: string } | null> {
  if (!userId) return null;

  const { data, error } = await dataGateway.queryTable('profiles', {
    select: 'full_name',
    filters: [{ type: 'eq', column: 'id', value: userId }],
    maybeSingle: true,
  });

  if (error || !data) {
    console.error('getUserProfileName error:', error);
    return null;
  }

  return { fullName: data.full_name || '' };
}
