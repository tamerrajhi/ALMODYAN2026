import * as dataGateway from '@/lib/dataGateway';
import { logAccountingAudit, type HealthCheckIssue } from './accounting-health-checks';
import { forbidDirectWrite } from '@/lib/atomicWriteGuard';

export interface FixResult {
  success: boolean;
  fixedCount: number;
  failedCount: number;
  totalAmount: number;
  errors: string[];
  details: any[];
}

async function getAccountIdByCode(code: string): Promise<string | null> {
  const { data } = await dataGateway.queryTable('chart_of_accounts', {
    select: 'id',
    filters: [{ type: 'eq', column: 'account_code', value: code }],
    single: true,
  });
  return data?.id || null;
}

async function generateJournalEntryNumber(): Promise<string> {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  
  const { count } = await dataGateway.queryTable('journal_entries', {
    select: '*',
    count: 'exact',
    head: true,
    filters: [{ type: 'gte', column: 'entry_date', value: today.toISOString().slice(0, 10) }],
  });
  
  const seq = (count || 0) + 1;
  return `JE-${dateStr}-${seq.toString().padStart(4, '0')}`;
}

export async function createMissingSalesJournalEntries(): Promise<FixResult> {
  const result: FixResult = {
    success: true,
    fixedCount: 0,
    failedCount: 0,
    totalAmount: 0,
    errors: [],
    details: [],
  };

  try {
    const { data: invoices, error: fetchError } = await dataGateway.queryTable('invoices', {
      select: 'id, invoice_number, invoice_date, total_amount, tax_amount, customer_id, branch_id',
      filters: [
        { type: 'eq', column: 'invoice_type', value: 'sales' },
        { type: 'is', column: 'journal_entry_id', value: null },
      ],
    });

    if (fetchError) throw fetchError;
    if (!invoices || (invoices as any[]).length === 0) {
      return { ...result, success: true };
    }

    const receivablesAccountId = await getAccountIdByCode('1102');
    const salesRevenueAccountId = await getAccountIdByCode('410101');
    const vatAccountId = await getAccountIdByCode('2103');

    if (!receivablesAccountId || !salesRevenueAccountId) {
      throw new Error('لم يتم العثور على الحسابات المطلوبة (1102, 410101)');
    }

    for (const invoice of (invoices as any[])) {
      try {
        const entryNumber = await generateJournalEntryNumber();
        const netAmount = (invoice.total_amount || 0) - (invoice.tax_amount || 0);
        const taxAmount = invoice.tax_amount || 0;

        forbidDirectWrite('insert', 'src/lib/accounting-health-fixes.ts:81');
        
        result.failedCount++;
        result.errors.push(`العملية محظورة - فاتورة ${invoice.invoice_number}`);

        await logAccountingAudit({
          auditType: 'auto_fix',
          category: 'sales',
          issueType: 'SL001',
          entityType: 'invoice',
          entityId: invoice.id,
          entityCode: invoice.invoice_number,
          newValue: { journalEntryId: journalEntry.id },
          description: `تم إنشاء قيد محاسبي لفاتورة المبيعات ${invoice.invoice_number}`,
          status: 'completed',
        });

      } catch (err: any) {
        result.failedCount++;
        result.errors.push(`فشل إصلاح الفاتورة ${invoice.invoice_number}: ${err.message}`);
        result.details.push({
          invoiceNumber: invoice.invoice_number,
          amount: invoice.total_amount,
          status: 'failed',
          error: err.message,
        });
      }
    }

    result.success = result.failedCount === 0;
  } catch (err: any) {
    result.success = false;
    result.errors.push(`خطأ عام: ${err.message}`);
  }

  return result;
}

export async function createMissingReceiptJournalEntries(): Promise<FixResult> {
  const result: FixResult = {
    success: true,
    fixedCount: 0,
    failedCount: 0,
    totalAmount: 0,
    errors: [],
    details: [],
  };

  try {
    const { data: receipts, error: fetchError } = await dataGateway.queryTable('customer_receipts', {
      select: 'id, receipt_number, receipt_date, amount, customer_id, branch_id, payment_method',
      filters: [{ type: 'is', column: 'journal_entry_id', value: null }],
    });

    if (fetchError) throw fetchError;
    if (!receipts || (receipts as any[]).length === 0) {
      return { ...result, success: true };
    }

    const cashAccountId = await getAccountIdByCode('110101');
    const receivablesAccountId = await getAccountIdByCode('1102');
    const bankAccountId = await getAccountIdByCode('110102');

    if (!cashAccountId || !receivablesAccountId) {
      throw new Error('لم يتم العثور على الحسابات المطلوبة (110101, 1102)');
    }

    for (const receipt of (receipts as any[])) {
      try {
        const entryNumber = await generateJournalEntryNumber();
        
        let debitAccountId = cashAccountId;
        if (receipt.payment_method === 'bank_transfer' || receipt.payment_method === 'card') {
          debitAccountId = bankAccountId || cashAccountId;
        }

        forbidDirectWrite('insert', 'src/lib/accounting-health-fixes.ts:230');
        
        result.failedCount++;
        result.errors.push(`العملية محظورة - سند ${receipt.receipt_number}`);

      } catch (err: any) {
        result.failedCount++;
        result.errors.push(`فشل إصلاح السند ${receipt.receipt_number}: ${err.message}`);
        result.details.push({
          receiptNumber: receipt.receipt_number,
          amount: receipt.amount,
          status: 'failed',
          error: err.message,
        });
      }
    }

    result.success = result.failedCount === 0;
  } catch (err: any) {
    result.success = false;
    result.errors.push(`خطأ عام: ${err.message}`);
  }

  return result;
}

