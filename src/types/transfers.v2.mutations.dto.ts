// ============================================
// Transfers V2 Mutation DTOs - Phase D2
// Single Source of Truth for Transfer Write Operations
// ============================================

/**
 * Payload for creating a new transfer via create_transfer_v2 RPC
 */
export interface CreateTransferPayloadDTO {
  from_branch_id: string | null;
  to_branch_id: string;
  transfer_date?: string | null;
  notes?: string | null;
  purchase_invoice_id?: string | null;
  item_ids: string[];
}

/**
 * Result from create_transfer_v2 RPC
 */
export interface CreateTransferResultDTO {
  success: boolean;
  transfer_id?: string;
  transfer_code?: string;
  total_items?: number;
  total_cost?: number;
  journal_entry_id?: string | null;
  journal_entry_number?: string | null;
  error?: string | null;
}

/**
 * Payload for reversing a transfer via reverse_transfer_v2 RPC
 */
export interface ReverseTransferPayloadDTO {
  transfer_id: string;
  notes?: string | null;
}

/**
 * Result from reverse_transfer_v2 RPC
 */
export interface ReverseTransferResultDTO {
  success: boolean;
  reversal_transfer_id?: string;
  reversal_transfer_code?: string;
  journal_entry_id?: string | null;
  journal_entry_number?: string | null;
  total_items?: number;
  total_cost?: number;
  error?: string | null;
}

/**
 * Result from transfer verification checks
 */
export interface TransferVerificationResultDTO {
  ok: boolean;
  transferExists: boolean;
  itemsCountMatch: boolean;
  branchUpdated: boolean;
  journalBalanced: boolean | null;
  details: string[];
  error?: string;
}
