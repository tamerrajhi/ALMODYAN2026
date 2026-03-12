/**
 * Command DTOs for Purchasing Domain Write Operations
 * These DTOs define the minimal required inputs for write operations
 * All derived/computed fields are excluded and calculated server-side
 */

// ===========================
// Line Command DTOs
// ===========================

/**
 * Line input for purchase invoices
 * Excludes derived fields: subtotal, tax_amount, total_amount
 */
export interface PurchaseInvoiceLineInput {
  lineNumber: number;
  
  // Item identification
  itemType: 'jewelry' | 'product' | 'cost' | 'service';
  itemId: string | null;  // product_id, cost_entry_id, or jewelry_item_id
  itemCode: string;
  description: string;
  
  // Required inputs
  quantity: number;
  unitPrice: number;
  taxRate: number;  // 0..1 (e.g., 0.15 for 15%)
  
  // Optional inputs
  isInclusive?: boolean;
  discountAmount?: number;
  
  // Account overrides (optional)
  glAccountId?: string | null;
  warehouseAccountId?: string | null;
}

/**
 * Line input for general returns (product/cost/service)
 */
export interface PurchaseReturnLineInput {
  lineNumber: number;
  
  // Item identification
  itemType: 'product' | 'cost' | 'service';
  itemId: string | null;
  itemCode: string;
  description: string;
  
  // Link to original invoice line
  invoiceLineId?: string | null;
  
  // Required inputs
  quantity: number;
  unitPrice: number;
  taxRate: number;  // 0..1
  
  // Return-specific
  returnReason?: string;
  returnType?: string;
  lineNotes?: string;
}

/**
 * Item input for unique returns (jewelry items)
 */
export interface PurchaseReturnItemInput {
  // Jewelry item link
  jewelryItemId: string;
  itemCode: string;
  description: string;
  
  // Pricing
  unitPrice: number;
  taxRate: number;  // 0..1
  
  // Weight
  goldWeight?: number;
  karatId?: string | null;
  
  // Return-specific
  returnReason?: string;
  returnType?: string;
  lineNotes?: string;
}

// ===========================
// Create Commands
// ===========================

/**
 * Command to create a new purchase invoice
 * Excluded derived fields: subtotal, tax_amount, total_amount, paid_amount,
 *                          remaining_amount, status, journal_entry_id
 */
export interface CreatePurchaseInvoiceCommand {
  // Required fields
  supplierId: string;
  branchId: string;
  invoiceDate: string;  // ISO date string
  
  // Optional header fields
  reference?: string;  // Auto-generated if not provided
  dueDate?: string;
  paymentTerms?: 'cash' | 'credit';
  notes?: string;
  
  // Lines - at least one required
  lines: PurchaseInvoiceLineInput[];
}

/**
 * Command to update an existing purchase invoice
 */
export interface UpdatePurchaseInvoiceCommand {
  id: string;
  
  // Updatable header fields
  supplierId?: string;
  branchId?: string;
  invoiceDate?: string;
  dueDate?: string;
  notes?: string;
  
  // Lines - complete replacement
  lines?: PurchaseInvoiceLineInput[];
}

/**
 * Command to create a general purchase return (product/cost lines)
 * Uses invoices table with invoice_type='purchase_return'
 */
export interface CreatePurchaseReturnGeneralCommand {
  // Required fields
  supplierId: string;
  branchId: string;
  returnDate: string;
  linkedInvoiceId: string;  // Original purchase invoice
  
  // Optional header fields
  reference?: string;
  returnReason?: string;
  notes?: string;
  
  // Lines - at least one required
  lines: PurchaseReturnLineInput[];
}

/**
 * Command to create a unique purchase return (jewelry items)
 * Uses purchase_returns and purchase_return_items tables
 */
export interface CreatePurchaseReturnUniqueCommand {
  // Required fields
  supplierId: string;
  branchId: string;
  returnDate: string;
  
  // Optional header fields
  reference?: string;
  linkedInvoiceId?: string;  // Optional for unique returns
  returnReason?: string;
  notes?: string;
  
  // Items - at least one required
  items: PurchaseReturnItemInput[];
}

/**
 * Allocation for supplier payment
 */
export interface PaymentAllocationInput {
  invoiceId: string;
  amount: number;
}

/**
 * Command to create a supplier payment
 * Excluded: journal_entry_id, payment_number (auto-generated)
 */
export interface CreateSupplierPaymentCommand {
  // Required fields
  supplierId: string;
  paymentDate: string;
  paymentMethod: 'cash' | 'bank_transfer' | 'check';
  totalAmount: number;
  