export async function createMissingPurchaseJournalEntries(): Promise<FixResult> {
  const result: FixResult = {
    success: true,
    fixedCount: 0,
    failedCount: 0,
    totalAmount: 0,
    errors: [],
    details: [],
  };

  try {
    const { data: invoices, error: fetchError } = await dataGateway.queryTable('invoices', {
      select: 'id, invoice_number, invoice_date, total_amount, tax_amount, supplier_id, branch_id',
      filters: [
        { type: 'eq', column: 'invoice_type', value: 'purchase' },
        { type: 'in', column: 'status', value: ['confirmed', 'partial'] },
        { type: 'is', column: 'journal_entry_id', value: null },
      ],
    });

    if (fetchError) throw fetchError;
    if (!invoices || (invoices as any[]).length === 0) {
      return { ...result, success: true };
    }

    const inventoryAccountId = await getAccountIdByCode('1301');
    const payablesAccountId = await getAccountIdByCode('2101');
    const vatAccountId = await getAccountIdByCode('1105');

    if (!inventoryAccountId || !payablesAccountId) {
      throw new Error('لم يتم العثور على الحسابات المطلوبة (1301, 2101)');
    }

    for (const invoice of (invoices as any[])) {
      try {
        const entryNumber = await generateJournalEntryNumber();
        const netAmount = (invoice.total_amount || 0) - (invoice.tax_amount || 0);
        const taxAmount = invoice.tax_amount || 0;

        forbidDirectWrite('insert', 'src/lib/accounting-health-fixes.ts:366');
        
        result.failedCount++;
        result.errors.push(`العملية محظورة - فاتورة ${invoice.invoice_number}`);

        await logAccountingAudit({
          auditType: 'auto_fix',
          category: 'purchases',
          issueType: 'PU001',
          entityType: 'invoice',
          entityId: invoice.id,
          entityCode: invoice.invoice_number,
          newValue: { journalEntryId: journalEntry.id },
          description: `تم إنشاء قيد محاسبي لفاتورة المشتريات ${invoice.invoice_number}`,
          status: 'completed',
        });

      } catch (err: any) {
        result.failedCount++;
        result.errors.push(`فشل إصلاح الفاتورة ${invoice.invoice_number}: ${err.message}`);
        result.details.push({
          invoiceNumber: invoice.invoice_number,
          amount: invoice.total_amount,
          status: 'failed',
          error: err.message,
        });
      }
    }

    result.success = result.failedCount === 0;
  } catch (err: any) {
    result.success = false;
    result.errors.push(`خطأ عام: ${err.message}`);
  }

  return result;
}

export async function recalculateCustomerBalances(): Promise<FixResult> {
  const result: FixResult = {
    success: true,
    fixedCount: 0,
    failedCount: 0,
    totalAmount: 0,
    errors: [],
    details: [],
  };

  try {
    const { data: customers, error: fetchError } = await dataGateway.queryTable('customers', {
      select: 'id, customer_code, full_name, total_purchases',
    });

    if (fetchError) throw fetchError;
    if (!customers || (customers as any[]).length === 0) {
      return { ...result, success: true };
    }

    for (const customer of (customers as any[])) {
      try {
        const { data: sales } = await dataGateway.queryTable('sales', {
          select: 'total_amount',
          filters: [{ type: 'eq', column: 'customer_id', value: customer.id }],
        });
        const totalSales = ((sales as any[]) || []).reduce((sum, s) => sum + (s.total_amount || 0), 0);

        const { data: receipts } = await dataGateway.queryTable('customer_receipts', {
          select: 'amount',
          filters: [{ type: 'eq', column: 'customer_id', value: customer.id }],
        });
        const totalReceipts = ((receipts as any[]) || []).reduce((sum, r) => sum + (r.amount || 0), 0);

        const { data: returns } = await dataGateway.queryTable('returns', {
          select: 'total_return',
          filters: [{ type: 'eq', column: 'customer_id', value: customer.id }],
        });
        const totalReturns = ((returns as any[]) || []).reduce((sum, r) => sum + ((r as any).total_return || 0), 0);

        const calculatedBalance = totalSales - totalReceipts - totalReturns;
        const oldBalance = customer.total_purchases || 0;

        if (Math.abs(calculatedBalance - oldBalance) > 0.01) {
          forbidDirectWrite('update', 'src/lib/accounting-health-fixes.ts:522');
          
          result.failedCount++;
          result.errors.push(`العملية محظورة - عميل ${customer.customer_code}`);
        }
      } catch (err: any) {
        result.failedCount++;
        result.errors.push(`فشل تصحيح رصيد العميل ${customer.customer_code}: ${err.message}`);
        result.details.push({
          customerCode: customer.customer_code,
          status: 'failed',
          error: err.message,
        });
      }
    }

    result.success = result.failedCount === 0;
  } catch (err: any) {
    result.success = false;
    result.errors.push(`خطأ عام: ${err.message}`);
  }

  return result;
}

