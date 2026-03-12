import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as dataGateway from '@/lib/dataGateway';
import {
  BranchMiniDTO,
  TransferListItemDTO,
  TransferDetailsDTO,
  TransferItemSnapshotDTO,
  TransferFiltersDTO
} from '@/types/transfers.v2.dto';
import { TransferActionAvailabilityDTO } from '@/types/transfers.v2.actions.dto';
import { 
  ReverseTransferPayloadDTO, 
  ReverseTransferResultDTO 
} from '@/types/transfers.v2.mutations.dto';
import { reverseTransferV2 } from '@/lib/transfersV2Service';

// ============================================
// ACTION AVAILABILITY HELPER - Phase D3
// Centralizes permission/rule logic for transfer actions
// ============================================

/**
 * Get action availability for a transfer based on its state
 * @param transfer - Transfer list item or details header
 * @returns Action availability DTO
 */
export function getTransferActionAvailability(
  transfer: TransferListItemDTO | null
): TransferActionAvailabilityDTO {
  if (!transfer) {
    return {
      can_view: false,
      can_print: false,
      can_open_journal: false,
      can_reverse: false,
      reverse_disabled_reason: 'Transfer not found',
    };
  }

  // Base rules
  const can_view = true;
  const can_print = true;
  const can_open_journal = !!transfer.journal_entry_id;
  
  // Reverse is available for posted transfers that haven't been reversed
  // Check status: only 'posted' can be reversed
  const isPosted = transfer.status === 'posted';
  
  // TODO: Add check for reversed_at when it's in the DTO
  // For now, we enable reverse for posted transfers
  const can_reverse = isPosted;
  const reverse_disabled_reason = !isPosted 
    ? 'يمكن عكس التحويلات المرحّلة فقط' 
    : null;

  return {
    can_view,
    can_print,
    can_open_journal,
    can_reverse,
    reverse_disabled_reason,
  };
}

// ============================================
// REVERSE TRANSFER MUTATION - Phase D4
// Uses reverseTransferV2 from service layer
// ============================================

export function useReverseTransferV2() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (payload: ReverseTransferPayloadDTO): Promise<ReverseTransferResultDTO> => {
      return reverseTransferV2(payload);
    },
    onSuccess: () => {
      // Invalidate all transfer-related queries
      queryClient.invalidateQueries({ queryKey: ['transfers-v2'] });
      queryClient.invalidateQueries({ queryKey: ['transfers-list-v2'] });
      queryClient.invalidateQueries({ queryKey: ['transfer-details-read-v2'] });
      queryClient.invalidateQueries({ queryKey: ['transfer-details-v2'] });
      queryClient.invalidateQueries({ queryKey: ['transfer-history-report-v2'] });
      queryClient.invalidateQueries({ queryKey: ['jewelry-items'] });
    }
  });
}

// ============================================
// READ MODEL HOOKS - Phase D1
// All queries go through dataGateway
// Components/Pages should ONLY use these hooks
// ============================================

function mapTransferListItem(t: any): TransferListItemDTO {
  const fromBranch: BranchMiniDTO | null = t.from_branch
    ? { id: t.from_branch.id, branch_code: t.from_branch.branch_code || '', branch_name: t.from_branch.branch_name || '' }
    : t.from_branch_name
      ? { id: t.from_branch_id, branch_code: t.from_branch_code || '', branch_name: t.from_branch_name || '' }
      : null;

  const toBranch: BranchMiniDTO = t.to_branch
    ? { id: t.to_branch.id, branch_code: t.to_branch.branch_code || '', branch_name: t.to_branch.branch_name || '' }
    : { id: t.to_branch_id, branch_code: t.to_branch_code || '', branch_name: t.to_branch_name || '' };

  return {
    id: t.id,
    transfer_code: t.transfer_code,
    transfer_date: t.transfer_date,
    status: t.status,
    total_items: t.total_items || 0,
    total_cost: t.total_cost || 0,
    journal_entry_id: t.journal_entry_id,
    from_branch: fromBranch,
    to_branch: toBranch,
    invoice_number: t.invoice?.invoice_number || t.invoice_number || null
  };
}

/**
 * Fetch paginated list of transfers with filters
 * Uses dataGateway.fetchTransfersList which handles Neon internally
 */
