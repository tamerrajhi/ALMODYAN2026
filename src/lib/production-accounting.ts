import * as dataGateway from '@/lib/dataGateway';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';

// Production Account Codes
export const PRODUCTION_ACCOUNT_CODES = {
  RAW_MATERIAL_INVENTORY: '110306',  // مخزون المواد الخام
  WIP_INVENTORY: '110303',           // مخزون الإنتاج تحت التشغيل
  FINISHED_GOODS_FACTORY: '110304',  // مخزون الإنتاج التام - المصنع
  FINISHED_GOODS_SHOWROOM: '110305', // مخزون الإنتاج التام - المعارض
  PRODUCTION_SCRAP_LOSS: '540101',   // فاقد الإنتاج
};

interface JournalEntryLine {
  accountCode: string;
  debit: number;
  credit: number;
  description?: string;
}

interface ProductionJournalParams {
  description: string;
  referenceType: 'production_start' | 'production_complete' | 'production_scrap' | 'production_reversal';
  referenceId: string;
  workOrderId?: string;
  costCenterId?: string;
  lines: JournalEntryLine[];
  autoPost?: boolean;
}

/**
 * Get account ID by account code
 */
async function getAccountId(accountCode: string): Promise<string | null> {
  const { data } = await dataGateway.fetchTable('chart_of_accounts', {
    filters: { account_code: accountCode },
    single: true
  });
  
  return (data as any)?.id || null;
}

/**
 * Get production account settings
 */
export async function getProductionAccountSettings(branchId?: string): Promise<{
  wipAccountId: string | null;
  rawMaterialAccountId: string | null;
  finishedGoodsAccountId: string | null;
  scrapLossAccountId: string | null;
  isJournalAutoEnabled: boolean;
}> {
  // Try to get branch-specific settings first
  if (branchId) {
    const { data: branchSettings, error: branchError } = await dataGateway.fetchTable('production_account_settings', {
      filters: { branch_id: branchId },
      single: true
    });
    
    if (branchError) {
      console.error('Error fetching branch production settings:', branchError);
    }
    
    if (branchSettings) {
      const s = branchSettings as any;
      return {
        wipAccountId: s.wip_account_id,
        rawMaterialAccountId: s.raw_material_account_id,
        finishedGoodsAccountId: s.finished_goods_account_id,
        scrapLossAccountId: s.scrap_loss_account_id,
        isJournalAutoEnabled: s.is_journal_auto_enabled,
      };
    }
  }
  
  // Fall back to global settings (branch_id IS NULL)
  const { data: allSettings, error: globalError } = await dataGateway.fetchTable('production_account_settings', {});
  if (globalError) {
    console.error('Error fetching production account settings:', globalError);
  }
  const globalSettings = (allSettings as any[] || []).find((s: any) => s.branch_id === null || s.branch_id === undefined);
  
  if (globalSettings) {
    return {
      wipAccountId: globalSettings.wip_account_id,
      rawMaterialAccountId: globalSettings.raw_material_account_id,
      finishedGoodsAccountId: globalSettings.finished_goods_account_id,
      scrapLossAccountId: globalSettings.scrap_loss_account_id,
      isJournalAutoEnabled: globalSettings.is_journal_auto_enabled,
    };
  }
  
  // Return defaults using account codes
  return {
    wipAccountId: await getAccountId(PRODUCTION_ACCOUNT_CODES.WIP_INVENTORY),
    rawMaterialAccountId: await getAccountId(PRODUCTION_ACCOUNT_CODES.RAW_MATERIAL_INVENTORY),
    finishedGoodsAccountId: await getAccountId(PRODUCTION_ACCOUNT_CODES.FINISHED_GOODS_FACTORY),
    scrapLossAccountId: await getAccountId(PRODUCTION_ACCOUNT_CODES.PRODUCTION_SCRAP_LOSS),
    isJournalAutoEnabled: true,
  };
}

/**
 * Create a production-related journal entry
 */
