// Purchasing Monitoring Types

export type PurchasingDrillDownType =
  | 'draft_invoices'
  | 'posted_no_je'
  | 'returns_pending_post'
  | 'returns_ref_mismatch'
  | 'vendor_negative_balance'
  | 'paid_with_remaining'
  | 'missing_movements'
  | 'wrong_account_mapping';

export interface PurchasingDrillDownFilters {
  dateFrom?: string;
  dateTo?: string;
  supplierId?: string;
  branchId?: string;
  invoiceNumber?: string;
  status?: string;
}

export interface InvoiceRecord {
  id: string;
  invoice_number: string;
  invoice_date: string;
  supplier_id: string;
  supplier_name?: string;
  branch_id: string;
  branch_name?: string;
  total_amount: number;
  remaining_amount: number;
  status: string;
  journal_entry_id?: string;
  created_at: string;
}

export interface ReturnRecord {
  id: string;
  return_number: string;
  return_date: string;
  supplier_id: string;
  supplier_name?: string;
  branch_id: string;
  branch_name?: string;
  total_amount: number;
  status: string;
  journal_entry_id?: string;
  invoice_id?: string;
  invoice_number?: string;
}

export interface VendorRecord {
  id: string;
  code: string;
  name: string;
  outstanding_balance: number;
  credit_limit: number;
  is_active: boolean;
}

export interface RunbookInfo {
  what: string;
  whatAr: string;
  why: string;
  whyAr: string;
  owner: string;
  ownerAr: string;
  steps: string[];
  stepsAr: string[];
}

