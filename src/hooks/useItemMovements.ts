import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

export type MovementType = 
  | 'IMPORT' 
  | 'PURCHASE' 
  | 'purchase_in'
  | 'transfer'
  | 'TRANSFER' 
  | 'TRANSFER_IN' 
  | 'TRANSFER_OUT' 
  | 'SALE' 
  | 'RETURN' 
  | 'RETURN_IN' 
  | 'RETURN_OUT'
  | 'ADJUSTMENT'
  | 'WRITE_OFF';

export type ReferenceType = 
  | 'purchase_invoice' 
  | 'unique_purchase_invoice'
  | 'sale_invoice' 
  | 'pos_sale' 
  | 'pos_return' 
  | 'sales_return'
  | 'transfer' 
  | 'purchase_return' 
  | 'adjustment'
  | 'batch';

export interface MovementEntry {
  id: string;
  movement_type: MovementType;
  movement_date: string;
  reference_id: string | null;
  reference_type: ReferenceType | null;
  reference_code: string | null;
  from_branch_id: string | null;
  to_branch_id: string | null;
  from_branch_name: string | null;
  to_branch_name: string | null;
  performed_by: string | null;
  notes: string | null;
  cost: number | null;
  journal_entry_id: string | null;
  documentSummary?: DocumentSummary;
}

export interface DocumentSummary {
  id: string;
  code: string;
  date: string;
  type: string;
  status?: string;
  total_amount?: number;
  tax_amount?: number;
  party_name?: string;
  party_type?: 'customer' | 'supplier';
  branch_name?: string;
  items_count?: number;
  top_items?: Array<{
    description: string;
    quantity: number;
    price: number;
  }>;
}

const PAGE_SIZE = 50;

export const movementConfig: Record<MovementType, { 
  label: string; 
  labelEn: string; 
  color: string;
  bgColor: string;
}> = {
  IMPORT: { label: 'استيراد', labelEn: 'Import', color: 'text-green-700', bgColor: 'bg-green-100' },
  PURCHASE: { label: 'فاتورة مشتريات', labelEn: 'Purchase', color: 'text-green-700', bgColor: 'bg-green-100' },
  purchase_in: { label: 'استيراد قطعة فريدة', labelEn: 'Unique Import', color: 'text-green-700', bgColor: 'bg-green-100' },
  transfer: { label: 'نقل بين الفروع', labelEn: 'Branch Transfer', color: 'text-blue-700', bgColor: 'bg-blue-100' },
  TRANSFER: { label: 'نقل', labelEn: 'Transfer', color: 'text-blue-700', bgColor: 'bg-blue-100' },
  TRANSFER_IN: { label: 'استلام تحويل', labelEn: 'Transfer In', color: 'text-blue-700', bgColor: 'bg-blue-100' },
  TRANSFER_OUT: { label: 'إرسال تحويل', labelEn: 'Transfer Out', color: 'text-blue-700', bgColor: 'bg-blue-100' },
  SALE: { label: 'بيع', labelEn: 'Sale', color: 'text-amber-700', bgColor: 'bg-amber-100' },
  RETURN: { label: 'مرتجع', labelEn: 'Return', color: 'text-purple-700', bgColor: 'bg-purple-100' },
  RETURN_IN: { label: 'مرتجع للمخزن', labelEn: 'Return In', color: 'text-purple-700', bgColor: 'bg-purple-100' },
  RETURN_OUT: { label: 'مرتجع للمورد', labelEn: 'Return Out', color: 'text-red-700', bgColor: 'bg-red-100' },
  ADJUSTMENT: { label: 'تسوية', labelEn: 'Adjustment', color: 'text-orange-700', bgColor: 'bg-orange-100' },
  WRITE_OFF: { label: 'إعدام', labelEn: 'Write-off', color: 'text-red-700', bgColor: 'bg-red-100' },
};

export const documentRoutes: Record<ReferenceType, string> = {
  purchase_invoice: '/purchasing/invoices/{id}/view',
  unique_purchase_invoice: '/purchasing/invoices/{id}/view',
  sale_invoice: '/sales/invoices/{id}/view',
  pos_sale: '/pos/invoices/{id}/view',
  pos_return: '/pos/return?returnId={id}',
  sales_return: '/pos/return?returnId={id}',
  transfer: '/transfers?id={id}',
  purchase_return: '/purchasing/returns-hub/r/{id}',
  adjustment: '/inventory-counts/{id}',
  batch: '/batches/{id}',
};

export function getDocumentRoute(referenceType: ReferenceType | null, referenceId: string | null): string | null {
  if (!referenceType || !referenceId) return null;
  const routeTemplate = documentRoutes[referenceType];
  if (!routeTemplate) return null;
  return routeTemplate.replace('{id}', referenceId);
}

