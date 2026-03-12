import { createInventoryTransferJournalEntry } from './accounting';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';
import * as dataGateway from '@/lib/dataGateway';

export type TransferStatus = 'draft' | 'awaiting_approval' | 'approved' | 'posted' | 'reversed' | 'completed';

export interface TransferItem {
  id: string;
  item_code: string;
  cost: number | null;
  branch_id: string;
}

export interface TransferMovementParams {
  itemId: string;
  itemCode: string;
  cost: number;
  sourceBranchId: string;
  targetBranchId: string;
  transferId: string;
  journalEntryId?: string | null;
}

/**
 * Record inventory movements for a transfer (OUT from source, IN to target)
 */
export async function recordTransferMovements(
  items: TransferMovementParams[],
  isReverse: boolean = false
): Promise<void> {
  const movements = items.flatMap(item => [
    // OUT from source
    {
      item_id: item.itemId,
      movement_type: isReverse ? 'TRANSFER_REVERSE_IN' : 'TRANSFER_OUT',
      from_branch_id: isReverse ? item.targetBranchId : item.sourceBranchId,
      to_branch_id: isReverse ? item.sourceBranchId : null,
      reference_id: item.transferId,
      reference_type: isReverse ? 'transfer_reverse' : 'inventory_transfer',
      performed_by: 'system',
      cost: item.cost,
      journal_entry_id: item.journalEntryId,
    },
    // IN to target
    {
      item_id: item.itemId,
      movement_type: isReverse ? 'TRANSFER_REVERSE_OUT' : 'TRANSFER_IN',
      from_branch_id: null,
      to_branch_id: isReverse ? item.sourceBranchId : item.targetBranchId,
      reference_id: item.transferId,
      reference_type: isReverse ? 'transfer_reverse' : 'inventory_transfer',
      performed_by: 'system',
      cost: item.cost,
      journal_entry_id: item.journalEntryId,
    },
  ]);

  // BLOCKED: Direct insert on item_movements
  forbidDirectWrite('insert', 'transfer-accounting.ts:57');
}

/**
 * Check if a transfer can be reversed
 * Returns null if can be reversed, or error message if not
 */
export async function canReverseTransfer(transferId: string): Promise<string | null> {
  const { data: transfer, error: transferError } = await dataGateway.queryTable('transfers', {
    select: 'id, status, from_branch_id, to_branch_id',
    filters: [{ type: 'eq', column: 'id', value: transferId }],
    limit: 1,
    single: true,
  });

  if (transferError || !transfer) {
    return 'عملية النقل غير موجودة';
  }

  if (transfer.status !== 'posted') {
    return 'يمكن عكس عمليات النقل المرحّلة فقط';
  }

  const { data: transferItems } = await dataGateway.queryTable('transfer_items', {
    select: 'item_id',
    filters: [{ type: 'eq', column: 'transfer_id', value: transferId }],
  });

  if (!transferItems || transferItems.length === 0) {
    return 'لا توجد قطع مرتبطة بهذا النقل';
  }

  const itemIds = transferItems.map((ti: any) => ti.item_id);

  const { data: soldItems, error: soldError } = await dataGateway.queryTable('unique_items', {
    select: 'id, serial_no, sold_at',
    filters: [
      { type: 'in', column: 'id', value: itemIds },
      { type: 'not', column: 'sold_at', operator: 'is', value: null },
    ],
  });

  if (soldError) {
    return 'خطأ في التحقق من حالة القطع';
  }

  if (soldItems && soldItems.length > 0) {
    return `لا يمكن عكس النقل: ${soldItems.length} قطعة تم بيعها`;
  }

  return null;
}

/**
 * Reverse a transfer - return items to source branch and create reverse journal entry
 */
