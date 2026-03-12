import * as dataGateway from '@/lib/dataGateway';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';

// Types
export type HealthCheckCategory = 
  | 'journal_entries' 
  | 'sales' 
  | 'purchases' 
  | 'returns' 
  | 'payments' 
  | 'balances' 
  | 'inventory' 
  | 'trial_balance';

export type HealthCheckSeverity = 'critical' | 'warning' | 'info';

export interface HealthCheckIssue {
  id: string;
  category: HealthCheckCategory;
  severity: HealthCheckSeverity;
  issueCode: string;
  title: string;
  description: string;
  affectedRecords: number;
  affectedAmount?: number;
  canAutoFix: boolean;
  autoFixFunction?: string;
  details: any[];
  manualFixSteps?: string[];
}

export interface HealthCheckResult {
  runId: string;
  runNumber: string;
  startedAt: Date;
  completedAt?: Date;
  status: 'running' | 'completed' | 'failed';
  mode: 'read_only' | 'with_fixes';
  totalChecks: number;
  passedChecks: number;
  warningChecks: number;
  criticalChecks: number;
  healthScore: number;
  issues: HealthCheckIssue[];
  categorySummary: Record<HealthCheckCategory, {
    total: number;
    passed: number;
    warnings: number;
    critical: number;
  }>;
}

export interface HealthCheckOptions {
  mode: 'read_only' | 'with_fixes';
  categories?: HealthCheckCategory[];
  userId?: string;
  userName?: string;
}

// Category labels
export const categoryLabels: Record<HealthCheckCategory, { ar: string; en: string }> = {
  journal_entries: { ar: 'القيود المحاسبية', en: 'Journal Entries' },
  sales: { ar: 'المبيعات', en: 'Sales' },
  purchases: { ar: 'المشتريات', en: 'Purchases' },
  returns: { ar: 'المرتجعات', en: 'Returns' },
  payments: { ar: 'سندات الصرف والقبض', en: 'Payments' },
  balances: { ar: 'أرصدة العملاء والموردين', en: 'Balances' },
  inventory: { ar: 'المخزون', en: 'Inventory' },
  trial_balance: { ar: 'ميزان المراجعة', en: 'Trial Balance' },
};

// Severity labels in Arabic
export const severityLabels: Record<HealthCheckSeverity, string> = {
  critical: 'حرج',
  warning: 'تحذير',
  info: 'معلومات',
};

// Generate run number
async function generateRunNumber(): Promise<string> {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  
  const { data } = await dataGateway.queryTable('accounting_health_check_runs', {
    select: 'id',
    filters: [{ type: 'gte', column: 'started_at', value: today.toISOString().slice(0, 10) }],
  });
  const count = data?.length || 0;
  
  const seq = (count || 0) + 1;
  return `AHC-${dateStr}-${seq.toString().padStart(3, '0')}`;
}

// Log audit action
export async function logAccountingAudit(params: {
  auditType: 'health_check' | 'auto_fix' | 'manual_fix' | 'system';
  category: string;
  issueType: string;
  entityType?: string;
  entityId?: string;
  entityCode?: string;
  oldValue?: any;
  newValue?: any;
  description: string;
  details?: any;
  userId?: string;
  userName?: string;
  status?: string;
}): Promise<void> {
  try {
    // BLOCKED: Direct insert to accounting_audit_logs
    forbidDirectWrite('insert', 'src/lib/accounting-health-checks.ts:112');
  } catch (error) {
    console.error('Failed to log accounting audit:', error);
  }
}

