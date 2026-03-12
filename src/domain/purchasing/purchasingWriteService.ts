/**
 * Purchasing Write Service
 * Consumes validated commands and delegates to existing write paths
 * This layer does NOT change any existing write behavior - it only adds validation
 */

import * as dataGateway from '@/lib/dataGateway';
import type { FilterOp } from '@/lib/dataGateway';
import { logAudit } from '@/lib/audit';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';
import {
  CreatePurchaseInvoiceCommand,
  UpdatePurchaseInvoiceCommand,
  CreatePurchaseReturnGeneralCommand,
  CreatePurchaseReturnUniqueCommand,
  CreateSupplierPaymentCommand,
  CancelPurchaseInvoiceCommand,
  CommandResult,
  CreateInvoiceResult,
  CreateReturnResult,
  CreatePaymentResult,
  CancelInvoiceResult,
  GeneratePurchaseInvoiceNumberCommand,
  GeneratePurchaseInvoiceNumberResult,
  CreatePurchaseInvoiceResult,
  UpdatePurchaseInvoiceResult,
  UpsertPurchaseInvoiceCommand,
  UpsertPurchaseInvoiceResult,
  isUpdateCommand,
} from './commands';
import {
  validateCreatePurchaseInvoice,
  validateUpdatePurchaseInvoice,
  validateCreatePurchaseReturnGeneral,
  validateCreatePurchaseReturnUnique,
  validateCreateSupplierPayment,
  logSanitizedPayload,
} from './validation';
import { createPurchaseInvoiceJournalEntryWithLines, createPurchaseReturnJournalEntryWithLines } from '@/lib/accounting';

// ===========================
// Line Calculation Helper
// ===========================

interface CalculatedLine {
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
}

/**
 * Calculates derived fields for a line
 * This mirrors the server-side calculation logic
 */
function calculateLineAmounts(
  quantity: number,
  unitPrice: number,
  taxRate: number,  // 0..1
  discountAmount: number = 0,
  isInclusive: boolean = false
): CalculatedLine {
  if (isInclusive) {
    // Price includes tax
    const totalAmount = quantity * unitPrice - discountAmount;
    const taxAmount = totalAmount * (taxRate / (1 + taxRate));
    const subtotal = totalAmount - taxAmount;
    return { subtotal, taxAmount, totalAmount };
  } else {
    // Price excludes tax
    const subtotal = quantity * unitPrice - discountAmount;
    const taxAmount = subtotal * taxRate;
    const totalAmount = subtotal + taxAmount;
    return { subtotal, taxAmount, totalAmount };
  }
}

/**
 * Calculates totals from lines
 */
function calculateTotals(lines: { subtotal: number; taxAmount: number; totalAmount: number }[]): {
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
} {
  return lines.reduce(
    (acc, line) => ({
      subtotal: acc.subtotal + line.subtotal,
      taxAmount: acc.taxAmount + line.taxAmount,
      totalAmount: acc.totalAmount + line.totalAmount,
    }),
    { subtotal: 0, taxAmount: 0, totalAmount: 0 }
  );
}

// ===========================
// Reference Generation
// ===========================

async function generateInvoiceReference(): Promise<string> {
  const { data, error } = await dataGateway.rpc('generate_purchase_invoice_number', {});
  if (error || !data) {
    // Fallback
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const random = Math.floor(Math.random() * 9000) + 1000;
    return `PI-${today}-${random}`;
  }
  return data;
}

async function generateReturnReference(branchCode?: string | null): Promise<string> {
  const { data, error } = await dataGateway.rpc('generate_purchase_return_number', {
    p_branch_code: branchCode || null,
  });
  if (error || !data) {
    // Fallback
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const random = Math.floor(Math.random() * 9000) + 1000;
    const branchPart = branchCode ? `-${branchCode}` : '';
    return `PR${branchPart}-${today}-${random}`;
  }
  return data;
}

async function generatePaymentReference(): Promise<string> {
  // Fallback only - no RPC exists for payment voucher numbers
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.floor(Math.random() * 9000) + 1000;
  return `PV-${today}-${random}`;
}

// ===========================
// Write Service Functions
// ===========================

/**
 * Generates a new purchase invoice number
 * Wraps the RPC call with proper error handling
 */
export async function generatePurchaseInvoiceNumber(
  _cmd?: GeneratePurchaseInvoiceNumberCommand
): Promise<CommandResult<GeneratePurchaseInvoiceNumberResult>> {
  try {
    const { data, error } = await dataGateway.rpc('generate_purchase_invoice_number', {});
    
    if (error) {
      console.error('generatePurchaseInvoiceNumber RPC error:', error);
      // Fallback generation
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const random = Math.floor(Math.random() * 9000) + 1000;
      return {
        success: true,
        data: { invoiceNumber: `PI-${today}-${random}` },
      };
    }
    
    return {
      success: true,
      data: { invoiceNumber: data || `PI-${Date.now()}` },
    };
  } catch (error: unknown) {
    console.error('generatePurchaseInvoiceNumber error:', error);
    return {
      success: false,
      error: {
        code: 'RPC_ERROR',
        message: error instanceof Error ? error.message : 'Failed to generate invoice number',
      },
    };
  }
}

/**
 * Creates a new purchase invoice
 * Routes through purchase_invoice_create_atomic RPC for guaranteed atomicity
 * NEVER creates an invoice without a journal entry
 */
export async function createPurchaseInvoice(
  cmd: CreatePurchaseInvoiceCommand
): Promise<CommandResult<CreateInvoiceResult>> {
  // Validate and sanitize
  const validation = validateCreatePurchaseInvoice(cmd);
  if (!validation.valid) {
    return {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: validation.errors.map(e => e.message).join('; '),
      },
    };
  }

  const sanitizedCmd = validation.sanitizedCommand as CreatePurchaseInvoiceCommand;
  logSanitizedPayload(cmd, sanitizedCmd, 'CreatePurchaseInvoice');

  try {
    // Generate client_request_id for idempotency
    const clientRequestId = crypto.randomUUID();

    // Build RPC payload matching purchase_invoice_create_atomic expected structure
    const rpcPayload = {
      client_request_id: clientRequestId,
      invoice: {
        supplier_id: sanitizedCmd.supplierId,
        branch_id: sanitizedCmd.branchId,
        invoice_date: sanitizedCmd.invoiceDate,
        due_date: sanitizedCmd.dueDate || sanitizedCmd.invoiceDate,
        notes: sanitizedCmd.notes || null,
      },
      items: sanitizedCmd.lines.map((line, index) => ({
        line_number: line.lineNumber || index + 1,
        item_type: line.itemType,
        item_id: line.itemId || null,
        item_code: line.itemCode || null,
        description: line.description,
        quantity: line.quantity,
        unit_price: line.unitPrice,
        tax_rate: line.taxRate, // 0..1 format
        discount_amount: line.discountAmount || 0,
        is_inclusive: line.isInclusive || false,
        gl_account_id: line.glAccountId || null,
        warehouse_account_id: line.warehouseAccountId || null,
      })),
      created_by: 'system',
    };

    console.log('[createPurchaseInvoice] Calling purchase_invoice_create_atomic RPC', {
      clientRequestId,
      supplierId: sanitizedCmd.supplierId,
      linesCount: sanitizedCmd.lines.length,
    });

    // Call the atomic RPC
    const { data: rpcResult, error: rpcError } = await dataGateway.rpc(
      'purchase_invoice_create_atomic',
      { p_payload: rpcPayload }
    );

    if (rpcError) {
      console.error('[createPurchaseInvoice] RPC error:', rpcError);
      return {
        success: false,
        error: {
          code: 'RPC_ERROR',
          message: rpcError.message,
        },
      };
    }

    // Parse RPC response
    const result = rpcResult as {
      success: boolean;
      cached?: boolean;
      invoiceId?: string;
      invoiceNumber?: string;
      journalEntryId?: string;
      error_code?: string;
      error?: string;
    };

    if (!result.success) {
      console.error('[createPurchaseInvoice] RPC returned failure:', result);
      return {
        success: false,
        error: {
          code: result.error_code || 'RPC_FAILED',
          message: result.error || 'Purchase invoice creation failed in atomic RPC',
        },
      };
    }

    // HARD ASSERTION: journal_entry_id MUST NOT be NULL for purchase invoices
    if (!result.journalEntryId) {
      console.error('[createPurchaseInvoice] CRITICAL: JE_CREATE_FAILED - Invoice created without journal entry', {
        invoiceId: result.invoiceId,
        invoiceNumber: result.invoiceNumber,
      });
      
      // This should never happen with atomic RPC, but if it does, we fail loudly
      return {
        success: false,
        error: {
          code: 'JE_CREATE_FAILED',
          message: 'Purchase invoice created but journal entry is missing. This is a critical error.',
        },
      };
    }

    console.log('[createPurchaseInvoice] Success via atomic RPC', {
      invoiceId: result.invoiceId,
      invoiceNumber: result.invoiceNumber,
      journalEntryId: result.journalEntryId,
      cached: result.cached,
    });

    return {
      success: true,
      data: {
        invoiceId: result.invoiceId!,
        invoiceNumber: result.invoiceNumber!,
        journalEntryId: result.journalEntryId,
      },
    };
  } catch (error: unknown) {
    console.error('[createPurchaseInvoice] Unexpected error:', error);
    return {
      success: false,
      error: {
        code: 'UNEXPECTED_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error during purchase invoice creation',
      },
    };
  }
}

/**
 * Updates an existing purchase invoice
 * Routes through purchase_invoice_update_v2_atomic RPC for governed atomicity
 * NEVER performs direct writes to purchase_invoice_lines
 */