export async function recalculateSupplierBalances(): Promise<FixResult> {
  const result: FixResult = {
    success: true,
    fixedCount: 0,
    failedCount: 0,
    totalAmount: 0,
    errors: [],
    details: [],
  };

  try {
    const { data: suppliers, error: fetchError } = await dataGateway.queryTable('suppliers', {
      select: 'id, supplier_code, supplier_name, current_balance',
    });

    if (fetchError) throw fetchError;
    if (!suppliers || (suppliers as any[]).length === 0) {
      return { ...result, success: true };
    }

    for (const supplier of (suppliers as any[])) {
      try {
        const { data: invoices } = await dataGateway.queryTable('invoices', {
          select: 'total_amount',
          filters: [
            { type: 'eq', column: 'supplier_id', value: supplier.id },
            { type: 'eq', column: 'invoice_type', value: 'purchase' },
            { type: 'in', column: 'status', value: ['confirmed', 'partial', 'paid'] },
          ],
        });
        const totalPurchases = ((invoices as any[]) || []).reduce((sum, i) => sum + (i.total_amount || 0), 0);

        const { data: payments } = await dataGateway.queryTable('payments', {
          select: 'amount',
          filters: [
            { type: 'eq', column: 'supplier_id', value: supplier.id },
            { type: 'eq', column: 'payment_type', value: 'payment' },
          ],
        });
        const totalPayments = ((payments as any[]) || []).reduce((sum, p) => sum + (p.amount || 0), 0);

        const { data: returns } = await dataGateway.queryTable('invoices', {
          select: 'total_amount',
          filters: [
            { type: 'eq', column: 'supplier_id', value: supplier.id },
            { type: 'eq', column: 'invoice_type', value: 'purchase_return' },
          ],
        });
        const totalReturns = ((returns as any[]) || []).reduce((sum, r) => sum + (r.total_amount || 0), 0);

        const calculatedBalance = totalPurchases - totalPayments - totalReturns;
        const oldBalance = supplier.current_balance || 0;

        if (Math.abs(calculatedBalance - oldBalance) > 0.01) {
          forbidDirectWrite('update', 'src/lib/accounting-health-fixes.ts:628');
          
          result.failedCount++;
          result.errors.push(`العملية محظورة - مورد ${supplier.supplier_code}`);
        }
      } catch (err: any) {
        result.failedCount++;
        result.errors.push(`فشل تصحيح رصيد المورد ${supplier.supplier_code}: ${err.message}`);
        result.details.push({
          supplierCode: supplier.supplier_code,
          status: 'failed',
          error: err.message,
        });
      }
    }

    result.success = result.failedCount === 0;
  } catch (err: any) {
    result.success = false;
    result.errors.push(`خطأ عام: ${err.message}`);
  }

  return result;
}

export async function executeAutoFix(issue: HealthCheckIssue): Promise<FixResult> {
  const functionName = issue.autoFixFunction;
  
  if (!functionName) {
    return {
      success: false,
      fixedCount: 0,
      failedCount: 0,
      totalAmount: 0,
      errors: ['لا توجد دالة إصلاح تلقائي لهذه المشكلة'],
      details: [],
    };
  }

  switch (functionName) {
    case 'createMissingSalesJournalEntries':
      return await createMissingSalesJournalEntries();
    case 'createMissingReceiptJournalEntries':
      return await createMissingReceiptJournalEntries();
    case 'createMissingPurchaseJournalEntries':
      return await createMissingPurchaseJournalEntries();
    case 'recalculateCustomerBalances':
      return await recalculateCustomerBalances();
    case 'recalculateSupplierBalances':
      return await recalculateSupplierBalances();
    default:
      return {
        success: false,
        fixedCount: 0,
        failedCount: 0,
        totalAmount: 0,
        errors: [`دالة الإصلاح غير معروفة: ${functionName}`],
        details: [],
      };
  }
}

export async function updateFixStatus(
  issueId: string,
  runId: string,
  status: 'pending' | 'in_progress' | 'completed' | 'failed',
  notes?: string
): Promise<void> {
  forbidDirectWrite('update', 'src/lib/accounting-health-fixes.ts:727');
}