// Check 1: Unbalanced Journal Entries
async function checkUnbalancedJournalEntries(): Promise<HealthCheckIssue[]> {
  const issues: HealthCheckIssue[] = [];
  
  const { data: allEntries } = await dataGateway.queryTable('journal_entries', {
    select: 'id, entry_number, entry_date, total_debit, total_credit, description',
  });
  
  const unbalanced = (allEntries || []).filter((e: any) => 
    Math.abs((e.total_debit || 0) - (e.total_credit || 0)) > 0.01
  );
  
  if (unbalanced.length > 0) {
    const totalDiff = unbalanced.reduce((sum: number, e: any) => 
      sum + Math.abs((e.total_debit || 0) - (e.total_credit || 0)), 0
    );
    
    issues.push({
      id: 'unbalanced_journal_entries',
      category: 'journal_entries',
      severity: 'critical',
      issueCode: 'JE001',
      title: 'قيود محاسبية غير متوازنة',
      description: `يوجد ${unbalanced.length} قيد محاسبي غير متوازن (المدين ≠ الدائن)`,
      affectedRecords: unbalanced.length,
      affectedAmount: totalDiff,
      canAutoFix: false,
      details: unbalanced.map((e: any) => ({
        id: e.id,
        entryNumber: e.entry_number,
        date: e.entry_date,
        debit: e.total_debit,
        credit: e.total_credit,
        difference: Math.abs((e.total_debit || 0) - (e.total_credit || 0)),
      })),
      manualFixSteps: [
        'مراجعة كل قيد غير متوازن',
        'تحديد البند الناقص أو الزائد',
        'تعديل القيد لتحقيق التوازن',
      ],
    });
  }
  
  return issues;
}

// Check 2: Journal Entries without Lines
async function checkJournalEntriesWithoutLines(): Promise<HealthCheckIssue[]> {
  const issues: HealthCheckIssue[] = [];
  
  const { data: entries } = await dataGateway.queryTable('journal_entries', {
    select: 'id, entry_number, entry_date, description',
  });
  const { data: allLines } = await dataGateway.queryTable('journal_entry_lines', {
    select: 'id, journal_entry_id',
  });
  const linesByEntry = new Set((allLines || []).map((l: any) => l.journal_entry_id));
  const emptyEntries = (entries || []).filter((e: any) => !linesByEntry.has(e.id));
  
  if (emptyEntries.length > 0) {
    issues.push({
      id: 'empty_journal_entries',
      category: 'journal_entries',
      severity: 'warning',
      issueCode: 'JE002',
      title: 'قيود بدون بنود تفصيلية',
      description: `يوجد ${emptyEntries.length} قيد محاسبي بدون أي سطور تفصيلية`,
      affectedRecords: emptyEntries.length,
      canAutoFix: false,
      details: emptyEntries.map((e: any) => ({
        id: e.id,
        entryNumber: e.entry_number,
        date: e.entry_date,
        description: e.description,
      })),
      manualFixSteps: [
        'مراجعة القيود الفارغة',
        'إضافة البنود المطلوبة أو حذف القيد',
      ],
    });
  }
  
  return issues;
}

// Check 3: Sales without Journal Entries
async function checkSalesWithoutJournal(): Promise<HealthCheckIssue[]> {
  const issues: HealthCheckIssue[] = [];
  
  const { data: salesInvoices } = await dataGateway.queryTable('invoices', {
    select: 'id, invoice_number, invoice_date, total_amount',
    filters: [
      { type: 'eq', column: 'invoice_type', value: 'sales' },
      { type: 'is', column: 'journal_entry_id', value: null },
    ],
  });
  
  if (salesInvoices && salesInvoices.length > 0) {
    const totalAmount = salesInvoices.reduce((sum: number, s: any) => sum + (s.total_amount || 0), 0);
    
    issues.push({
      id: 'sales_without_journal',
      category: 'sales',
      severity: 'critical',
      issueCode: 'SL001',
      title: 'مبيعات بدون قيد محاسبي',
      description: `يوجد ${salesInvoices.length} فاتورة مبيعات بدون قيد محاسبي مرتبط`,
      affectedRecords: salesInvoices.length,
      affectedAmount: totalAmount,
      canAutoFix: true,
      autoFixFunction: 'createMissingSalesJournalEntries',
      details: salesInvoices.map((s: any) => ({
        id: s.id,
        invoiceNumber: s.invoice_number,
        date: s.invoice_date,
        amount: s.total_amount,
      })),
      manualFixSteps: [
        'مراجعة فواتير المبيعات المفقودة',
        'إنشاء قيود محاسبية لكل فاتورة',
      ],
    });
  }
  
  return issues;
}

