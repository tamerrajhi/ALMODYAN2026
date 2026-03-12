/**
 * Invoice Policy Layer - Thin Facade
 * 
 * Stage P4.3-B: This module provides a simple API for UI components.
 * All business rules are centralized in the policy subfolder.
 * 
 * UI components should call getInvoicePolicy(invoiceDto) and consume
 * the result without any additional business logic.
 */

import type { PurchaseInvoiceDTO } from './dto';
import { toInvoicePolicyInput } from './policy/invoicePolicyAdapter';
import { evaluateInvoicePolicy } from './policy/evaluateInvoicePolicy';

// Re-export types for convenience
export type {
  InvoiceActionKey,
  BlockReasonCode,
  BlockSeverity,
  BlockReason,
  InvoicePolicyInput,
  InvoiceActionState,
  InvoicePolicyResult,
} from './policy/invoicePolicyTypes';

export { BLOCK_REASONS, createBlockReason } from './policy/invoicePolicyTypes';

/**
 * Get complete invoice policy based on invoice DTO.
 * This is the SINGLE entry point for UI components.
 * 
 * @param invoice - The PurchaseInvoiceDTO from the read service
 * @returns InvoicePolicyResult with all action states and quick-access flags
 */
export function getInvoicePolicy(invoice: PurchaseInvoiceDTO): import('./policy/invoicePolicyTypes').InvoicePolicyResult {
  const input = toInvoicePolicyInput(invoice);
  return evaluateInvoicePolicy(input);
}

/**
 * Get a specific action's state.
 * 
 * @param invoice - The PurchaseInvoiceDTO from the read service
 * @param actionKey - The action to get state for
 * @returns InvoiceActionState for the specified action
 */
export function getActionState(
  invoice: PurchaseInvoiceDTO, 
  actionKey: import('./policy/invoicePolicyTypes').InvoiceActionKey
): import('./policy/invoicePolicyTypes').InvoiceActionState {
  const policy = getInvoicePolicy(invoice);
  return policy.actions[actionKey];
}

/**
 * Helper to get the localized block reason message.
 * 
 * @param blockReason - The BlockReason object
 * @param language - 'ar' or 'en'
 * @returns The localized message string
 */
export function getBlockReasonMessage(
  blockReason: import('./policy/invoicePolicyTypes').BlockReason | undefined,
  language: 'ar' | 'en'
): string | undefined {
  if (!blockReason) return undefined;
  return language === 'ar' ? blockReason.messageAr : blockReason.messageEn;
}