async function createProductionJournalEntry(params: ProductionJournalParams): Promise<string | null> {
  try {
    const { description, referenceType, referenceId, workOrderId, costCenterId, lines, autoPost = true } = params;

    // Calculate totals
    const totalDebit = lines.reduce((sum, line) => sum + line.debit, 0);
    const totalCredit = lines.reduce((sum, line) => sum + line.credit, 0);

    // Validate balance
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      console.error('Journal entry is not balanced:', { totalDebit, totalCredit });
      return null;
    }

    // Generate entry number
    const { data: entryNumber } = await dataGateway.rpc('generate_journal_entry_number', {});

    // BLOCKED: Direct insert on journal_entries and journal_entry_lines
    forbidDirectWrite('insert', 'production-accounting.ts:119');
    return null;
  } catch (error) {
    console.error('Error in createProductionJournalEntry:', error);
    return null;
  }
}

/**
 * القيد رقم 1 - عند بدء الإنتاج
 * من حـ/ مخزون تحت التشغيل (WIP)
 * إلى حـ/ مخزون إنتاج خام (Raw Material)
 */
export async function createProductionStartJournalEntry(params: {
  workOrderId: string;
  workOrderCode: string;
  rawMaterialCost: number;
  costCenterId?: string;
  branchId?: string;
}): Promise<string | null> {
  const { workOrderId, workOrderCode, rawMaterialCost, costCenterId, branchId } = params;

  // Get settings
  const settings = await getProductionAccountSettings(branchId);
  
  if (!settings.isJournalAutoEnabled) {
    console.log('Automatic journal entries disabled');
    return null;
  }

  const lines: JournalEntryLine[] = [
    {
      accountCode: PRODUCTION_ACCOUNT_CODES.WIP_INVENTORY,
      debit: rawMaterialCost,
      credit: 0,
      description: `تحويل خامات لأمر إنتاج ${workOrderCode}`,
    },
    {
      accountCode: PRODUCTION_ACCOUNT_CODES.RAW_MATERIAL_INVENTORY,
      debit: 0,
      credit: rawMaterialCost,
      description: `صرف مواد خام لأمر إنتاج ${workOrderCode}`,
    },
  ];

  const journalId = await createProductionJournalEntry({
    description: `قيد إثبات تحويل خامات إلى تحت التشغيل لأمر إنتاج رقم ${workOrderCode}`,
    referenceType: 'production_start',
    referenceId: workOrderId,
    workOrderId,
    costCenterId,
    lines,
  });

  // BLOCKED: Direct update on work_orders
  if (journalId) {
    forbidDirectWrite('update', 'production-accounting.ts:215');
  }

  return journalId;
}

/**
 * القيد رقم 3 - عند إتمام الإنتاج
 * من حـ/ مخزون الإنتاج التام (Finished Goods)
 * إلى حـ/ مخزون تحت التشغيل (WIP)
 */
export async function createProductionCompleteJournalEntry(params: {
  workOrderId: string;
  workOrderCode: string;
  totalCost: number;
  costCenterId?: string;
  branchId?: string;
  isPartial?: boolean;
  partialCompletionId?: string;
}): Promise<string | null> {
  const { workOrderId, workOrderCode, totalCost, costCenterId, branchId, isPartial, partialCompletionId } = params;

  // Get settings
  const settings = await getProductionAccountSettings(branchId);
  
  if (!settings.isJournalAutoEnabled) {
    console.log('Automatic journal entries disabled');
    return null;
  }

  const partialText = isPartial ? ' (جزئي)' : '';

  const lines: JournalEntryLine[] = [
    {
      accountCode: PRODUCTION_ACCOUNT_CODES.FINISHED_GOODS_FACTORY,
      debit: totalCost,
      credit: 0,
      description: `إنتاج تام${partialText} - أمر ${workOrderCode}`,
    },
    {
      accountCode: PRODUCTION_ACCOUNT_CODES.WIP_INVENTORY,
      debit: 0,
      credit: totalCost,
      description: `إغلاق تحت التشغيل${partialText} - أمر ${workOrderCode}`,
    },
  ];

  const journalId = await createProductionJournalEntry({
    description: `قيد تحويل الإنتاج تحت التشغيل إلى إنتاج تام${partialText} لأمر إنتاج رقم ${workOrderCode}`,
    referenceType: 'production_complete',
    referenceId: isPartial ? partialCompletionId || workOrderId : workOrderId,
    workOrderId,
    costCenterId,
    lines,
  });

  // BLOCKED: Direct update on work_order_partial_completions or work_orders
  if (journalId) {
    forbidDirectWrite('update', 'production-accounting.ts:277');
  }

  return journalId;
}