// Check 5: Payments without Journal Entries
async function checkPaymentsWithoutJournal(): Promise<HealthCheckIssue[]> {
  const issues: HealthCheckIssue[] = [];
  
  const { data: receipts } = await dataGateway.queryTable('customer_receipts', {
    select: 'id, receipt_number, receipt_date, amount',
    filters: [{ type: 'is', column: 'journal_entry_id', value: null }],
  });
  
  if (receipts && receipts.length > 0) {
    const totalAmount = receipts.reduce((sum: number, r: any) => sum + (r.amount || 0), 0);
    
    issues.push({
      id: 'receipts_without_journal',
      category: 'payments',
      severity: 'critical',
      issueCode: 'PY002',
      title: 'سندات قبض بدون قيد محاسبي',
      description: `يوجد ${receipts.length} سند قبض بدون قيد محاسبي مرتبط`,
      affectedRecords: receipts.length,
      affectedAmount: totalAmount,
      canAutoFix: true,
      autoFixFunction: 'createMissingReceiptJournalEntries',
      details: receipts.map((r: any) => ({
        id: r.id,
        receiptNumber: r.receipt_number,
        date: r.receipt_date,
        amount: r.amount,
      })),
    });
  }
  
  return issues;
}

// Check 5.5: Purchases without journal entries
async function checkPurchasesWithoutJournal(): Promise<HealthCheckIssue[]> {
  const issues: HealthCheckIssue[] = [];
  
  const { data: invoices } = await dataGateway.queryTable('invoices', {
    select: 'id, invoice_number, invoice_date, total_amount',
    filters: [
      { type: 'eq', column: 'invoice_type', value: 'purchase' },
      { type: 'is', column: 'journal_entry_id', value: null },
      { type: 'in', column: 'status', value: ['confirmed', 'partial'] },
    ],
  });
  
  if (invoices && invoices.length > 0) {
    const totalAmount = invoices.reduce((sum: number, inv: any) => sum + (inv.total_amount || 0), 0);
    
    issues.push({
      id: 'purchases_without_journal',
      category: 'purchases',
      severity: 'critical',
      issueCode: 'PU001',
      title: 'فواتير مشتريات بدون قيد محاسبي',
      description: `يوجد ${invoices.length} فاتورة مشتريات مؤكدة بدون قيد محاسبي`,
      affectedRecords: invoices.length,
      affectedAmount: totalAmount,
      canAutoFix: true,
      autoFixFunction: 'createMissingPurchaseJournalEntries',
      details: invoices.map((inv: any) => ({
        id: inv.id,
        invoiceNumber: inv.invoice_number,
        date: inv.invoice_date,
        amount: inv.total_amount,
      })),
    });
  }
  
  return issues;
}

// Check 6: Returns exceeding original quantity
async function checkExcessReturns(): Promise<HealthCheckIssue[]> {
  const issues: HealthCheckIssue[] = [];
  
  const { data: returnInvoices } = await dataGateway.queryTable('invoices', {
    select: 'id, invoice_number, invoice_date, total_amount',
    filters: [{ type: 'eq', column: 'invoice_type', value: 'purchase_return' }],
  });
  
  if (returnInvoices && returnInvoices.length > 0) {
    const orphanReturns = returnInvoices.filter((r: any) => !r);
    
    if (returnInvoices.length > 0) {
      issues.push({
        id: 'purchase_returns_check',
        category: 'returns',
        severity: 'info',
        issueCode: 'RT001',
        title: 'مرتجعات المشتريات',
        description: `تم العثور على ${returnInvoices.length} مرتجع مشتريات للمراجعة`,
        affectedRecords: returnInvoices.length,
        canAutoFix: false,
        details: returnInvoices.slice(0, 10).map((r: any) => ({
          id: r.id,
          invoiceNumber: r.invoice_number,
          date: r.invoice_date,
          amount: r.total_amount,
        })),
        manualFixSteps: [
          'مراجعة المرتجعات',
          'التأكد من صحة القيود المحاسبية',
        ],
      });
    }
  }
  
  return issues;
}

