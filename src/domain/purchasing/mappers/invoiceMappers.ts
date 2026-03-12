/**
 * Invoice Mappers - Transform raw database rows to DTOs
 * All numeric nullables are normalized to 0
 */

import type { PurchaseInvoiceDTO, PurchaseInvoiceLineDTO } from '../dto';

// ===========================
// Type Definitions for Raw Rows
// ===========================

interface RawInvoiceRow {
  id: string;
  invoice_number: string;
  supplier_invoice_no: string | null;
  invoice_date: string;
  due_date: string | null;
  invoice_type: string;
  purchase_type: string | null;
  supplier_id: string | null;
  branch_id: string | null;
  subtotal: number | null;
  discount_amount: number | null;
  tax_amount: number | null;
  total_amount: number | null;
  paid_amount: number | null;
  remaining_amount: number | null;
  status: string | null;
  notes: string | null;
  linked_invoice_id: string | null;
  journal_entry_id: string | null;
  batch_id: string | null;
  created_at: string;
  updated_at: string;
  supplier_name?: string | null;
  supplier_code?: string | null;
  supplier_vat?: string | null;
  branch_name?: string | null;
  branch_code?: string | null;
  supplier?: {
    supplier_name: string;
    email?: string | null;
    phone?: string | null;
    vat_number?: string | null;
    address?: string | null;
  } | null;
  branch?: {
    branch_name: string;
  } | null;
}

interface RawInvoiceLineRow {
  id: string;
  invoice_id: string;
  line_number: number | null;
  item_type: string | null;
  line_kind: string | null;
  product_id: string | null;
  cost_entry_id: string | null;
  product_code: string | null;
  description: string | null;
  quantity: number | null;
  returned_qty: number | null;
  unit_price: number | null;
  is_inclusive: boolean | null;
  discount_amount: number | null;
  subtotal: number | null;
  tax_rate: number | null;
  tax_amount: number | null;
  // Handle both field names (vat_amount is alias)
  vat_amount?: number | null;
  total_amount: number | null;
  // Handle both field names (total_with_vat is alias)
  total_with_vat?: number | null;
  gl_account_id: string | null;
  warehouse_account_id: string | null;
}

// ===========================
// Mapper Functions
// ===========================

/**
 * Normalize nullable number to 0
 */
function n(value: number | null | undefined): number {
  return value ?? 0;
}

/**
 * Normalize status with default
 */
function normalizeInvoiceStatus(status: string | null): PurchaseInvoiceDTO['status'] {
  const validStatuses = ['pending', 'partial', 'paid', 'cancelled', 'posted', 'draft', 'voided', 'returned', 'partially_returned'];
  if (status && validStatuses.includes(status)) {
    return status as PurchaseInvoiceDTO['status'];
  }
  return 'pending';
}

/**
 * Normalize purchase type with default
 */
function normalizePurchaseType(type: string | null): 'general' | 'import' {
  return type === 'import' ? 'import' : 'general';
}

/**
 * Normalize item type with default
 */
function normalizeItemType(type: string | null): PurchaseInvoiceLineDTO['itemType'] {
  const validTypes = ['jewelry', 'product', 'cost', 'service'];
  if (type && validTypes.includes(type)) {
    return type as PurchaseInvoiceLineDTO['itemType'];
  }
  return 'jewelry';
}

/**
 * Map raw invoice row to DTO
 */
export function mapInvoiceRowToDTO(
  row: RawInvoiceRow,
  lines?: RawInvoiceLineRow[]
): PurchaseInvoiceDTO {
  const mappedLines = lines?.map(mapInvoiceLineRowToDTO);
  const hasImportedItems = mappedLines?.some(l => l.lineKind === 'import_summary') ?? false;
  
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    supplierInvoiceNo: row.supplier_invoice_no,  // NEW: Map supplier invoice no
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    invoiceType: row.invoice_type === 'purchase_return' ? 'purchase_return' : 'purchase',
    purchaseType: normalizePurchaseType(row.purchase_type),
    
    // Party (flat columns from JOIN, fallback to nested format)
    supplierId: row.supplier_id,
    supplierName: row.supplier_name ?? row.supplier?.supplier_name ?? '',
    supplierEmail: row.supplier?.email ?? null,
    supplierPhone: row.supplier?.phone ?? null,
    supplierVatNumber: row.supplier_vat ?? row.supplier?.vat_number ?? null,
    supplierAddress: row.supplier?.address ?? null,
    
    // Branch (flat columns from JOIN, fallback to nested format)
    branchId: row.branch_id,
    branchName: row.branch_name ?? row.branch?.branch_name ?? '',
    
    // Totals (normalized)
    subtotal: n(row.subtotal),
    discountAmount: n(row.discount_amount),
    taxAmount: n(row.tax_amount),
    totalAmount: n(row.total_amount),
    paidAmount: n(row.paid_amount),
    remainingAmount: n(row.remaining_amount),
    
    // Status
    status: normalizeInvoiceStatus(row.status),
    
    // Metadata
    notes: row.notes,
    linkedInvoiceId: row.linked_invoice_id,
    journalEntryId: row.journal_entry_id,
    batchId: row.batch_id,
    
    // Computed
    hasImportedItems,
    
    // Lines
    lines: mappedLines,
    
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Map raw invoice line row to DTO
 * Normalizes duplicate VAT fields (tax_amount vs vat_amount, total_amount vs total_with_vat)
 */
export function mapInvoiceLineRowToDTO(row: RawInvoiceLineRow): PurchaseInvoiceLineDTO {
  const quantity = n(row.quantity);
  const returnedQty = n(row.returned_qty);
  
  // Normalize duplicate fields - prefer tax_amount/total_amount, fallback to vat equivalents
  const taxAmount = n(row.tax_amount ?? row.vat_amount);
  const totalAmount = n(row.total_amount ?? row.total_with_vat);
  
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    lineNumber: n(row.line_number),
    
    // Item identification
    itemType: normalizeItemType(row.item_type),
    lineKind: row.line_kind,
    productId: row.product_id,
    costEntryId: row.cost_entry_id,
    productCode: row.product_code ?? '',
    description: row.description ?? '',
    
    // Quantities (normalized)
    quantity,
    returnedQty,
    remainingQty: Math.max(0, quantity - returnedQty),
    
    // Pricing (normalized)
    unitPrice: n(row.unit_price),
    isInclusive: row.is_inclusive ?? false,
    discountAmount: n(row.discount_amount),
    subtotal: n(row.subtotal),
    taxRate: n(row.tax_rate),
    taxAmount,
    totalAmount,
    
    // Accounting
    glAccountId: row.gl_account_id,
    warehouseAccountId: row.warehouse_account_id,
  };
}

/**
 * Map array of raw invoice rows to DTOs
 */
export function mapInvoiceRowsToDTO(rows: RawInvoiceRow[]): PurchaseInvoiceDTO[] {
  return rows.map(row => mapInvoiceRowToDTO(row));
}
