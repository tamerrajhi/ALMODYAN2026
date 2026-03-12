/**
 * Invoice Policy Types - Stage P4.3-B
 * 
 * Type-safe definitions for the invoice policy layer.
 * All business rules for invoice actions are expressed through these types.
 */

// ===========================
// Action Keys
// ===========================

export type InvoiceActionKey = 
  | 'view'
  | 'cancel' 
  | 'pay' 
  | 'createReturn' 
  | 'print' 
  | 'pdf' 
  | 'email' 
  | 'viewJournal'
  | 'duplicate';

// ===========================
// Block Reason Codes
// ===========================

export type BlockReasonCode = 
  | 'INVOICE_CANCELLED'
  | 'INVOICE_PAID'
  | 'INVOICE_POSTED_LOCKED'
  | 'INVOICE_NOT_PENDING'
  | 'INVOICE_NOT_POSTED'
  | 'NO_REMAINING_AMOUNT'
  | 'NO_JOURNAL_ENTRY'
  | 'NO_SUPPLIER_EMAIL'
  | 'MIXED_ITEM_TYPES'
  | 'CANCEL_NOT_IMPLEMENTED'
  | 'IMPORT_LINES_LOCKED'
  | 'INVOICE_FULLY_RETURNED';

export type BlockSeverity = 'info' | 'warn' | 'error';

// ===========================
// Block Reason
// ===========================

export interface BlockReason {
  code: BlockReasonCode;
  severity: BlockSeverity;
  messageAr: string;
  messageEn: string;
}

// ===========================
// Policy Input (normalized from DTO)
// ===========================

export interface InvoicePolicyInput {
  id: string;
  status: 'pending' | 'partial' | 'paid' | 'cancelled' | 'posted' | 'draft' | 'voided' | 'returned' | 'partially_returned';
  purchaseType: 'general' | 'import';
  batchId: string | null;
  journalEntryId: string | null;
  remainingAmount: number;
  supplierEmail: string | null;
  hasMixedItemTypes: boolean;
}

// ===========================
// Action State
// ===========================

export interface InvoiceActionState {
  key: InvoiceActionKey;
  visible: boolean;
  enabled: boolean;
  blockReason?: BlockReason;
  href?: string;
}

// ===========================
// Policy Result
// ===========================

export interface InvoicePolicyResult {
  input: InvoicePolicyInput;
  actions: Record<InvoiceActionKey, InvoiceActionState>;
  
  // Quick access flags (derived from actions)
  canView: boolean;
  canCancel: boolean;
  canPay: boolean;
  canCreateReturn: boolean;
  canViewJournal: boolean;
  canPrint: boolean;
  canPdf: boolean;
  canEmail: boolean;
  canDuplicate: boolean;
  
  // Derived state flags
  isImportInvoice: boolean;
  isPosted: boolean;
  isCancelled: boolean;
}

// ===========================
// Block Reason Registry
// ===========================

export const BLOCK_REASONS: Record<BlockReasonCode, Omit<BlockReason, 'code'>> = {
  INVOICE_CANCELLED: {
    severity: 'error',
    messageAr: 'لا يمكن تنفيذ هذا الإجراء على فاتورة ملغاة',
    messageEn: 'Cannot perform this action on a cancelled invoice',
  },
  INVOICE_PAID: {
    severity: 'warn',
    messageAr: 'لا يمكن تنفيذ هذا الإجراء على فاتورة مدفوعة بالكامل',
    messageEn: 'Cannot perform this action on a fully paid invoice',
  },
  INVOICE_POSTED_LOCKED: {
    severity: 'warn',
    messageAr: 'لا يمكن تعديل فاتورة مرحّلة للحسابات',
    messageEn: 'Cannot edit a posted invoice',
  },
  INVOICE_NOT_PENDING: {
    severity: 'info',
    messageAr: 'يمكن تعديل الفواتير المسودة فقط (حالة: معلقة)',
    messageEn: 'Only draft invoices can be edited (status: pending)',
  },
  INVOICE_NOT_POSTED: {
    severity: 'info',
    messageAr: 'يجب ترحيل الفاتورة أولاً قبل تسجيل دفعات',
    messageEn: 'Invoice must be posted before recording payments',
  },
  NO_REMAINING_AMOUNT: {
    severity: 'info',
    messageAr: 'لا يوجد مبلغ متبقي للدفع',
    messageEn: 'No remaining amount to pay',
  },
  NO_JOURNAL_ENTRY: {
    severity: 'info',
    messageAr: 'لم يتم ترحيل الفاتورة بعد',
    messageEn: 'Invoice has not been posted yet',
  },
  NO_SUPPLIER_EMAIL: {
    severity: 'info',
    messageAr: 'لا يوجد بريد إلكتروني للمورد',
    messageEn: 'Supplier has no email address',
  },
  MIXED_ITEM_TYPES: {
    severity: 'error',
    messageAr: 'لا يمكن إنشاء مرتجع: الفاتورة تحتوي على أنواع مختلطة من البنود (مجوهرات + منتجات/تكاليف)',
    messageEn: 'Cannot create return: Invoice contains mixed item types (jewelry + products/costs)',
  },
  CANCEL_NOT_IMPLEMENTED: {
    severity: 'warn',
    messageAr: 'الإلغاء غير مفعّل حتى يتم تنفيذ عكس القيد المحاسبي',
    messageEn: 'Cancel not implemented - requires journal reversal',
  },
  IMPORT_LINES_LOCKED: {
    severity: 'info',
    messageAr: 'فاتورة استيراد - لا يمكن تعديل بنود المجوهرات بعد الإنشاء',
    messageEn: 'Import invoice - jewelry lines cannot be modified after creation',
  },
  INVOICE_FULLY_RETURNED: {
    severity: 'error',
    messageAr: 'تم إرجاع جميع بنود هذه الفاتورة بالكامل',
    messageEn: 'All items in this invoice have been fully returned',
  },
};

/**
 * Helper to create a BlockReason from a code
 */
export function createBlockReason(code: BlockReasonCode): BlockReason {
  return {
    code,
    ...BLOCK_REASONS[code],
  };
}