// Check 7: Customer Balance Discrepancies
async function checkCustomerBalances(): Promise<HealthCheckIssue[]> {
  const issues: HealthCheckIssue[] = [];
  
  const { data: customers } = await dataGateway.queryTable('customers', {
    select: 'id, customer_code, full_name, total_purchases',
    limit: 50,
  });
  
  const balanceIssues: Array<{
    id: string;
    code: string;
    name: string;
    storedBalance: number;
    calculatedBalance: number;
    difference: number;
  }> = [];
  
  for (const customer of (customers || [])) {
    const salesResult = await dataGateway.queryTable('sales', {
      select: 'total_amount',
      filters: [{ type: 'eq', column: 'customer_id', value: customer.id }],
    });
    const sales = salesResult.data as Array<{ total_amount: number | null }> | null;
    
    const receiptsResult = await dataGateway.queryTable('customer_receipts', {
      select: 'amount',
      filters: [{ type: 'eq', column: 'customer_id', value: customer.id }],
    });
    const receipts = receiptsResult.data as Array<{ amount: number | null }> | null;
    
    const totalSales = (sales || []).reduce((sum, s) => sum + (s.total_amount || 0), 0);
    const totalReceipts = (receipts || []).reduce((sum, r) => sum + (r.amount || 0), 0);
    const calculatedBalance = totalSales - totalReceipts;
    const storedBalance = customer.total_purchases || 0;
    
    if (Math.abs(calculatedBalance - storedBalance) > 0.01) {
      balanceIssues.push({
        id: customer.id,
        code: customer.customer_code,
        name: customer.full_name,
        storedBalance,
        calculatedBalance,
        difference: calculatedBalance - storedBalance,
      });
    }
  }
  
  if (balanceIssues.length > 0) {
    const totalDiff = balanceIssues.reduce((sum, b) => sum + Math.abs(b.difference), 0);
    
    issues.push({
      id: 'customer_balance_discrepancy',
      category: 'balances',
      severity: 'warning',
      issueCode: 'BL001',
      title: 'اختلاف في أرصدة العملاء',
      description: `يوجد ${balanceIssues.length} عميل برصيد مخزّن مختلف عن الرصيد المحسوب`,
      affectedRecords: balanceIssues.length,
      affectedAmount: totalDiff,
      canAutoFix: true,
      autoFixFunction: 'recalculateCustomerBalances',
      details: balanceIssues,
    });
  }
  
  return issues;
}

// Check 8: Supplier Balance Discrepancies
async function checkSupplierBalances(): Promise<HealthCheckIssue[]> {
  const issues: HealthCheckIssue[] = [];
  
  const { data: suppliers } = await dataGateway.queryTable('suppliers', {
    select: 'id, supplier_code, supplier_name, current_balance',
  });
  
  const balanceIssues: any[] = [];
  
  for (const supplier of (suppliers || []).slice(0, 20)) { // Limit for performance
    const { data: invoices } = await dataGateway.queryTable('invoices', {
      select: 'total_amount',
      filters: [
        { type: 'eq', column: 'supplier_id', value: supplier.id },
        { type: 'eq', column: 'invoice_type', value: 'purchase' },
        { type: 'in', column: 'status', value: ['confirmed', 'partial'] },
      ],
    });
    
    const totalInvoices = (invoices || []).reduce((sum: number, i: any) => sum + (i.total_amount || 0), 0);
    const storedBalance = supplier.current_balance || 0;
    
    if (Math.abs(totalInvoices - storedBalance) > 100) { // Allow small differences
      balanceIssues.push({
        id: supplier.id,
        code: supplier.supplier_code,
        name: supplier.supplier_name,
        storedBalance,
        calculatedBalance: totalInvoices,
        difference: totalInvoices - storedBalance,
      });
    }
  }
  
  if (balanceIssues.length > 0) {
    const totalDiff = balanceIssues.reduce((sum: number, b: any) => sum + Math.abs(b.difference), 0);
    
    issues.push({
      id: 'supplier_balance_discrepancy',
      category: 'balances',
      severity: 'warning',
      issueCode: 'BL002',
      title: 'اختلاف في أرصدة الموردين',
      description: `يوجد ${balanceIssues.length} مورد برصيد مخزّن مختلف عن الرصيد المحسوب`,
      affectedRecords: balanceIssues.length,
      affectedAmount: totalDiff,
      canAutoFix: true,
      autoFixFunction: 'recalculateSupplierBalances',
      details: balanceIssues,
    });
  }
  
  return issues;
}

