// Document Types for unified invoice/return handling
export type DocumentType = 
  | 'PURCHASE_INVOICE' 
  | 'PURCHASE_RETURN' 
  | 'SALES_INVOICE' 
  | 'SALES_RETURN';

export interface DocumentConfig {
  type: DocumentType;
  // For inventory movement direction
  direction: 'incoming' | 'outgoing';
  // For accounting entries (1 = normal, -1 = reversed)
  accountingSign: 1 | -1;
  // Party type for supplier/customer
  partyType: 'supplier' | 'customer';
  partyField: 'supplier_id' | 'customer_id';
  // Inventory effect
  inventoryEffect: 'increase' | 'decrease';
  // Invoice type for database
  invoiceType: 'purchase' | 'purchase_return' | 'sales' | 'sales_return';
  // Movement type for item_movements
  movementType: 'purchase' | 'purchase_return' | 'sale' | 'sale_return';
  // Branch field in movement
  branchField: 'to_branch_id' | 'from_branch_id';
  // Reference type for journal entries
  journalReferenceType: 'purchase' | 'purchase_return' | 'sale' | 'sale_return';
  // RPC function for generating document number
  generateNumberFunction: string;
}

export const DOCUMENT_CONFIGS: Record<DocumentType, DocumentConfig> = {
  PURCHASE_INVOICE: {
    type: 'PURCHASE_INVOICE',
    direction: 'incoming',
    accountingSign: 1,
    partyType: 'supplier',
    partyField: 'supplier_id',
    inventoryEffect: 'increase',
    invoiceType: 'purchase',
    movementType: 'purchase',
    branchField: 'to_branch_id',
    journalReferenceType: 'purchase',
    generateNumberFunction: 'generate_purchase_invoice_number',
  },
  PURCHASE_RETURN: {
    type: 'PURCHASE_RETURN',
    direction: 'outgoing',
    accountingSign: -1,
    partyType: 'supplier',
    partyField: 'supplier_id',
    inventoryEffect: 'decrease',
    invoiceType: 'purchase_return',
    movementType: 'purchase_return',
    branchField: 'from_branch_id',
    journalReferenceType: 'purchase_return',
    generateNumberFunction: 'generate_purchase_return_number',
  },
  SALES_INVOICE: {
    type: 'SALES_INVOICE',
    direction: 'outgoing',
    accountingSign: 1,
    partyType: 'customer',
    partyField: 'customer_id',
    inventoryEffect: 'decrease',
    invoiceType: 'sales',
    movementType: 'sale',
    branchField: 'from_branch_id',
    journalReferenceType: 'sale',
    generateNumberFunction: 'generate_sales_invoice_number',
  },
  SALES_RETURN: {
    type: 'SALES_RETURN',
    direction: 'incoming',
    accountingSign: -1,
    partyType: 'customer',
    partyField: 'customer_id',
    inventoryEffect: 'increase',
    invoiceType: 'sales_return',
    movementType: 'sale_return',
    branchField: 'to_branch_id',
    journalReferenceType: 'sale_return',
    generateNumberFunction: 'generate_sales_return_number',
  },
};

// Helper function to get document config
export function getDocumentConfig(documentType: DocumentType): DocumentConfig {
  return DOCUMENT_CONFIGS[documentType];
}

// Check if document is a return type
export function isReturnDocument(documentType: DocumentType): boolean {
  return documentType === 'PURCHASE_RETURN' || documentType === 'SALES_RETURN';
}

// Check if document is purchase-related
export function isPurchaseDocument(documentType: DocumentType): boolean {
  return documentType === 'PURCHASE_INVOICE' || documentType === 'PURCHASE_RETURN';
}

// Check if document is sales-related
export function isSalesDocument(documentType: DocumentType): boolean {
  return documentType === 'SALES_INVOICE' || documentType === 'SALES_RETURN';
}
