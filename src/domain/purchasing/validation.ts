/**
 * Validation layer for Purchasing Commands
 * Strips derived fields and validates inputs before processing
 */

import {
  CreatePurchaseInvoiceCommand,
  UpdatePurchaseInvoiceCommand,
  CreatePurchaseReturnGeneralCommand,
  CreatePurchaseReturnUniqueCommand,
  CreateSupplierPaymentCommand,
  PurchaseInvoiceLineInput,
  PurchaseReturnLineInput,
  PurchaseReturnItemInput,
  CommandResult,
} from './commands';

// ===========================
// Derived fields that must be stripped/rejected
// ===========================

const INVOICE_DERIVED_FIELDS = [
  'subtotal',
  'tax_amount',
  'taxAmount',
  'discount_amount',
  'discountAmount', 
  'total_amount',
  'totalAmount',
  'paid_amount',
  'paidAmount',
  'remaining_amount',
  'remainingAmount',
  'status',
  'total_returned_amount',
  'totalReturnedAmount',
  'journal_entry_id',
  'journalEntryId',
  'reference_type',
  'referenceType',
  'reference_id',
  'referenceId',
  'returned_qty',
  'returnedQty',
] as const;

const LINE_DERIVED_FIELDS = [
  'subtotal',
  'tax_amount',
  'taxAmount',
  'total_amount',
  'totalAmount',
  'returned_qty',
  'returnedQty',
  'remaining_qty',
  'remainingQty',
] as const;

// ===========================
// Validation Errors
// ===========================

export interface ValidationError {
  code: string;
  message: string;
  field?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  sanitizedCommand?: unknown;
}

// ===========================
// Helper Functions
// ===========================

/**
 * Checks if an object has any derived fields that should be rejected
 */
function checkForDerivedFields(
  obj: Record<string, unknown>,
  derivedFields: readonly string[],
  prefix: string = ''
): ValidationError[] {
  const errors: ValidationError[] = [];
  
  for (const field of derivedFields) {
    if (field in obj && obj[field] !== undefined) {
      errors.push({
        code: 'DERIVED_FIELD_NOT_ALLOWED',
        message: `Derived field '${field}' should not be provided; it will be calculated`,
        field: prefix ? `${prefix}.${field}` : field,
      });
    }
  }
  
  return errors;
}

/**
 * Strips derived fields from an object (returns a clean copy)
 */
function stripDerivedFields<T extends Record<string, unknown>>(
  obj: T,
  derivedFields: readonly string[]
): T {
  const cleaned = { ...obj };
  for (const field of derivedFields) {
    delete cleaned[field];
  }
  return cleaned;
}

/**
 * Validates quantity is positive
 */
function validateQuantity(qty: number, field: string): ValidationError | null {
  if (typeof qty !== 'number' || qty <= 0) {
    return {
      code: 'INVALID_QUANTITY',
      message: 'Quantity must be greater than 0',
      field,
    };
  }
  return null;
}

/**
 * Validates unit price is non-negative
 */
function validateUnitPrice(price: number, field: string): ValidationError | null {
  if (typeof price !== 'number' || price < 0) {
    return {
      code: 'INVALID_UNIT_PRICE',
      message: 'Unit price must be >= 0',
      field,
    };
  }
  return null;
}

/**
 * Validates tax rate is between 0 and 1
 */
function validateTaxRate(rate: number, field: string): ValidationError | null {
  if (typeof rate !== 'number' || rate < 0 || rate > 1) {
    return {
      code: 'INVALID_TAX_RATE',
      message: 'Tax rate must be between 0 and 1 (e.g., 0.15 for 15%)',
      field,
    };
  }
  return null;
}

/**
 * Validates a UUID string
 */
function validateUUID(value: string | null | undefined, field: string, required: boolean = true): ValidationError | null {
  if (!value) {
    if (required) {
      return {
        code: 'REQUIRED_FIELD',
        message: `${field} is required`,
        field,
      };
    }
    return null;
  }
  
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(value)) {
    return {
      code: 'INVALID_UUID',
      message: `${field} must be a valid UUID`,
      field,
    };
  }
  return null;
}

/**
 * Validates a date string (ISO format)
 */
