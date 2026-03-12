// ============================================
// Transfers V2 Service - Phase D2
// Unified Write Path for All Transfer Operations
// Uses create_transfer_v2 RPC ONLY - No Legacy RPCs
// ============================================

import * as dataGateway from '@/lib/dataGateway';
import type {
  CreateTransferPayloadDTO,
  CreateTransferResultDTO,
  ReverseTransferPayloadDTO,
  ReverseTransferResultDTO,
  TransferVerificationResultDTO,
} from '@/types/transfers.v2.mutations.dto';

/**
 * Create a new transfer using create_transfer_v2 RPC
 * This is the ONLY authorized path for creating transfers.
 */
export async function createTransferV2(
  payload: CreateTransferPayloadDTO
): Promise<CreateTransferResultDTO> {
  try {
    // Build RPC payload - ensure proper null handling
    const rpcPayload = {
      from_branch_id: payload.from_branch_id ?? null,
      to_branch_id: payload.to_branch_id,
      transfer_date: payload.transfer_date ?? null,
      notes: payload.notes ?? null,
      purchase_invoice_id: payload.purchase_invoice_id ?? null,
      item_ids: payload.item_ids,
    };

    const { data, error } = await dataGateway.rpc('create_transfer_v2', {
      p_payload: rpcPayload,
    });

    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    // RPC returns JSON - parse the result
    const result = data as unknown as CreateTransferResultDTO;
    
    return {
      success: result.success ?? false,
      transfer_id: result.transfer_id,
      transfer_code: result.transfer_code,
      total_items: result.total_items,
      total_cost: result.total_cost,
      journal_entry_id: result.journal_entry_id,
      journal_entry_number: result.journal_entry_number,
      error: result.error,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'خطأ غير متوقع أثناء إنشاء التحويل',
    };
  }
}

/**
 * Reverse a transfer using reverse_transfer_v2 RPC
 * This is the ONLY authorized path for reversing transfers.
 */
export async function reverseTransferV2(
  payload: ReverseTransferPayloadDTO
): Promise<ReverseTransferResultDTO> {
  try {
    const rpcPayload = {
      transfer_id: payload.transfer_id,
      notes: payload.notes ?? null,
    };

    const { data, error } = await dataGateway.rpc('reverse_transfer_v2', {
      p_payload: rpcPayload,
    });

    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    const result = data as unknown as ReverseTransferResultDTO;

    return {
      success: result.success ?? false,
      reversal_transfer_id: result.reversal_transfer_id,
      reversal_transfer_code: result.reversal_transfer_code,
      journal_entry_id: result.journal_entry_id,
      journal_entry_number: result.journal_entry_number,
      total_items: result.total_items,
      total_cost: result.total_cost,
      error: result.error,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'خطأ غير متوقع أثناء عكس التحويل',
    };
  }
}

/**
 * Verify transfer completion - V2 version
 * Checks that transfer was properly created and all data is consistent
 */
