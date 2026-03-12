/**
 * Invoice Policy Adapter - Stage P4.3-B
 * 
 * Converts PurchaseInvoiceDTO to InvoicePolicyInput.
 * ALL domain mapping happens here, NOT in UI components.
 * 
 * This includes:
 * - Field normalization
 * - Mixed item type detection (delegated to returnRoutingService)
 */

import type { PurchaseInvoiceDTO } from '../dto';
import type { InvoicePolicyInput } from './invoicePolicyTypes';
import { determineReturnScreen, MixedItemTypesError } from '../returnRoutingService';

/**
 * Convert a PurchaseInvoiceDTO to an InvoicePolicyInput.
 * 
 * This adapter handles:
 * 1. Field mapping from DTO to policy input
 * 2. Mixed item type detection via returnRoutingService
 * 
 * UI components should NOT perform any of this logic.
 */
export function toInvoicePolicyInput(invoice: PurchaseInvoiceDTO): InvoicePolicyInput {
  // Detect mixed item types using the routing service
  let hasMixedItemTypes = false;
  
  try {
    determineReturnScreen(invoice);
  } catch (error) {
    if (error instanceof MixedItemTypesError) {
      hasMixedItemTypes = true;
    }
    // Other errors are ignored - they don't affect policy evaluation
  }

  return {
    id: invoice.id,
    status: invoice.status,
    purchaseType: invoice.purchaseType,
    batchId: invoice.batchId,
    journalEntryId: invoice.journalEntryId,
    remainingAmount: invoice.remainingAmount ?? 0,
    supplierEmail: invoice.supplierEmail,
    hasMixedItemTypes,
  };
}