function validateDate(value: string | undefined, field: string, required: boolean = true): ValidationError | null {
  if (!value) {
    if (required) {
      return {
        code: 'REQUIRED_FIELD',
        message: `${field} is required`,
        field,
      };
    }
    return null;
  }
  
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    return {
      code: 'INVALID_DATE',
      message: `${field} must be a valid date`,
      field,
    };
  }
  return null;
}

// ===========================
// Line Validation
// ===========================

function validateInvoiceLine(
  line: PurchaseInvoiceLineInput,
  index: number
): { errors: ValidationError[]; sanitized: PurchaseInvoiceLineInput } {
  const errors: ValidationError[] = [];
  const prefix = `lines[${index}]`;
  
  // Check for derived fields
  errors.push(...checkForDerivedFields(line as unknown as Record<string, unknown>, LINE_DERIVED_FIELDS, prefix));
  
  // Validate required fields
  const qtyError = validateQuantity(line.quantity, `${prefix}.quantity`);
  if (qtyError) errors.push(qtyError);
  
  const priceError = validateUnitPrice(line.unitPrice, `${prefix}.unitPrice`);
  if (priceError) errors.push(priceError);
  
  // Normalize tax rate (accept 0-100 and convert to 0-1 if needed)
  let normalizedTaxRate = line.taxRate;
  if (normalizedTaxRate > 1) {
    normalizedTaxRate = normalizedTaxRate / 100;
  }
  
  const taxError = validateTaxRate(normalizedTaxRate, `${prefix}.taxRate`);
  if (taxError) errors.push(taxError);
  
  // Validate item type
  const validItemTypes = ['jewelry', 'product', 'cost', 'service'];
  if (!validItemTypes.includes(line.itemType)) {
    errors.push({
      code: 'INVALID_ITEM_TYPE',
      message: `Item type must be one of: ${validItemTypes.join(', ')}`,
      field: `${prefix}.itemType`,
    });
  }
  
  // Strip derived fields and return sanitized line
  const sanitized: PurchaseInvoiceLineInput = {
    lineNumber: line.lineNumber,
    itemType: line.itemType,
    itemId: line.itemId,
    itemCode: line.itemCode || '',
    description: line.description || '',
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    taxRate: normalizedTaxRate,
    isInclusive: line.isInclusive ?? false,
    discountAmount: line.discountAmount ?? 0,
    glAccountId: line.glAccountId,
    warehouseAccountId: line.warehouseAccountId,
  };
  
  return { errors, sanitized };
}

function validateReturnLine(
  line: PurchaseReturnLineInput,
  index: number
): { errors: ValidationError[]; sanitized: PurchaseReturnLineInput } {
  const errors: ValidationError[] = [];
  const prefix = `lines[${index}]`;
  
  // Check for derived fields
  errors.push(...checkForDerivedFields(line as unknown as Record<string, unknown>, LINE_DERIVED_FIELDS, prefix));
  
  // Validate required fields
  const qtyError = validateQuantity(line.quantity, `${prefix}.quantity`);
  if (qtyError) errors.push(qtyError);
  
  const priceError = validateUnitPrice(line.unitPrice, `${prefix}.unitPrice`);
  if (priceError) errors.push(priceError);
  
  // Normalize tax rate
  let normalizedTaxRate = line.taxRate;
  if (normalizedTaxRate > 1) {
    normalizedTaxRate = normalizedTaxRate / 100;
  }
  
  const taxError = validateTaxRate(normalizedTaxRate, `${prefix}.taxRate`);
  if (taxError) errors.push(taxError);
  
  const sanitized: PurchaseReturnLineInput = {
    lineNumber: line.lineNumber,
    itemType: line.itemType,
    itemId: line.itemId,
    itemCode: line.itemCode || '',
    description: line.description || '',
    invoiceLineId: line.invoiceLineId,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    taxRate: normalizedTaxRate,
    returnReason: line.returnReason,
    returnType: line.returnType,
    lineNotes: line.lineNotes,
  };
  
  return { errors, sanitized };
}

