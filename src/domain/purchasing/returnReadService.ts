/**
 * Purchase Return Read Service
 * Specialized read functions for return creation and viewing screens
 * This is the ONLY source for return screen data - no direct database queries in UI
 */

import * as dataGateway from '@/lib/dataGateway';
import type {
  InvoiceForUniqueReturnDTO,
  JewelryItemForReturnDTO,
  InvoiceForGeneralReturnDTO,
  InvoiceLineForReturnDTO,
} from './dto/returnScreenDTOs';
import type { PurchaseReturnDTO, PurchaseReturnFilters } from './dto';
import { mapGeneralReturnToDTO, mapUniqueReturnToDTO } from './mappers';

// Excel/Import purchase returns are VAT-exempt (0%)
// Regular purchase invoices handle their own VAT from invoice lines

// ===========================
// Unique Return (Jewelry)
// ===========================

/**
 * Get invoice data with jewelry items for unique return screen
 * Includes returnability check for each item
 */
export async function getInvoiceForUniqueReturn(
  invoiceId: string
): Promise<InvoiceForUniqueReturnDTO | null> {
  // Unique returns are exclusively for unique_purchase_invoices (UINV)
  const { data: uinvInvoice, error: uinvError } = await dataGateway.queryTable('unique_purchase_invoices', {
    select: 'id, invoice_number, invoice_date, supplier_id, branch_id, batch_id',
    filters: [{ type: 'eq', column: 'id', value: invoiceId }],
    maybeSingle: true
  });

  if (uinvError) throw uinvError;
  if (!uinvInvoice) return null;

  const invoice = uinvInvoice as { id: string; invoice_number: string; invoice_date: string; supplier_id: string; branch_id: string; batch_id: string | null };

  // 1c. Fetch supplier and branch names
  let supplierName = '';
  let branchName = '';
  if (invoice.supplier_id) {
    const { data: supplier } = await dataGateway.queryTable('suppliers', {
      select: 'supplier_name',
      filters: [{ type: 'eq', column: 'id', value: invoice.supplier_id }],
      maybeSingle: true
    });
    supplierName = (supplier as any)?.supplier_name || '';
  }
  if (invoice.branch_id) {
    const { data: branch } = await dataGateway.queryTable('branches', {
      select: 'branch_name',
      filters: [{ type: 'eq', column: 'id', value: invoice.branch_id }],
      maybeSingle: true
    });
    branchName = (branch as any)?.branch_name || '';
  }

  // 2. Fetch unique items linked to this invoice via batch_id
  const { data: jewelryItems, error: jewelryError } = await dataGateway.queryTable('unique_items', {
    select: 'id, serial_no, description, model, g_weight, cost, sold_at, branch_id, status',
    filters: invoice.batch_id
      ? [{ type: 'eq', column: 'batch_id', value: invoice.batch_id }]
      : [{ type: 'eq', column: 'purchase_invoice_id', value: invoiceId }]
  });

  if (jewelryError) throw jewelryError;

  // 3. Check which items have already been returned
  const itemIds = (jewelryItems || []).map(item => item.id);
  
  let returnedItemIds: Set<string> = new Set();
  if (itemIds.length > 0) {
    const { data: returnedItems } = await dataGateway.queryTable('unique_purchase_return_items', {
      select: 'unique_item_id',
      filters: [{ type: 'in', column: 'unique_item_id', value: itemIds }]
    });
    
    returnedItemIds = new Set((returnedItems || []).map((r: any) => r.unique_item_id).filter(Boolean));
  }

  // 4. Map jewelry items with returnability status
  const mappedItems: JewelryItemForReturnDTO[] = (jewelryItems || []).map((item: any) => {
    const unitPrice = item.cost || 0;
    // Excel/Import returns are VAT-exempt
    const taxAmount = 0;
    const totalAmount = unitPrice;
    
    // Determine returnability
    let isReturnable = true;
    let returnBlockReason: JewelryItemForReturnDTO['returnBlockReason'] = null;
    
    // Check if sold
    if (item.sold_at) {
      isReturnable = false;
      returnBlockReason = 'SOLD';
    }
    // Check if already returned (via return items table or status field)
    else if (returnedItemIds.has(item.id) || item.status === 'returned_to_supplier') {
      isReturnable = false;
      returnBlockReason = 'ALREADY_RETURNED';
    }
    // Check if in different branch (optional - may still allow return)
    else if (item.branch_id !== invoice.branch_id) {
      isReturnable = false;
      returnBlockReason = 'NOT_IN_BRANCH';
    }

    return {
      id: item.id,
      itemCode: item.serial_no,
      description: item.description,
      model: item.model,
      goldWeight: parseFloat(item.g_weight) || 0,
      totalWeight: parseFloat(item.g_weight) || 0,
      karatId: null,
      karatName: null,
      unitPrice,
      taxRate: 0, // Excel/Import returns are VAT-exempt
      taxAmount,
      totalAmount,
      isReturnable,
      returnBlockReason,
    };
  });

  return {
    id: invoice.id,
    invoiceNumber: invoice.invoice_number,
    invoiceDate: invoice.invoice_date,
    supplierId: invoice.supplier_id || null,
    supplierName,
    branchId: invoice.branch_id || null,
    branchName,
    batchId: invoice.batch_id,
    jewelryItems: mappedItems,
  };
}