/**
 * قيد الهالك - خسائر الإنتاج
 * من حـ/ خسائر هالك إنتاج
 * إلى حـ/ مخزون تحت التشغيل
 */
export async function createProductionScrapJournalEntry(params: {
  lossId: string;
  workOrderCode: string;
  scrapValue: number;
  costCenterId?: string;
  branchId?: string;
  description?: string;
}): Promise<string | null> {
  const { lossId, workOrderCode, scrapValue, costCenterId, branchId, description } = params;

  // Get settings
  const settings = await getProductionAccountSettings(branchId);
  
  if (!settings.isJournalAutoEnabled) {
    console.log('Automatic journal entries disabled');
    return null;
  }

  const lines: JournalEntryLine[] = [
    {
      accountCode: PRODUCTION_ACCOUNT_CODES.PRODUCTION_SCRAP_LOSS,
      debit: scrapValue,
      credit: 0,
      description: `هالك إنتاج - أمر ${workOrderCode}${description ? ` - ${description}` : ''}`,
    },
    {
      accountCode: PRODUCTION_ACCOUNT_CODES.WIP_INVENTORY,
      debit: 0,
      credit: scrapValue,
      description: `خصم هالك من تحت التشغيل - أمر ${workOrderCode}`,
    },
  ];

  return createProductionJournalEntry({
    description: `قيد هالك إنتاج لأمر ${workOrderCode}`,
    referenceType: 'production_scrap',
    referenceId: lossId,
    costCenterId,
    lines,
  });
}

/**
 * عكس قيد محاسبي
 */
export async function createReversalJournalEntry(params: {
  originalEntryId: string;
  reversalReason: string;
  reversedBy: string;
}): Promise<string | null> {
  const { originalEntryId, reversalReason, reversedBy } = params;

  // Get original entry
  const { data: originalEntry, error: fetchError } = await dataGateway.getJournalEntryWithLines(originalEntryId);

  if (fetchError || !originalEntry) {
    console.error('Error fetching original entry:', fetchError);
    return null;
  }

  // Generate entry number
  const { data: entryNumber } = await dataGateway.rpc('generate_journal_entry_number', {});

  // BLOCKED: Direct insert on journal_entries and journal_entry_lines, update on journal_entries
  forbidDirectWrite('insert', 'production-accounting.ts:365');
  return null;
}

/**
 * Check raw material availability before starting production
 */
export async function checkRawMaterialAvailability(
  branchId: string,
  requiredWeight: number
): Promise<{ available: boolean; currentStock: number; shortage: number }> {
  // Get total available raw materials in branch using wip_inventory
  const { data, error } = await dataGateway.fetchTable('wip_inventory', {
    filters: { status: 'in_stage' }
  });

  if (error) {
    console.error('Error checking raw material availability:', error);
    return { available: false, currentStock: 0, shortage: requiredWeight };
  }

  const currentStock = (data as any[] || []).reduce((sum: number, item: any) => sum + (item.gold_weight_in || 0), 0);
  const shortage = Math.max(0, requiredWeight - currentStock);

  return {
    available: currentStock >= requiredWeight,
    currentStock,
    shortage,
  };
}

/**
 * Calculate work order total cost
 */
export async function calculateWorkOrderTotalCost(workOrderId: string): Promise<{
  rawMaterialCost: number;
  additionalCost: number;
  totalCost: number;
}> {
  // Get materials cost
  const { data: materials } = await dataGateway.fetchTable('work_order_materials', {
    filters: { work_order_id: workOrderId }
  });

  const rawMaterialCost = (materials as any[] || []).reduce((sum: number, m: any) => sum + (m.total_cost || 0), 0);

  // Get additional direct costs
  const { data: directCosts } = await dataGateway.fetchTable('work_order_direct_costs', {
    filters: { work_order_id: workOrderId }
  });

  const additionalCost = (directCosts as any[] || []).reduce((sum: number, c: any) => sum + (c.amount || 0), 0);

  // Get labor costs
  const { data: labor } = await dataGateway.fetchTable('work_order_labor', {
    filters: { work_order_id: workOrderId }
  });

  const laborCost = (labor as any[] || []).reduce((sum: number, l: any) => sum + (l.total_cost || 0), 0);

  return {
    rawMaterialCost,
    additionalCost: additionalCost + laborCost,
    totalCost: rawMaterialCost + additionalCost + laborCost,
  };
}