function validateReturnItem(
  item: PurchaseReturnItemInput,
  index: number
): { errors: ValidationError[]; sanitized: PurchaseReturnItemInput } {
  const errors: ValidationError[] = [];
  const prefix = `items[${index}]`;
  
  // Check for derived fields
  errors.push(...checkForDerivedFields(item as unknown as Record<string, unknown>, LINE_DERIVED_FIELDS, prefix));
  
  // Validate jewelry item ID
  const itemIdError = validateUUID(item.jewelryItemId, `${prefix}.jewelryItemId`);
  if (itemIdError) errors.push(itemIdError);
  
  const priceError = validateUnitPrice(item.unitPrice, `${prefix}.unitPrice`);
  if (priceError) errors.push(priceError);
  
  // Normalize tax rate
  let normalizedTaxRate = item.taxRate;
  if (normalizedTaxRate > 1) {
    normalizedTaxRate = normalizedTaxRate / 100;
  }
  
  const taxError = validateTaxRate(normalizedTaxRate, `${prefix}.taxRate`);
  if (taxError) errors.push(taxError);
  
  const sanitized: PurchaseReturnItemInput = {
    jewelryItemId: item.jewelryItemId,
    itemCode: item.itemCode || '',
    description: item.description || '',
    unitPrice: item.unitPrice,
    taxRate: normalizedTaxRate,
    goldWeight: item.goldWeight ?? 0,
    karatId: item.karatId,
    returnReason: item.returnReason,
    returnType: item.returnType,
    lineNotes: item.lineNotes,
  };
  
  return { errors, sanitized };
}

// ===========================
// Command Validators
// ===========================

/**
 * Validates CreatePurchaseInvoiceCommand
 * - Rejects derived fields
 * - Validates quantities, prices, tax rates
 * - Returns sanitized command
 */
export function validateCreatePurchaseInvoice(
  cmd: CreatePurchaseInvoiceCommand
): ValidationResult {
  const errors: ValidationError[] = [];
  
  // Check for derived fields at header level
  errors.push(...checkForDerivedFields(cmd as unknown as Record<string, unknown>, INVOICE_DERIVED_FIELDS));
  
  // Validate required header fields
  const supplierError = validateUUID(cmd.supplierId, 'supplierId');
  if (supplierError) errors.push(supplierError);
  
  const branchError = validateUUID(cmd.branchId, 'branchId');
  if (branchError) errors.push(branchError);
  
  const dateError = validateDate(cmd.invoiceDate, 'invoiceDate');
  if (dateError) errors.push(dateError);
  
  // Validate lines exist
  if (!cmd.lines || cmd.lines.length === 0) {
    errors.push({
      code: 'LINES_REQUIRED',
      message: 'At least one line is required',
      field: 'lines',
    });
  }
  
  // Validate each line
  const sanitizedLines: PurchaseInvoiceLineInput[] = [];
  if (cmd.lines) {
    for (let i = 0; i < cmd.lines.length; i++) {
      const { errors: lineErrors, sanitized } = validateInvoiceLine(cmd.lines[i], i);
      errors.push(...lineErrors);
      sanitizedLines.push(sanitized);
    }
  }
  
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  
  // Return sanitized command
  const sanitizedCommand: CreatePurchaseInvoiceCommand = {
    supplierId: cmd.supplierId,
    branchId: cmd.branchId,
    invoiceDate: cmd.invoiceDate,
    reference: cmd.reference,
    dueDate: cmd.dueDate,
    paymentTerms: cmd.paymentTerms,
    notes: cmd.notes,
    lines: sanitizedLines,
  };
  
  return { valid: true, errors: [], sanitizedCommand };
}

/**
 * Validates UpdatePurchaseInvoiceCommand
 */
