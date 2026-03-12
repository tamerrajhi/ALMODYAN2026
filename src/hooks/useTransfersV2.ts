import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  CreateTransferPayloadDTO, 
  CreateTransferResultDTO, 
  TransferListItemDTO, 
  TransferDetailsDTO,
  TransferableItemDTO,
  TransferFiltersDTO,
  TransferItemDTO
} from '@/types/transfer.dto';
import { createTransferV2 } from '@/lib/transfersV2Service';

export function useCreateTransferV2() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (payload: CreateTransferPayloadDTO): Promise<CreateTransferResultDTO> => {
      return createTransferV2({
        from_branch_id: payload.from_branch_id ?? null,
        to_branch_id: payload.to_branch_id,
        transfer_date: payload.transfer_date,
        notes: payload.notes ?? null,
        purchase_invoice_id: payload.purchase_invoice_id ?? null,
        item_ids: payload.item_ids,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transfers-v2'] });
      queryClient.invalidateQueries({ queryKey: ['transfers-list-v2'] });
      queryClient.invalidateQueries({ queryKey: ['jewelry-items'] });
      queryClient.invalidateQueries({ queryKey: ['pos-items'] });
      queryClient.invalidateQueries({ queryKey: ['transferable-items'] });
    }
  });
}

export function useTransferableItems(branchId: string | null, search: string = '') {
  return useQuery({
    queryKey: ['transferable-items', branchId, search],
    queryFn: async (): Promise<TransferableItemDTO[]> => {
      if (!branchId) return [];
      
      const params = new URLSearchParams({ branch_id: branchId });
      if (search.trim()) params.set('search', search.trim());
      
      const response = await fetch(`/api/inventory/transferable-items?${params}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (result.error) throw new Error(result.error.message);
      
      return (result.data || []).map((item: any): TransferableItemDTO => ({
        id: item.id,
        item_code: item.item_code,
        model: item.model,
        description: item.description,
        g_weight: item.g_weight != null ? Number(item.g_weight) : null,
        cost: item.cost != null ? Number(item.cost) : null,
        branch_id: item.branch_id,
        branch_name: item.branch_name || null,
        sale_status: item.sale_status || null,
        purchase_invoice_id: item.purchase_invoice_id || item.unique_invoice_id || null,
        supp_inv: item.supp_inv || null,
      }));
    },
    enabled: !!branchId
  });
}

export function useItemsByPurchaseInvoice(invoiceId: string | null) {
  return useQuery({
    queryKey: ['items-by-invoice', invoiceId],
    queryFn: async (): Promise<TransferableItemDTO[]> => {
      if (!invoiceId) return [];
      
      const response = await fetch(`/api/inventory/items-by-invoice/${invoiceId}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (result.error) throw new Error(result.error.message);
      
      return (result.data || []).map((item: any): TransferableItemDTO => ({
        id: item.id,
        item_code: item.item_code,
        model: item.model,
        description: item.description,
        g_weight: item.g_weight != null ? Number(item.g_weight) : null,
        cost: item.cost != null ? Number(item.cost) : null,
        branch_id: item.branch_id,
        branch_name: item.branch_name || null,
        sale_status: item.sale_status || null,
        purchase_invoice_id: item.purchase_invoice_id || item.unique_invoice_id || null,
        supp_inv: item.supp_inv || null,
      }));
    },
    enabled: !!invoiceId
  });
}

export interface PurchaseInvoiceSearchResult {
  id: string;
  invoice_number: string;
  invoice_date: string;
  supplier_name: string | null;
  branch_id: string | null;
  branch_name: string | null;
  total_amount: number | null;
  supp_inv: string | null;
}

export function useSearchPurchaseInvoices(search: string) {
  return useQuery({
    queryKey: ['search-purchase-invoices', search],
    queryFn: async (): Promise<PurchaseInvoiceSearchResult[]> => {
      if (!search.trim()) return [];
      
      const params = new URLSearchParams({ search: search.trim() });
      const response = await fetch(`/api/inventory/search-purchase-invoices?${params}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (result.error) throw new Error(result.error.message);
      
      return (result.data || []).map((inv: any): PurchaseInvoiceSearchResult => ({
        id: inv.id,
        invoice_number: inv.invoice_number,
        invoice_date: inv.invoice_date,
        supplier_name: inv.supplier_name || null,
        branch_id: inv.branch_id,
        branch_name: inv.branch_name || null,
        total_amount: inv.total_amount != null ? Number(inv.total_amount) : null,
        supp_inv: inv.supp_inv || inv.supplier_invoice_no || null,
      }));
    },
    enabled: search.trim().length >= 2
  });
}
