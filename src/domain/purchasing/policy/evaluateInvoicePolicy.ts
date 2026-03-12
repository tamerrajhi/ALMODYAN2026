/**
 * Invoice Policy Evaluator - Stage P4.3-B
 * 
 * SINGLE SOURCE OF TRUTH for all invoice action rules.
 * This module contains ALL business logic for determining action permissions.
 * 
 * UI components MUST NOT contain any business rule checks.
 */

import {
  type InvoicePolicyInput,
  type InvoicePolicyResult,
  type InvoiceActionKey,
  type InvoiceActionState,
  createBlockReason,
} from './invoicePolicyTypes';

/**
 * Evaluate all invoice actions based on the policy input.
 * Returns a complete policy result with action states and quick-access flags.
 */
export function evaluateInvoicePolicy(input: InvoicePolicyInput): InvoicePolicyResult {
  const { 
    id,
    status, 
    purchaseType, 
    batchId, 
    journalEntryId, 
    remainingAmount, 
    supplierEmail,
    hasMixedItemTypes,
  } = input;

  // Derived flags
  const isImportInvoice = purchaseType === 'import' || !!batchId;
  const isPosted = !!journalEntryId;
  const isCancelled = status === 'cancelled';
  const isPaid = status === 'paid';
  const isReturned = status === 'returned';
  const hasRemainingAmount = remainingAmount > 0;

  // ===========================
  // VIEW - Always visible and enabled
  // ===========================
  const viewAction: InvoiceActionState = {
    key: 'view',
    visible: true,
    enabled: true,
    href: `/purchasing/invoices/${id}/view`,
  };

  // ===========================
  // CANCEL
  // ===========================
  // Best Practice: Cancel NOT implemented until journal reversal is available
  const cancelAction: InvoiceActionState = {
    key: 'cancel',
    visible: true,
    enabled: false,
    blockReason: createBlockReason('CANCEL_NOT_IMPLEMENTED'),
  };

  // ===========================
  // PAY
  // ===========================
  let payAction: InvoiceActionState = {
    key: 'pay',
    visible: true,
    enabled: true,
  };

  if (isCancelled) {
    payAction.enabled = false;
    payAction.blockReason = createBlockReason('INVOICE_CANCELLED');
  } else if (isPaid) {
    payAction.enabled = false;
    payAction.blockReason = createBlockReason('INVOICE_PAID');
  } else if (!hasRemainingAmount) {
    payAction.enabled = false;
    payAction.blockReason = createBlockReason('NO_REMAINING_AMOUNT');
  } else if (status === 'pending' && !isPosted) {
    payAction.enabled = false;
    payAction.blockReason = createBlockReason('INVOICE_NOT_POSTED');
  }

  // ===========================
  // CREATE RETURN
  // ===========================
  let createReturnAction: InvoiceActionState = {
    key: 'createReturn',
    visible: true,
    enabled: true,
  };

  if (isCancelled) {
    createReturnAction.enabled = false;
    createReturnAction.blockReason = createBlockReason('INVOICE_CANCELLED');
  } else if (isReturned) {
    createReturnAction.enabled = false;
    createReturnAction.blockReason = createBlockReason('INVOICE_FULLY_RETURNED');
  } else if (hasMixedItemTypes) {
    createReturnAction.enabled = false;
    createReturnAction.blockReason = createBlockReason('MIXED_ITEM_TYPES');
  }

  // ===========================
  // VIEW JOURNAL
  // ===========================
  const viewJournalAction: InvoiceActionState = {
    key: 'viewJournal',
    visible: isPosted,
    enabled: isPosted,
    href: isPosted ? `/accounting/journal-entries?id=${journalEntryId}` : undefined,
  };

  if (!isPosted) {
    viewJournalAction.blockReason = createBlockReason('NO_JOURNAL_ENTRY');
  }

  // ===========================
  // PRINT / PDF / DUPLICATE - Always enabled
  // ===========================
  const printAction: InvoiceActionState = {
    key: 'print',
    visible: true,
    enabled: true,
  };

  const pdfAction: InvoiceActionState = {
    key: 'pdf',
    visible: true,
    enabled: true,
  };

  const duplicateAction: InvoiceActionState = {
    key: 'duplicate',
    visible: true,
    enabled: true,
  };

  // ===========================
  // EMAIL
  // ===========================
  let emailAction: InvoiceActionState = {
    key: 'email',
    visible: true,
    enabled: !!supplierEmail,
  };

  if (!supplierEmail) {
    emailAction.blockReason = createBlockReason('NO_SUPPLIER_EMAIL');
  } else if (isCancelled) {
    emailAction.enabled = false;
    emailAction.blockReason = createBlockReason('INVOICE_CANCELLED');
  }

  // Build actions record
  const actions: Record<InvoiceActionKey, InvoiceActionState> = {
    view: viewAction,
    cancel: cancelAction,
    pay: payAction,
    createReturn: createReturnAction,
    viewJournal: viewJournalAction,
    print: printAction,
    pdf: pdfAction,
    email: emailAction,
    duplicate: duplicateAction,
  };

  return {
    input,
    actions,
    
    // Quick access flags
    canView: viewAction.enabled,
    canCancel: cancelAction.enabled,
    canPay: payAction.enabled,
    canCreateReturn: createReturnAction.enabled,
    canViewJournal: viewJournalAction.enabled,
    canPrint: printAction.enabled,
    canPdf: pdfAction.enabled,
    canEmail: emailAction.enabled,
    canDuplicate: duplicateAction.enabled,
    
    // Derived state flags
    isImportInvoice,
    isPosted,
    isCancelled,
  };
}