export function useTransfersList(filters: TransferFiltersDTO = {}) {
  return useQuery({
    queryKey: ['transfers-list-v2', filters],
    queryFn: async (): Promise<TransferListItemDTO[]> => {
      const { data, error } = await dataGateway.fetchTransfersList({
        branch_id: filters.branch_id ?? undefined,
        from_branch_id: filters.from_branch_id ?? undefined,
        to_branch_id: filters.to_branch_id ?? undefined,
        status: filters.status ?? undefined,
        date_from: filters.date_from ?? undefined,
        date_to: filters.date_to ?? undefined,
        search: filters.search ?? undefined,
      });

      if (error) throw new Error(error.message);

      return (data || []).map(mapTransferListItem);
    }
  });
}

/**
 * Fetch full transfer details with header + items
 * Uses dataGateway.fetchTransferDetails which handles Neon internally
 */
export function useTransferDetails(transferId: string | null) {
  return useQuery({
    queryKey: ['transfer-details-read-v2', transferId],
    queryFn: async (): Promise<TransferDetailsDTO | null> => {
      if (!transferId) return null;

      const { data, error } = await dataGateway.fetchTransferDetails(transferId);
      if (error) throw new Error(error.message);
      if (!data) return null;

      const transfer = data.header;
      const items = data.items;

      const fromBranch: BranchMiniDTO | null = transfer.from_branch
        ? { id: transfer.from_branch.id, branch_code: transfer.from_branch.branch_code || '', branch_name: transfer.from_branch.branch_name || '' }
        : transfer.from_branch_name
          ? { id: transfer.from_branch_id, branch_code: transfer.from_branch_code || '', branch_name: transfer.from_branch_name || '' }
          : null;

      const toBranch: BranchMiniDTO = transfer.to_branch
        ? { id: transfer.to_branch.id, branch_code: transfer.to_branch.branch_code || '', branch_name: transfer.to_branch.branch_name || '' }
        : { id: transfer.to_branch_id, branch_code: transfer.to_branch_code || '', branch_name: transfer.to_branch_name || '' };

      const header: TransferDetailsDTO['header'] = {
        id: transfer.id,
        transfer_code: transfer.transfer_code,
        transfer_date: transfer.transfer_date,
        status: transfer.status,
        total_items: transfer.total_items || 0,
        total_cost: transfer.total_cost || 0,
        journal_entry_id: transfer.journal_entry_id,
        from_branch: fromBranch,
        to_branch: toBranch,
        invoice_number: transfer.invoice?.invoice_number || transfer.invoice_number || null,
        from_branch_id: transfer.from_branch_id,
        to_branch_id: transfer.to_branch_id,
        reverse_journal_entry_id: transfer.reverse_journal_entry_id ?? null,
        reversed_at: transfer.reversed_at ?? null,
        reversed_by: transfer.reversed_by ?? null,
        reversal_reason: transfer.reversal_reason ?? null,
        approved_at: transfer.approved_at ?? null,
        approved_by: transfer.approved_by ?? null,
        transferred_by: transfer.transferred_by ?? transfer.created_by ?? null,
        notes: transfer.notes,
        purchase_invoice_id: transfer.purchase_invoice_id
      };

      const itemDtos: TransferItemSnapshotDTO[] = (items || []).map((item: any) => ({
        item_id: item.item_id,
        item_code: item.item_code,
        weight_grams: item.weight_grams,
        unit_cost: item.unit_cost,
        model: item.jewelry_item?.model || item.model || null,
        description: item.jewelry_item?.description || item.description || null,
        stockcode: item.jewelry_item?.stockcode || item.stockcode || null,
        type: item.jewelry_item?.type || item.type || null,
      }));

      return { header, items: itemDtos };
    },
    enabled: !!transferId
  });
}

/**
 * For TransferHistoryReport - same pattern as useTransfersList
 * Uses dataGateway.fetchTransfersList which handles Neon internally
 */
export function useTransferHistoryReport(filters: TransferFiltersDTO = {}) {
  return useQuery({
    queryKey: ['transfer-history-report-v2', filters],
    queryFn: async (): Promise<TransferListItemDTO[]> => {
      const { data, error } = await dataGateway.fetchTransfersList({
        branch_id: filters.branch_id ?? undefined,
        status: filters.status ?? undefined,
        date_from: filters.date_from ?? undefined,
        date_to: filters.date_to ?? undefined,
      });

      if (error) throw new Error(error.message);

      return (data || []).map(mapTransferListItem);
    }
  });
}
