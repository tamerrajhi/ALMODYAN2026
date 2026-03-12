import * as dataGateway from '@/lib/dataGateway';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';

export type AuditActionType = 
  | 'Create' 
  | 'Update' 
  | 'Delete' 
  | 'Approve' 
  | 'Reject' 
  | 'Login' 
  | 'Logout'
  | 'Import'
  | 'Transfer'
  | 'Post'
  | 'Unpost'
  | 'Reverse'
  | 'Submit'
  | 'Cancel'
  | 'Convert'
  | 'Hold'
  | 'Void';

export type AuditEntityType = 
  | 'Invoice'
  | 'Item'
  | 'JewelryItem'
  | 'Stock'
  | 'GoldPrice'
  | 'JournalEntry'
  | 'User'
  | 'Transfer'
  | 'TransferRequest'
  | 'InventoryCount'
  | 'Sale'
  | 'Return'
  | 'Payment'
  | 'Customer'
  | 'Supplier'
  | 'Branch'
  | 'PurchaseBatch'
  | 'GoldScrap'
  | 'Account'
  | 'Role'
  | 'PurchaseRequisition'
  | 'PurchaseOrder'
  | 'CostCenter'
  | 'WorkOrder'
  | 'ProductionSettings'
  | 'CreditNote'
  | 'GoodsReceipt'
  | 'PurchaseReturnUnique'
  | 'PurchaseReturnGeneral'
  | 'purchase_return_unique'
  | 'purchase_return_general';

interface AuditLogParams {
  userId?: string;
  userName?: string;
  userRole?: string;
  actionType: AuditActionType;
  entityType: AuditEntityType;
  entityId?: string;
  entityCode?: string;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  branchId?: string;
  branchName?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export async function logAudit(params: AuditLogParams): Promise<void> {
  try {
    let userId = params.userId;
    let userName = params.userName;

    let userRole = params.userRole;
    if (!userRole && userId) {
      const { data: roles } = await dataGateway.fetchUserRole(userId);
      if (roles && roles.length > 0) {
        userRole = roles[0].role;
      }
    }

    // BLOCKED: Direct insert on audit_logs
    forbidDirectWrite('insert', 'audit.ts:98');
    return;
  } catch (error) {
    console.error('Audit logging error:', error);
  }
}

// Action labels in Arabic
export const actionTypeLabels: Record<string, string> = {
  Create: 'إنشاء',
  Update: 'تعديل',
  Delete: 'حذف',
  Approve: 'اعتماد',
  Reject: 'رفض',
  Login: 'تسجيل دخول',
  Logout: 'تسجيل خروج',
  Import: 'استيراد',
  Transfer: 'تحويل',
  Post: 'ترحيل',
  Unpost: 'إلغاء ترحيل',
  Reverse: 'عكس قيد',
  Hold: 'تعليق',
  Void: 'إلغاء',
};

// Entity labels in Arabic
export const entityTypeLabels: Record<string, string> = {
  Invoice: 'فاتورة',
  Item: 'قطعة',
  JewelryItem: 'قطعة مجوهرات',
  Stock: 'مخزون',
  GoldPrice: 'سعر ذهب',
  JournalEntry: 'قيد محاسبي',
  User: 'مستخدم',
  Transfer: 'تحويل',
  TransferRequest: 'طلب تحويل',
  InventoryCount: 'جرد',
  Sale: 'مبيعات',
  Return: 'مرتجع',
  Payment: 'دفعة',
  Customer: 'عميل',
  Supplier: 'مورد',
  Branch: 'فرع',
  PurchaseBatch: 'دفعة شراء',
  GoldScrap: 'كسر ذهب',
  Account: 'حساب',
  Role: 'دور',
  PurchaseRequisition: 'طلب شراء',
  PurchaseOrder: 'أمر شراء',
  CostCenter: 'مركز تكلفة',
  WorkOrder: 'أمر إنتاج',
  ProductionSettings: 'إعدادات الإنتاج',
  CreditNote: 'إشعار دائن',
  PurchaseReturnUnique: 'مرتجع مشتريات (قطع)',
  PurchaseReturnGeneral: 'مرتجع مشتريات (عام)',
  purchase_return_unique: 'مرتجع مشتريات (قطع)',
  purchase_return_general: 'مرتجع مشتريات (عام)',
};

// Action colors for badges
export const actionTypeColors: Record<string, string> = {
  Create: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400',
  Update: 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400',
  Delete: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/30 dark:text-red-400',
  Approve: 'bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-400',
  Reject: 'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:text-orange-400',
  Login: 'bg-cyan-100 text-cyan-800 border-cyan-300 dark:bg-cyan-900/30 dark:text-cyan-400',
  Logout: 'bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-900/30 dark:text-slate-400',
  Import: 'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/30 dark:text-purple-400',
  Transfer: 'bg-indigo-100 text-indigo-800 border-indigo-300 dark:bg-indigo-900/30 dark:text-indigo-400',
  Post: 'bg-teal-100 text-teal-800 border-teal-300 dark:bg-teal-900/30 dark:text-teal-400',
  Unpost: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400',
  Reverse: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-900/30 dark:text-rose-400',
  Hold: 'bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-400',
  Void: 'bg-gray-100 text-gray-800 border-gray-300 dark:bg-gray-900/30 dark:text-gray-400',
};