// ===========================
// General Return (Qty-based)
// ===========================

/**
 * Get invoice data with lines for general return screen
 * Calculates available quantity for each line
 */
export async function getInvoiceForGeneralReturn(
  invoiceId: string
): Promise<InvoiceForGeneralReturnDTO | null> {
  // 1. Fetch invoice header
  const { data: invoice, error: invoiceError } = await dataGateway.queryTable('invoices', {
    select: `
      id,
      invoice_number,
      invoice_date,
      supplier_id,
      branch_id,
      suppliers(supplier_name),
      branches(branch_name)
    `,
    filters: [
      { type: 'eq', column: 'id', value: invoiceId },
      { type: 'eq', column: 'invoice_type', value: 'purchase' }
    ],
    maybeSingle: true
  });

  if (invoiceError) throw invoiceError;
  if (!invoice) return null;

  // 2. Fetch invoice lines (excluding jewelry/import_summary lines)
  const { data: lines, error: linesError } = await dataGateway.queryTable('purchase_invoice_lines', {
    select: '*',
    filters: [
      { type: 'eq', column: 'invoice_id', value: invoiceId },
      { type: 'in', column: 'item_type', value: ['product', 'cost', 'service'] },
      { type: 'neq', column: 'line_kind', value: 'import_summary' }
    ],
    order: { column: 'line_number', ascending: true }
  });

  if (linesError) throw linesError;

  // 3. Map lines with availability calculation
  const mappedLines: InvoiceLineForReturnDTO[] = (lines || []).map((line: any) => {
    const originalQty = line.quantity || 0;
    const returnedQty = line.returned_qty || 0;
    const availableQty = Math.max(0, originalQty - returnedQty);
    
    return {
      id: line.id,
      lineNumber: line.line_number,
      itemType: line.item_type as 'product' | 'cost' | 'service',
      productId: line.product_id,
      costEntryId: line.cost_entry_id,
      productCode: line.product_code || line.manual_item_code || '',
      description: line.description || '',
      originalQty,
      returnedQty,
      availableQty,
      unitPrice: line.unit_price || 0,
      taxRate: 0, // Excel/Import returns are VAT-exempt
      isReturnable: availableQty > 0,
    };
  });

  return {
    id: invoice.id,
    invoiceNumber: invoice.invoice_number,
    invoiceDate: invoice.invoice_date,
    supplierId: invoice.supplier_id || null,
    supplierName: (invoice.suppliers as any)?.supplier_name || '',
    branchId: invoice.branch_id || null,
    branchName: (invoice.branches as any)?.branch_name || '',
    lines: mappedLines,
  };
}

// ===========================
// Helpers
// ===========================

/**
 * Calculate totals from selected jewelry items
 */
export function calculateUniqueReturnTotals(items: JewelryItemForReturnDTO[]): {
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  itemCount: number;
} {
  const subtotal = items.reduce((sum, item) => sum + item.unitPrice, 0);
  const taxAmount = items.reduce((sum, item) => sum + item.taxAmount, 0);
  const totalAmount = subtotal + taxAmount;
  
  return {
    subtotal,
    taxAmount,
    totalAmount,
    itemCount: items.length,
  };
}

