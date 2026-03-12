/**
 * Purchase Return Routing Service
 * Determines which return screen to use based on invoice characteristics
 */

import type { PurchaseInvoiceDTO } from './dto';

export type ReturnScreenType = 'unique' | 'general';

export interface ReturnRoutingResult {
  screenType: ReturnScreenType;
  reason: string;
}

export class MixedItemTypesError extends Error {
  constructor() {
    super('MIXED_ITEM_TYPES_NOT_SUPPORTED');
    this.name = 'MixedItemTypesError';
  }
}

/**
 * Determines which return screen to use based on invoice characteristics
 * 
 * Rules:
 * 1. Import invoices (batch) → Always UNIQUE (jewelry items)
 * 2. If all lines are jewelry → UNIQUE
 * 3. If all lines are product/cost/service → GENERAL
 * 4. Mixed types → BLOCKED with error
 */
export function determineReturnScreen(invoice: PurchaseInvoiceDTO): ReturnRoutingResult {
  // Rule 1: Import invoices (batch) → Always UNIQUE (jewelry items)
  if (invoice.purchaseType === 'import' || invoice.batchId) {
    return {
      screenType: 'unique',
      reason: 'IMPORT_BATCH_INVOICE',
    };
  }
  
  // Rule 2: Check line item types
  const lines = invoice.lines || [];
  
  if (lines.length === 0) {
    // No lines - default to general (for manual invoices without lines yet)
    return {
      screenType: 'general',
      reason: 'NO_LINES_DEFAULT_GENERAL',
    };
  }
  
  const hasJewelryLines = lines.some(l => l.itemType === 'jewelry');
  const hasNonJewelryLines = lines.some(l => 
    l.itemType === 'product' || l.itemType === 'cost' || l.itemType === 'service'
  );
  
  // Rule 3: Mixed types not allowed
  if (hasJewelryLines && hasNonJewelryLines) {
    throw new MixedItemTypesError();
  }
  
  // Rule 4: Route based on item type
  if (hasJewelryLines) {
    return {
      screenType: 'unique',
      reason: 'ALL_JEWELRY_LINES',
    };
  }
  
  return {
    screenType: 'general',
    reason: 'ALL_PRODUCT_COST_SERVICE_LINES',
  };
}

/**
 * Build the return URL based on invoice and routing decision
 */
export function buildReturnUrl(invoiceId: string, screenType: ReturnScreenType): string {
  return `/purchasing/returns/new?type=${screenType}&invoiceId=${invoiceId}`;
}
