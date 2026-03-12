// ============================================
// Transfer DTOs - Single Source of Truth
// ============================================

// Payload for creating a new transfer
export interface CreateTransferPayloadDTO {
  from_branch_id: string | null;
  to_branch_id: string;
  transfer_date?: string;
  notes?: string | null;
  purchase_invoice_id?: string | null;
  item_ids: string[];
}

// Result from create_transfer_v2 RPC
export interface CreateTransferResultDTO {
  success: boolean;
  transfer_id?: string;
  transfer_code?: string;
  total_items?: number;
  total_cost?: number;
  error?: string;
}

// Transfer list item (for history table)
export interface TransferListItemDTO {
  id: string;
  transfer_code: string | null;
  transfer_date: string;
  status: string | null;
  from_branch_id: string | null;
  to_branch_id: string;
  from_branch_name: string | null;
  from_branch_code: string | null;
  to_branch_name: string | null;
  to_branch_code: string | null;
  total_items: number;
  total_cost: number;
  journal_entry_id: string | null;
  transferred_by: string | null;
  created_by: string | null;
  notes: string | null;
  purchase_invoice_id: string | null;
  purchase_invoice_number: string | null;
}

// Transfer item (for details)
export interface TransferItemDTO {
  id: string;
  item_id: string;
  item_code: string | null;
  weight_grams: number | null;
  unit_cost: number | null;
  // From jewelry_items join
  model: string | null;
  description: string | null;
}

// Full transfer details
export interface TransferDetailsDTO {
  id: string;
  transfer_code: string | null;
  transfer_date: string;
  status: string | null;
  from_branch_id: string | null;
  to_branch_id: string;
  from_branch_name: string | null;
  to_branch_name: string | null;
  total_items: number;
  total_cost: number;
  journal_entry_id: string | null;
  reverse_journal_entry_id: string | null;
  reversed_at: string | null;
  reversed_by: string | null;
  reversal_reason: string | null;
  approved_at: string | null;
  approved_by: string | null;
  transferred_by: string | null;
  notes: string | null;
  purchase_invoice_id: string | null;
  purchase_invoice_number: string | null;
  items: TransferItemDTO[];
}

// Transferable item (for selection)
export interface TransferableItemDTO {
  id: string;
  item_code: string;
  model: string | null;
  description: string | null;
  g_weight: number | null;
  cost: number | null;
  branch_id: string | null;
  branch_name: string | null;
  sale_status: string | null;
  purchase_invoice_id: string | null;
  supp_inv: string | null;
}

// Filters for transfer list
export interface TransferFiltersDTO {
  branch_id?: string;
  from_branch_id?: string;
  to_branch_id?: string;
  status?: string;
  date_from?: string;
  date_to?: string;
  search?: string;
}