export const PURCHASING_RUNBOOKS: Record<PurchasingDrillDownType, RunbookInfo> = {
  draft_invoices: {
    what: 'Purchase invoices in draft status that have not been posted',
    whatAr: 'فواتير مشتريات في حالة مسودة لم يتم ترحيلها',
    why: 'Draft invoices do not affect accounting or inventory until posted',
    whyAr: 'الفواتير المسودة لا تؤثر على المحاسبة أو المخزون حتى يتم ترحيلها',
    owner: 'Purchasing / Accounting',
    ownerAr: 'المشتريات / المحاسبة',
    steps: [
      'Review each draft invoice for completeness',
      'Verify supplier, items, and amounts are correct',
      'Post the invoice if ready',
      'Cancel if created in error',
    ],
    stepsAr: [
      'مراجعة كل فاتورة مسودة للتأكد من اكتمالها',
      'التحقق من صحة المورد والأصناف والمبالغ',
      'ترحيل الفاتورة إذا كانت جاهزة',
      'إلغاء الفاتورة إذا تم إنشاؤها بالخطأ',
    ],
  },
  posted_no_je: {
    what: 'Posted invoices that are missing their journal entry',
    whatAr: 'فواتير مرحلة بدون قيد محاسبي',
    why: 'This indicates a failure in the posting process - accounting is incomplete',
    whyAr: 'هذا يشير إلى فشل في عملية الترحيل - المحاسبة غير مكتملة',
    owner: 'Accounting / IT',
    ownerAr: 'المحاسبة / تقنية المعلومات',
    steps: [
      'Identify when the invoice was posted',
      'Check for errors in the posting logs',
      'Use Runbook action to re-create journal entry',
      'Verify the JE was created correctly',
    ],
    stepsAr: [
      'تحديد وقت ترحيل الفاتورة',
      'التحقق من الأخطاء في سجلات الترحيل',
      'استخدام إجراء Runbook لإعادة إنشاء القيد المحاسبي',
      'التحقق من صحة القيد المحاسبي',
    ],
  },
  returns_pending_post: {
    what: 'Purchase returns that have not been posted yet',
    whatAr: 'مرتجعات مشتريات لم يتم ترحيلها بعد',
    why: 'Unposted returns do not reverse inventory or accounting entries',
    whyAr: 'المرتجعات غير المرحلة لا تعكس المخزون أو القيود المحاسبية',
    owner: 'Purchasing / Warehouse',
    ownerAr: 'المشتريات / المستودع',
    steps: [
      'Review each pending return',
      'Verify items have been returned to supplier',
      'Post the return to update inventory and accounting',
    ],
    stepsAr: [
      'مراجعة كل مرتجع معلق',
      'التحقق من إرجاع الأصناف للمورد',
      'ترحيل المرتجع لتحديث المخزون والمحاسبة',
    ],
  },
  returns_ref_mismatch: {
    what: 'Returns where the journal entry reference does not match',
    whatAr: 'مرتجعات حيث مرجع القيد المحاسبي غير متطابق',
    why: 'Reference mismatch can cause reconciliation issues',
    whyAr: 'عدم تطابق المرجع يمكن أن يسبب مشاكل في المطابقة',
    owner: 'Accounting',
    ownerAr: 'المحاسبة',
    steps: [
      'Compare the return record with its linked JE',
      'Use Runbook action to re-link if needed',
      'Verify the reference matches after correction',
    ],
    stepsAr: [
      'مقارنة سجل المرتجع مع القيد المحاسبي المرتبط',
      'استخدام إجراء Runbook لإعادة الربط إذا لزم الأمر',
      'التحقق من تطابق المرجع بعد التصحيح',
    ],
  },
  vendor_negative_balance: {
    what: 'Suppliers with negative outstanding balance',
    whatAr: 'موردين برصيد مستحق سالب',
    why: 'May indicate overpayment or accounting error',
    whyAr: 'قد يشير إلى دفعة زائدة أو خطأ محاسبي',
    owner: 'Accounting',
    ownerAr: 'المحاسبة',
    steps: [
      'Review payment history for the supplier',
      'Check for duplicate payments',
      'Reconcile with supplier statement',
      'Create debit note or request refund if overpaid',
    ],
    stepsAr: [
      'مراجعة تاريخ الدفعات للمورد',
      'التحقق من الدفعات المكررة',
      'مطابقة مع كشف حساب المورد',
      'إنشاء إشعار مدين أو طلب استرداد إذا تم الدفع الزائد',
    ],
  },
  paid_with_remaining: {
    what: 'Invoices marked as paid but still have remaining amount > 0',
    whatAr: 'فواتير مسجلة كمدفوعة لكن المتبقي > 0',
    why: 'Data inconsistency - status should match remaining amount',
    whyAr: 'عدم اتساق البيانات - الحالة يجب أن تتطابق مع المبلغ المتبقي',
    owner: 'Accounting',
    ownerAr: 'المحاسبة',
    steps: [
      'Review payment allocations for the invoice',
      'Verify all payments are correctly allocated',
      'Use Runbook action to recompute remaining amount',
      'Update status if fully paid',
    ],
    stepsAr: [
      'مراجعة توزيعات الدفعات للفاتورة',
      'التحقق من صحة توزيع جميع الدفعات',
      'استخدام إجراء Runbook لإعادة حساب المبلغ المتبقي',
      'تحديث الحالة إذا تم السداد الكامل',
    ],
  },
  missing_movements: {
    what: 'Invoices or returns without corresponding inventory movements',
    whatAr: 'فواتير أو مرتجعات بدون حركات مخزون مقابلة',
    why: 'Inventory is not being updated correctly',
    whyAr: 'المخزون لا يتم تحديثه بشكل صحيح',
    owner: 'IT / Warehouse',
    ownerAr: 'تقنية المعلومات / المستودع',
    steps: [
      'Identify the missing movement type',
      'Check if items are inventory-tracked',
      'Use Runbook action to rebuild movements if safe',
    ],
    stepsAr: [
      'تحديد نوع الحركة المفقودة',
      'التحقق مما إذا كانت الأصناف تُتبع في المخزون',
      'استخدام إجراء Runbook لإعادة بناء الحركات إذا كان آمناً',
    ],
  },
  wrong_account_mapping: {
    what: 'Transactions with incorrect account mapping in journal entries',
    whatAr: 'معاملات بخريطة حسابات خاطئة في القيود المحاسبية',
    why: 'Financial reports will be incorrect',
    whyAr: 'التقارير المالية ستكون غير صحيحة',
    owner: 'Accounting',
    ownerAr: 'المحاسبة',
    steps: [
      'Review the chart of accounts configuration',
      'Identify the correct accounts for the transaction type',
      'Create correcting journal entry if needed',
    ],
    stepsAr: [
      'مراجعة إعدادات دليل الحسابات',
      'تحديد الحسابات الصحيحة لنوع المعاملة',
      'إنشاء قيد تصحيحي إذا لزم الأمر',
    ],
  },
};