export async function reverseTransfer(
  transferId: string,
  userId: string,
  reason: string
): Promise<{ success: boolean; error?: string; reverseJournalEntryId?: string }> {
  // Validate can reverse
  const canReverse = await canReverseTransfer(transferId);
  if (canReverse) {
    return { success: false, error: canReverse };
  }

  try {
    const { data: transfer, error: transferError } = await dataGateway.queryTable('transfers', {
      select: 'id, from_branch_id, to_branch_id, total_cost, journal_entry_id, purchase_invoice_id',
      filters: [{ type: 'eq', column: 'id', value: transferId }],
      limit: 1,
      single: true,
    });

    if (transferError || !transfer) {
      throw new Error('فشل تحميل بيانات النقل');
    }

    const { data: transferItems } = await dataGateway.queryTable('transfer_items', {
      select: 'id, item_id',
      filters: [{ type: 'eq', column: 'transfer_id', value: transferId }],
    });

    const tiItemIds = (transferItems || []).map((ti: any) => ti.item_id);
    let itemsMap: Record<string, any> = {};
    if (tiItemIds.length > 0) {
      const { data: itemsData } = await dataGateway.queryTable('unique_items', {
        select: 'id, serial_no, cost, branch_id',
        filters: [{ type: 'in', column: 'id', value: tiItemIds }],
      });
      if (itemsData) {
        for (const it of itemsData) {
          itemsMap[it.id] = it;
        }
      }
    }
    const transferItemsWithJewelry = (transferItems || []).map((ti: any) => ({
      ...ti,
      jewelry_items: itemsMap[ti.item_id] || null,
    }));

    if (!transferItems || transferItems.length === 0) {
      throw new Error('لا توجد قطع مرتبطة بهذا النقل');
    }

    const itemsNotInTarget = transferItemsWithJewelry.filter(
      (ti: any) => ti.jewelry_items?.branch_id !== transfer.to_branch_id
    );

    if (itemsNotInTarget.length > 0) {
      throw new Error(`${itemsNotInTarget.length} قطعة تم نقلها لفرع آخر`);
    }

    const totalCost = transferItemsWithJewelry.reduce(
      (sum: number, ti: any) => sum + (Number(ti.jewelry_items?.cost) || 0),
      0
    );

    // Create reverse journal entry (swap source and target)
    let reverseJournalEntryId: string | null = null;
    if (totalCost > 0) {
      reverseJournalEntryId = await createInventoryTransferJournalEntry({
        transferId: transferId,
        sourceBranchId: transfer.to_branch_id, // Reversed
        targetBranchId: transfer.from_branch_id!, // Reversed
        totalCost: totalCost,
        purchaseInvoiceNumber: (transfer.invoices as any)?.invoice_number,
        notes: `قيد عكسي لنقل المخزون – ${reason}`,
      });
    }

    // BLOCKED: Direct update on transfers and jewelry_items
    forbidDirectWrite('update', 'transfer-accounting.ts:197');
    return {
      success: false,
      error: 'DIRECT_WRITE_BLOCKED',
    };
  } catch (error) {
    console.error('Error reversing transfer:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'خطأ غير متوقع',
    };
  }
}

/**
 * Approve a transfer and create journal entry
 */
export async function approveTransfer(
  transferId: string,
  approverId: string
): Promise<{ success: boolean; journalEntryId?: string; error?: string }> {
  try {
    const { data: transfer, error: transferError } = await dataGateway.queryTable('transfers', {
      select: 'id, status, from_branch_id, to_branch_id, total_cost, purchase_invoice_id',
      filters: [{ type: 'eq', column: 'id', value: transferId }],
      limit: 1,
      single: true,
    });

    if (transferError || !transfer) {
      throw new Error('فشل تحميل بيانات النقل');
    }

    if (transfer.status !== 'awaiting_approval') {
      throw new Error('النقل ليس في انتظار الموافقة');
    }

    // Create journal entry
    let journalEntryId: string | null = null;
    if (transfer.total_cost && transfer.total_cost > 0) {
      journalEntryId = await createInventoryTransferJournalEntry({
        transferId: transfer.id,
        sourceBranchId: transfer.from_branch_id!,
        targetBranchId: transfer.to_branch_id,
        totalCost: transfer.total_cost,
        purchaseInvoiceNumber: (transfer.invoices as any)?.invoice_number,
      });
    }

    // BLOCKED: Direct update on transfers
    forbidDirectWrite('update', 'transfer-accounting.ts:293');
    return {
      success: false,
      error: 'DIRECT_WRITE_BLOCKED',
    };
  } catch (error) {
    console.error('Error approving transfer:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'خطأ غير متوقع',
    };
  }
}

/**
 * Reject a transfer and return to draft
 */
export async function rejectTransfer(
  transferId: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // BLOCKED: Direct update on transfers
    forbidDirectWrite('update', 'transfer-accounting.ts:328');
    return {
      success: false,
      error: 'DIRECT_WRITE_BLOCKED',
    };
  } catch (error) {
    console.error('Error rejecting transfer:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'خطأ غير متوقع',
    };
  }
}

/**
 * Get transfer status label and color
 */
export function getTransferStatusDisplay(status: TransferStatus): {
  label: string;
  color: string;
  bgColor: string;
} {
  const statusMap: Record<TransferStatus, { label: string; color: string; bgColor: string }> = {
    draft: { label: 'مسودة', color: 'text-gray-700', bgColor: 'bg-gray-100' },
    awaiting_approval: { label: 'بانتظار الموافقة', color: 'text-amber-700', bgColor: 'bg-amber-100' },
    approved: { label: 'معتمد', color: 'text-blue-700', bgColor: 'bg-blue-100' },
    posted: { label: 'مرحّل', color: 'text-green-700', bgColor: 'bg-green-100' },
    completed: { label: 'مكتمل', color: 'text-green-700', bgColor: 'bg-green-100' },
    reversed: { label: 'معكوس', color: 'text-red-700', bgColor: 'bg-red-100' },
  };

  return statusMap[status] || statusMap.draft;
}