  // Optional fields
  branchId?: string;
  notes?: string;
  checkNumber?: string;
  bankName?: string;
  
  // Allocations - can be empty for advance payment
  allocations?: PaymentAllocationInput[];
}

// ===========================
// Generate Invoice Number Command/Result
// ===========================

/**
 * Command to generate a new purchase invoice number
 * Optional parameters for future extension (e.g., branch-based numbering)
 */
export type GeneratePurchaseInvoiceNumberCommand = {
  branchId?: string;
  warehouseId?: string;
};

/**
 * Result of generating a purchase invoice number
 */
export type GeneratePurchaseInvoiceNumberResult = {
  invoiceNumber: string;
};

// ===========================
// Result Types
// ===========================

export interface CommandResult<T = void> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    field?: string;
  };
}

export interface CreateInvoiceResult {
  invoiceId: string;
  invoiceNumber: string;
  journalEntryId?: string;
}

/**
 * Alias for clarity when used with Purchase Invoice operations
 */
export type CreatePurchaseInvoiceResult = CreateInvoiceResult;

/**
 * Result of updating a purchase invoice
 */
export type UpdatePurchaseInvoiceResult = {
  invoiceId: string;
  invoiceNumber?: string;
  journalEntryId?: string;
};

export interface CreateReturnResult {
  returnId: string;
  returnNumber: string;
  journalEntryId?: string;
}

export interface CreatePaymentResult {
  paymentId: string;
  paymentNumber: string;
  journalEntryId?: string;
}

/**
 * Command to cancel a purchase invoice
 * Only allowed for pending/partial status with remaining_amount > 0
 */
export interface CancelPurchaseInvoiceCommand {
  invoiceId: string;
  reason?: string;
  cancelledBy?: string;
}

export interface CancelInvoiceResult {
  success: boolean;
  invoiceNumber: string;
}

// ===========================
// Upsert Types (Union Types)
// ===========================

/**
 * Union command for creating or updating a purchase invoice
 * Use type guards to determine which operation to perform
 */
export type UpsertPurchaseInvoiceCommand = 
  | (CreatePurchaseInvoiceCommand & { id?: never })
  | UpdatePurchaseInvoiceCommand;

/**
 * Result type for upsert operations
 */
export type UpsertPurchaseInvoiceResult = CreatePurchaseInvoiceResult | UpdatePurchaseInvoiceResult;

/**
 * Type guard to check if command is an update (has id)
 */
export function isUpdateCommand(cmd: UpsertPurchaseInvoiceCommand): cmd is UpdatePurchaseInvoiceCommand {
  return 'id' in cmd && typeof cmd.id === 'string' && cmd.id.length > 0;
}

// ===========================
// Convert PR to PO Types
// ===========================

/**
 * DTO for Purchase Requisition in convert-to-PO flow
 */
export type PRForConvertDTO = {
  id: string;
  prNumber: string;
  status: string;
  branchId: string;
  branchName: string;
  requestedBy: string | null;
  requestedByName: string | null;
  createdAt: string;
  notes: string | null;
};

/**
 * DTO for Purchase Requisition Item in convert-to-PO flow
 */
export type PRItemForConvertDTO = {
  id: string;
  requisitionId: string;
  productId: string | null;
  productCode: string | null;
  productName: string | null;
  description: string | null;
  quantity: number;
  convertedQuantity: number;
  remainingQuantity: number;
  estimatedPrice: number | null;
  notes: string | null;
};

/**
 * Item to convert from PR to PO
 */
export type ConvertPRItemInput = {
  prItemId: string;
  requisitionId: string;
  convertQuantity: number;
  actualPrice: number;
  supplierId: string | null;
  description: string;
  warehouseId: string | null;
  costCenterId: string | null;
};

/**
 * Command for converting Purchase Requisitions to Purchase Order
 */
/**
 * Command for converting Purchase Requisitions to Purchase Order
 * clientRequestId is REQUIRED for idempotency - must be a valid UUID
 */
export type ConvertPRToPOCommand = {
  /** UUID for idempotency - REQUIRED, must be a valid UUID string */
  clientRequestId: string;
  prIds: string[];
  targetBranchId: string;
  warehouseId?: string | null;
  defaultSupplierId?: string | null;
  expectedDeliveryDate?: string | null;
  paymentTerms?: string | null;
  deliveryTerms?: string | null;
  notes?: string;
  createdByUserId: string;
  createdByName?: string | null;
  items: ConvertPRItemInput[];
};

/**
 * Created PO info
 */
export type CreatedPOInfo = {
  poId: string;
  poNumber: string;
};