export function validateUpdatePurchaseInvoice(
  cmd: UpdatePurchaseInvoiceCommand
): ValidationResult {
  const errors: ValidationError[] = [];
  
  // Check for derived fields
  errors.push(...checkForDerivedFields(cmd as unknown as Record<string, unknown>, INVOICE_DERIVED_FIELDS));
  
  // Validate ID is required
  const idError = validateUUID(cmd.id, 'id');
  if (idError) errors.push(idError);
  
  // Validate optional UUIDs if provided
  if (cmd.supplierId) {
    const supplierError = validateUUID(cmd.supplierId, 'supplierId');
    if (supplierError) errors.push(supplierError);
  }
  
  if (cmd.branchId) {
    const branchError = validateUUID(cmd.branchId, 'branchId');
    if (branchError) errors.push(branchError);
  }
  
  // Validate lines if provided
  const sanitizedLines: PurchaseInvoiceLineInput[] = [];
  if (cmd.lines) {
    for (let i = 0; i < cmd.lines.length; i++) {
      const { errors: lineErrors, sanitized } = validateInvoiceLine(cmd.lines[i], i);
      errors.push(...lineErrors);
      sanitizedLines.push(sanitized);
    }
  }
  
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  
  const sanitizedCommand: UpdatePurchaseInvoiceCommand = {
    id: cmd.id,
    supplierId: cmd.supplierId,
    branchId: cmd.branchId,
    invoiceDate: cmd.invoiceDate,
    dueDate: cmd.dueDate,
    notes: cmd.notes,
    lines: cmd.lines ? sanitizedLines : undefined,
  };
  
  return { valid: true, errors: [], sanitizedCommand };
}

/**
 * Validates CreatePurchaseReturnGeneralCommand
 */
export function validateCreatePurchaseReturnGeneral(
  cmd: CreatePurchaseReturnGeneralCommand
): ValidationResult {
  const errors: ValidationError[] = [];
  
  // Check for derived fields
  errors.push(...checkForDerivedFields(cmd as unknown as Record<string, unknown>, INVOICE_DERIVED_FIELDS));
  
  // Validate required header fields
  const supplierError = validateUUID(cmd.supplierId, 'supplierId');
  if (supplierError) errors.push(supplierError);
  
  const branchError = validateUUID(cmd.branchId, 'branchId');
  if (branchError) errors.push(branchError);
  
  const dateError = validateDate(cmd.returnDate, 'returnDate');
  if (dateError) errors.push(dateError);
  
  // Original invoice link is required for general returns
  const linkedInvoiceError = validateUUID(cmd.linkedInvoiceId, 'linkedInvoiceId');
  if (linkedInvoiceError) errors.push(linkedInvoiceError);
  
  // Validate lines exist
  if (!cmd.lines || cmd.lines.length === 0) {
    errors.push({
      code: 'LINES_REQUIRED',
      message: 'At least one return line is required',
      field: 'lines',
    });
  }
  
  // Validate each line
  const sanitizedLines: PurchaseReturnLineInput[] = [];
  if (cmd.lines) {
    for (let i = 0; i < cmd.lines.length; i++) {
      const { errors: lineErrors, sanitized } = validateReturnLine(cmd.lines[i], i);
      errors.push(...lineErrors);
      sanitizedLines.push(sanitized);
    }
  }
  
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  
  const sanitizedCommand: CreatePurchaseReturnGeneralCommand = {
    supplierId: cmd.supplierId,
    branchId: cmd.branchId,
    returnDate: cmd.returnDate,
    linkedInvoiceId: cmd.linkedInvoiceId,
    reference: cmd.reference,
    returnReason: cmd.returnReason,
    notes: cmd.notes,
    lines: sanitizedLines,
  };
  
  return { valid: true, errors: [], sanitizedCommand };
}

/**
 * Validates CreatePurchaseReturnUniqueCommand
 */
export function validateCreatePurchaseReturnUnique(
  cmd: CreatePurchaseReturnUniqueCommand
): ValidationResult {
  const errors: ValidationError[] = [];
  
  // Check for derived fields
  errors.push(...checkForDerivedFields(cmd as unknown as Record<string, unknown>, INVOICE_DERIVED_FIELDS));
  
  // Validate required header fields
  const supplierError = validateUUID(cmd.supplierId, 'supplierId');
  if (supplierError) errors.push(supplierError);
  
  const branchError = validateUUID(cmd.branchId, 'branchId');
  if (branchError) errors.push(branchError);
  
  const dateError = validateDate(cmd.returnDate, 'returnDate');
  if (dateError) errors.push(dateError);
  
  // linkedInvoiceId is optional for unique returns
  if (cmd.linkedInvoiceId) {
    const linkedError = validateUUID(cmd.linkedInvoiceId, 'linkedInvoiceId', false);
    if (linkedError) errors.push(linkedError);
  }
  
  // Validate items exist
  if (!cmd.items || cmd.items.length === 0) {
    errors.push({
      code: 'ITEMS_REQUIRED',
      message: 'At least one return item is required',
      field: 'items',
    });
  }
  
  // Validate each item
  const sanitizedItems: PurchaseReturnItemInput[] = [];
  if (cmd.items) {
    for (let i = 0; i < cmd.items.length; i++) {
      const { errors: itemErrors, sanitized } = validateReturnItem(cmd.items[i], i);
      errors.push(...itemErrors);
      sanitizedItems.push(sanitized);
    }
  }
  
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  
  const sanitizedCommand: CreatePurchaseReturnUniqueCommand = {
    supplierId: cmd.supplierId,
    branchId: cmd.branchId,
    returnDate: cmd.returnDate,
    linkedInvoiceId: cmd.linkedInvoiceId,
    reference: cmd.reference,
    returnReason: cmd.returnReason,
    notes: cmd.notes,
    items: sanitizedItems,
  };
  
  return { valid: true, errors: [], sanitizedCommand };
}