export async function updatePurchaseInvoice(
  cmd: UpdatePurchaseInvoiceCommand
): Promise<CommandResult<CreateInvoiceResult>> {
  // Validate and sanitize
  const validation = validateUpdatePurchaseInvoice(cmd);
  if (!validation.valid) {
    return {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: validation.errors.map(e => e.message).join('; '),
      },
    };
  }

  const sanitizedCmd = validation.sanitizedCommand as UpdatePurchaseInvoiceCommand;
  logSanitizedPayload(cmd, sanitizedCmd, 'UpdatePurchaseInvoice');

  try {
    // Generate client_request_id for idempotency
    const clientRequestId = crypto.randomUUID();

    // Build RPC payload matching purchase_invoice_update_v2_atomic expected structure
    // IMPORTANT: branch_id is NOT sent - RPC does not allow branch change
    // IMPORTANT: tax_rate from UI is ALREADY PERCENT (15), send as-is (NO multiplication)
    // UI convention: UnifiedInvoiceLineRow uses tax_rate=15, calculates with taxRate/100
    const rpcPayload = {
      client_request_id: clientRequestId,
      invoice: {
        id: sanitizedCmd.id,
        supplier_id: sanitizedCmd.supplierId || null,
        invoice_date: sanitizedCmd.invoiceDate || null,
        due_date: sanitizedCmd.dueDate || null,
        notes: sanitizedCmd.notes !== undefined ? sanitizedCmd.notes : null,
        // NOTE: branch_id intentionally omitted - RPC blocks branch changes
      },
      items: sanitizedCmd.lines ? sanitizedCmd.lines.map((line, index) => ({
        line_number: line.lineNumber || index + 1,
        item_type: line.itemType,
        product_id: line.itemType === 'jewelry' ? (line.itemId || null) : null,
        cost_entry_id: line.itemType === 'cost' ? (line.itemId || null) : null,
        product_code: line.itemCode || null,
        description: line.description || null,
        quantity: line.quantity,
        unit_price: line.unitPrice,
        tax_rate: line.taxRate, // PERCENT (15) - NO conversion needed, UI already uses percent
        discount_amount: line.discountAmount || 0,
        is_inclusive: line.isInclusive || false,
        gl_account_id: line.glAccountId || null,
        warehouse_account_id: line.warehouseAccountId || null,
      })) : [],
    };

    console.log('[updatePurchaseInvoice] Calling purchase_invoice_update_v2_atomic RPC', {
      clientRequestId,
      invoiceId: sanitizedCmd.id,
      linesCount: rpcPayload.items.length,
    });

    // Call the atomic RPC - single point of truth for invoice updates
    const { data: rpcResult, error: rpcError } = await dataGateway.rpc(
      'purchase_invoice_update_v2_atomic',
      { p_payload: rpcPayload }
    );

    if (rpcError) {
      console.error('[updatePurchaseInvoice] RPC error:', rpcError);
      return {
        success: false,
        error: {
          code: 'RPC_ERROR',
          message: rpcError.message,
        },
      };
    }

    // Parse RPC response
    const result = rpcResult as {
      success: boolean;
      cached?: boolean;
      invoice_id?: string;
      invoice_number?: string;
      subtotal?: number;
      tax_amount?: number;
      total_amount?: number;
      lines_count?: number;
      error_code?: string;
      error?: string;
    };

    if (!result.success) {
      console.error('[updatePurchaseInvoice] RPC returned failure:', result);
      return {
        success: false,
        error: {
          code: result.error_code || 'RPC_FAILED',
          message: result.error || 'Purchase invoice update failed in atomic RPC',
        },
      };
    }

    console.log('[updatePurchaseInvoice] Success via atomic RPC', {
      invoiceId: result.invoice_id,
      invoiceNumber: result.invoice_number,
      linesCount: result.lines_count,
      totalAmount: result.total_amount,
      cached: result.cached,
    });

    return {
      success: true,
      data: {
        invoiceId: result.invoice_id || sanitizedCmd.id,
        invoiceNumber: result.invoice_number || '',
        // Note: journalEntryId not returned by update RPC (existing JE preserved)
      },
    };
  } catch (error: unknown) {
    console.error('[updatePurchaseInvoice] Unexpected error:', error);
    return {
      success: false,
      error: {
        code: 'UNEXPECTED_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error during purchase invoice update',
      },
    };
  }
}

/**
 * Upserts a purchase invoice (create or update based on presence of id)
 * Convenience wrapper that routes to create or update
 */
export async function upsertPurchaseInvoice(
  cmd: UpsertPurchaseInvoiceCommand
): Promise<CommandResult<UpsertPurchaseInvoiceResult>> {
  if (isUpdateCommand(cmd)) {
    // Update existing invoice
    const result = await updatePurchaseInvoice(cmd);
    if (!result.success) {
      return {
        success: false,
        error: result.error,
      };
    }
    return {
      success: true,
      data: {
        invoiceId: result.data?.invoiceId || cmd.id,
        invoiceNumber: result.data?.invoiceNumber,
        journalEntryId: result.data?.journalEntryId,
      } as UpdatePurchaseInvoiceResult,
    };
  } else {
    // Create new invoice
    const createCmd = cmd as CreatePurchaseInvoiceCommand;
    const result = await createPurchaseInvoice(createCmd);
    if (!result.success) {
      return {
        success: false,
        error: result.error,
      };
    }
    return {
      success: true,
      data: {
        invoiceId: result.data?.invoiceId || '',
        invoiceNumber: result.data?.invoiceNumber || '',
        journalEntryId: result.data?.journalEntryId,
      } as CreatePurchaseInvoiceResult,
    };
  }
}

// ===========================
// Legacy Functions Removed (P3-2 Cleanup)
// ===========================
// The following functions have been removed as part of P3-2 cleanup:
// - createPurchaseReturnGeneral → Use createPurchaseReturnGeneralAtomic()
// - createPurchaseReturnUnique → Use createPurchaseReturnUniqueAtomic()  
// - createSupplierPayment → Use payment_voucher_atomic RPC
// - cancelPurchaseReturn → Use voidPurchaseReturnAtomic()
// - cancelPurchaseInvoice → Use purchase_invoice_void_atomic RPC
// See docs/purchasing_v2/P3-2_cleanup_changes.md for migration details.

// ===========================
// Import Summary Operations
// ===========================

/**
 * Rebuild import summary for an invoice
 * Calculates total from unique_items and updates/inserts summary line
 * NOTE: Moved from purchasingReadService due to write operations
 */
export async function rebuildImportSummary(
  invoiceId: string
): Promise<{ itemsCount: number; totalCost: number }> {
  // Calculate summary from unique_items
  const { data: summaryData, error: summaryError } = await dataGateway.queryTable('unique_items', {
    select: 'cost',
    filters: [{ type: 'eq', column: 'purchase_invoice_id', value: invoiceId }],
  });

  if (summaryError) throw new Error(summaryError.message);

  const itemsCount = summaryData?.length || 0;
  const totalCost = summaryData?.reduce((sum, item) => sum + (item.cost || 0), 0) || 0;

  if (itemsCount === 0) {
    throw new Error('NO_ITEMS_LINKED');
  }

  // Check if summary line exists
  const { data: existingLine } = await dataGateway.queryTable('purchase_invoice_lines', {
    select: 'id',
    filters: [
      { type: 'eq', column: 'invoice_id', value: invoiceId },
      { type: 'eq', column: 'line_kind', value: 'import_summary' },
    ],
    maybeSingle: true,
  });

  if (existingLine) {
    // Update existing line - BLOCKED: Use atomic RPC
    forbidDirectWrite('update', 'src/domain/purchasing/purchasingWriteService.ts:541');
  } else {
    // Insert new line - BLOCKED: Use atomic RPC
    forbidDirectWrite('insert', 'src/domain/purchasing/purchasingWriteService.ts:558');
  }

  return { itemsCount, totalCost };
}

// ===========================
// Email Invoice
// ===========================

export interface SendInvoiceEmailCommand {
  invoiceId: string;
  invoiceNumber: string;
  supplierEmail: string | null;
  supplierName: string;
  invoiceDate: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  language: 'ar' | 'en';
}

export interface SendInvoiceEmailResult {
  success: boolean;
  error?: string;
}

/**
 * Send invoice email and log audit trail
 */
export async function sendInvoiceEmail(cmd: SendInvoiceEmailCommand): Promise<SendInvoiceEmailResult> {
  const formatCurrency = (value: number) =>
    new Intl.NumberFormat(cmd.language === 'ar' ? 'ar-SA' : 'en-SA', {
      style: 'currency',
      currency: 'SAR',
      minimumFractionDigits: 2,
    }).format(value);

  const formatDate = (date: string) => {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  try {
    const emailRes = await fetch('/api/email/send-invoice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: cmd.supplierEmail,
        customerName: cmd.supplierName,
        invoiceNumber: cmd.invoiceNumber,
        invoiceType: cmd.language === 'ar' ? 'فاتورة مشتريات' : 'Purchase Invoice',
        invoiceDate: formatDate(cmd.invoiceDate),
        totalAmount: formatCurrency(cmd.totalAmount),
        paidAmount: formatCurrency(cmd.paidAmount),
        remainingAmount: formatCurrency(cmd.remainingAmount),
      }),
    });
    const { error } = await emailRes.json();

    if (error) throw new Error(error.message);

    // Log audit trail - BLOCKED: Use atomic RPC
    forbidDirectWrite('insert', 'src/domain/purchasing/purchasingWriteService.ts:634');
  } catch (err: any) {
    console.error('sendInvoiceEmail error:', err);
    return { success: false, error: err.message };
  }
}

// ===========================
// Quick Create Supplier
// ===========================

export interface QuickCreateSupplierCommand {
  supplierName: string;
  supplierType?: string;
  mobilePhone?: string | null;
  email?: string | null;
  vatNumber?: string | null;
  country?: string;
  city?: string | null;
}

export interface QuickCreateSupplierResult {
  success: boolean;
  supplierId?: string;
  supplierCode?: string;
  error?: string;
}

/**
 * Quick create a supplier (minimal fields) from invoice forms
 */
export async function quickCreateSupplier(cmd: QuickCreateSupplierCommand): Promise<QuickCreateSupplierResult> {
  try {
    // Check for duplicate VAT
    if (cmd.vatNumber) {
      const { data: existing } = await dataGateway.queryTable('suppliers', {
        select: 'id',
        filters: [{ type: 'eq', column: 'vat_number', value: cmd.vatNumber }],
        maybeSingle: true,
      });

      if (existing) {
        return { success: false, error: 'الرقم الضريبي مستخدم بالفعل' };
      }
    }

    // BLOCKED: Use atomic RPC for supplier creation
    forbidDirectWrite('insert', 'src/domain/purchasing/purchasingWriteService.ts:688');
  } catch (err: any) {
    console.error('quickCreateSupplier error:', err);
    return { success: false, error: err.message || 'خطأ غير متوقع' };
  }
}