export function useItemMovementsPaginated(itemId: string | null, itemSource: 'jewelry' | 'unique' = 'jewelry') {
  return useInfiniteQuery({
    queryKey: ['item-movements-paginated', itemId, itemSource],
    queryFn: async ({ pageParam = 0 }) => {
      if (!itemId) return { movements: [], nextPage: null };

      const params = new URLSearchParams({
        source: itemSource,
        page: String(pageParam),
        pageSize: String(PAGE_SIZE)
      });
      const response = await fetch(`/api/inventory/item-movements/${itemId}?${params}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (result.error) throw new Error(result.error.message);

      const movements: MovementEntry[] = (result.data.movements || []).map((m: any) => ({
        id: m.id,
        movement_type: m.movement_type as MovementType,
        movement_date: m.movement_date,
        reference_id: m.reference_id,
        reference_type: m.reference_type as ReferenceType | null,
        reference_code: m.journal_entry_number || m.reference_code || null,
        from_branch_id: m.from_branch_id,
        to_branch_id: m.to_branch_id,
        from_branch_name: m.from_branch_name || null,
        to_branch_name: m.to_branch_name || null,
        performed_by: m.created_by || null,
        notes: m.notes,
        cost: m.unit_cost != null ? Number(m.unit_cost) : null,
        journal_entry_id: m.journal_entry_id || null,
      }));

      return {
        movements,
        nextPage: result.data.hasMore ? pageParam + 1 : null,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextPage,
    initialPageParam: 0,
    enabled: !!itemId,
  });
}

export function useDocumentSummaries(movements: MovementEntry[]) {
  const refs = useMemo(() => {
    const unique: Array<{ referenceType: string; referenceId: string }> = [];
    const seen = new Set<string>();
    for (const m of movements) {
      if (m.reference_type && m.reference_id) {
        const key = `${m.reference_type}:${m.reference_id}`;
        if (!seen.has(key)) {
          seen.add(key);
          unique.push({ referenceType: m.reference_type, referenceId: m.reference_id });
        }
      }
    }
    return unique;
  }, [movements]);

  const stableKey = useMemo(() => 
    refs.map(r => `${r.referenceType}:${r.referenceId}`).sort().join('|'),
    [refs]
  );

  const { data } = useQuery({
    queryKey: ['document-summaries-batch', stableKey],
    queryFn: async () => {
      const map = new Map<string, DocumentSummary>();
      if (refs.length === 0) return map;
      try {
        const res = await fetch('/api/inventory/document-details/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refs }),
        });
        const json = await res.json();
        if (json.data) {
          for (const [key, doc] of Object.entries(json.data)) {
            map.set(key, doc as DocumentSummary);
          }
        }
      } catch (e) {
        console.error('Failed to fetch document summaries batch:', e);
      }
      return map;
    },
    enabled: refs.length > 0,
    staleTime: 60000,
  });

  return data || new Map<string, DocumentSummary>();
}

export function useItemMovements(itemId: string | null, pageSize = 50, itemSource: 'jewelry' | 'unique' = 'jewelry') {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useItemMovementsPaginated(itemId, itemSource);
  
  const movements = useMemo(() => {
    if (!data) return [];
    return data.pages.flatMap(page => page.movements);
  }, [data]);
  
  const documentSummaries = useDocumentSummaries(movements);
  
  return {
    movements,
    documentSummaries,
    isLoading,
    hasMore: !!hasNextPage,
    loadMore: fetchNextPage,
    isLoadingMore: isFetchingNextPage,
  };
}

export function useDocumentDetails(referenceType: ReferenceType | null, referenceId: string | null) {
  return useQuery({
    queryKey: ['document-details', referenceType, referenceId],
    queryFn: async (): Promise<DocumentSummary | null> => {
      if (!referenceType || !referenceId) return null;
      const res = await fetch(`/api/inventory/document-details?referenceType=${encodeURIComponent(referenceType)}&referenceId=${encodeURIComponent(referenceId)}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      return json.data || null;
    },
    enabled: !!referenceType && !!referenceId,
  });
}

export interface JournalEntryDetails {
  id: string;
  entry_number: string;
  entry_date: string;
  description: string | null;
  status: string | null;
  reference_type: string | null;
  reference_id: string | null;
  total_debit: number;
  total_credit: number;
  created_by: string | null;
  lines: Array<{
    id: string;
    account_code: string;
    account_name: string;
    debit_amount: number;
    credit_amount: number;
    description: string | null;
  }>;
}

export function useJournalEntryDetails(journalEntryId: string | null) {
  return useQuery({
    queryKey: ['journal-entry-details', journalEntryId],
    queryFn: async (): Promise<JournalEntryDetails | null> => {
      if (!journalEntryId) return null;
      const res = await fetch(`/api/inventory/journal-entry/${encodeURIComponent(journalEntryId)}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      return json.data || null;
    },
    enabled: !!journalEntryId,
  });
}