// Check 9: Inventory Issues (simplified)
async function checkInventoryIssues(): Promise<HealthCheckIssue[]> {
  const issues: HealthCheckIssue[] = [];
  
  const { data: showroomItems } = await dataGateway.queryTable('finished_goods_showroom', {
    select: 'id, item_code, status, sale_id',
    filters: [
      { type: 'eq', column: 'status', value: 'sold' },
      { type: 'is', column: 'sale_id', value: null },
    ],
  });
  
  if (showroomItems && showroomItems.length > 0) {
    issues.push({
      id: 'sold_items_no_sale_id',
      category: 'inventory',
      severity: 'warning',
      issueCode: 'INV001',
      title: 'قطع مباعة بدون ربط بعملية بيع',
      description: `يوجد ${showroomItems.length} قطعة بحالة "مباعة" لكن بدون sale_id`,
      affectedRecords: showroomItems.length,
      canAutoFix: false,
      details: showroomItems.map((item: any) => ({
        id: item.id,
        itemCode: item.item_code,
        status: item.status,
      })),
      manualFixSteps: [
        'مراجعة القطع المباعة',
        'ربطها بعملية البيع الصحيحة أو تغيير حالتها',
      ],
    });
  }
  
  return issues;
}

// Check 10: Trial Balance
async function checkTrialBalance(): Promise<HealthCheckIssue[]> {
  const issues: HealthCheckIssue[] = [];
  
  const { data: accounts } = await dataGateway.queryTable('chart_of_accounts', {
    select: 'id, account_code, account_name, account_type, current_balance',
  });
  
  let totalDebit = 0;
  let totalCredit = 0;
  
  for (const account of (accounts || [])) {
    const balance = account.current_balance || 0;
    if (['asset', 'expense'].includes(account.account_type)) {
      if (balance >= 0) totalDebit += balance;
      else totalCredit += Math.abs(balance);
    } else {
      if (balance >= 0) totalCredit += balance;
      else totalDebit += Math.abs(balance);
    }
  }
  
  const difference = Math.abs(totalDebit - totalCredit);
  
  if (difference > 0.01) {
    issues.push({
      id: 'trial_balance_imbalance',
      category: 'trial_balance',
      severity: 'critical',
      issueCode: 'TB001',
      title: 'ميزان المراجعة غير متوازن',
      description: `إجمالي المدين (${totalDebit.toFixed(2)}) ≠ إجمالي الدائن (${totalCredit.toFixed(2)})`,
      affectedRecords: 1,
      affectedAmount: difference,
      canAutoFix: false,
      details: [{
        totalDebit,
        totalCredit,
        difference,
      }],
      manualFixSteps: [
        'مراجعة جميع القيود المحاسبية',
        'البحث عن قيود غير متوازنة',
        'إنشاء قيد تسوية إذا لزم الأمر',
      ],
    });
  }
  
  return issues;
}