// ===========================
// Purchase Requisition Commands
// ===========================

export interface PRLineItemCommand {
  id?: string;
  itemDescription: string;
  itemCode?: string;
  jewelryItemId?: string;
  quantity: number;
  unit: string;
  estimatedUnitPrice: number;
  supplierId?: string;
  warehouseId?: string;
  costCenterId?: string;
  notes?: string;
}

export interface UpsertPurchaseRequisitionCommand {
  id?: string; // If provided, update; otherwise create
  branchId?: string;
  departmentId?: string;
  warehouseId?: string;
  costCenterId?: string;
  requiredDate?: string;
  priority: string;
  requisitionType: string;
  justification?: string;
  notes?: string;
  items: PRLineItemCommand[];
  userId: string;
  userName: string;
}

export interface UpsertPurchaseRequisitionResult {
  success: boolean;
  requisitionId?: string;
  requisitionNumber?: string;
  error?: string;
}

function calculateRequiredApprovalLevel(amount: number): number {
  if (amount <= 5000) return 1;
  if (amount <= 25000) return 2;
  return 3;
}

/**
 * Create or update a purchase requisition
 */
export async function upsertPurchaseRequisition(cmd: UpsertPurchaseRequisitionCommand): Promise<UpsertPurchaseRequisitionResult> {
  try {
    const validItems = cmd.items.filter(item => item.itemDescription.trim());
    if (validItems.length === 0) {
      return { success: false, error: 'يجب إضافة بند واحد على الأقل' };
    }

    const invalidItems = validItems.filter(item => item.quantity <= 0);
    if (invalidItems.length > 0) {
      return { success: false, error: 'لا يُسمح بكمية صفرية أو سالبة' };
    }

    const totalEstimated = validItems.reduce((sum, item) => sum + (item.quantity * item.estimatedUnitPrice), 0);
    const requiredLevel = calculateRequiredApprovalLevel(totalEstimated);

    if (cmd.id) {
      // UPDATE MODE - BLOCKED: Use atomic RPC
      forbidDirectWrite('update', 'src/domain/purchasing/purchasingWriteService.ts:725');
    } else {
      // CREATE MODE - BLOCKED: Use atomic RPC
      forbidDirectWrite('insert', 'src/domain/purchasing/purchasingWriteService.ts:802');
    }
  } catch (err: any) {
    console.error('upsertPurchaseRequisition error:', err);
    return { success: false, error: err.message || 'خطأ غير متوقع' };
  }
}

// ===========================
// Purchase Requisition Approval
// ===========================

export interface ApprovePurchaseRequisitionCommand {
  requisitionId: string;
  action: 'approve' | 'reject' | 'hold';
  comments?: string;
  userId: string;
  userName: string;
  userRole: string;
  // PR data needed for notifications
  requisitionNumber: string;
  currentApprovalLevel: number;
  requiredApprovalLevel: number;
  createdBy: string;
  departmentId?: string;
}

export interface ApprovePurchaseRequisitionResult {
  success: boolean;
  newStatus?: string;
  newLevel?: number;
  error?: string;
}

/**
 * Approve, reject, or hold a purchase requisition
 */
export async function approvePurchaseRequisition(cmd: ApprovePurchaseRequisitionCommand): Promise<ApprovePurchaseRequisitionResult> {
  try {
    if ((cmd.action === 'reject' || cmd.action === 'hold') && !cmd.comments?.trim()) {
      return { success: false, error: cmd.action === 'reject' ? 'يجب إدخال سبب الرفض' : 'يجب إدخال سبب التعليق' };
    }

    const currentLevel = cmd.currentApprovalLevel || 0;
    const requiredLevel = cmd.requiredApprovalLevel || 1;

    let newStatus: string;
    let newLevel: number;
    let updateData: any = {};

    if (cmd.action === 'approve') {
      newLevel = currentLevel + 1;
      if (newLevel >= requiredLevel) {
        newStatus = 'approved';
        updateData.approved_by = cmd.userId;
        updateData.approved_at = new Date().toISOString();
      } else if (newLevel === 1) {
        newStatus = 'pending_procurement';
      } else if (newLevel === 2) {
        newStatus = 'pending_management';
      } else {
        newStatus = 'approved';
      }
      updateData.current_approval_level = newLevel;
      updateData.status = newStatus;
    } else if (cmd.action === 'reject') {
      newStatus = 'rejected';
      newLevel = currentLevel;
      updateData.status = 'rejected';
      updateData.rejection_reason = cmd.comments;
      updateData.approved_by = cmd.userId;
      updateData.approved_at = new Date().toISOString();
    } else {
      // hold
      newStatus = 'on_hold';
      newLevel = currentLevel;
      updateData.status = 'on_hold';
    }

    // BLOCKED: Use atomic RPC for purchase requisition approval
    forbidDirectWrite('update', 'src/domain/purchasing/purchasingWriteService.ts:944');
  } catch (err: any) {
    console.error('approvePurchaseRequisition error:', err);
    return { success: false, error: err.message || 'خطأ غير متوقع' };
  }
}

// ===========================
// Import Payment Commands & Functions
// ===========================

export interface ImportPaymentExpenseInput {
  expenseType: string;
  amount: number;
}

export interface ProcessImportPaymentCommand {
  id?: string; // If provided, update; otherwise create
  invoiceId: string;
  supplierId?: string | null;
  paymentDate: string;
  paymentMethod: string;
  documentNumber?: string | null;
  currency: string;
  exchangeRate: number;
  amount: number;
  notes?: string | null;
  useDistribution: boolean;
  expenses: ImportPaymentExpenseInput[];
}

export interface ProcessImportPaymentResult {
  success: boolean;
  paymentId?: string;
  error?: string;
}

/**
 * Create or update an import payment
 * BLOCKED: Use atomic RPC instead
 */
export async function processImportPayment(cmd: ProcessImportPaymentCommand): Promise<ProcessImportPaymentResult> {
  const isEditing = !!cmd.id;
  if (isEditing) {
    // BLOCKED: Use atomic RPC for payment update
    forbidDirectWrite('update', 'src/domain/purchasing/purchasingWriteService.ts:871');
  } else {
    // BLOCKED: Use atomic RPC for payment insert
    forbidDirectWrite('insert', 'src/domain/purchasing/purchasingWriteService.ts:890');
  }
}

/**
 * Delete an import payment
 * BLOCKED: Use atomic RPC instead
 */
export async function deleteImportPayment(paymentId: string): Promise<{ success: boolean; error?: string }> {
  // BLOCKED: Use atomic RPC for payment deletion
  forbidDirectWrite('delete', 'src/domain/purchasing/purchasingWriteService.ts:939');
}

// ===========================
// Purchase Orders Write Service
// ===========================

export interface CreatePurchaseOrderCommand {
  supplierId: string | null;
  branchId: string | null;
  orderType: string;
  expectedDeliveryDate: string | null;
  notes: string | null;
  createdBy: string;
}

export interface CreatePurchaseOrderResult {
  success: boolean;
  poId?: string;
  poNumber?: string;
  error?: string;
}

export interface ApprovePurchaseOrderCommand {
  poId: string;
  approvedBy: string;
}

export interface ApprovePurchaseOrderResult {
  success: boolean;
  error?: string;
}

/**
 * Create a new purchase order via V2 atomic RPC
 * P2-1: All writes go through atomic RPC with idempotency
 */
export async function createPurchaseOrder(cmd: CreatePurchaseOrderCommand): Promise<CreatePurchaseOrderResult> {
  try {
    const clientRequestId = crypto.randomUUID();

    const rpcPayload = {
      client_request_id: clientRequestId,
      supplier_id: cmd.supplierId || null,
      branch_id: cmd.branchId || null,
      order_type: cmd.orderType,
      expected_delivery_date: cmd.expectedDeliveryDate || null,
      notes: cmd.notes || null,
      created_by: cmd.createdBy,
    };

    console.log('[createPurchaseOrder] Calling purchase_order_create_v2_atomic', { clientRequestId });

    const { data: result, error } = await dataGateway.rpc('purchase_order_create_v2_atomic', {
      p_payload: rpcPayload,
    });

    if (error) {
      console.error('[createPurchaseOrder] RPC error:', error);
      return { success: false, error: error.message };
    }

    const rpcResult = result as { success: boolean; order_id?: string; order_number?: string; error_code?: string; error?: string };

    if (!rpcResult.success) {
      console.error('[createPurchaseOrder] RPC returned failure:', rpcResult);
      return { success: false, error: rpcResult.error || rpcResult.error_code || 'Unknown error' };
    }

    console.log('[createPurchaseOrder] Success via V2 atomic RPC', { orderId: rpcResult.order_id, orderNumber: rpcResult.order_number });

    return { success: true, poId: rpcResult.order_id, poNumber: rpcResult.order_number };
  } catch (err: any) {
    console.error('createPurchaseOrder error:', err);
    return { success: false, error: err.message || 'Unexpected error' };
  }
}

/**
 * Approve a purchase order via V2 atomic RPC
 * P2-1: Uses purchase_order_update_v2_atomic with action='approve'
 */
export async function approvePurchaseOrder(cmd: ApprovePurchaseOrderCommand): Promise<ApprovePurchaseOrderResult> {
  try {
    const clientRequestId = crypto.randomUUID();

    const rpcPayload = {
      client_request_id: clientRequestId,
      order_id: cmd.poId,
      action: 'approve',
      approved_by: cmd.approvedBy,
    };

    console.log('[approvePurchaseOrder] Calling purchase_order_update_v2_atomic', { clientRequestId, poId: cmd.poId });

    const { data: result, error } = await dataGateway.rpc('purchase_order_update_v2_atomic', {
      p_payload: rpcPayload,
    });

    if (error) {
      console.error('[approvePurchaseOrder] RPC error:', error);
      return { success: false, error: error.message };
    }

    const rpcResult = result as { success: boolean; error_code?: string; error?: string };

    if (!rpcResult.success) {
      console.error('[approvePurchaseOrder] RPC returned failure:', rpcResult);
      return { success: false, error: rpcResult.error || rpcResult.error_code || 'Unknown error' };
    }

    console.log('[approvePurchaseOrder] Success via V2 atomic RPC');

    return { success: true };
  } catch (err: any) {
    console.error('approvePurchaseOrder error:', err);
    return { success: false, error: err.message || 'Unexpected error' };
  }
}