/**
 * Validates CreateSupplierPaymentCommand
 */
export function validateCreateSupplierPayment(
  cmd: CreateSupplierPaymentCommand
): ValidationResult {
  const errors: ValidationError[] = [];
  
  // Check for derived fields
  const paymentDerivedFields = ['journal_entry_id', 'journalEntryId', 'payment_number', 'paymentNumber'];
  errors.push(...checkForDerivedFields(cmd as unknown as Record<string, unknown>, paymentDerivedFields));
  
  // Validate required fields
  const supplierError = validateUUID(cmd.supplierId, 'supplierId');
  if (supplierError) errors.push(supplierError);
  
  const dateError = validateDate(cmd.paymentDate, 'paymentDate');
  if (dateError) errors.push(dateError);
  
  // Validate payment method
  const validMethods = ['cash', 'bank_transfer', 'check'];
  if (!validMethods.includes(cmd.paymentMethod)) {
    errors.push({
      code: 'INVALID_PAYMENT_METHOD',
      message: `Payment method must be one of: ${validMethods.join(', ')}`,
      field: 'paymentMethod',
    });
  }
  
  // Validate amount
  if (typeof cmd.totalAmount !== 'number' || cmd.totalAmount <= 0) {
    errors.push({
      code: 'INVALID_AMOUNT',
      message: 'Total amount must be greater than 0',
      field: 'totalAmount',
    });
  }
  
  // Validate allocations if provided
  if (cmd.allocations) {
    let totalAllocated = 0;
    for (let i = 0; i < cmd.allocations.length; i++) {
      const alloc = cmd.allocations[i];
      const invoiceError = validateUUID(alloc.invoiceId, `allocations[${i}].invoiceId`);
      if (invoiceError) errors.push(invoiceError);
      
      if (typeof alloc.amount !== 'number' || alloc.amount <= 0) {
        errors.push({
          code: 'INVALID_ALLOCATION_AMOUNT',
          message: 'Allocation amount must be greater than 0',
          field: `allocations[${i}].amount`,
        });
      }
      totalAllocated += alloc.amount || 0;
    }
    
    // Warn if allocations exceed total (but don't block - could be advance payment)
    if (totalAllocated > cmd.totalAmount) {
      errors.push({
        code: 'ALLOCATION_EXCEEDS_TOTAL',
        message: 'Total allocated amount exceeds payment amount',
        field: 'allocations',
      });
    }
  }
  
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  
  return { valid: true, errors: [], sanitizedCommand: cmd };
}

/**
 * Logs sanitization details for debugging
 */
export function logSanitizedPayload(
  original: unknown,
  sanitized: unknown,
  commandType: string
): void {
  console.log(`[Purchasing Validation] ${commandType}`);
  console.log('Original fields:', Object.keys(original as Record<string, unknown>));
  console.log('Sanitized fields:', Object.keys(sanitized as Record<string, unknown>));
  
  // Show removed fields
  const originalKeys = new Set(Object.keys(original as Record<string, unknown>));
  const sanitizedKeys = new Set(Object.keys(sanitized as Record<string, unknown>));
  const removed = [...originalKeys].filter(k => !sanitizedKeys.has(k));
  if (removed.length > 0) {
    console.log('Removed derived fields:', removed);
  }
}
