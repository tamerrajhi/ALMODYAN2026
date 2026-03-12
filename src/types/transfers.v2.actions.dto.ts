// ============================================
// Transfers V2 Actions DTO - Phase D3
// Action Availability Rules for Transfer Row Actions
// ============================================

/**
 * Defines which actions are available for a specific transfer
 * Used to centralize permission/rule logic away from UI components
 */
export interface TransferActionAvailabilityDTO {
  can_view: boolean;
  can_print: boolean;
  can_open_journal: boolean;
  can_reverse: boolean;
  reverse_disabled_reason?: string | null;
}
