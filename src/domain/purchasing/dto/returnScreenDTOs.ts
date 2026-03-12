/**
 * DTOs specifically for Purchase Return Screens
 * These are optimized for the return creation UI
 */

// ===========================
// Unique Return Screen DTOs
// ===========================

/**
 * Invoice data for unique (jewelry) return screen
 */
export interface InvoiceForUniqueReturnDTO {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  supplierId: string;
  supplierName: string;
  branchId: string;
  branchName: string;
  batchId: string | null;
  
  // Linked jewelry items eligible for return
  jewelryItems: JewelryItemForReturnDTO[];
}

/**
 * Jewelry item with returnability status
 */
export interface JewelryItemForReturnDTO {
  id: string;
  itemCode: string;
  description: string | null;
  model: string | null;
  
  // Weight
  goldWeight: number;
  totalWeight: number;
  karatId: string | null;
  karatName: string | null;
  
  // Pricing
  unitPrice: number;     // Original purchase cost
  taxRate: number;       // 0.15
  taxAmount: number;     // Calculated
  totalAmount: number;   // unitPrice + taxAmount
  
  // Status checks
  isReturnable: boolean;
  returnBlockReason: 'SOLD' | 'ALREADY_RETURNED' | 'NOT_IN_BRANCH' | null;
}

// ===========================
// General Return Screen DTOs
// ===========================

/**
 * Invoice data for general (qty-based) return screen
 */
export interface InvoiceForGeneralReturnDTO {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  supplierId: string;
  supplierName: string;
  branchId: string;
  branchName: string;
  
  // Lines with availability
  lines: InvoiceLineForReturnDTO[];
}

/**
 * Invoice line with return availability
 */
export interface InvoiceLineForReturnDTO {
  id: string;
  lineNumber: number;
  
  // Item
  itemType: 'product' | 'cost' | 'service';
  productId: string | null;
  costEntryId: string | null;
  productCode: string;
  description: string;
  
  // Quantities
  originalQty: number;
  returnedQty: number;
  availableQty: number;  // originalQty - returnedQty
  
  // Pricing (per unit)
  unitPrice: number;
  taxRate: number;
  
  // Returnable check
  isReturnable: boolean;  // availableQty > 0
}

// ===========================
// Return Reasons
// ===========================

export const RETURN_REASONS = [
  { value: 'defective', labelAr: 'عيب في المنتج', labelEn: 'Defective Product' },
  { value: 'wrong_item', labelAr: 'منتج خاطئ', labelEn: 'Wrong Item' },
  { value: 'quality_issue', labelAr: 'مشكلة جودة', labelEn: 'Quality Issue' },
  { value: 'excess_quantity', labelAr: 'كمية زائدة', labelEn: 'Excess Quantity' },
  { value: 'price_dispute', labelAr: 'خلاف سعري', labelEn: 'Price Dispute' },
  { value: 'other', labelAr: 'أخرى', labelEn: 'Other' },
] as const;

export type ReturnReasonValue = typeof RETURN_REASONS[number]['value'];