// ===========================
// PO Items Write Commands
// ===========================

export interface AddPOItemCommand {
  poId: string;
  itemType: string;
  description: string | null;
  karatId: string | null;
  gemstoneTypeId: string | null;
  rawMaterialId: string | null;
  quantity: number;
  weightGrams: number | null;
  unitPrice: number;
  // For recalculating PO totals
  currentTotalAmount: number;
  currentTotalGoldWeight: number;
}

export interface AddPOItemResult {
  success: boolean;
  itemId?: string;
  error?: string;
}

/**
 * Add item to a purchase order via V2 atomic RPC
 * P2-1: Uses purchase_order_update_v2_atomic with action='add_item'
 */
export async function addPOItem(cmd: AddPOItemCommand): Promise<AddPOItemResult> {
  try {
    if (cmd.quantity <= 0 && (!cmd.weightGrams || cmd.weightGrams <= 0)) {
      return { success: false, error: 'الكمية أو الوزن يجب أن يكون أكبر من صفر' };
    }

    const clientRequestId = crypto.randomUUID();

    const rpcPayload = {
      client_request_id: clientRequestId,
      order_id: cmd.poId,
      action: 'add_item',
      item: {
        item_type: cmd.itemType,
        description: cmd.description || null,
        karat_id: cmd.karatId || null,
        gemstone_type_id: cmd.gemstoneTypeId || null,
        raw_material_id: cmd.rawMaterialId || null,
        quantity: cmd.quantity,
        weight_grams: cmd.weightGrams || null,
        unit_price: cmd.unitPrice,
      },
    };

    console.log('[addPOItem] Calling purchase_order_update_v2_atomic', { clientRequestId, poId: cmd.poId });

    const { data: result, error } = await dataGateway.rpc('purchase_order_update_v2_atomic', {
      p_payload: rpcPayload,
    });

    if (error) {
      console.error('[addPOItem] RPC error:', error);
      return { success: false, error: error.message };
    }

    const rpcResult = result as { success: boolean; item_id?: string; error_code?: string; error?: string };

    if (!rpcResult.success) {
      console.error('[addPOItem] RPC returned failure:', rpcResult);
      return { success: false, error: rpcResult.error || rpcResult.error_code || 'Unknown error' };
    }

    console.log('[addPOItem] Success via V2 atomic RPC', { itemId: rpcResult.item_id });

    return { success: true, itemId: rpcResult.item_id };
  } catch (err: any) {
    console.error('addPOItem error:', err);
    return { success: false, error: err.message || 'فشل في إضافة الصنف' };
  }
}

export interface DuplicatePOItemCommand {
  poId: string;
  sourceItemId: string;
  // Source item data for duplication
  itemType: string;
  description: string | null;
  karatId: string | null;
  gemstoneTypeId: string | null;
  rawMaterialId: string | null;
  quantity: number;
  weightGrams: number | null;
  unitPrice: number | null;
  totalPrice: number | null;
  // For recalculating PO totals
  currentTotalAmount: number;
  currentTotalGoldWeight: number;
}

export interface DuplicatePOItemResult {
  success: boolean;
  newItemId?: string;
  error?: string;
}

/**
 * Duplicate an existing PO item via V2 atomic RPC
 * P2-1: Uses addPOItem internally which calls the V2 RPC
 */
export async function duplicatePOItem(cmd: DuplicatePOItemCommand): Promise<DuplicatePOItemResult> {
  try {
    // Use addPOItem which now uses V2 atomic RPC
    const addResult = await addPOItem({
      poId: cmd.poId,
      itemType: cmd.itemType,
      description: cmd.description,
      karatId: cmd.karatId,
      gemstoneTypeId: cmd.gemstoneTypeId,
      rawMaterialId: cmd.rawMaterialId,
      quantity: cmd.quantity,
      weightGrams: cmd.weightGrams,
      unitPrice: cmd.unitPrice || 0,
      currentTotalAmount: cmd.currentTotalAmount,
      currentTotalGoldWeight: cmd.currentTotalGoldWeight,
    });

    if (!addResult.success) {
      return { success: false, error: addResult.error };
    }

    return { success: true, newItemId: addResult.itemId };
  } catch (err: any) {
    console.error('duplicatePOItem error:', err);
    return { success: false, error: err.message || 'فشل في نسخ الصنف' };
  }
}

export interface DeletePOItemCommand {
  poId: string;
  itemId: string;
  // Item data for recalculating PO totals
  itemType: string;
  totalPrice: number;
  weightGrams: number | null;
  // Current PO totals
  currentTotalAmount: number;
  currentTotalGoldWeight: number;
}

export interface DeletePOItemResult {
  success: boolean;
  error?: string;
}

/**
 * Delete a PO item via V2 atomic RPC
 * P2-1: Uses purchase_order_update_v2_atomic with action='delete_item'
 */
export async function deletePOItem(cmd: DeletePOItemCommand): Promise<DeletePOItemResult> {
  try {
    const clientRequestId = crypto.randomUUID();

    const rpcPayload = {
      client_request_id: clientRequestId,
      order_id: cmd.poId,
      action: 'delete_item',
      item_id: cmd.itemId,
    };

    console.log('[deletePOItem] Calling purchase_order_update_v2_atomic', { clientRequestId, poId: cmd.poId, itemId: cmd.itemId });

    const { data: result, error } = await dataGateway.rpc('purchase_order_update_v2_atomic', {
      p_payload: rpcPayload,
    });

    if (error) {
      console.error('[deletePOItem] RPC error:', error);
      return { success: false, error: error.message };
    }

    const rpcResult = result as { success: boolean; error_code?: string; error?: string };

    if (!rpcResult.success) {
      console.error('[deletePOItem] RPC returned failure:', rpcResult);
      return { success: false, error: rpcResult.error || rpcResult.error_code || 'Unknown error' };
    }

    console.log('[deletePOItem] Success via V2 atomic RPC');

    return { success: true };
  } catch (err: any) {
    console.error('deletePOItem error:', err);
    return { success: false, error: err.message || 'فشل في حذف الصنف' };
  }
}

export interface SubmitPOForApprovalCommand {
  poId: string;
  poNumber: string;
}

export interface SubmitPOForApprovalResult {
  success: boolean;
  error?: string;
}

/**
 * Submit a PO for approval (draft → pending) via V2 atomic RPC
 * P2-1: Uses purchase_order_update_v2_atomic with action='submit'
 */
export async function submitPOForApproval(cmd: SubmitPOForApprovalCommand): Promise<SubmitPOForApprovalResult> {
  try {
    const clientRequestId = crypto.randomUUID();

    const rpcPayload = {
      client_request_id: clientRequestId,
      order_id: cmd.poId,
      action: 'submit',
    };

    console.log('[submitPOForApproval] Calling purchase_order_update_v2_atomic', { clientRequestId, poId: cmd.poId });

    const { data: result, error } = await dataGateway.rpc('purchase_order_update_v2_atomic', {
      p_payload: rpcPayload,
    });

    if (error) {
      console.error('[submitPOForApproval] RPC error:', error);
      return { success: false, error: error.message };
    }

    const rpcResult = result as { success: boolean; error_code?: string; error?: string };

    if (!rpcResult.success) {
      console.error('[submitPOForApproval] RPC returned failure:', rpcResult);
      return { success: false, error: rpcResult.error || rpcResult.error_code || 'Unknown error' };
    }

    console.log('[submitPOForApproval] Success via V2 atomic RPC');

    return { success: true };
  } catch (err: any) {
    console.error('submitPOForApproval error:', err);
    return { success: false, error: err.message || 'فشل في إرسال أمر الشراء' };
  }
}

export interface SendPOToSupplierCommand {
  poId: string;
  poNumber: string;
}

export interface SendPOToSupplierResult {
  success: boolean;
  error?: string;
}

/**
 * Mark PO as sent to supplier via V2 atomic RPC
 * P2-1: Uses purchase_order_update_v2_atomic with action='send'
 */
export async function sendPOToSupplier(cmd: SendPOToSupplierCommand): Promise<SendPOToSupplierResult> {
  try {
    const clientRequestId = crypto.randomUUID();

    const rpcPayload = {
      client_request_id: clientRequestId,
      order_id: cmd.poId,
      action: 'send',
    };

    console.log('[sendPOToSupplier] Calling purchase_order_update_v2_atomic', { clientRequestId, poId: cmd.poId });

    const { data: result, error } = await dataGateway.rpc('purchase_order_update_v2_atomic', {
      p_payload: rpcPayload,
    });

    if (error) {
      console.error('[sendPOToSupplier] RPC error:', error);
      return { success: false, error: error.message };
    }

    const rpcResult = result as { success: boolean; error_code?: string; error?: string };

    if (!rpcResult.success) {
      console.error('[sendPOToSupplier] RPC returned failure:', rpcResult);
      return { success: false, error: rpcResult.error || rpcResult.error_code || 'Unknown error' };
    }

    console.log('[sendPOToSupplier] Success via V2 atomic RPC');

    return { success: true };
  } catch (err: any) {
    console.error('sendPOToSupplier error:', err);
    return { success: false, error: err.message || 'فشل في تسجيل الإرسال' };
  }
}

// ===========================
// PO Receive Commands
// ===========================

export interface ReceivePOItemInput {
  itemId: string;
  itemType: string;
  description: string | null;
  quantityOrdered: number;
  weightOrdered: number | null;
  quantityReceived: number;
  weightReceived: number;
  quantityRejected: number;
  unitPrice: number | null;
  karatId: string | null;
  gemstoneTypeId: string | null;
  gemstoneTypeName: string | null;
  warehouseId: string | null;
  notes: string;
  previousReceivedQty: number;
  previousReceivedWeight: number;
}