/**
 * Result of converting Purchase Requisitions to Purchase Order
 */
export type ConvertPRToPOResult = {
  success: boolean;
  createdPOs?: CreatedPOInfo[];
  error?: string;
};

// ===========================
// PI-1: Atomic Purchase Invoice Commands
// ===========================

/**
 * Line input for atomic purchase invoice creation
 */
export interface AtomicPurchaseInvoiceLineInput {
  item_id?: string;
  item_code?: string;
  description?: string;
  qty: number;
  unit_cost: number;
  tax_rate?: number;  // 0..1 (defaults to 0.15)
  discount_amount?: number;
  item_type?: 'jewelry' | 'product' | 'cost' | 'service' | 'imported_piece';
  gl_account_id?: string;
  cost_entry_id?: string;
  warehouse_id?: string;
  line_notes?: string;
}

/**
 * Command to create a purchase invoice atomically
 */
export interface AtomicCreatePurchaseInvoiceCommand {
  client_request_id: string;
  created_by?: string;
  invoice: {
    supplier_id: string;
    branch_id?: string;
    invoice_date?: string;
    due_date?: string;
    notes?: string;
    invoice_type?: 'general' | 'imported' | 'service';
    external_ref?: string;
    supplier_invoice_no?: string;  // NEW: Supplier Invoice Number
  };
  items: AtomicPurchaseInvoiceLineInput[];
}

/**
 * Command to post a purchase invoice atomically (create JE)
 */
export interface AtomicPostPurchaseInvoiceCommand {
  client_request_id: string;
  created_by?: string;
  invoice_id: string;
  post_date?: string;
  journal?: {
    description?: string;
    reference_type?: string;
  };
}

/**
 * Command to void a purchase invoice atomically
 */
export interface AtomicVoidPurchaseInvoiceCommand {
  client_request_id: string;
  created_by?: string;
  invoice_id: string;
  void_reason?: string;
  void_date?: string;
}

/**
 * Result from atomic purchase invoice create
 */
export interface AtomicCreatePurchaseInvoiceResult {
  success: boolean;
  cached?: boolean;
  invoiceId?: string;
  invoiceNumber?: string;
  supplierInvoiceNo?: string;  // Normalized SUPP INV returned from RPC
  status?: string;
  totals?: {
    subtotal: number;
    taxAmount: number;
    totalAmount: number;
  };
  itemsCount?: number;
  error_code?: string;
  error?: string;
  message_ar?: string;  // Arabic error message for SUPP INV validation
  meta?: {
    workflowType: string;
    clientRequestId: string;
    payloadHash: string;
  };
}

/**
 * Result from atomic purchase invoice post
 */
export interface AtomicPostPurchaseInvoiceResult {
  success: boolean;
  cached?: boolean;
  alreadyPosted?: boolean;
  invoiceId?: string;
  invoiceNumber?: string;
  journalEntryId?: string;
  journalEntryNumber?: string;
  linesDerived?: boolean;
  posted?: boolean;
  totals?: {
    debit: number;
    credit: number;
  };
  error_code?: string;
  error?: string;
  meta?: {
    workflowType: string;
    clientRequestId: string;
    payloadHash: string;
  };
}

/**
 * Result from atomic purchase invoice void
 */
export interface AtomicVoidPurchaseInvoiceResult {
  success: boolean;
  cached?: boolean;
  alreadyVoided?: boolean;
  invoiceId?: string;
  invoiceNumber?: string;
  voided?: boolean;
  voidReason?: string;
  voidDate?: string;
  reversalJournalEntryId?: string;
  reversalEntryNumber?: string;
  error_code?: string;
  error?: string;
  meta?: {
    workflowType: string;
    clientRequestId: string;
    payloadHash: string;
  };
}

// ===========================
// PR-1: Atomic Purchase Return Commands
// ===========================

/**
 * Item input for atomic purchase return (unique/jewelry)
 * Maps to RPC items array - uses item_id (not jewelry_item_id) per schema
 */
export interface AtomicPurchaseReturnItemInput {
  item_id: string;              // unique_items.id - RPC expects "item_id"
  item_code?: string;
  description?: string;
  unit_price: number;
  tax_rate?: number;            // 0..1 (defaults to 0 for imports)
  gold_weight?: number;
  karat_id?: string;
  invoice_line_id?: string;
  reason?: string;
}

/**
 * Line input for atomic purchase return (general/qty-based)
 */
export interface AtomicPurchaseReturnLineInput {
  invoice_line_id: string;
  item_id?: string;
  item_code?: string;
  description?: string;
  item_type?: 'product' | 'cost' | 'service';
  qty: number;
  unit_price: number;
  tax_rate?: number;            // 0..1 (defaults to 0.15)
  discount_amount?: number;
  reason?: string;
}

