// ============================================
// Transfer Post-Checks - V2 Wrapper
// DEPRECATED: Use transfersV2Service directly
// This file is kept for backward compatibility only
// ============================================

import {
  createTransferV2,
  verifyTransferV2Completion,
  executeTransferV2WithChecks,
} from './transfersV2Service';
import type {
  CreateTransferResultDTO,
  TransferVerificationResultDTO,
} from '@/types/transfers.v2.mutations.dto';

// Re-export types for backward compatibility
export type TransferResult = CreateTransferResultDTO & {
  transfer_number?: string;
  items_count?: number;
  total_value?: number;
  journal_number?: string;
};

export type PostCheckResult = TransferVerificationResultDTO & {
  allPassed: boolean;
};

/**
 * @deprecated Use verifyTransferV2Completion from transfersV2Service
 */
export async function verifyTransferCompletion(
  result: TransferResult,
  itemIds: string[],
  targetBranchId: string
): Promise<PostCheckResult> {
  if (!result.transfer_id) {
    return {
      ok: false,
      allPassed: false,
      transferExists: false,
      itemsCountMatch: false,
      branchUpdated: false,
      journalBalanced: null,
      details: ['❌ لم يتم إرجاع معرف التحويل'],
    };
  }

  const verification = await verifyTransferV2Completion(
    result.transfer_id,
    itemIds.length,
    targetBranchId
  );

  return {
    ...verification,
    allPassed: verification.ok,
  };
}

/**
 * Execute transfer with post-checks using V2 RPC
 * @deprecated Use executeTransferV2WithChecks from transfersV2Service
 */
export async function executeTransferWithChecks(
  fromBranchId: string | null,
  toBranchId: string,
  itemIds: string[],
  notes?: string | null,
  purchaseInvoiceId?: string | null
): Promise<{
  result: TransferResult;
  postCheck: PostCheckResult | null;
  isPartialSuccess: boolean;
}> {
  // Use V2 service
  const { result, verification, isPartialSuccess } = await executeTransferV2WithChecks({
    from_branch_id: fromBranchId,
    to_branch_id: toBranchId,
    item_ids: itemIds,
    notes: notes ?? null,
    purchase_invoice_id: purchaseInvoiceId ?? null,
  });

  // Map to legacy format for backward compatibility
  const legacyResult: TransferResult = {
    success: result.success,
    transfer_id: result.transfer_id,
    transfer_code: result.transfer_code,
    transfer_number: result.transfer_code, // Alias
    total_items: result.total_items,
    items_count: result.total_items, // Alias
    total_cost: result.total_cost,
    total_value: result.total_cost, // Alias
    journal_entry_id: result.journal_entry_id ?? undefined,
    journal_entry_number: result.journal_entry_number ?? undefined,
    journal_number: result.journal_entry_number ?? undefined, // Alias
    error: result.error ?? undefined,
  };

  const postCheck: PostCheckResult | null = verification
    ? {
        ...verification,
        allPassed: verification.ok,
      }
    : null;

  return {
    result: legacyResult,
    postCheck,
    isPartialSuccess,
  };
}