export interface ReceivePOItemsCommand {
  poId: string;
  poNumber: string;
  supplierId: string | null;
  supplierName: string | null;
  branchId: string | null;
  defaultWarehouseId: string | null;
  selectedVaultId: string | null;
  generalNotes: string;
  items: ReceivePOItemInput[];
  receivedBy: string | null;
  receivedByName: string | null;
}

export interface ReceivePOItemsResult {
  success: boolean;
  grnNumber?: string;
  grnId?: string;
  error?: string;
}

/**
 * Receive PO items via V2 atomic RPC
 * P2-1: Uses purchase_order_receive_v2_atomic for atomic GRN creation and inventory effects
 */
export async function receivePOItems(cmd: ReceivePOItemsCommand): Promise<ReceivePOItemsResult> {
  try {
    const itemsToReceive = cmd.items.filter(item => item.quantityReceived > 0 || item.weightReceived > 0);
    
    if (itemsToReceive.length === 0) {
      return { success: false, error: 'يرجى تحديد الكميات المستلمة' };
    }

    const clientRequestId = crypto.randomUUID();

    // Build receipts array for RPC
    const receipts = itemsToReceive.map(item => ({
      item_id: item.itemId,
      quantity_received: item.quantityReceived,
      weight_received: item.weightReceived,
      quantity_rejected: item.quantityRejected,
      notes: item.notes || null,
    }));

    const rpcPayload = {
      client_request_id: clientRequestId,
      order_id: cmd.poId,
      vault_id: cmd.selectedVaultId || null,
      warehouse_id: cmd.defaultWarehouseId || cmd.branchId || null,
      notes: cmd.generalNotes || null,
      received_by: cmd.receivedByName || cmd.receivedBy || 'system',
      receipts,
    };

    console.log('[receivePOItems] Calling purchase_order_receive_v2_atomic', { 
      clientRequestId, 
      poId: cmd.poId, 
      itemsCount: receipts.length 
    });

    const { data: result, error } = await dataGateway.rpc('purchase_order_receive_v2_atomic', {
      p_payload: rpcPayload,
    });

    if (error) {
      console.error('[receivePOItems] RPC error:', error);
      return { success: false, error: error.message };
    }

    const rpcResult = result as { 
      success: boolean; 
      grn_id?: string; 
      grn_number?: string; 
      error_code?: string; 
      error?: string;
      new_po_status?: string;
    };

    if (!rpcResult.success) {
      console.error('[receivePOItems] RPC returned failure:', rpcResult);
      return { success: false, error: rpcResult.error || rpcResult.error_code || 'Unknown error' };
    }

    console.log('[receivePOItems] Success via V2 atomic RPC', { 
      grnId: rpcResult.grn_id, 
      grnNumber: rpcResult.grn_number,
      newPOStatus: rpcResult.new_po_status
    });

    return { success: true, grnNumber: rpcResult.grn_number, grnId: rpcResult.grn_id };
  } catch (err: any) {
    console.error('receivePOItems error:', err);
    return { success: false, error: err.message || 'Unexpected error' };
  }
}

// ===========================
// Payment Voucher Commands & Results
// ===========================

export interface GeneratePaymentVoucherNumberResult {
  paymentNumber: string;
}

/**
 * Payment Voucher Atomic Command (PV-1 + PV-3B)
 * clientRequestId is REQUIRED for idempotency
 * lines is OPTIONAL - if not provided, server will derive from payment_account_settings
 */
export interface CreatePaymentVoucherCommand {
  /** Required for idempotency - must be a valid UUID */
  clientRequestId: string;
  /** 'payment' for supplier payments, 'receipt' for customer receipts */
  paymentType?: 'payment' | 'receipt';
  paymentDate: string;
  amount: number;
  paymentMethod: string;
  supplierId?: string | null;
  customerId?: string | null;
  invoiceId?: string | null;
  notes?: string | null;
  supplierName?: string | null;
  customerName?: string | null;
  branchId?: string | null;
  /** 
   * OPTIONAL: Account lines for journal entry
   * PV-3B: If not provided, server will derive lines using derive_payment_voucher_lines()
   * Derivation uses payment_account_settings + supplier/customer account_id
   */
  lines?: {
    accountId: string;
    debitAmount?: number;
    creditAmount?: number;
    description?: string;
  }[];
  /**
   * SET-1: Invoice allocations for this payment
   * When provided, the RPC will:
   * 1. Insert into supplier_payment_allocations
   * 2. Update invoices.paid_amount and remaining_amount
   * 3. Update invoice status (paid/partial)
   * 
   * SET-HB: For supplier payments (supplierId set), allocations are REQUIRED
   * unless allowUnallocated is true.
   */
  allocations?: {
    invoiceId: string;
    amount: number;
  }[];
  /**
   * SET-HB: Allow creating supplier payment without allocations (advance payment)
   * This is an admin escape hatch - should be used sparingly
   * Customer receipts are NOT affected by this flag
   */
  allowUnallocated?: boolean;
}

export interface CreatePaymentVoucherResult {
  success: boolean;
  paymentId?: string;
  paymentNumber?: string;
  journalEntryId?: string | null;
  journalEntryNumber?: string | null;
  error?: string;
  errorCode?: 'VALIDATION' | 'IN_PROGRESS' | 'IDEMPOTENCY_CONFLICT' | 'DB_ERROR' | 'WORKFLOW_ERROR' | 'LINES_REQUIRED';
  /** SET-1: Allocation results */
  allocatedTotal?: number;
  unallocatedRemainder?: number;
  allocationsCount?: number;
  touchedInvoices?: {
    invoiceId: string;
    allocatedAmount: number;
    newPaidAmount: number;
    newRemainingAmount: number;
    newStatus: string;
  }[];
  meta?: {
    workflowType: string;
    clientRequestId: string;
    payloadHash?: string;
  };
}

/**
 * PV-4: Update Payment Voucher Atomic Command
 * clientRequestId is REQUIRED for idempotency
 * lines is OPTIONAL - if not provided, server will derive
 */
export interface UpdatePaymentVoucherCommand {
  /** Required for idempotency - must be a valid UUID */
  clientRequestId: string;
  paymentId: string;
  /** Patch fields - only provided fields will be updated */
  payment?: {
    paymentDate?: string;
    amount?: number;
    paymentMethod?: string;
    supplierId?: string | null;
    customerId?: string | null;
    branchId?: string | null;
    notes?: string | null;
    currency?: string;
    exchangeRate?: number;
  };
  /** Optional: if not provided, server derives from updated payment */
  lines?: {
    accountId: string;
    debitAmount?: number;
    creditAmount?: number;
    description?: string;
  }[];
}

export interface UpdatePaymentVoucherResult {
  success: boolean;
  paymentId?: string;
  paymentNumber?: string;
  journalEntryId?: string | null;
  journalEntryNumber?: string | null;
  linesDerived?: boolean;
  reversedJournalEntryId?: string | null;
  error?: string;
  errorCode?: 'VALIDATION' | 'IN_PROGRESS' | 'IDEMPOTENCY_CONFLICT' | 'DB_ERROR' | 'JE_REVERSAL_FAILED';
}

/**
 * PV-4: Void/Delete Payment Voucher Atomic Command
 * Uses soft delete with reversal JE
 */
export interface VoidPaymentVoucherCommand {
  /** Required for idempotency - must be a valid UUID */
  clientRequestId: string;
  paymentId: string;
  voidReason?: string;
  voidDate?: string;
}

export interface VoidPaymentVoucherResult {
  success: boolean;
  paymentId?: string;
  paymentNumber?: string;
  voided?: boolean;
  alreadyVoided?: boolean;
  reversalJournalEntryId?: string | null;
  reversalEntryNumber?: string | null;
  error?: string;
  errorCode?: 'VALIDATION' | 'IN_PROGRESS' | 'IDEMPOTENCY_CONFLICT' | 'DB_ERROR' | 'JE_REVERSAL_FAILED';
}

// Legacy interfaces for backward compatibility
export interface DeletePaymentVoucherCommand {
  paymentId: string;
  clientRequestId?: string;
  voidReason?: string;
}

export interface DeletePaymentVoucherResult {
  success: boolean;
  error?: string;
  voided?: boolean;
}

// ===========================
// Payment Voucher Write Functions
// ===========================

export async function generatePaymentVoucherNumber(): Promise<GeneratePaymentVoucherNumberResult> {
  try {
    const { data, error } = await dataGateway.rpc('generate_payment_number', {
      payment_type_param: 'payment',
    });

    if (error || !data) {
      console.error('generatePaymentVoucherNumber error:', error);
      // Fallback
      const timestamp = Date.now().toString().slice(-8);
      return { paymentNumber: `PV-${timestamp}` };
    }

    return { paymentNumber: data };
  } catch (err) {
    console.error('generatePaymentVoucherNumber exception:', err);
    const timestamp = Date.now().toString().slice(-8);
    return { paymentNumber: `PV-${timestamp}` };
  }
}

/**
 * Creates a Payment Voucher atomically via the payment_voucher_atomic RPC (PV-1)
 * This is a THIN WRAPPER - all business logic is in the RPC
 * PV-2 COMPLIANT: No derivation logic - lines must be provided
 */
