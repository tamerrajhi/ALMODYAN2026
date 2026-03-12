import { forbidDirectWrite } from '@/lib/atomicWriteGuard';

const FORBIDDEN_GENERAL_INVENTORY_CODE = '1103';

export function validateInventoryAccountCode(accountCode: string, context?: string): void {
  if (accountCode === FORBIDDEN_GENERAL_INVENTORY_CODE) {
    const contextMsg = context ? ` (${context})` : '';
    throw new Error(
      `ممنوع استخدام حساب المخزون العام (${FORBIDDEN_GENERAL_INVENTORY_CODE})${contextMsg}. ` +
      `يجب استخدام حساب المخزون الخاص بالفرع. ` +
      `Direct posting to general inventory account is forbidden.`
    );
  }
}

export async function getBranchInventoryAccountCode(
  branchId: string | null | undefined,
  itemType: 'imported' | 'general' = 'imported'
): Promise<string> {
  if (!branchId) {
    throw new Error(
      'لا يمكن خصم المخزون بدون تحديد الفرع. ' +
      'Branch ID is required for inventory deduction.'
    );
  }

  try {
    const res = await fetch(`/api/branch-inventory-account?branch_id=${branchId}&item_type=${itemType}`);
    if (!res.ok) throw new Error(`خطأ في جلب حساب المخزون للفرع ${branchId}`);
    const data = await res.json();

    if (data.account_code) {
      validateInventoryAccountCode(data.account_code, 'getBranchInventoryAccountCode');
      return data.account_code;
    }

    const branchRes = await fetch(`/api/branches`);
    if (branchRes.ok) {
      const branches = await branchRes.json();
      const branch = branches.find((b: any) => b.id === branchId);
      if (branch) {
        console.log(`Creating inventory account for branch ${branch.name}...`);
        const createdAccountCode = await createBranchInventoryAccounts(branchId, branch.name, branch.code);
        if (createdAccountCode) return createdAccountCode;
      }
    }

    throw new Error(
      `لا يوجد حساب مخزون للفرع ${branchId}. ` +
      `يرجى إنشاء حساب مخزون للفرع أولاً. ` +
      `No inventory account found for branch.`
    );
  } catch (error) {
    console.error('Error in getBranchInventoryAccountCode:', error);
    throw error;
  }
}

/** @deprecated Use getBranchInventoryAccountCode instead */
export async function getBranchImportedPiecesAccountCode(branchId: string | null | undefined): Promise<string> {
  const DEFAULT_ACCOUNT_CODE = '1137';

  if (!branchId) {
    console.warn('No branchId provided, using default imported pieces account');
    return DEFAULT_ACCOUNT_CODE;
  }

  try {
    const res = await fetch(`/api/branch-inventory-account?branch_id=${branchId}&item_type=imported`);
    if (!res.ok) return DEFAULT_ACCOUNT_CODE;
    const data = await res.json();

    if (data.account_code) return data.account_code;

    console.log(`No imported pieces account found for branch ${branchId}, creating one...`);
    const branchRes = await fetch(`/api/branches`);
    if (branchRes.ok) {
      const branches = await branchRes.json();
      const branch = branches.find((b: any) => b.id === branchId);
      if (branch) {
        const createdAccountCode = await createBranchInventoryAccounts(branchId, branch.name, branch.code);
        return createdAccountCode || DEFAULT_ACCOUNT_CODE;
      }
    }

    return DEFAULT_ACCOUNT_CODE;
  } catch (error) {
    console.error('Error in getBranchImportedPiecesAccountCode:', error);
    return DEFAULT_ACCOUNT_CODE;
  }
}

export async function getBranchImportedPiecesAccountId(branchId: string | null | undefined): Promise<string | null> {
  if (!branchId) {
    const res = await fetch(`/api/branch-inventory-account-by-code?account_code=1137`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.id || null;
  }

  try {
    const res = await fetch(`/api/branch-inventory-account?branch_id=${branchId}&item_type=imported`);
    if (!res.ok) return null;
    const data = await res.json();

    if (data.account_id) return data.account_id;

    const fallbackRes = await fetch(`/api/branch-inventory-account-by-code?account_code=1137`);
    if (!fallbackRes.ok) return null;
    const fallbackData = await fallbackRes.json();
    return fallbackData.id || null;
  } catch (error) {
    console.error('Error fetching branch inventory account ID:', error);
    return null;
  }
}

export async function createBranchInventoryAccounts(
  branchId: string, 
  branchName: string,
  branchCode?: string
): Promise<string | null> {
  try {
    forbidDirectWrite('insert', 'branch-inventory-accounts.ts:createBranchInventoryAccounts');
    return null;
  } catch (error) {
    console.error('Error in createBranchInventoryAccounts:', error);
    return null;
  }
}

export async function ensureAllBranchesHaveInventoryAccounts(): Promise<void> {
  try {
    const branchesRes = await fetch(`/api/branches`);
    if (!branchesRes.ok) return;
    const branches = await branchesRes.json();

    const linksRes = await fetch(`/api/branch-inventory-accounts`);
    const existingLinks = linksRes.ok ? await linksRes.json() : [];
    const existingBranchIds = new Set(existingLinks.map((l: any) => l.branch_id));

    for (const branch of branches) {
      if (!existingBranchIds.has(branch.id)) {
        console.log(`Creating inventory accounts for branch: ${branch.name}`);
        await createBranchInventoryAccounts(branch.id, branch.name, branch.code);
      }
    }
  } catch (error) {
    console.error('Error ensuring all branches have inventory accounts:', error);
  }
}
