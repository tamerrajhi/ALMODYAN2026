/**
 * DTO-first Read Layer for Purchasing Domain
 * All numeric nullable fields are normalized to 0 in mappers
 */

// ===========================
// Purchase Invoice DTOs
// ===========================

export interface PurchaseInvoiceDTO {
  id: string;
  invoiceNumber: string;
  supplierInvoiceNo: string | null;  // NEW: Supplier Invoice Number
  invoiceDate: string;
  dueDate: string | null;
  invoiceType: 'purchase' | 'purchase_return';
  purchaseType: 'general' | 'import';
  
  // Party
  supplierId: string | null;
  supplierName: string;
  supplierEmail: string | null;
  supplierPhone: string | null;
  supplierVatNumber: string | null;
  supplierAddress: string | null;
  
  // Branch
  branchId: string | null;
  branchName: string;
  
  // Totals (normalized - never null)
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  
  // Status
  status: 'pending' | 'partial' | 'paid' | 'cancelled' | 'posted' | 'draft' | 'voided' | 'returned' | 'partially_returned';
  
  // Metadata
  notes: string | null;
  linkedInvoiceId: string | null;
  journalEntryId: string | null;
  batchId: string | null;
  uploadedFileName: string | null;
  
  // Computed
  hasImportedItems: boolean;
  
  // Lines (optional, loaded separately or eagerly)
  lines?: PurchaseInvoiceLineDTO[];
  
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseInvoiceLineDTO {
  id: string;
  invoiceId: string;
  lineNumber: number;
  uniqueItemId?: string | null;
  
  // Item identification
  itemType: 'jewelry' | 'product' | 'cost' | 'service';
  lineKind: string | null;
  productId: string | null;
  costEntryId: string | null;
  productCode: string;
  description: string;
  
  // Quantities (normalized - never null)
  quantity: number;
  returnedQty: number;
  remainingQty: number;
  
  // Pricing (normalized - never null)
  unitPrice: number;
  isInclusive: boolean;
  discountAmount: number;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
  
  // Accounting
  glAccountId: string | null;
  warehouseAccountId: string | null;
}

// ===========================
// Purchase Return DTOs
// ===========================

export type PurchaseReturnType = 'general' | 'unique';

export interface PurchaseReturnDTO {
  id: string;
  returnNumber: string;
  returnDate: string;
  returnType: PurchaseReturnType;
  
  // Party
  supplierId: string | null;
  supplierName: string;
  
  // Branch
  branchId: string | null;
  branchName: string;
  
  // Linked Invoice
  linkedInvoiceId: string | null;
  linkedInvoiceNumber: string | null;
  
  // Totals (normalized - never null)
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  
  // Status
  status: 'pending' | 'approved' | 'completed' | 'cancelled';
  
  // Metadata
  reason: string | null;
  notes: string | null;
  journalEntryId: string | null;
  
  // Lines (polymorphic based on returnType)
  lines: PurchaseReturnLineDTO[];
  items: PurchaseReturnItemDTO[];
  
  createdAt: string;
}

/**
 * General return line (product/cost returns from purchase_return_lines or invoice lines)
 */
export interface PurchaseReturnLineDTO {
  id: string;
  returnId: string;
  lineNumber: number;
  
  // Item identification
  itemType: 'product' | 'cost' | 'service';
  productCode: string;
  description: string;
  
  // Original invoice link
  invoiceLineId: string | null;
  
  // Quantities (normalized - never null)
  quantity: number;
  
  // Pricing (normalized - never null)
  unitPrice: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
}

/**
 * Unique return item (jewelry returns from purchase_return_items)
 */
export interface PurchaseReturnItemDTO {
  id: string;
  returnId: string;
  
  // Jewelry item link
  jewelryItemId: string;
  itemCode: string;
  description: string;
  
  // Pricing (normalized - never null)
  unitPrice: number;
  taxAmount: number;
  totalAmount: number;
  
  // Weight (normalized - never null)
  goldWeight: number;
  karatId: string | null;
}

// ===========================
// Jewelry Item DTO (minimal for read)
// ===========================

export interface JewelryItemDTO {
  id: string;
  itemCode: string;
  description: string | null;
  
  // Status
  status: string;
  saleStatus: string;
  
  // Gold details (normalized - never null)
  goldWeight: number;
  totalWeight: number;
  karatId: string | null;
  karatName: string | null;
  
  // Pricing (normalized - never null)
  unitPrice: number;
  totalCost: number;
  
  // Location
  branchId: string | null;
  branchName: string | null;
  
  // Relations
  supplierId: string | null;
  supplierName: string | null;
  purchaseInvoiceId: string | null;
  batchId: string | null;
}

// ===========================
// Filter DTOs
// ===========================

export interface PurchaseInvoiceFilters {
  branchId?: string;
  supplierId?: string;
  status?: 'pending' | 'partial' | 'paid' | 'cancelled';
  purchaseType?: 'general' | 'import';
  dateFrom?: string;
  dateTo?: string;
  searchQuery?: string;
}

export interface PurchaseReturnFilters {
  branchId?: string;
  supplierId?: string;
  status?: 'pending' | 'approved' | 'completed' | 'cancelled';
  dateFrom?: string;
  dateTo?: string;
  searchQuery?: string;
}