export async function createPaymentVoucher(
  cmd: CreatePaymentVoucherCommand
): Promise<CreatePaymentVoucherResult> {
  // Validate clientRequestId is required
  if (!cmd.clientRequestId) {
    return { 
      success: false, 
      error: 'clientRequestId is required for atomic payment voucher creation',
      errorCode: 'VALIDATION'
    };
  }

  // Validate amount
  if (!cmd.amount || cmd.amount <= 0) {
    return { 
      success: false, 
      error: 'المبلغ يجب أن يكون أكبر من صفر',
      errorCode: 'VALIDATION'
    };
  }

  // SET-HB: Belt-and-suspenders validation for supplier payments without allocations
  const paymentType = cmd.paymentType || 'payment';
  const isSupplierPayment = paymentType === 'payment' && cmd.supplierId;
  const hasAllocations = cmd.allocations && cmd.allocations.length > 0;
  
  if (isSupplierPayment && !hasAllocations && !cmd.allowUnallocated) {
    return {
      success: false,
      error: 'سند صرف المورد يتطلب توزيع على فواتير. لإنشاء دفعة مقدمة بدون توزيع، يرجى التواصل مع الإدارة.',
      errorCode: 'VALIDATION'
    };
  }

  // PV-3B: Lines are now OPTIONAL - server will derive if not provided
  // If lines ARE provided, validate they are balanced
  if (cmd.lines && cmd.lines.length > 0) {
    const totalDebit = cmd.lines.reduce((sum, l) => sum + (l.debitAmount || 0), 0);
    const totalCredit = cmd.lines.reduce((sum, l) => sum + (l.creditAmount || 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01 || totalDebit <= 0) {
      return {
        success: false,
        error: 'قيود اليومية يجب أن تكون متوازنة (مدين = دائن)',
        errorCode: 'VALIDATION'
      };
    }
  }

  try {
    // Build atomic payload (THIN WRAPPER - no business logic)
    // PV-3B: lines can be empty/undefined - server will derive
    const payment = {
      payment_type: paymentType,
      payment_date: cmd.paymentDate,
      amount: cmd.amount,
      payment_method: cmd.paymentMethod,
      supplier_id: cmd.supplierId || null,
      customer_id: cmd.customerId || null,
      invoice_id: cmd.invoiceId || null,
      branch_id: cmd.branchId || null,
      notes: cmd.notes || null,
    };

    const journal = {
      description: paymentType === 'receipt'
        ? (cmd.customerName ? `سند قبض من العميل ${cmd.customerName}` : 'سند قبض')
        : (cmd.supplierName ? `سند صرف للمورد ${cmd.supplierName}` : 'سند صرف'),
    };

    // Build lines array only if provided (PV-3B: server derives if missing)
    const lines = (cmd.lines && cmd.lines.length > 0)
      ? cmd.lines.map(l => ({
          account_id: l.accountId,
          debit_amount: l.debitAmount || 0,
          credit_amount: l.creditAmount || 0,
          description: l.description || null,
        }))
      : null;

    // SET-1: Build allocations array if provided
    const allocations = (cmd.allocations && cmd.allocations.length > 0)
      ? cmd.allocations.map(a => ({
          invoice_id: a.invoiceId,
          amount: a.amount,
        }))
      : null;

    const payload = {
      client_request_id: cmd.clientRequestId,
      payment,
      journal,
      ...(lines && { lines }),
      ...(allocations && { allocations }),
      // SET-HB: Pass allow_unallocated flag to RPC (admin escape hatch)
      ...(cmd.allowUnallocated && { allow_unallocated: true }),
    };

    // Call atomic RPC (THIN WRAPPER - all logic in DB)
    const { data, error } = await dataGateway.rpc('payment_voucher_atomic', {
      p_payload: payload
    });

    if (error) {
      console.error('payment_voucher_atomic RPC error:', error);
      return {
        success: false,
        error: error.message || 'فشل إنشاء السند',
        errorCode: 'DB_ERROR'
      };
    }

    // Handle RPC result (SET-1: includes allocation fields)
    const result = data as {
      success: boolean;
      paymentId?: string;
      paymentNumber?: string;
      journalEntryId?: string;
      journalEntryNumber?: string;
      allocatedTotal?: number;
      unallocatedRemainder?: number;
      allocationsCount?: number;
      touchedInvoices?: any[];
      meta?: { workflowType: string; clientRequestId: string; payloadHash?: string };
      error_code?: string;
      error?: string;
    };

    if (!result.success) {
      return {
        success: false,
        error: result.error || 'فشل إنشاء السند',
        errorCode: (result.error_code as CreatePaymentVoucherResult['errorCode']) || 'DB_ERROR'
      };
    }

    return {
      success: true,
      paymentId: result.paymentId,
      paymentNumber: result.paymentNumber,
      journalEntryId: result.journalEntryId,
      journalEntryNumber: result.journalEntryNumber,
      allocatedTotal: result.allocatedTotal,
      unallocatedRemainder: result.unallocatedRemainder,
      allocationsCount: result.allocationsCount,
      touchedInvoices: result.touchedInvoices?.map((inv: any) => ({
        invoiceId: inv.invoiceId,
        allocatedAmount: inv.allocatedAmount,
        newPaidAmount: inv.newPaidAmount,
        newRemainingAmount: inv.newRemainingAmount,
        newStatus: inv.newStatus,
      })),
      meta: result.meta
    };
  } catch (err: any) {
    console.error('createPaymentVoucher exception:', err);
    return { 
      success: false, 
      error: err.message || 'حدث خطأ غير متوقع',
      errorCode: 'DB_ERROR'
    };
  }
}

// ===========================
// PV-3 Reserved: derivePaymentJournalLines will be moved to DB/RPC
// The function below is ISOLATED and NOT used by createPaymentVoucher
// ===========================

/**
 * Derives journal entry lines for payment/receipt based on account settings
 * Uses payment_account_settings for cash/bank accounts and party-linked accounts
 */
async function derivePaymentJournalLines(params: {
  paymentType: 'payment' | 'receipt';
  amount: number;
  paymentMethod: string;
  supplierId?: string | null;
  customerId?: string | null;
  supplierName?: string | null;
  customerName?: string | null;
  branchId?: string | null;
}): Promise<{ success: boolean; lines?: CreatePaymentVoucherCommand['lines']; error?: string }> {
  const { paymentType, amount, paymentMethod, supplierId, customerId, supplierName, customerName, branchId } = params;
  
  try {
    // Get payment account settings resolved (branch-specific with global fallback)
    const { data: accountSettings } = await dataGateway.getPaymentAccountSettingsResolved(branchId);

    // Determine cash/bank account based on payment method
    let cashBankAccountId: string | null = null;
    if (accountSettings) {
      switch (paymentMethod) {
        case 'cash':
          cashBankAccountId = accountSettings.cash_account_id;
          break;
        case 'bank':
        case 'bank_transfer':
          cashBankAccountId = accountSettings.bank_transfer_account_id;
          break;
        case 'check':
          cashBankAccountId = accountSettings.check_account_id;
          break;
        case 'card':
        case 'credit_card':
          cashBankAccountId = accountSettings.card_account_id;
          break;
        default:
          cashBankAccountId = accountSettings.cash_account_id;
      }
    }

    if (!cashBankAccountId) {
      // Fallback: try to find by account code
      const fallbackCode = ['bank', 'bank_transfer', 'card', 'check', 'credit_card'].includes(paymentMethod) ? '110104' : '110101';
      const { data: fallbackAccount } = await dataGateway.queryTable('chart_of_accounts', {
        select: 'id',
        filters: [
          { type: 'eq', column: 'account_code', value: fallbackCode },
          { type: 'eq', column: 'is_active', value: true },
        ],
        maybeSingle: true,
      });
      
      if (fallbackAccount) {
        cashBankAccountId = fallbackAccount.id;
      } else {
        return { success: false, error: 'لم يتم ضبط حسابات الدفع. يرجى ضبط الإعدادات أولاً.' };
      }
    }

    // Get party account (supplier for payment, customer for receipt)
    let partyAccountId: string | null = null;
    
    if (paymentType === 'payment' && supplierId) {
      const { data: supplier } = await dataGateway.queryTable('suppliers', {
        select: 'account_id',
        filters: [{ type: 'eq', column: 'id', value: supplierId }],
        maybeSingle: true,
      });
      partyAccountId = supplier?.account_id || null;
      
      // Fallback to parent payables
      if (!partyAccountId) {
        const { data: payablesAccount } = await dataGateway.queryTable('chart_of_accounts', {
          select: 'id',
          filters: [
            { type: 'eq', column: 'account_code', value: '2101' },
            { type: 'eq', column: 'is_active', value: true },
          ],
          maybeSingle: true,
        });
        partyAccountId = payablesAccount?.id || null;
      }
    } else if (paymentType === 'receipt' && customerId) {
      const { data: customer } = await dataGateway.queryTable('customers', {
        select: 'account_id',
        filters: [{ type: 'eq', column: 'id', value: customerId }],
        maybeSingle: true,
      });
      partyAccountId = customer?.account_id || null;
      
      // Fallback to parent receivables
      if (!partyAccountId) {
        const { data: receivablesAccount } = await dataGateway.queryTable('chart_of_accounts', {
          select: 'id',
          filters: [
            { type: 'eq', column: 'account_code', value: '1102' },
            { type: 'eq', column: 'is_active', value: true },
          ],
          maybeSingle: true,
        });
        partyAccountId = receivablesAccount?.id || null;
      }
    }

    if (!partyAccountId) {
      // Final fallback - get any suitable party account
      const fallbackPartyCode = paymentType === 'payment' ? '2101' : '1102';
      const { data: fallbackParty } = await dataGateway.queryTable('chart_of_accounts', {
        select: 'id',
        filters: [
          { type: 'eq', column: 'account_code', value: fallbackPartyCode },
          { type: 'eq', column: 'is_active', value: true },
        ],
        maybeSingle: true,
      });
      partyAccountId = fallbackParty?.id || null;
    }

    if (!partyAccountId) {
      return { success: false, error: `لم يتم العثور على حساب ${paymentType === 'payment' ? 'المورد/الذمم الدائنة' : 'العميل/الذمم المدينة'}` };
    }

    // Build lines based on payment type
    // Payment (supplier): Debit AP, Credit Cash/Bank
    // Receipt (customer): Debit Cash/Bank, Credit AR
    const lines: CreatePaymentVoucherCommand['lines'] = [];
    
    if (paymentType === 'payment') {
      lines.push({
        accountId: partyAccountId,
        debitAmount: amount,
        creditAmount: 0,
        description: supplierName ? `سداد للمورد ${supplierName}` : 'سداد للمورد',
      });
      lines.push({
        accountId: cashBankAccountId,
        debitAmount: 0,
        creditAmount: amount,
        description: paymentMethod === 'cash' ? 'صرف نقدي' : 'صرف بنكي',
      });
    } else {
      // Receipt
      lines.push({
        accountId: cashBankAccountId,
        debitAmount: amount,
        creditAmount: 0,
        description: paymentMethod === 'cash' ? 'قبض نقدي' : 'قبض بنكي',
      });
      lines.push({
        accountId: partyAccountId,
        debitAmount: 0,
        creditAmount: amount,
        description: customerName ? `تحصيل من العميل ${customerName}` : 'تحصيل من العميل',
      });
    }

    return { success: true, lines };
  } catch (err: any) {
    console.error('derivePaymentJournalLines error:', err);
    return { success: false, error: err.message || 'خطأ في اشتقاق سطور القيد' };
  }
}

/**
 * PV-4: Updates a Payment Voucher atomically via payment_voucher_update_atomic RPC
 * THIN WRAPPER - all business logic is in the RPC
 */
export async function updatePaymentVoucher(
  cmd: UpdatePaymentVoucherCommand
): Promise<UpdatePaymentVoucherResult> {
  // Validate clientRequestId
  if (!cmd.clientRequestId) {
    return { 
      success: false, 
      error: 'clientRequestId is required for atomic update',
      errorCode: 'VALIDATION'
    };
  }

  if (!cmd.paymentId) {
    return { 
      success: false, 
      error: 'paymentId is required',
      errorCode: 'VALIDATION'
    };
  }

  try {
    // Build atomic payload
    const payment = cmd.payment ? {
      payment_date: cmd.payment.paymentDate,
      amount: cmd.payment.amount,
      payment_method: cmd.payment.paymentMethod,
      supplier_id: cmd.payment.supplierId,
      customer_id: cmd.payment.customerId,
      branch_id: cmd.payment.branchId,
      notes: cmd.payment.notes,
      currency: cmd.payment.currency,
      exchange_rate: cmd.payment.exchangeRate,
    } : undefined;

    // Build lines array only if provided
    const lines = (cmd.lines && cmd.lines.length > 0)
      ? cmd.lines.map(l => ({
          account_id: l.accountId,
          debit_amount: l.debitAmount || 0,
          credit_amount: l.creditAmount || 0,
          description: l.description || null,
        }))
      : null;

    const payload = {
      client_request_id: cmd.clientRequestId,
      payment_id: cmd.paymentId,
      payment,
      ...(lines && { lines }),
    };

    // Call atomic RPC
    const { data, error } = await dataGateway.rpc('payment_voucher_update_atomic', {
      p_payload: payload
    });

    if (error) {
      console.error('payment_voucher_update_atomic RPC error:', error);
      return {
        success: false,
        error: error.message || 'فشل تحديث السند',
        errorCode: 'DB_ERROR'
      };
    }

    const result = data as {
      success: boolean;
      paymentId?: string;
      paymentNumber?: string;
      journalEntryId?: string;
      journalEntryNumber?: string;
      linesDerived?: boolean;
      reversedJournalEntryId?: string;
      error_code?: string;
      error?: string;
    };

    if (!result.success) {
      return {
        success: false,
        error: result.error || 'فشل تحديث السند',
        errorCode: (result.error_code as UpdatePaymentVoucherResult['errorCode']) || 'DB_ERROR'
      };
    }

    return {
      success: true,
      paymentId: result.paymentId,
      paymentNumber: result.paymentNumber,
      journalEntryId: result.journalEntryId,
      journalEntryNumber: result.journalEntryNumber,
      linesDerived: result.linesDerived,
      reversedJournalEntryId: result.reversedJournalEntryId
    };
  } catch (err: any) {
    console.error('updatePaymentVoucher exception:', err);
    return { 
      success: false, 
      error: err.message || 'حدث خطأ غير متوقع',
      errorCode: 'DB_ERROR'
    };
  }
}

/**
 * PV-4: Voids a Payment Voucher atomically via payment_voucher_void_atomic RPC
 * Uses SOFT DELETE with reversal JE - preserves accounting history
 * THIN WRAPPER - all business logic is in the RPC
 */
export async function voidPaymentVoucher(
  cmd: VoidPaymentVoucherCommand
): Promise<VoidPaymentVoucherResult> {
  // Validate clientRequestId
  if (!cmd.clientRequestId) {
    return { 
      success: false, 
      error: 'clientRequestId is required for atomic void',
      errorCode: 'VALIDATION'
    };
  }

  if (!cmd.paymentId) {
    return { 
      success: false, 
      error: 'paymentId is required',
      errorCode: 'VALIDATION'
    };
  }

  try {
    const payload = {
      client_request_id: cmd.clientRequestId,
      payment_id: cmd.paymentId,
      void_reason: cmd.voidReason || 'ملغي بواسطة المستخدم',
      void_date: cmd.voidDate || new Date().toISOString().split('T')[0],
    };

    // Call atomic RPC
    const { data, error } = await dataGateway.rpc('payment_voucher_void_atomic', {
      p_payload: payload
    });

    if (error) {
      console.error('payment_voucher_void_atomic RPC error:', error);
      return {
        success: false,
        error: error.message || 'فشل إلغاء السند',
        errorCode: 'DB_ERROR'
      };
    }

    const result = data as {
      success: boolean;
      paymentId?: string;
      paymentNumber?: string;
      voided?: boolean;
      alreadyVoided?: boolean;
      reversalJournalEntryId?: string;
      reversalEntryNumber?: string;
      error_code?: string;
      error?: string;
    };

    if (!result.success) {
      return {
        success: false,
        error: result.error || 'فشل إلغاء السند',
        errorCode: (result.error_code as VoidPaymentVoucherResult['errorCode']) || 'DB_ERROR'
      };
    }

    return {
      success: true,
      paymentId: result.paymentId,
      paymentNumber: result.paymentNumber,
      voided: result.voided,
      alreadyVoided: result.alreadyVoided,
      reversalJournalEntryId: result.reversalJournalEntryId,
      reversalEntryNumber: result.reversalEntryNumber
    };
  } catch (err: any) {
    console.error('voidPaymentVoucher exception:', err);
    return { 
      success: false, 
      error: err.message || 'حدث خطأ غير متوقع',
      errorCode: 'DB_ERROR'
    };
  }
}

/**
 * PV-4: Legacy delete wrapper - now uses voidPaymentVoucher internally
 * DEPRECATED: Use voidPaymentVoucher directly for new code
 */
export async function deletePaymentVoucher(
  cmd: DeletePaymentVoucherCommand
): Promise<DeletePaymentVoucherResult> {
  // Generate clientRequestId if not provided
  const clientRequestId = cmd.clientRequestId || crypto.randomUUID();
  
  const result = await voidPaymentVoucher({
    clientRequestId,
    paymentId: cmd.paymentId,
    voidReason: cmd.voidReason || 'حذف بواسطة المستخدم',
  });

  return {
    success: result.success,
    error: result.error,
    voided: result.voided
  };
}

// =========================================================================
// Convert PR to PO - Write APIs
// =========================================================================

import type { ConvertPRToPOCommand, ConvertPRToPOResult, CreatedPOInfo, ConvertPRItemInput } from './commands';

/**
 * Generates a new Purchase Order number
 */
export async function generatePONumber(): Promise<{ poNumber: string } | { error: string }> {
  const { data, error } = await dataGateway.rpc('generate_po_number');

  if (error) {
    console.error('generatePONumber error:', error);
    return { error: error.message || 'فشل في توليد رقم أمر الشراء' };
  }

  return { poNumber: data as string };
}

/**
 * Converts Purchase Requisitions to Purchase Order(s)
 * 
 * This is a thin wrapper around the atomic RPC convert_prs_to_pos_atomic.
 * All business logic (grouping, PO creation, linking, status updates) is handled server-side.
 */
export async function convertPRToPO(cmd: ConvertPRToPOCommand): Promise<ConvertPRToPOResult> {
  // VALIDATION: clientRequestId is REQUIRED for idempotency
  if (!cmd.clientRequestId || typeof cmd.clientRequestId !== 'string' || cmd.clientRequestId.trim() === '') {
    return { 
      success: false, 
      error: 'VALIDATION: clientRequestId is required for idempotency' 
    };
  }

  // VALIDATION: createdByUserId is REQUIRED
  if (!cmd.createdByUserId || typeof cmd.createdByUserId !== 'string' || cmd.createdByUserId.trim() === '') {
    return { 
      success: false, 
      error: 'VALIDATION: createdByUserId is required' 
    };
  }

  // VALIDATION: targetBranchId is REQUIRED
  if (!cmd.targetBranchId || typeof cmd.targetBranchId !== 'string' || cmd.targetBranchId.trim() === '') {
    return { 
      success: false, 
      error: 'VALIDATION: targetBranchId is required' 
    };
  }

  // VALIDATION: prIds must have at least one PR
  if (!cmd.prIds || !Array.isArray(cmd.prIds) || cmd.prIds.length === 0) {
    return { 
      success: false, 
      error: 'VALIDATION: prIds must contain at least one PR ID' 
    };
  }

  // VALIDATION: items must have at least one item with convertQuantity > 0
  const validItems = (cmd.items || []).filter(item => item.convertQuantity > 0);
  if (validItems.length === 0) {
    return { 
      success: false, 
      error: 'VALIDATION: items must contain at least one item with convertQuantity > 0' 
    };
  }

  try {
    // Build payload for atomic RPC
    const payload = {
      client_request_id: cmd.clientRequestId,
      requested_by: cmd.createdByUserId,
      branch_id: cmd.targetBranchId,
      warehouse_id: cmd.warehouseId || null,
      pr_ids: cmd.prIds,
      default_supplier_id: cmd.defaultSupplierId || null,
      expected_delivery_date: cmd.expectedDeliveryDate || null,
      payment_terms: cmd.paymentTerms || null,
      delivery_terms: cmd.deliveryTerms || null,
      notes: cmd.notes || null,
      created_by_name: cmd.createdByName || null,
      items: validItems.map(item => ({
        prItemId: item.prItemId,
        requisitionId: item.requisitionId,
        convertQuantity: item.convertQuantity,
        unitPrice: item.actualPrice,
        supplierId: item.supplierId || null,
        description: item.description || null,
        warehouseId: item.warehouseId || null,
        costCenterId: item.costCenterId || null,
      })),
    };

    // Call atomic RPC
    const { data, error } = await dataGateway.rpc('convert_prs_to_pos_atomic', {
      p_payload: payload,
    });

    if (error) {
      console.error('convert_prs_to_pos_atomic error:', error);
      return { success: false, error: error.message || 'فشل في تحويل طلبات الشراء' };
    }

    const result = data as { 
      success: boolean; 
      createdPOs?: any[]; 
      error?: string;
      error_code?: string;
      meta?: {
        workflowType: string;
        clientRequestId: string;
        payloadHash: string;
      };
    };

    if (!result.success) {
      // Return error_code if available for better debugging
      const errorMessage = result.error_code 
        ? `${result.error_code}: ${result.error}` 
        : (result.error || 'فشل في تحويل طلبات الشراء');
      return { success: false, error: errorMessage };
    }

    // Map RPC result to expected format
    const createdPOs: CreatedPOInfo[] = (result.createdPOs || []).map((po: any) => ({
      poId: po.poId,
      poNumber: po.poNumber,
    }));

    return {
      success: true,
      createdPOs,
    };
  } catch (err: any) {
    console.error('convertPRToPO exception:', err);
    return { success: false, error: err.message || 'حدث خطأ غير متوقع' };
  }
}

// ===========================
// PI-1: Atomic Purchase Invoice Operations
// ===========================

import type {
  AtomicCreatePurchaseInvoiceCommand,
  AtomicPostPurchaseInvoiceCommand,
  AtomicVoidPurchaseInvoiceCommand,
  AtomicCreatePurchaseInvoiceResult,
  AtomicPostPurchaseInvoiceResult,
  AtomicVoidPurchaseInvoiceResult,
} from './commands';

/**
 * Creates a purchase invoice atomically via RPC
 * Thin wrapper - no business logic
 */
export async function createPurchaseInvoiceAtomic(
  cmd: AtomicCreatePurchaseInvoiceCommand
): Promise<AtomicCreatePurchaseInvoiceResult> {
  const { data, error } = await dataGateway.rpc('purchase_invoice_create_atomic', {
    p_payload: JSON.parse(JSON.stringify(cmd)),
  });

  if (error) {
    console.error('purchase_invoice_create_atomic RPC error:', error);
    return { success: false, error_code: 'RPC_ERROR', error: error.message };
  }

  return data as unknown as AtomicCreatePurchaseInvoiceResult;
}

/**
 * Posts a purchase invoice atomically via RPC (creates JE)
 * Thin wrapper - no business logic
 */
export async function postPurchaseInvoiceAtomic(
  cmd: AtomicPostPurchaseInvoiceCommand
): Promise<AtomicPostPurchaseInvoiceResult> {
  const { data, error } = await dataGateway.rpc('purchase_invoice_post_atomic', {
    p_payload: JSON.parse(JSON.stringify(cmd)),
  });

  if (error) {
    console.error('purchase_invoice_post_atomic RPC error:', error);
    return { success: false, error_code: 'RPC_ERROR', error: error.message };
  }

  return data as unknown as AtomicPostPurchaseInvoiceResult;
}

/**
 * Voids a purchase invoice atomically via RPC
 * Thin wrapper - no business logic
 */
export async function voidPurchaseInvoiceAtomic(
  cmd: AtomicVoidPurchaseInvoiceCommand
): Promise<AtomicVoidPurchaseInvoiceResult> {
  const { data, error } = await dataGateway.rpc('purchase_invoice_void_atomic', {
    p_payload: JSON.parse(JSON.stringify(cmd)),
  });

  if (error) {
    console.error('purchase_invoice_void_atomic RPC error:', error);
    return { success: false, error_code: 'RPC_ERROR', error: error.message };
  }

  return data as unknown as AtomicVoidPurchaseInvoiceResult;
}

// ===========================
// PR-1: Atomic Purchase Return Wrappers
// ===========================

import type {
  AtomicCreatePurchaseReturnUniqueCommand,
  AtomicCreatePurchaseReturnUniqueResult,
  AtomicCreatePurchaseReturnGeneralCommand,
  AtomicCreatePurchaseReturnGeneralResult,
  AtomicVoidPurchaseReturnCommand,
  AtomicVoidPurchaseReturnResult,
} from './commands';

/**
 * Creates a unique (jewelry) purchase return atomically via RPC
 * Routes to unique_purchase_return_create_atomic which writes to:
 *   unique_purchase_returns + unique_purchase_return_items + unique_item_movements + journal_entries
 * Transforms legacy command shape to the flat args contract the new RPC expects.
 */
export async function createPurchaseReturnUniqueAtomic(
  cmd: AtomicCreatePurchaseReturnUniqueCommand
): Promise<AtomicCreatePurchaseReturnUniqueResult> {
  const rpcArgs = {
    client_request_id: cmd.client_request_id,
    created_by: cmd.created_by || null,
    supplier_id: cmd.return?.supplier_id || null,
    branch_id: cmd.return?.branch_id,
    unique_invoice_id: cmd.return?.purchase_invoice_id || null,
    reason: cmd.return?.reason || cmd.return?.notes || null,
    items: (cmd.items || []).map((item: any) => ({
      unique_item_id: item.unique_item_id || item.item_id || item.jewelry_item_id,
    })),
  };

  const { data, error } = await dataGateway.rpc('unique_purchase_return_create_atomic',
    JSON.parse(JSON.stringify(rpcArgs)),
  );

  if (error) {
    console.error('unique_purchase_return_create_atomic RPC error:', error);
    return { success: false, error_code: 'RPC_ERROR', error: error.message };
  }

  const result = data as any;
  return {
    success: result?.success ?? false,
    returnId: result?.return_id,
    returnNumber: result?.return_number,
    journalEntryId: result?.journal_entry_id || undefined,
    journalEntryNumber: result?.journal_entry_number || undefined,
    status: result?.status || 'posted',
    itemCount: result?.items_returned,
    totals: result?.total_amount != null ? {
      subtotal: result.subtotal ?? result.total_amount,
      taxAmount: result.tax_amount ?? 0,
      totalAmount: result.total_amount,
    } : undefined,
    error_code: result?.error_code,
    error: result?.error,
  } as AtomicCreatePurchaseReturnUniqueResult;
}

/**
 * Creates a general (qty-based) purchase return atomically via RPC
 * Thin wrapper - no business logic
 */
export async function createPurchaseReturnGeneralAtomic(
  cmd: AtomicCreatePurchaseReturnGeneralCommand
): Promise<AtomicCreatePurchaseReturnGeneralResult> {
  const { data, error } = await dataGateway.rpc('complete_purchase_return_general_atomic', {
    p_payload: JSON.parse(JSON.stringify(cmd)),
  });

  if (error) {
    console.error('complete_purchase_return_general_atomic RPC error:', error);
    return { success: false, error_code: 'RPC_ERROR', error: error.message };
  }

  return data as unknown as AtomicCreatePurchaseReturnGeneralResult;
}

/**
 * Voids a purchase return atomically via RPC
 * Thin wrapper - routes to void_purchase_return_atomic
 */
export async function voidPurchaseReturnAtomic(
  cmd: AtomicVoidPurchaseReturnCommand
): Promise<AtomicVoidPurchaseReturnResult> {
  const { data, error } = await dataGateway.rpc('void_purchase_return_atomic', {
    p_payload: JSON.parse(JSON.stringify(cmd)),
  });

  if (error) {
    console.error('void_purchase_return_atomic RPC error:', error);
    return { success: false, error_code: 'RPC_ERROR', error: error.message };
  }

  return data as unknown as AtomicVoidPurchaseReturnResult;
}

export interface UniqueInvoiceEditItemUpdate {
  item_id: string;
  stockcode?: string;
  model?: string;
  description?: string;
  division?: string;
  supp_ref?: string;
  type?: string;
  cost: number;
  tag_price?: number;
  minimum_price?: number;
  g_weight?: number;
  d_weight?: number;
  metal?: string;
  stone?: string;
}

export interface UniqueInvoiceEditItemAdd {
  stockcode?: string;
  model?: string;
  description?: string;
  division?: string;
  supp_ref?: string;
  type?: string;
  cost: number;
  tag_price?: number;
  minimum_price?: number;
  g_weight?: number;
  d_weight?: number;
  metal?: string;
  stone?: string;
}

export interface UniqueInvoiceEditItemDelete {
  item_id: string;
}

export interface UniqueInvoiceEditCommand {
  invoice_id: string;
  supp_inv?: string;
  invoice_date?: string;
  notes?: string;
  vat_rate?: number;
  items_update?: UniqueInvoiceEditItemUpdate[];
  items_add?: UniqueInvoiceEditItemAdd[];
  items_delete?: UniqueInvoiceEditItemDelete[];
  updated_by?: string;
}

export interface UniqueInvoiceEditResult {
  success: boolean;
  invoice_id?: string;
  new_subtotal?: number;
  new_tax?: number;
  new_total?: number;
  items_updated?: number;
  items_added?: number;
  items_deleted?: number;
  message_ar?: string;
  error?: string;
  blockers?: string[];
}


export interface RebuildGateResult {
  can_rebuild: boolean;
  blockers: Array<{ code: string; count: number; message_ar: string }>;
  invoice_number?: string;
  status?: string;
  has_journal?: boolean;
  purchase_in_movements?: number;
}

export async function fetchRebuildGate(invoiceId: string): Promise<RebuildGateResult> {
  const resp = await fetch(`/api/purchasing/unique-invoices/${invoiceId}/rebuild-gate`, {
    credentials: 'include',
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  if (json.error) throw new Error(json.error.message || 'Gate check failed');
  return json.data as RebuildGateResult;
}

export interface RebuildResult {
  success: boolean;
  invoice_id?: string;
  new_subtotal?: number;
  new_tax?: number;
  new_total?: number;
  items_updated?: number;
  items_added?: number;
  items_deleted?: number;
  old_movements_deleted?: number;
  rebuilt_movements?: number;
  rebuilt_items?: number;
  message_ar?: string;
  error?: string;
  blockers?: Array<{ code: string; count: number; message_ar: string }>;
}

export async function rebuildUniqueInvoiceAtomic(
  cmd: UniqueInvoiceEditCommand
): Promise<RebuildResult> {
  const { data, error } = await dataGateway.rpc('unique_purchase_invoice_rebuild_atomic',
    JSON.parse(JSON.stringify(cmd))
  );

  if (error) {
    console.error('unique_purchase_invoice_rebuild_atomic RPC error:', error);
    return { success: false, error: error.message };
  }

  return data as unknown as RebuildResult;
}
