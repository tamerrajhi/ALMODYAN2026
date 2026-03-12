// ============================================
// Transfers V2 DTOs - Phase D1
// Single Source of Truth for Transfer Read Models
// ============================================

/**
 * Minimal branch info for list displays
 */
export interface BranchMiniDTO {
  id: string;
  branch_code: string;
  branch_name: string;
}

/**
 * Transfer list item - used in tables and lists
 * Uses total_items from transfers table (no N+1)
 */
export interface TransferListItemDTO {
  id: string;
  transfer_code: string | null;
  transfer_date: string;
  status: string | null;
  total_items: number;
  total_cost: number;
  journal_entry_id: string | null;
  from_branch: BranchMiniDTO | null;
  to_branch: BranchMiniDTO;
  invoice_number?: string | null;
}

/**
 * Transfer item snapshot - from transfer_items table
 * Contains point-in-time snapshots of item data
 */
export interface TransferItemSnapshotDTO {
  item_id: string;
  item_code: string | null;
  weight_grams: number | null;
  unit_cost: number | null;
  // Display-only from jewelry_items (not snapshotted)
  model?: string | null;
  description?: string | null;
  stockcode?: string | null;
  type?: string | null;
}

/**
 * Full transfer details - header + items
 */
export interface TransferDetailsDTO {
  header: TransferListItemDTO & {
    // Additional fields for details view
    from_branch_id: string | null;
    to_branch_id: string;
    reverse_journal_entry_id: string | null;
    reversed_at: string | null;
    reversed_by: string | null;
    reversal_reason: string | null;
    approved_at: string | null;
    approved_by: string | null;
    transferred_by: string | null;
    notes: string | null;
    purchase_invoice_id: string | null;
  };
  items: TransferItemSnapshotDTO[];
}

/**
 * Filters for transfer list queries
 */
export interface TransferFiltersDTO {
  from_branch_id?: string | null;
  to_branch_id?: string | null;
  branch_id?: string | null; // Either from or to
  status?: string | null;
  search?: string | null;
  date_from?: string | null;
  date_to?: string | null;
}
