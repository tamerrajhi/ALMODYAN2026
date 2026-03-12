/**
 * Return Mappers - Transform raw database rows to DTOs
 * Handles both general returns (invoices table) and unique returns (purchase_returns table)
 */

import type { 
  PurchaseReturnDTO, 
  PurchaseReturnLineDTO, 
  PurchaseReturnItemDTO,
  PurchaseReturnType 
} from '../dto';

// ===========================
// Type Definitions for Raw Rows
// ===========================

/**
 * General return row from canonical purchase_returns table (purchase_type='general')
 */
interface RawGeneralReturnRow {
  id: string;
  return_number: string;
  return_date: string;
  supplier_id: string | null;
  branch_id: string | null;
  subtotal: number | null;
  tax_amount: number | null;
  total_amount: number | null;
  status: string | null;
  reason: string | null;
  notes: string | null;
  purchase_invoice_id: string | null;
  journal_entry_id: string | null;
  created_at: string;
  suppliers?: {
    supplier_name: string;
  } | null;
  branches?: {
    branch_name: string;
  } | null;
  invoices?: {
    invoice_number: string;
  } | null;
}

/**
 * General return line from canonical purchase_return_lines table
 */
interface RawGeneralReturnLineRow {
  id: string;
  return_id: string;
  invoice_id?: string | null;
  invoice_line_id?: string | null;
  line_number: number | null;
  item_id?: string | null;
  item_type: string | null;
  description: string | null;
  quantity: number | null;
  unit_cost: number | null;
  vat_rate: number | null;
  tax_amount: number | null;
  line_total: number | null;
}

/**
 * Unique return row from purchase_returns table
 */
interface RawUniqueReturnRow {
  id: string;
  return_number: string;
  return_date: string;
  supplier_id: string | null;
  branch_id: string | null;
  subtotal: number | null;
  tax_amount: number | null;
  total_amount: number | null;
  status: string | null;
  reason: string | null;
  notes: string | null;
  journal_entry_id: string | null;
  purchase_invoice_id: string | null;
  created_at: string;
  suppliers?: {
    supplier_name: string;
  } | null;
  branches?: {
    branch_name: string;
  } | null;
  invoices?: {
    invoice_number: string;
  } | null;
}

/**
 * Unique return item from purchase_return_items table
 */
interface RawUniqueReturnItemRow {
  id: string;
  purchase_return_id: string;
  jewelry_item_id: string;
  unit_price: number | null;
  tax_amount: number | null;
  total_amount: number | null;
  gold_weight: number | null;
  karat_id: string | null;
  jewelry_items?: {
    item_code: string;
    description: string | null;
  } | null;
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
 * Normalize return status with default
 */
function normalizeReturnStatus(status: string | null): PurchaseReturnDTO['status'] {
  const validStatuses = ['pending', 'approved', 'completed', 'cancelled'];
  if (status && validStatuses.includes(status)) {
    return status as PurchaseReturnDTO['status'];
  }
  return 'pending';
}

/**
 * Normalize item type for return lines
 */
function normalizeReturnLineItemType(type: string | null): PurchaseReturnLineDTO['itemType'] {
  const validTypes = ['product', 'cost', 'service'];
  if (type && validTypes.includes(type)) {
    return type as PurchaseReturnLineDTO['itemType'];
  }
  return 'product';
}

/**
 * Map general return row (from canonical purchase_returns table) to DTO
 */
export function mapGeneralReturnToDTO(
  row: RawGeneralReturnRow,
  lines: RawGeneralReturnLineRow[] = []
): PurchaseReturnDTO {
  return {
    id: row.id,
    returnNumber: row.return_number,
    returnDate: row.return_date,
    returnType: 'general' as PurchaseReturnType,
    
    // Party
    supplierId: row.supplier_id,
    supplierName: row.suppliers?.supplier_name ?? '',
    
    // Branch
    branchId: row.branch_id,
    branchName: row.branches?.branch_name ?? '',
    
    // Linked Invoice
    linkedInvoiceId: row.purchase_invoice_id,
    linkedInvoiceNumber: row.invoices?.invoice_number ?? null,
    
    // Totals (normalized)
    subtotal: n(row.subtotal),
    taxAmount: n(row.tax_amount),
    totalAmount: n(row.total_amount),
    
    // Status
    status: normalizeReturnStatus(row.status),
    
    // Metadata
    reason: row.reason ?? null,
    notes: row.notes,
    journalEntryId: row.journal_entry_id,
    
    // Lines (general returns use lines, not items)
    lines: lines.map(mapGeneralReturnLineToDTO),
    items: [], // No unique items for general returns
    
    createdAt: row.created_at,
  };
}

/**
 * Map general return line to DTO (from canonical purchase_return_lines)
 */
export function mapGeneralReturnLineToDTO(row: RawGeneralReturnLineRow): PurchaseReturnLineDTO {
  return {
    id: row.id,
    returnId: row.return_id ?? '',
    lineNumber: n(row.line_number),
    
    // Item identification
    itemType: normalizeReturnLineItemType(row.item_type),
    productCode: '', // General lines don't have product_code in canonical table
    description: row.description ?? '',
    
    // Original invoice link
    invoiceLineId: row.invoice_line_id ?? null,
    
    // Quantities (normalized)
    quantity: n(row.quantity),
    
    // Pricing (normalized)
    unitPrice: n(row.unit_cost),
    taxRate: n(row.vat_rate),
    taxAmount: n(row.tax_amount),
    totalAmount: n(row.line_total),
  };
}

/**
 * Map unique return row (from purchase_returns table) to DTO
 */
export function mapUniqueReturnToDTO(
  row: RawUniqueReturnRow,
  items: RawUniqueReturnItemRow[] = []
): PurchaseReturnDTO {
  return {
    id: row.id,
    returnNumber: row.return_number,
    returnDate: row.return_date,
    returnType: 'unique' as PurchaseReturnType,
    
    // Party
    supplierId: row.supplier_id,
    supplierName: row.suppliers?.supplier_name ?? '',
    
    // Branch
    branchId: row.branch_id,
    branchName: row.branches?.branch_name ?? '',
    
    // Linked Invoice
    linkedInvoiceId: row.purchase_invoice_id,
    linkedInvoiceNumber: row.invoices?.invoice_number ?? null,
    
    // Totals (normalized)
    subtotal: n(row.subtotal),
    taxAmount: n(row.tax_amount),
    totalAmount: n(row.total_amount),
    
    // Status
    status: normalizeReturnStatus(row.status),
    
    // Metadata
    reason: row.reason,
    notes: row.notes,
    journalEntryId: row.journal_entry_id,
    
    // Items (unique returns use items, not lines)
    lines: [], // No general lines for unique returns
    items: items.map(mapUniqueReturnItemToDTO),
    
    createdAt: row.created_at,
  };
}

/**
 * Map unique return item to DTO
 */
export function mapUniqueReturnItemToDTO(row: RawUniqueReturnItemRow): PurchaseReturnItemDTO {
  return {
    id: row.id,
    returnId: row.purchase_return_id,
    
    // Jewelry item link
    jewelryItemId: row.jewelry_item_id,
    itemCode: row.jewelry_items?.item_code ?? '',
    description: row.jewelry_items?.description ?? '',
    
    // Pricing (normalized)
    unitPrice: n(row.unit_price),
    taxAmount: n(row.tax_amount),
    totalAmount: n(row.total_amount),
    
    // Weight (normalized)
    goldWeight: n(row.gold_weight),
    karatId: row.karat_id,
  };
}