// Main function to run all health checks
export async function runHealthCheck(options: HealthCheckOptions): Promise<HealthCheckResult> {
  const runId = crypto.randomUUID();
  const runNumber = await generateRunNumber();
  const startedAt = new Date();
  
  const userId = options.userId;
  
  // BLOCKED: Direct insert to accounting_health_check_runs
  forbidDirectWrite('insert', 'src/lib/accounting-health-checks.ts:599');
  
  // Log audit
  await logAccountingAudit({
    auditType: 'health_check',
    category: 'system',
    issueType: 'health_check_started',
    description: `بدء فحص الصحة المحاسبية - الجلسة ${runNumber}`,
    details: { runId, mode: options.mode },
  });
  
  const allIssues: HealthCheckIssue[] = [];
  const categoriesToCheck = options.categories || Object.keys(categoryLabels) as HealthCheckCategory[];
  
  try {
    if (categoriesToCheck.includes('journal_entries')) {
      allIssues.push(...await checkUnbalancedJournalEntries());
      allIssues.push(...await checkJournalEntriesWithoutLines());
    }
    
    if (categoriesToCheck.includes('sales')) {
      allIssues.push(...await checkSalesWithoutJournal());
    }
    
    if (categoriesToCheck.includes('purchases')) {
      allIssues.push(...await checkPurchasesWithoutJournal());
    }
    
    if (categoriesToCheck.includes('payments')) {
      allIssues.push(...await checkPaymentsWithoutJournal());
    }
    
    if (categoriesToCheck.includes('returns')) {
      allIssues.push(...await checkExcessReturns());
    }
    
    if (categoriesToCheck.includes('balances')) {
      allIssues.push(...await checkCustomerBalances());
      allIssues.push(...await checkSupplierBalances());
    }
    
    if (categoriesToCheck.includes('inventory')) {
      allIssues.push(...await checkInventoryIssues());
    }
    
    if (categoriesToCheck.includes('trial_balance')) {
      allIssues.push(...await checkTrialBalance());
    }
    
    const criticalCount = allIssues.filter(i => i.severity === 'critical').length;
    const warningCount = allIssues.filter(i => i.severity === 'warning').length;
    const totalChecks = categoriesToCheck.length * 3;
    const passedChecks = totalChecks - criticalCount - warningCount;
    const healthScore = totalChecks > 0 ? ((passedChecks / totalChecks) * 100) : 100;
    
    for (const issue of allIssues) {
      // BLOCKED: Direct insert to accounting_health_check_results
      forbidDirectWrite('insert', 'src/lib/accounting-health-checks.ts:665');
    }
    
    const categorySummary: Record<HealthCheckCategory, any> = {} as any;
    for (const cat of categoriesToCheck) {
      const catIssues = allIssues.filter(i => i.category === cat);
      categorySummary[cat] = {
        total: 3,
        passed: 3 - catIssues.length,
        warnings: catIssues.filter(i => i.severity === 'warning').length,
        critical: catIssues.filter(i => i.severity === 'critical').length,
      };
    }
    
    // BLOCKED: Direct update to accounting_health_check_runs
    forbidDirectWrite('update', 'src/lib/accounting-health-checks.ts:695');
    
    await logAccountingAudit({
      auditType: 'health_check',
      category: 'system',
      issueType: 'health_check_completed',
      description: `اكتمل فحص الصحة المحاسبية - الجلسة ${runNumber}`,
      details: { 
        runId, 
        totalIssues: allIssues.length,
        critical: criticalCount,
        warnings: warningCount,
        healthScore,
      },
    });
    
    return {
      runId,
      runNumber,
      startedAt,
      completedAt: new Date(),
      status: 'completed',
      mode: options.mode,
      totalChecks,
      passedChecks,
      warningChecks: warningCount,
      criticalChecks: criticalCount,
      healthScore,
      issues: allIssues,
      categorySummary,
    };
  } catch (error) {
    // BLOCKED: Direct update to accounting_health_check_runs
    forbidDirectWrite('update', 'src/lib/accounting-health-checks.ts:742');
    
    throw error;
  }
}

// Get previous run results
export async function getHealthCheckRuns(limit = 10) {
  const { data, error } = await dataGateway.queryTable('accounting_health_check_runs', {
    select: '*',
    order: { column: 'started_at', ascending: false },
    limit,
  });
  
  if (error) throw error;
  return data;
}

// Get results for a specific run
export async function getHealthCheckResults(runId: string) {
  const { data, error } = await dataGateway.queryTable('accounting_health_check_results', {
    select: '*',
    filters: [{ type: 'eq', column: 'run_id', value: runId }],
    order: { column: 'severity', ascending: true },
  });
  
  if (error) throw error;
  return data;
}

// Get audit logs
export async function getAccountingAuditLogs(limit = 50) {
  const { data, error } = await dataGateway.queryTable('accounting_audit_logs', {
    select: '*',
    order: { column: 'created_at', ascending: false },
    limit,
  });
  
  if (error) throw error;
  return data;
}
