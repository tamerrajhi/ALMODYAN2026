/**
 * Phase 3-B: Types for Accounting Monitoring Drill-Down
 */

export type DrillDownType = 
  | 'hb_legacy'
  | 'hb_new_violations'
  | 'allow_unallocated'
  | 'formula_mismatch'
  | 'negative_remaining'
  | 'overpaid'
  | 'stuck_workflows'
  | 'unbalanced_je';

export type HBLegacyClassification = 'pending' | 'backfilled' | 'advance_payment' | 'approved_exception';

export interface DrillDownFilters {
  fromDate?: string;
  toDate?: string;
  branchId?: string;
  supplierId?: string;
  workflowType?: string;
  referenceType?: string;
}

export interface HBLegacyRecord {
  payment_id: string;
  payment_number: string;
  payment_date: string;
  amount: number;
  supplier_id: string;
  supplier_name: string;
  branch_id: string;
  branch_name: string;
  created_at: string;
  hb_legacy_classification: HBLegacyClassification;
  hb_legacy_notes: string | null;
  hb_legacy_approved_by: string | null;
  hb_legacy_approved_at: string | null;
}

export interface HBNewViolationRecord {
  payment_id: string;
  payment_number: string;
  payment_date: string;
  amount: number;
  supplier_id: string;
  supplier_name: string;
  branch_id: string;
  branch_name: string;
  created_at: string;
  allow_unallocated: boolean;
}

export interface AllowUnallocatedRecord {
  payment_id: string;
  payment_number: string;
  payment_date: string;
  amount: number;
  supplier_id: string;
  supplier_name: string;
  branch_id: string;
  branch_name: string;
  created_at: string;
}

export interface FormulaMismatchRecord {
  invoice_id: string;
  invoice_number: string;
  invoice_type: string;
  invoice_date: string;
  supplier_id: string;
  supplier_name: string;
  branch_id: string;
  branch_name: string;
  total_amount: number;
  total_returned_amount: number;
  paid_amount: number;
  remaining_amount: number;
  expected_remaining: number;
  mismatch_amount: number;
}

export interface NegativeRemainingRecord {
  invoice_id: string;
  invoice_number: string;
  invoice_type: string;
  invoice_date: string;
  supplier_id: string;
  supplier_name: string;
  branch_id: string;
  branch_name: string;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
}

export interface OverpaidRecord {
  invoice_id: string;
  invoice_number: string;
  invoice_type: string;
  invoice_date: string;
  supplier_id: string;
  supplier_name: string;
  branch_id: string;
  branch_name: string;
  total_amount: number;
  total_returned_amount: number;
  paid_amount: number;
  overpaid_amount: number;
}

export interface StuckWorkflowRecord {
  client_request_id: string;
  workflow_type: string;
  entity_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  minutes_stuck: number;
  error_code: string | null;
  error_message: string | null;
}