/**
 * Nested return object for atomic purchase return commands
 * Matches RPC p_payload->'return' structure
 */
export interface AtomicPurchaseReturnData {
  branch_id: string;
  purchase_invoice_id: string;
  supplier_id?: string | null;
  return_date: string;
  reason?: string;
  notes?: string | null;
}

/**
 * Command to create a unique (jewelry) purchase return atomically
 * Matches RPC complete_purchase_return_unique_items_atomic(p_payload jsonb)
 */
export interface AtomicCreatePurchaseReturnUniqueCommand {
  client_request_id: string;
  created_by?: string;           // RPC reads p_payload->>'created_by'
  return: AtomicPurchaseReturnData;
  items: AtomicPurchaseReturnItemInput[];
}

/**
 * Command to create a general (qty-based) purchase return atomically
 * Matches RPC complete_purchase_return_general_atomic(p_payload jsonb)
 */
export interface AtomicCreatePurchaseReturnGeneralCommand {
  client_request_id: string;
  created_by?: string;           // RPC reads p_payload->>'created_by'
  return: AtomicPurchaseReturnData;
  items: AtomicPurchaseReturnLineInput[];  // RPC expects 'items' not 'lines'
}

/**
 * Command to void a purchase return atomically
 * Supports both Unique (purchase_returns) and General (invoice-based) returns
 * 
 * Resolution order:
 * 1. If purchase_return_id is provided, resolve as Unique
 * 2. If return_number is provided, try Unique first, then General
 * 3. If invoice_id is provided, resolve as General
 */
export interface AtomicVoidPurchaseReturnCommand {
  client_request_id: string;
  void: {
    /** UUID of the purchase_return (for Unique returns) */
    purchase_return_id?: string;
    /** Return number (works for both Unique and General) */
    return_number?: string;
    /** UUID of the invoice (for General returns) */
    invoice_id?: string;
    /** Reason for voiding */
    reason?: string;
    /** User ID performing the void */
    voided_by: string;
  };
}

/**
 * Legacy format for backward compatibility
 */
export interface AtomicVoidPurchaseReturnCommandLegacy {
  client_request_id: string;
  created_by: string;
  return_id: string;
  void_reason?: string;
  void_date?: string;
}

/**
 * Result from atomic purchase return create (unique)
 */
export interface AtomicCreatePurchaseReturnUniqueResult {
  success: boolean;
  cached?: boolean;
  idempotent?: boolean;
  returnId?: string;
  returnNumber?: string;
  journalEntryId?: string;
  journalEntryNumber?: string;
  status?: string;
  itemCount?: number;
  totals?: {
    subtotal: number;
    taxAmount: number;
    totalAmount: number;
  };
  error_code?: string;
  error?: string;
  meta?: {
    workflowType: string;
    clientRequestId: string;
    payloadHash: string;
  };
}

/**
 * Result from atomic purchase return create (general)
 */
export interface AtomicCreatePurchaseReturnGeneralResult {
  success: boolean;
  cached?: boolean;
  idempotent?: boolean;
  returnId?: string;
  returnNumber?: string;
  journalEntryId?: string;
  journalEntryNumber?: string;
  status?: string;
  lineCount?: number;
  totals?: {
    subtotal: number;
    taxAmount: number;
    totalAmount: number;
  };
  error_code?: string;
  error?: string;
  meta?: {
    workflowType: string;
    clientRequestId: string;
    payloadHash: string;
  };
}

/**
 * Result from atomic purchase return void
 * Supports both Unique and General return types
 */
export interface AtomicVoidPurchaseReturnResult {
  success: boolean;
  /** Type of return that was voided */
  return_type?: 'unique' | 'general';
  /** ID of the purchase_return (for Unique) */
  purchase_return_id?: string;
  /** ID of the invoice (for General) */
  invoice_id?: string;
  /** Return number */
  return_number?: string;
  /** Final status */
  status?: string;
  /** True if already voided (idempotent) */
  already_voided?: boolean;
  /** True if this was an idempotent call */
  idempotent?: boolean;
  /** Reversal JE ID if created */
  reversal_je_id?: string;
  /** Mirror invoice ID (for Unique returns) */
  mirror_invoice_id?: string;
  /** Count of items restored to available (for Unique) */
  items_restored_count?: number;
  /** Count of items skipped because sold after return (for Unique) */
  items_skipped_sold_after_void_count?: number;
  /** Error code if failed */
  error_code?: string;
  /** Error message if failed */
  error?: string;
}