/**
 * Calculate totals from return quantities
 */
export function calculateGeneralReturnTotals(
  lines: InvoiceLineForReturnDTO[],
  returnQuantities: Record<string, number>
): {
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  lineCount: number;
} {
  let subtotal = 0;
  let taxAmount = 0;
  let lineCount = 0;

  lines.forEach(line => {
    const returnQty = returnQuantities[line.id] || 0;
    if (returnQty > 0) {
      const lineSubtotal = returnQty * line.unitPrice;
      const lineTax = lineSubtotal * line.taxRate;
      subtotal += lineSubtotal;
      taxAmount += lineTax;
      lineCount++;
    }
  });

  return {
    subtotal,
    taxAmount,
    totalAmount: subtotal + taxAmount,
    lineCount,
  };
}

// ===========================
// Unified List & View (P3.3)
// ===========================

/**
 * List all purchase returns - merges general (invoices) and unique (purchase_returns)
 * Returns unified array sorted by date desc with returnType discriminator
 */
export async function listPurchaseReturnsUnified(
  filters: PurchaseReturnFilters = {}
): Promise<PurchaseReturnDTO[]> {
  // Build filters array
  const filterOps = [];
  
  if (filters.branchId) {
    filterOps.push({ type: 'eq', column: 'branch_id', value: filters.branchId });
  }
  if (filters.supplierId) {
    filterOps.push({ type: 'eq', column: 'supplier_id', value: filters.supplierId });
  }
  if (filters.status) {
    filterOps.push({ type: 'eq', column: 'status', value: filters.status });
  }
  if (filters.dateFrom) {
    filterOps.push({ type: 'gte', column: 'return_date', value: filters.dateFrom });
  }
  if (filters.dateTo) {
    filterOps.push({ type: 'lte', column: 'return_date', value: filters.dateTo });
  }

  // Fetch ALL returns from canonical purchase_returns table
  const { data, error } = await dataGateway.queryTable('purchase_returns', {
    select: `
      *,
      suppliers(supplier_name),
      branches(branch_name),
      invoices:purchase_invoice_id(invoice_number)
    `,
    filters: filterOps.length > 0 ? filterOps : undefined,
    order: { column: 'return_date', ascending: false }
  });
  
  if (error) throw error;

  // Map to DTOs with correct return type based on purchase_type
  const allReturns: PurchaseReturnDTO[] = (data || []).map((row: any) => {
    const isUnique = row.purchase_type === 'import';
    return isUnique ? mapUniqueReturnToDTO(row) : mapGeneralReturnToDTO(row);
  });

  // Apply search filter if provided
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
 * Get a single purchase return by ID - from canonical purchase_returns table
 * Returns full DTO with lines (general) or items (unique)
 */
export async function getPurchaseReturnByIdUnified(
  id: string
): Promise<PurchaseReturnDTO | null> {
  // Query from canonical purchase_returns table
  const { data, error } = await dataGateway.queryTable('purchase_returns', {
    select: `
      *,
      suppliers(supplier_name),
      branches(branch_name),
      invoices:purchase_invoice_id(invoice_number)
    `,
    filters: [{ type: 'eq', column: 'id', value: id }],
    maybeSingle: true
  });

  if (error) throw error;
  if (!data) return null;

  const isUnique = data.purchase_type === 'import';

  if (isUnique) {
    // Fetch items for unique return with jewelry_items join
    const { data: itemsData } = await dataGateway.queryTable('purchase_return_items', {
      select: `
        *,
        jewelry_items(item_code, description)
      `,
      filters: [{ type: 'eq', column: 'return_id', value: id }]
    });

    return mapUniqueReturnToDTO(data as any, (itemsData || []) as any);
  } else {
    // Fetch lines for general return from canonical purchase_return_lines
    const { data: linesData } = await dataGateway.queryTable('purchase_return_lines', {
      select: '*',
      filters: [{ type: 'eq', column: 'return_id', value: id }],
      order: { column: 'line_number', ascending: true }
    });

    return mapGeneralReturnToDTO(data as any, linesData as any);
  }
}