export interface UnbalancedJERecord {
  journal_entry_id: string;
  entry_number: string;
  entry_date: string;
  reference_type: string;
  reference_id: string;
  description: string;
  total_debit: number;
  total_credit: number;
  imbalance_amount: number;
  is_posted: boolean;
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

export const RUNBOOKS: Record<DrillDownType, RunbookInfo> = {
  hb_legacy: {
    what: 'Supplier payments created before 2026-01-19 without invoice allocations',
    whatAr: 'دفعات موردين أُنشئت قبل 2026-01-19 بدون توزيعات على الفواتير',
    why: 'These may be advance payments, misclassified, or require retroactive allocation',
    whyAr: 'قد تكون دفعات مقدمة، أو مصنفة خطأً، أو تحتاج توزيع بأثر رجعي',
    owner: 'Management / Accounting',
    ownerAr: 'الإدارة / المحاسبة',
    steps: [
      'Review each payment with the supplier',
      'Classify as: Backfill allocation, Advance payment, or Approved exception',
      'For backfill: Select the invoice(s) to allocate against',
      'For advance: Mark as advance payment with notes',
      'For exception: Get management approval and document reason',
    ],
    stepsAr: [
      'مراجعة كل دفعة مع المورد',
      'التصنيف كـ: توزيع بأثر رجعي، دفعة مقدمة، أو استثناء معتمد',
      'للتوزيع: اختيار الفاتورة/الفواتير للتوزيع عليها',
      'للمقدمة: تحديد كدفعة مقدمة مع ملاحظات',
      'للاستثناء: الحصول على موافقة الإدارة وتوثيق السبب',
    ],
  },
  hb_new_violations: {
    what: 'Supplier payments after 2026-01-19 without allocations (Hard Block violations)',
    whatAr: 'دفعات موردين بعد 2026-01-19 بدون توزيعات (انتهاكات الحظر الصارم)',
    why: 'Critical: These should not exist after the Hard Block enforcement date',
    whyAr: 'حرج: يجب ألا توجد هذه الحالات بعد تاريخ تفعيل الحظر الصارم',
    owner: 'Accounting / Tech',
    ownerAr: 'المحاسبة / التقنية',
    steps: [
      'Investigate how payment was created without allocations',
      'Check if allow_unallocated escape hatch was used',
      'Review workflow logs for any failures',
      'Allocate to appropriate invoice(s) immediately',
      'Document root cause and prevent recurrence',
    ],
    stepsAr: [
      'التحقيق في كيفية إنشاء الدفعة بدون توزيعات',
      'التحقق من استخدام صلاحية allow_unallocated',
      'مراجعة سجلات سير العمل للأخطاء',
      'التوزيع على الفاتورة/الفواتير المناسبة فوراً',
      'توثيق السبب الجذري ومنع التكرار',
    ],
  },
  allow_unallocated: {
    what: 'Payments created using the allow_unallocated admin escape hatch',
    whatAr: 'دفعات أُنشئت باستخدام صلاحية allow_unallocated الإدارية',
    why: 'Tracking usage of this override to ensure it is not misused',
    whyAr: 'تتبع استخدام هذه الصلاحية للتأكد من عدم إساءة استخدامها',
    owner: 'Management',
    ownerAr: 'الإدارة',
    steps: [
      'Review reason for using override',
      'Verify business justification',
      'Consider adding allocation if possible',
      'Document for audit purposes',
    ],
    stepsAr: [
      'مراجعة سبب استخدام الصلاحية',
      'التحقق من المبرر التجاري',
      'النظر في إضافة توزيع إن أمكن',
      'التوثيق لأغراض التدقيق',
    ],
  },
  formula_mismatch: {
    what: 'Invoices where remaining ≠ total - returned - paid',
    whatAr: 'فواتير المتبقي فيها ≠ الإجمالي - المرتجع - المدفوع',
    why: 'Critical data integrity issue that affects payment reconciliation',
    whyAr: 'مشكلة سلامة بيانات حرجة تؤثر على تسوية الدفعات',
    owner: 'Accounting',
    ownerAr: 'المحاسبة',
    steps: [
      'Identify the source of mismatch',
      'Check payment allocations sum',
      'Check returns sum',
      'Recalculate and correct remaining_amount',
      'Create correcting journal entry if needed',
    ],
    stepsAr: [
      'تحديد مصدر عدم التطابق',
      'التحقق من مجموع توزيعات الدفعات',
      'التحقق من مجموع المرتجعات',
      'إعادة حساب وتصحيح المبلغ المتبقي',
      'إنشاء قيد تصحيحي إذا لزم الأمر',
    ],
  },
  negative_remaining: {
    what: 'Invoices with negative remaining amount',
    whatAr: 'فواتير بمبلغ متبقي سالب',
    why: 'Indicates overpayment or allocation errors',
    whyAr: 'يشير إلى دفع زائد أو أخطاء في التوزيع',
    owner: 'Accounting',
    ownerAr: 'المحاسبة',
    steps: [
      'Review all payment allocations',
      'Identify overpayment source',
      'Issue credit note or refund if needed',
      'Correct remaining_amount to zero',
    ],
    stepsAr: [
      'مراجعة جميع توزيعات الدفعات',
      'تحديد مصدر الدفع الزائد',
      'إصدار إشعار دائن أو استرداد إذا لزم',
      'تصحيح المبلغ المتبقي إلى صفر',
    ],
  },
  overpaid: {
    what: 'Invoices where paid_amount exceeds (total - returned)',
    whatAr: 'فواتير المدفوع فيها يتجاوز (الإجمالي - المرتجع)',
    why: 'Customer/supplier may be owed a refund',
    whyAr: 'قد يكون للعميل/المورد مبلغ مستحق للاسترداد',
    owner: 'Accounting',
    ownerAr: 'المحاسبة',
    steps: [
      'Calculate exact overpayment',
      'Determine if refund or credit needed',
      'Process refund or create credit note',
      'Adjust paid_amount accordingly',
    ],
    stepsAr: [
      'حساب المبلغ الزائد بدقة',
      'تحديد إذا كان مطلوب استرداد أو رصيد',
      'معالجة الاسترداد أو إنشاء إشعار دائن',
      'تعديل المبلغ المدفوع وفقاً لذلك',
    ],
  },
  stuck_workflows: {
    what: 'Atomic workflows stuck in_progress for more than 15 minutes',
    whatAr: 'عمليات ذرية عالقة في حالة التقدم لأكثر من 15 دقيقة',
    why: 'May indicate system failures or deadlocks requiring intervention',
    whyAr: 'قد يشير إلى أعطال في النظام أو توقفات تحتاج تدخل',
    owner: 'Tech Team',
    ownerAr: 'الفريق التقني',
    steps: [
      'Check workflow error_code and error_message',
      'Review result payload for partial completion',
      'Identify root cause (network, DB lock, etc.)',
      'Manually resolve or retry if safe',
      'Update workflow status to failed if unrecoverable',
    ],
    stepsAr: [
      'التحقق من كود الخطأ ورسالة الخطأ',
      'مراجعة نتيجة العملية للاكتمال الجزئي',
      'تحديد السبب الجذري (شبكة، قفل قاعدة بيانات، إلخ)',
      'الحل اليدوي أو إعادة المحاولة إذا كان آمناً',
      'تحديث حالة العملية إلى فشل إذا لم يمكن استرجاعها',
    ],
  },
  unbalanced_je: {
    what: 'Journal entries where total_debit ≠ total_credit',
    whatAr: 'قيود محاسبية إجمالي المدين فيها ≠ إجمالي الدائن',
    why: 'Violates fundamental accounting principle; must be corrected',
    whyAr: 'ينتهك مبدأ محاسبي أساسي؛ يجب التصحيح',
    owner: 'Accounting',
    ownerAr: 'المحاسبة',
    steps: [
      'Identify source document (invoice, payment, etc.)',
      'Review journal entry lines',
      'Find missing or incorrect line',
      'Create correcting entry or void and recreate',
      'Verify balance after correction',
    ],
    stepsAr: [
      'تحديد المستند المصدر (فاتورة، دفعة، إلخ)',
      'مراجعة سطور القيد',
      'إيجاد السطر المفقود أو الخاطئ',
      'إنشاء قيد تصحيحي أو إلغاء وإعادة إنشاء',
      'التحقق من التوازن بعد التصحيح',
    ],
  },
};