export async function verifyTransferV2Completion(
  transferId: string,
  expectedItemCount?: number,
  targetBranchId?: string
): Promise<TransferVerificationResultDTO> {
  const details: string[] = [];
  let transferExists = false;
  let itemsCountMatch = false;
  let branchUpdated = false;
  let journalBalanced: boolean | null = null;

  try {
    // 1. Verify transfer exists
    const { data: transfer, error: transferError } = await dataGateway.fetchTable('transfers', {
      filters: { id: transferId },
      single: true
    });

    if (transferError || !transfer) {
      details.push('لم يتم العثور على سجل التحويل');
      return {
        ok: false,
        transferExists: false,
        itemsCountMatch: false,
        branchUpdated: false,
        journalBalanced: null,
        details,
        error: 'Transfer not found',
      };
    }

    const t = transfer as any;
    transferExists = true;
    details.push(`التحويل ${t.transfer_code} موجود`);

    // 2. Verify transfer_items count
    const { data: transferItems, error: tiError } = await dataGateway.fetchTable('transfer_items', {
      filters: { transfer_id: transferId }
    });

    if (tiError) {
      details.push('تعذر التحقق من عدد عناصر التحويل');
    } else {
      const count = (transferItems as any[] || []).length;
      if (expectedItemCount !== undefined) {
        if (count === expectedItemCount) {
          itemsCountMatch = true;
          details.push(`عدد القطع المنقولة: ${count}`);
        } else {
          details.push(`عدد القطع غير متطابق: متوقع ${expectedItemCount}، فعلي ${count}`);
        }
      } else if (count > 0) {
        itemsCountMatch = true;
        details.push(`عدد القطع المنقولة: ${count}`);
      } else {
        details.push('لا توجد قطع في التحويل');
      }
    }

    // 3. Verify jewelry_items.branch_id updated (if targetBranchId provided)
    if (targetBranchId) {
      const { data: tiData } = await dataGateway.fetchTable('transfer_items', {
        filters: { transfer_id: transferId }
      });

      if (tiData && (tiData as any[]).length > 0) {
        const itemIds = (tiData as any[]).map((ti: any) => ti.item_id);
        
        const { data: allItems } = await dataGateway.fetchJewelryItems();
        const updatedItems = (allItems || []).filter((item: any) => itemIds.includes(item.id));

        const allUpdated = updatedItems.every(
          (item: any) => item.branch_id === targetBranchId
        );
        if (allUpdated && updatedItems.length === itemIds.length) {
          branchUpdated = true;
          details.push('تم تحديث فرع جميع القطع');
        } else {
          const notUpdated = updatedItems.filter((item: any) => item.branch_id !== targetBranchId).length;
          details.push(`${notUpdated} قطعة لم يتم تحديث فرعها`);
        }
      }
    } else {
      branchUpdated = true;
      details.push('فرع الوجهة محدد في التحويل');
    }

    // 4. Verify journal entry is balanced (if exists)
    if (t.journal_entry_id) {
      const { data: je, error: jeError } = await dataGateway.fetchTable('journal_entries', {
        filters: { id: t.journal_entry_id },
        single: true
      });

      if (jeError || !je) {
        details.push('تعذر التحقق من القيد المحاسبي');
      } else {
        const jeData = je as any;
        if (jeData.total_debit === jeData.total_credit) {
          journalBalanced = true;
          details.push(`القيد ${jeData.entry_number} متوازن (${jeData.total_debit} ر.س)`);
        } else {
          journalBalanced = false;
          details.push(
            `القيد غير متوازن: مدين ${jeData.total_debit}، دائن ${jeData.total_credit}`
          );
        }
      }
    } else {
      const { data: costData } = await dataGateway.fetchTable('transfers', {
        filters: { id: transferId },
        single: true
      });
      
      if ((costData as any)?.total_cost && (costData as any).total_cost > 0) {
        details.push('لم يتم إنشاء قيد محاسبي (تحقق من إعدادات حسابات الفروع)');
        journalBalanced = null;
      }
    }

    const ok =
      transferExists &&
      itemsCountMatch &&
      branchUpdated &&
      journalBalanced !== false;

    return {
      ok,
      transferExists,
      itemsCountMatch,
      branchUpdated,
      journalBalanced,
      details,
    };
  } catch (err: any) {
    return {
      ok: false,
      transferExists: false,
      itemsCountMatch: false,
      branchUpdated: false,
      journalBalanced: null,
      details: ['خطأ أثناء التحقق من التحويل'],
      error: err.message,
    };
  }
}

/**
 * Execute transfer with post-checks - V2 version
 * Creates transfer and verifies completion in one call
 */
export async function executeTransferV2WithChecks(
  payload: CreateTransferPayloadDTO
): Promise<{
  result: CreateTransferResultDTO;
  verification: TransferVerificationResultDTO | null;
  isPartialSuccess: boolean;
}> {
  // Create transfer via V2 RPC
  const result = await createTransferV2(payload);

  if (!result.success || !result.transfer_id) {
    return {
      result,
      verification: null,
      isPartialSuccess: false,
    };
  }

  // Perform verification checks
  const verification = await verifyTransferV2Completion(
    result.transfer_id,
    payload.item_ids.length,
    payload.to_branch_id
  );

  return {
    result,
    verification,
    isPartialSuccess: result.success && !verification.ok,
  };
}
