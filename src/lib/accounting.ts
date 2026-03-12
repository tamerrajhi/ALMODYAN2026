import * as dataGateway from '@/lib/dataGateway';
import { toast } from 'sonner';
import { getBranchImportedPiecesAccountCode, getBranchInventoryAccountCode } from './branch-inventory-accounts';

interface JournalEntryLine {
  accountCode: string;
  debit: number;
  credit: number;
  description?: string;
}

interface CreateJournalEntryParams {
  description: string;
  referenceType: 'sale' | 'purchase' | 'sale_return' | 'purchase_return' | 'payment' | 'receipt' | 'manual';
  referenceId: string;
  lines: JournalEntryLine[];
  autoPost?: boolean;
}

// Default account codes - these should match chart_of_accounts
// Updated to match actual database account codes
const ACCOUNT_CODES = {
  CASH: '110101',           // الصندوق العام
  BANK: '110104',           // البنك الأهلي
  RECEIVABLES: '1102',      // الذمم المدينة (رئيسي)
  INVENTORY: '1103',        // المخزون (رئيسي)
  PAYABLES: '2101',         // الذمم الدائنة (رئيسي)
  SALES_REVENUE: '41',      // إيرادات المبيعات (رئيسي)
  SERVICE_REVENUE: '4102',  // إيرادات خدمات (رسوم شحن/توصيل)
  COGS: '51',               // تكلفة البضاعة المباعة (رئيسي)
  INVENTORY_LOSS: '540101', // فاقد الإنتاج
  INVENTORY_GAIN: '42',     // إيرادات أخرى
  SALES_RETURNS: '4201',    // مردودات المبيعات
  VAT_PAYABLE: '2201',      // ضريبة القيمة المضافة المستحقة
  VAT_RECEIVABLE: '2202',   // ضريبة القيمة المضافة على المشتريات
  CUSTOMER_CREDITS: '2310', // أرصدة العملاء الدائنة
  DISCOUNT_ALLOWED: '5201', // خصم مسموح به (مصروف)
  SHIPPING_EXPENSE: '5202', // مصروف شحن
};

/**
 * Parent accounts that CANNOT receive direct postings
 * All transactions must use customer/supplier sub-accounts instead
 */
const FORBIDDEN_PARENT_ACCOUNTS = ['1102', '2101'];

/**
 * Validate that posting is not directly to AR/AP parent accounts
 * Throws an error if attempting to post to forbidden parent accounts
 */
function validatePostingAccount(accountCode: string): void {
  if (FORBIDDEN_PARENT_ACCOUNTS.includes(accountCode)) {
    const accountNames: Record<string, string> = {
      '1102': 'الذمم المدينة (Accounts Receivable)',
      '2101': 'الذمم الدائنة (Accounts Payable)'
    };
    throw new Error(
      `لا يمكن التسجيل مباشرة على حساب ${accountNames[accountCode]} الرئيسي. ` +
      `يجب استخدام حساب العميل أو المورد الفرعي. ` +
      `Posting directly to AR/AP parent account (${accountCode}) is not allowed.`
    );
  }
}

/**
 * Get customer's specific sub-account code from chart_of_accounts
 * Returns the sub-account code (e.g., '11020001') or null if not linked
 */
export async function getCustomerAccountCode(customerId: string): Promise<string | null> {
  try {
    const { data, error } = await dataGateway.getCustomerAccountCode(customerId);
    
    if (error || !data?.account_code) {
      console.log(`Customer ${customerId} has no linked account, using parent receivables`);
      return null;
    }
    
    return data.account_code || null;
  } catch (error) {
    console.error('Error fetching customer account code:', error);
    return null;
  }
}

/**
 * Get supplier's specific sub-account code from chart_of_accounts
 * Returns the sub-account code (e.g., '21010001') or null if not linked
 */
export async function getSupplierAccountCode(supplierId: string): Promise<string | null> {
  try {
    const { data, error } = await dataGateway.getSupplierAccountCode(supplierId);
    
    if (error || !data?.account_code) {
      console.log(`Supplier ${supplierId} has no linked account, using parent payables`);
      return null;
    }
    
    return data.account_code || null;
  } catch (error) {
    console.error('Error fetching supplier account code:', error);
    return null;
  }
}

/**
 * Get payment account settings for a branch or fallback to general settings
 */
async function getPaymentAccountSettings(branchId?: string | null): Promise<{
  cashAccountCode: string;
  bankTransferAccountCode: string;
  checkAccountCode: string;
  cardAccountCode: string;
} | null> {
  try {
    if (branchId) {
      const { data: branchSettings } = await dataGateway.getPaymentAccountSettingsResolved(branchId);

      if (branchSettings && (branchSettings.cash_account_id || branchSettings.bank_transfer_account_id)) {
        return {
          cashAccountCode: branchSettings.cash_account_code || ACCOUNT_CODES.CASH,
          bankTransferAccountCode: branchSettings.bank_transfer_account_code || ACCOUNT_CODES.BANK,
          checkAccountCode: branchSettings.check_account_code || ACCOUNT_CODES.BANK,
          cardAccountCode: branchSettings.card_account_code || ACCOUNT_CODES.BANK,
        };
      }
    }

    const { data: generalSettings } = await dataGateway.getPaymentAccountSettingsResolved(null);

    if (generalSettings && (generalSettings.cash_account_id || generalSettings.bank_transfer_account_id)) {
      return {
        cashAccountCode: generalSettings.cash_account_code || ACCOUNT_CODES.CASH,
        bankTransferAccountCode: generalSettings.bank_transfer_account_code || ACCOUNT_CODES.BANK,
        checkAccountCode: generalSettings.check_account_code || ACCOUNT_CODES.BANK,
        cardAccountCode: generalSettings.card_account_code || ACCOUNT_CODES.BANK,
      };
    }

    return null;
  } catch (error) {
    console.error('Error fetching payment account settings:', error);
    return null;
  }
}

/**
 * Get account code based on payment method using configured settings
 */
async function getPaymentMethodAccountCode(
  paymentMethod: string,
  type: 'debit' | 'credit',
  branchId?: string | null
): Promise<string> {
  const settings = await getPaymentAccountSettings(branchId);
  
  if (settings) {
    switch (paymentMethod) {
      case 'cash':
        return settings.cashAccountCode;
      case 'bank':
      case 'bank_transfer':
        return settings.bankTransferAccountCode;
      case 'check':
        return settings.checkAccountCode;
      case 'card':
        return settings.cardAccountCode;
      default:
        return settings.cashAccountCode;
    }
  }
  
  // Fallback to default behavior if no settings configured
  const isBankPayment = ['bank', 'bank_transfer', 'card', 'check'].includes(paymentMethod);
  return isBankPayment ? ACCOUNT_CODES.BANK : ACCOUNT_CODES.CASH;
}

/**
 * Get account ID by account code with improved error logging
 * Also validates that posting is not to forbidden parent accounts
 */
async function getAccountId(accountCode: string): Promise<string | null> {
  // ✅ Validate that we're not posting to AR/AP parent accounts
  validatePostingAccount(accountCode);
  
  const { data, error } = await dataGateway.fetchTable('chart_of_accounts', { filters: { account_code: accountCode }, single: true });
  
  if (error) {
    console.error(`Error fetching account ${accountCode}:`, error);
    return null;
  }
  
  if (!data) {
    console.error(`CRITICAL: Account code ${accountCode} not found in chart_of_accounts. Journal entry line will be skipped!`);
    return null;
  }
  
  return data.id;
}

/**
 * Create a journal entry with lines via atomic RPC
 * Uses je_create_atomic for guaranteed atomicity and idempotency
 */
export async function createJournalEntry(params: CreateJournalEntryParams): Promise<string | null> {
  try {
    const { description, referenceType, referenceId, lines, autoPost = false } = params;

    // Validate balance from requested lines first
    const requestedDebit = lines.reduce((sum, line) => sum + line.debit, 0);
    const requestedCredit = lines.reduce((sum, line) => sum + line.credit, 0);

    if (Math.abs(requestedDebit - requestedCredit) > 0.01) {
      console.error('Journal entry is not balanced (requested lines):', { requestedDebit, requestedCredit });
      toast.error('فشل إنشاء القيد: القيد غير متوازن');
      return null;
    }

    // Resolve account codes to IDs for the RPC
    const rpcLines: Array<{ account_id: string; debit: number; credit: number; description?: string }> = [];
    
    for (const line of lines) {
      let accountId: string | null = null;
      try {
        accountId = await getAccountId(line.accountCode);
      } catch (e) {
        console.error('Posting validation failed:', e);
        toast.error('فشل إنشاء القيد: حساب غير مسموح للتسجيل');
        return null;
      }

      if (!accountId) {
        console.error(`CRITICAL: Account not found for code: ${line.accountCode}`);
        toast.error('فشل إنشاء القيد: حساب محاسبي غير موجود');
        return null;
      }

      rpcLines.push({
        account_id: accountId,
        debit: line.debit,
        credit: line.credit,
        description: line.description || description,
      });
    }

    // Get branch ID (use default if not available)
    const { data: branchesData } = await dataGateway.fetchBranches();
    const branchId = branchesData?.[0]?.id;

    if (!branchId) {
      console.error('No branch found for journal entry');
      toast.error('فشل إنشاء القيد: لم يتم العثور على فرع');
      return null;
    }

    // Call atomic RPC
    const clientRequestId = crypto.randomUUID();
    const { data: result, error: rpcError } = await dataGateway.rpc('je_create_atomic', {
      p_client_request_id: clientRequestId,
      p_branch_id: branchId,
      p_je_date: new Date().toISOString().split('T')[0],
      p_memo: description,
      p_lines: rpcLines,
    });

    if (rpcError) {
      console.error('je_create_atomic RPC error:', rpcError);
      toast.error('فشل إنشاء القيد: ' + rpcError.message);
      return null;
    }

    const rpcResult = result as { success: boolean; je_id?: string; je_no?: string; error?: string };

    if (!rpcResult.success) {
      console.error('je_create_atomic returned failure:', rpcResult);
      toast.error(rpcResult.error || 'فشل إنشاء القيد');
      return null;
    }

    console.log(`Journal entry created via atomic RPC: ${rpcResult.je_no} (${rpcResult.je_id})`);

    // Auto-post if requested
    if (autoPost && rpcResult.je_id) {
      const postClientRequestId = crypto.randomUUID();
      const { data: postResult, error: postError } = await dataGateway.rpc('je_post_atomic', {
        p_client_request_id: postClientRequestId,
        p_je_id: rpcResult.je_id,
      });

      if (postError) {
        console.error('je_post_atomic RPC error:', postError);
      } else {
        const postRpcResult = postResult as { success: boolean; status?: string };
        if (postRpcResult.success) {
          console.log(`Journal entry auto-posted: ${rpcResult.je_no}`);
        }
      }
    }

    return rpcResult.je_id || null;
  } catch (error) {
    console.error('Error in createJournalEntry:', error);
    toast.error('فشل إنشاء القيد: حدث خطأ غير متوقع');
    return null;
  }
}

/**
 * Create journal entry for a sale - implements proper accounting policy
 * 
 * For PAID invoices:
 *   Debit: Cash/Bank (total amount)
 *   Credit: Sales Revenue (amount before tax)
 *   Credit: VAT Payable (tax amount)
 * 
 * For UNPAID invoices:
 *   Debit: Accounts Receivable (total amount)
 *   Credit: Sales Revenue (amount before tax)
 *   Credit: VAT Payable (tax amount)
 * 
 * For inventory tracking (optional):
 *   Debit: Cost of Goods Sold (cost)
 *   Credit: Inventory (cost)
 */
/**
 * Create proper 3-line journal entry for POS sales
 * Implements accounting policy with separate VAT handling (same as sales invoices)
 * 
 * Debit: Cash/Bank (grand total) - صافي المستحق
 * Credit: Sales Revenue (subtotal before tax) - إجمالي المبيعات قبل الضريبة
 * Credit: VAT Payable (tax amount) - ضريبة القيمة المضافة
 */
export async function createSaleJournalEntry(params: {
  saleId: string;
  saleCode: string;
  finalAmount: number;
  subtotalBeforeTax: number;
  taxAmount: number;
  paymentMethod: string;
  customerName?: string;
  customerId?: string;
  itemsCost?: number;
  bankAccountCode?: string;
  branchId?: string;
  inventoryAccountCode?: string; // NEW: Branch-specific inventory account
}): Promise<string | null> {
  const { 
    saleId, 
    saleCode, 
    finalAmount, 
    subtotalBeforeTax, 
    taxAmount, 
    paymentMethod, 
    customerName, 
    customerId,
    itemsCost, 
    bankAccountCode,
    branchId,
    inventoryAccountCode
  } = params;

  const lines: JournalEntryLine[] = [];
  
  // Get payment account settings for the branch
  const paymentSettings = await getPaymentAccountSettings(branchId);
  
  // Determine the debit account based on payment method
  let debitAccountCode: string;
  let debitDescription: string;
  
  switch (paymentMethod) {
    case 'cash':
      debitAccountCode = paymentSettings?.cashAccountCode || ACCOUNT_CODES.CASH;
      debitDescription = `تحصيل نقدي من مبيعات POS - ${saleCode}`;
      break;
    case 'card':
      debitAccountCode = bankAccountCode || paymentSettings?.cardAccountCode || ACCOUNT_CODES.BANK;
      debitDescription = `تحصيل بطاقة من مبيعات POS - ${saleCode}`;
      break;
    case 'credit':
      // Use customer's specific sub-account for credit sales
      if (customerId) {
        const customerAccountCode = await getCustomerAccountCode(customerId);
        debitAccountCode = customerAccountCode || ACCOUNT_CODES.RECEIVABLES;
      } else {
        debitAccountCode = ACCOUNT_CODES.RECEIVABLES;
      }
      debitDescription = `مدين العميل - مبيعات POS ${saleCode}${customerName ? ` - ${customerName}` : ''}`;
      break;
    default:
      debitAccountCode = paymentSettings?.cashAccountCode || ACCOUNT_CODES.CASH;
      debitDescription = `تحصيل من مبيعات POS - ${saleCode}`;
  }

  // Line 1: Debit - Cash/Bank/Receivables (grand total = صافي المستحق)
  lines.push({
    accountCode: debitAccountCode,
    debit: finalAmount,
    credit: 0,
    description: debitDescription,
  });

  // Line 2: Credit - Sales Revenue (subtotal before tax = إجمالي المبيعات قبل الضريبة)
  lines.push({
    accountCode: ACCOUNT_CODES.SALES_REVENUE,
    debit: 0,
    credit: subtotalBeforeTax,
    description: `إيراد مبيعات POS - ${saleCode}${customerName ? ` - ${customerName}` : ''}`,
  });

  // Line 3: Credit - VAT Payable (tax amount = ضريبة القيمة المضافة)
  if (taxAmount > 0) {
    lines.push({
      accountCode: ACCOUNT_CODES.VAT_PAYABLE,
      debit: 0,
      credit: taxAmount,
      description: `ضريبة القيمة المضافة - مبيعات POS ${saleCode}`,
    });
  }

  // COGS entries with branch-specific inventory account
  if (itemsCost && itemsCost > 0) {
    // Get branch-specific inventory account
    let branchInventoryAccountCode: string;
    
    if (inventoryAccountCode) {
      // Use provided inventory account code
      branchInventoryAccountCode = inventoryAccountCode;
    } else if (branchId) {
      // Fetch branch-specific inventory account
      branchInventoryAccountCode = await getBranchInventoryAccountCode(branchId);
    } else {
      // This should never happen - throw error to prevent incorrect accounting
      throw new Error(
        'لا يمكن إنشاء قيد تكلفة البضاعة المباعة بدون تحديد الفرع أو حساب المخزون. ' +
        'Branch ID or inventory account code is required for COGS entry.'
      );
    }

    lines.push({
      accountCode: ACCOUNT_CODES.COGS,
      debit: itemsCost,
      credit: 0,
      description: `تكلفة بضاعة مباعة - ${saleCode}`,
    });

    lines.push({
      accountCode: branchInventoryAccountCode,
      debit: 0,
      credit: itemsCost,
      description: `خصم من المخزون - ${saleCode}`,
    });
  }

  return createJournalEntry({
    description: `قيد مبيعات POS - فاتورة ${saleCode}${customerName ? ` - ${customerName}` : ''}`,
    referenceType: 'sale',
    referenceId: saleId,
    lines,
    autoPost: true,
  });
}

/**
 * Create proper 3-line journal entry for sales invoices
 * Implements accounting policy with separate VAT handling
 * 
 * For PAID invoices (cash/card/bank):
 *   Debit: Cash/Bank (grand total)
 *   Credit: Sales Revenue (subtotal before tax)
 *   Credit: VAT Payable (tax amount)
 * 
 * For UNPAID invoices (credit):
 *   Debit: Accounts Receivable (grand total)
 *   Credit: Sales Revenue (subtotal before tax)
 *   Credit: VAT Payable (tax amount)
 */
export async function createSalesInvoiceJournalEntry(params: {
  invoiceId: string;
  invoiceNumber: string;
  subtotalBeforeTax: number;
  taxAmount: number;
  grandTotal: number;
  paymentMethod: string;
  isPaid: boolean;
  customerName?: string;
  customerId?: string;
  itemsCost?: number;
  branchId?: string;
  inventoryAccountCode?: string; // NEW: Branch-specific inventory account
}): Promise<string | null> {
  const { 
    invoiceId, 
    invoiceNumber, 
    subtotalBeforeTax, 
    taxAmount, 
    grandTotal, 
    paymentMethod,
    isPaid,
    customerName, 
    customerId,
    itemsCost,
    branchId,
    inventoryAccountCode
  } = params;

  const lines: JournalEntryLine[] = [];
  
  // Determine debit account based on payment status and method
  let debitAccountCode: string;
  let debitDescription: string;

  if (isPaid) {
    // Paid invoice - debit cash or bank
    const paymentSettings = await getPaymentAccountSettings(branchId);
    switch (paymentMethod) {
      case 'cash':
        debitAccountCode = paymentSettings?.cashAccountCode || ACCOUNT_CODES.CASH;
        debitDescription = `تحصيل نقدي من فاتورة ${invoiceNumber}`;
        break;
      case 'card':
        debitAccountCode = paymentSettings?.cardAccountCode || ACCOUNT_CODES.BANK;
        debitDescription = `تحصيل بطاقة من فاتورة ${invoiceNumber}`;
        break;
      case 'bank':
      case 'bank_transfer':
        debitAccountCode = paymentSettings?.bankTransferAccountCode || ACCOUNT_CODES.BANK;
        debitDescription = `تحصيل تحويل بنكي من فاتورة ${invoiceNumber}`;
        break;
      case 'check':
        debitAccountCode = paymentSettings?.checkAccountCode || ACCOUNT_CODES.BANK;
        debitDescription = `تحصيل شيك من فاتورة ${invoiceNumber}`;
        break;
      default:
        debitAccountCode = paymentSettings?.cashAccountCode || ACCOUNT_CODES.CASH;
        debitDescription = `تحصيل من فاتورة ${invoiceNumber}`;
    }
  } else {
    // Unpaid invoice - debit customer's specific sub-account (or parent if not linked)
    if (customerId) {
      const customerAccountCode = await getCustomerAccountCode(customerId);
      debitAccountCode = customerAccountCode || ACCOUNT_CODES.RECEIVABLES;
    } else {
      debitAccountCode = ACCOUNT_CODES.RECEIVABLES;
    }
    debitDescription = `مدين العميل - فاتورة ${invoiceNumber}${customerName ? ` - ${customerName}` : ''}`;
  }

  // Line 1: Debit - Cash/Bank (if paid) or Accounts Receivable (if unpaid)
  lines.push({
    accountCode: debitAccountCode,
    debit: grandTotal,
    credit: 0,
    description: debitDescription,
  });

  // Line 2: Credit - Sales Revenue (subtotal before tax)
  lines.push({
    accountCode: ACCOUNT_CODES.SALES_REVENUE,
    debit: 0,
    credit: subtotalBeforeTax,
    description: `إيراد مبيعات - فاتورة ${invoiceNumber}${customerName ? ` - ${customerName}` : ''}`,
  });

  // Line 3: Credit - VAT Payable (tax amount)
  if (taxAmount > 0) {
    lines.push({
      accountCode: ACCOUNT_CODES.VAT_PAYABLE,
      debit: 0,
      credit: taxAmount,
      description: `ضريبة القيمة المضافة - فاتورة ${invoiceNumber}`,
    });
  }

  // COGS entries with branch-specific inventory account
  if (itemsCost && itemsCost > 0) {
    // Get branch-specific inventory account
    let branchInventoryAccountCode: string;
    
    if (inventoryAccountCode) {
      // Use provided inventory account code
      branchInventoryAccountCode = inventoryAccountCode;
    } else if (branchId) {
      // Fetch branch-specific inventory account
      branchInventoryAccountCode = await getBranchInventoryAccountCode(branchId);
    } else {
      // This should never happen - throw error to prevent incorrect accounting
      throw new Error(
        'لا يمكن إنشاء قيد تكلفة البضاعة المباعة بدون تحديد الفرع أو حساب المخزون. ' +
        'Branch ID or inventory account code is required for COGS entry.'
      );
    }

    lines.push({
      accountCode: ACCOUNT_CODES.COGS,
      debit: itemsCost,
      credit: 0,
      description: `تكلفة بضاعة مباعة - فاتورة ${invoiceNumber}`,
    });

    lines.push({
      accountCode: branchInventoryAccountCode,
      debit: 0,
      credit: itemsCost,
      description: `خصم من المخزون - فاتورة ${invoiceNumber}`,
    });
  }

  return createJournalEntry({
    description: `قيد فاتورة مبيعات ${invoiceNumber}${customerName ? ` - ${customerName}` : ''}`,
    referenceType: 'sale',
    referenceId: invoiceId,
    lines,
    autoPost: true,
  });
}

/**
 * Create journal entry for partial payment receipt
 * Used when customer makes a partial payment on an invoice
 * 
 * Debit: Cash/Bank (payment amount)
 * Credit: Accounts Receivable (payment amount)
 */
export async function createPaymentReceiptJournalEntry(params: {
  receiptId: string;
  receiptNumber: string;
  amount: number;
  paymentMethod: string;
  invoiceNumber: string;
  customerName?: string;
  customerId?: string;
  branchId?: string;
}): Promise<string | null> {
  const { 
    receiptId, 
    receiptNumber, 
    amount, 
    paymentMethod,
    invoiceNumber,
    customerName,
    customerId,
    branchId
  } = params;

  const lines: JournalEntryLine[] = [];
  
  // Determine debit account based on payment method
  const paymentSettings = await getPaymentAccountSettings(branchId);
  let debitAccountCode: string;
  let debitDescription: string;

  switch (paymentMethod) {
    case 'cash':
      debitAccountCode = paymentSettings?.cashAccountCode || ACCOUNT_CODES.CASH;
      debitDescription = `تحصيل نقدي - سند ${receiptNumber}`;
      break;
    case 'card':
      debitAccountCode = paymentSettings?.cardAccountCode || ACCOUNT_CODES.BANK;
      debitDescription = `تحصيل بطاقة - سند ${receiptNumber}`;
      break;
    case 'bank':
    case 'bank_transfer':
      debitAccountCode = paymentSettings?.bankTransferAccountCode || ACCOUNT_CODES.BANK;
      debitDescription = `تحصيل تحويل بنكي - سند ${receiptNumber}`;
      break;
    case 'check':
      debitAccountCode = paymentSettings?.checkAccountCode || ACCOUNT_CODES.BANK;
      debitDescription = `تحصيل شيك - سند ${receiptNumber}`;
      break;
    default:
      debitAccountCode = paymentSettings?.cashAccountCode || ACCOUNT_CODES.CASH;
      debitDescription = `تحصيل - سند ${receiptNumber}`;
  }

  // Debit: Cash/Bank
  lines.push({
    accountCode: debitAccountCode,
    debit: amount,
    credit: 0,
    description: debitDescription,
  });

  // Credit: Customer's specific sub-account (or parent receivables if not linked)
  let creditAccountCode = ACCOUNT_CODES.RECEIVABLES;
  if (customerId) {
    const customerAccountCode = await getCustomerAccountCode(customerId);
    if (customerAccountCode) {
      creditAccountCode = customerAccountCode;
    }
  }

  lines.push({
    accountCode: creditAccountCode,
    debit: 0,
    credit: amount,
    description: `تسديد من العميل${customerName ? ` - ${customerName}` : ''} - فاتورة ${invoiceNumber}`,
  });

  return createJournalEntry({
    description: `قيد سند قبض ${receiptNumber} - فاتورة ${invoiceNumber}${customerName ? ` - ${customerName}` : ''}`,
    referenceType: 'receipt',
    referenceId: receiptId,
    lines,
    autoPost: true,
  });
}

/**
 * Create proper 3-line journal entry for split payment POS sales (cash + card)
 * Implements accounting policy with separate VAT handling
 * 
 * For split payment:
 * Debit: Cash (cash portion)
 * Debit: Bank (card portion)
 * Credit: Sales Revenue (subtotal before tax) - إجمالي المبيعات قبل الضريبة
 * Credit: VAT Payable (tax amount) - ضريبة القيمة المضافة
 */
export async function createSplitSaleJournalEntry(params: {
  saleId: string;
  saleCode: string;
  finalAmount: number;
  subtotalBeforeTax: number;
  taxAmount: number;
  cashAmount: number;
  cardAmount: number;
  customerName?: string;
  itemsCost?: number;
  bankAccountCode?: string;
  branchId?: string;
  inventoryAccountCode?: string; // NEW: Branch-specific inventory account
}): Promise<string | null> {
  const { 
    saleId, 
    saleCode, 
    subtotalBeforeTax, 
    taxAmount, 
    cashAmount, 
    cardAmount, 
    customerName, 
    itemsCost, 
    bankAccountCode,
    branchId,
    inventoryAccountCode
  } = params;

  const lines: JournalEntryLine[] = [];
  
  // Get payment account settings for the branch
  const paymentSettings = await getPaymentAccountSettings(branchId);
  
  // Debit: Cash portion goes to Cash account
  if (cashAmount > 0) {
    lines.push({
      accountCode: paymentSettings?.cashAccountCode || ACCOUNT_CODES.CASH,
      debit: cashAmount,
      credit: 0,
      description: `تحصيل نقدي من مبيعات POS - ${saleCode}`,
    });
  }

  // Debit: Card portion goes to selected Bank account
  if (cardAmount > 0) {
    lines.push({
      accountCode: bankAccountCode || paymentSettings?.cardAccountCode || ACCOUNT_CODES.BANK,
      debit: cardAmount,
      credit: 0,
      description: `تحصيل بطاقة من مبيعات POS - ${saleCode}`,
    });
  }

  // Credit: Sales Revenue (subtotal before tax = إجمالي المبيعات قبل الضريبة)
  lines.push({
    accountCode: ACCOUNT_CODES.SALES_REVENUE,
    debit: 0,
    credit: subtotalBeforeTax,
    description: `إيراد مبيعات POS - ${saleCode}${customerName ? ` - ${customerName}` : ''}`,
  });

  // Credit: VAT Payable (tax amount = ضريبة القيمة المضافة)
  if (taxAmount > 0) {
    lines.push({
      accountCode: ACCOUNT_CODES.VAT_PAYABLE,
      debit: 0,
      credit: taxAmount,
      description: `ضريبة القيمة المضافة - مبيعات POS ${saleCode}`,
    });
  }

  // COGS entries with branch-specific inventory account
  if (itemsCost && itemsCost > 0) {
    // Get branch-specific inventory account
    let branchInventoryAccountCode: string;
    
    if (inventoryAccountCode) {
      branchInventoryAccountCode = inventoryAccountCode;
    } else if (branchId) {
      branchInventoryAccountCode = await getBranchInventoryAccountCode(branchId);
    } else {
      throw new Error(
        'لا يمكن إنشاء قيد تكلفة البضاعة المباعة بدون تحديد الفرع أو حساب المخزون. ' +
        'Branch ID or inventory account code is required for COGS entry.'
      );
    }

    lines.push({
      accountCode: ACCOUNT_CODES.COGS,
      debit: itemsCost,
      credit: 0,
      description: `تكلفة بضاعة مباعة - ${saleCode}`,
    });

    lines.push({
      accountCode: branchInventoryAccountCode,
      debit: 0,
      credit: itemsCost,
      description: `خصم من المخزون - ${saleCode}`,
    });
  }

  return createJournalEntry({
    description: `قيد مبيعات POS (دفع مقسم) - فاتورة ${saleCode}${customerName ? ` - ${customerName}` : ''}`,
    referenceType: 'sale',
    referenceId: saleId,
    lines,
    autoPost: true,
  });
}

/**
 * Create journal entry for a sales return
 * Debit: Sales Revenue (reduces sales)
 * Credit: Cash/Receivables (refund)
 * 
 * For inventory tracking:
 * Debit: Inventory (returned items)
 * Credit: Cost of Goods Sold (reduces COGS)
 */
/**
 * Create journal entry for POS Sales Return
 * This correctly separates VAT from sales returns and handles different refund methods
 * 
 * القيد المحاسبي الصحيح:
 * من ح/ مردودات المبيعات (4201)         [القيمة قبل الضريبة]
 * من ح/ ضريبة القيمة المضافة (2201)     [قيمة الضريبة]
 * إلى ح/ الصندوق / البنك / أرصدة العملاء  [الإجمالي حسب طريقة الرد]
 * 
 * إذا كان هناك حساب مخصص للعميل:
 * إلى ح/ العميل (حسابه المخصص)
 */
export async function createSalesReturnJournalEntry(params: {
  returnId: string;
  returnCode: string;
  totalAmount: number;
  subtotalBeforeTax?: number;
  taxAmount?: number;
  originalSaleCode: string;
  customerName?: string;
  customerId?: string;
  itemsCost?: number;
  refundMethod?: 'cash' | 'card' | 'store_credit';
  bankAccountCode?: string;
  branchId?: string;
  inventoryAccountCode?: string; // NEW: Branch-specific inventory account for return
}): Promise<string | null> {
  const { 
    returnId, 
    returnCode, 
    totalAmount, 
    subtotalBeforeTax,
    taxAmount,
    originalSaleCode, 
    customerName,
    customerId,
    itemsCost,
    refundMethod = 'cash',
    bankAccountCode,
    branchId,
    inventoryAccountCode
  } = params;

  const lines: JournalEntryLine[] = [];
  
  // Calculate amounts if not provided
  const netAmount = subtotalBeforeTax ?? (totalAmount / 1.15);
  const vatAmount = taxAmount ?? (totalAmount - netAmount);

  // Debit: Sales Returns Account (net amount before VAT)
  lines.push({
    accountCode: '4201', // مردودات المبيعات
    debit: netAmount,
    credit: 0,
    description: `مرتجع مبيعات - ${returnCode} من فاتورة ${originalSaleCode}`,
  });

  // Debit: VAT Payable (reverse the VAT collected)
  if (vatAmount > 0) {
    lines.push({
      accountCode: '2201', // ضريبة القيمة المضافة المستحقة
      debit: vatAmount,
      credit: 0,
      description: `ضريبة مستردة - مرتجع ${returnCode}`,
    });
  }

  // Credit: Determine account based on refund method
  let creditAccountCode: string;
  let creditDescription: string;
  
  switch (refundMethod) {
    case 'card':
      creditAccountCode = bankAccountCode || ACCOUNT_CODES.BANK;
      creditDescription = `رد مبلغ بالبطاقة - مرتجع ${returnCode}`;
      break;
    case 'store_credit':
      creditAccountCode = '2310'; // أرصدة العملاء الدائنة
      creditDescription = `رصيد دائن للعميل - مرتجع ${returnCode}${customerName ? ` - ${customerName}` : ''}`;
      break;
    case 'cash':
    default:
      // Use branch-specific cash account if available
      const paymentSettings = await getPaymentAccountSettings(branchId);
      creditAccountCode = paymentSettings?.cashAccountCode || ACCOUNT_CODES.CASH;
      creditDescription = `رد مبلغ نقداً - مرتجع ${returnCode}`;
      break;
  }

  lines.push({
    accountCode: creditAccountCode,
    debit: 0,
    credit: totalAmount,
    description: creditDescription,
  });

  // If we have cost information, reverse COGS (items returned to inventory)
  if (itemsCost && itemsCost > 0) {
    // Get branch-specific inventory account for return
    let branchInventoryAccountCode: string;
    
    if (inventoryAccountCode) {
      branchInventoryAccountCode = inventoryAccountCode;
    } else if (branchId) {
      branchInventoryAccountCode = await getBranchInventoryAccountCode(branchId);
    } else {
      throw new Error(
        'لا يمكن إنشاء قيد إعادة المخزون بدون تحديد الفرع أو حساب المخزون. ' +
        'Branch ID or inventory account code is required for inventory return entry.'
      );
    }

    lines.push({
      accountCode: branchInventoryAccountCode,
      debit: itemsCost,
      credit: 0,
      description: `إعادة للمخزون - ${returnCode}`,
    });

    lines.push({
      accountCode: ACCOUNT_CODES.COGS,
      debit: 0,
      credit: itemsCost,
      description: `تخفيض تكلفة البضاعة المباعة - ${returnCode}`,
    });
  }

  return createJournalEntry({
    description: `قيد مرتجع مبيعات - ${returnCode} من فاتورة ${originalSaleCode}${customerName ? ` - ${customerName}` : ''}`,
    referenceType: 'sale_return',
    referenceId: returnId,
    lines,
    autoPost: true,
  });
}

/**
 * Create journal entry for a POS Credit Note
 * This is used when issuing a credit note from POS
 * Debit: Sales Revenue / Returns Account (reduces sales)
 * Debit: VAT Refundable (if applicable)
 * Credit: Cash/Bank/Receivables (refund to customer)
 */
export async function createPOSCreditNoteJournalEntry(params: {
  creditNoteId: string;
  creditNoteNumber: string;
  totalAmount: number;
  taxAmount?: number;
  paymentMethod: 'cash' | 'card' | 'credit';
  customerName?: string;
  itemsCost?: number;
  bankAccountCode?: string;
  linkedInvoiceNumber?: string;
  branchId?: string;
  inventoryAccountCode?: string; // NEW: Branch-specific inventory account
}): Promise<string | null> {
  const { 
    creditNoteId, 
    creditNoteNumber, 
    totalAmount, 
    taxAmount = 0,
    paymentMethod, 
    customerName, 
    itemsCost,
    bankAccountCode,
    linkedInvoiceNumber,
    branchId,
    inventoryAccountCode
  } = params;

  const lines: JournalEntryLine[] = [];
  const netAmount = totalAmount - taxAmount;
  
  // Debit: Sales Returns / Revenue (net amount without tax)
  lines.push({
    accountCode: ACCOUNT_CODES.SALES_REVENUE,
    debit: netAmount,
    credit: 0,
    description: `إشعار دائن POS - ${creditNoteNumber}${linkedInvoiceNumber ? ` (مرتبط بفاتورة ${linkedInvoiceNumber})` : ''}`,
  });

  // Debit: VAT Refundable (if there's tax)
  if (taxAmount > 0) {
    lines.push({
      accountCode: '2117', // VAT Payable account - to be refunded
      debit: taxAmount,
      credit: 0,
      description: `ضريبة مستردة - إشعار دائن ${creditNoteNumber}`,
    });
  }

  // Determine the credit account based on payment method
  const creditAccountCode = paymentMethod === 'cash' ? ACCOUNT_CODES.CASH : 
                           paymentMethod === 'card' ? (bankAccountCode || ACCOUNT_CODES.BANK) : 
                           ACCOUNT_CODES.RECEIVABLES;

  // Credit: Cash/Bank/Receivables (refund amount)
  lines.push({
    accountCode: creditAccountCode,
    debit: 0,
    credit: totalAmount,
    description: `رد قيمة إشعار دائن - ${creditNoteNumber}${customerName ? ` - ${customerName}` : ''}`,
  });

  // If we have cost information, reverse COGS (items returned to inventory)
  if (itemsCost && itemsCost > 0) {
    // Get branch-specific inventory account
    let branchInventoryAccountCode: string;
    
    if (inventoryAccountCode) {
      branchInventoryAccountCode = inventoryAccountCode;
    } else if (branchId) {
      branchInventoryAccountCode = await getBranchInventoryAccountCode(branchId);
    } else {
      throw new Error(
        'لا يمكن إنشاء قيد إعادة المخزون بدون تحديد الفرع أو حساب المخزون. '
      );
    }

    lines.push({
      accountCode: branchInventoryAccountCode,
      debit: itemsCost,
      credit: 0,
      description: `إعادة للمخزون - إشعار دائن ${creditNoteNumber}`,
    });

    lines.push({
      accountCode: ACCOUNT_CODES.COGS,
      debit: 0,
      credit: itemsCost,
      description: `تخفيض تكلفة البضاعة المباعة - إشعار دائن ${creditNoteNumber}`,
    });
  }

  return createJournalEntry({
    description: `قيد إشعار دائن POS - ${creditNoteNumber}${customerName ? ` - ${customerName}` : ''}${linkedInvoiceNumber ? ` (فاتورة أصلية: ${linkedInvoiceNumber})` : ''}`,
    referenceType: 'sale_return',
    referenceId: creditNoteId,
    lines,
    autoPost: true,
  });
}

/**
 * Create journal entry for service revenue (shipping fees charged to customer)
 * When shipping/additional fees are charged to customer, they are treated as service revenue
 * 
 * Debit: Accounts Receivable or Cash (fee amount + VAT if applicable)
 * Credit: Service Revenue (fee amount before VAT)
 * Credit: VAT Payable (VAT on service if taxable)
 */
export async function createServiceRevenueJournalEntry(params: {
  referenceId: string;
  referenceNumber: string;
  serviceAmount: number;
  taxAmount?: number;
  serviceType: 'shipping' | 'additional_fees';
  isPaid: boolean;
  paymentMethod?: string;
  customerName?: string;
  branchId?: string;
}): Promise<string | null> {
  const { 
    referenceId, 
    referenceNumber, 
    serviceAmount, 
    taxAmount = 0,
    serviceType,
    isPaid,
    paymentMethod = 'cash',
    customerName,
    branchId
  } = params;

  const lines: JournalEntryLine[] = [];
  const totalAmount = serviceAmount + taxAmount;
  const serviceLabel = serviceType === 'shipping' ? 'رسوم شحن' : 'رسوم إضافية';
  
  // Determine debit account
  let debitAccountCode: string;
  if (isPaid) {
    const paymentSettings = await getPaymentAccountSettings(branchId);
    debitAccountCode = paymentMethod === 'cash' 
      ? (paymentSettings?.cashAccountCode || ACCOUNT_CODES.CASH)
      : (paymentSettings?.bankTransferAccountCode || ACCOUNT_CODES.BANK);
  } else {
    debitAccountCode = ACCOUNT_CODES.RECEIVABLES;
  }

  // Debit: Cash/Bank or Receivables
  lines.push({
    accountCode: debitAccountCode,
    debit: totalAmount,
    credit: 0,
    description: `${serviceLabel} - ${referenceNumber}${customerName ? ` - ${customerName}` : ''}`,
  });

  // Credit: Service Revenue
  lines.push({
    accountCode: ACCOUNT_CODES.SERVICE_REVENUE,
    debit: 0,
    credit: serviceAmount,
    description: `إيراد ${serviceLabel} - ${referenceNumber}`,
  });

  // Credit: VAT if applicable
  if (taxAmount > 0) {
    lines.push({
      accountCode: ACCOUNT_CODES.VAT_PAYABLE,
      debit: 0,
      credit: taxAmount,
      description: `ضريبة ${serviceLabel} - ${referenceNumber}`,
    });
  }

  return createJournalEntry({
    description: `قيد ${serviceLabel} - ${referenceNumber}${customerName ? ` - ${customerName}` : ''}`,
    referenceType: 'sale',
    referenceId,
    lines,
    autoPost: true,
  });
}

/**
 * Create journal entry for administrative/late discount (discount allowed after invoice)
 * This creates a separate document without modifying the original invoice
 * 
 * Debit: Discount Allowed (expense)
 * Credit: Accounts Receivable (customer)
 */
export async function createDiscountAllowedJournalEntry(params: {
  referenceId: string;
  referenceNumber: string;
  discountAmount: number;
  reason: string;
  customerName?: string;
  customerId?: string;
  originalInvoiceNumber?: string;
}): Promise<string | null> {
  const { 
    referenceId, 
    referenceNumber, 
    discountAmount, 
    reason,
    customerName,
    customerId,
    originalInvoiceNumber
  } = params;

  // Get customer's specific sub-account (or parent receivables if not linked)
  let creditAccountCode = ACCOUNT_CODES.RECEIVABLES;
  if (customerId) {
    const customerAccountCode = await getCustomerAccountCode(customerId);
    if (customerAccountCode) {
      creditAccountCode = customerAccountCode;
    }
  }

  const lines: JournalEntryLine[] = [];
  
  // Debit: Discount Allowed (expense)
  lines.push({
    accountCode: ACCOUNT_CODES.DISCOUNT_ALLOWED,
    debit: discountAmount,
    credit: 0,
    description: `خصم مسموح به - ${referenceNumber}${originalInvoiceNumber ? ` (فاتورة: ${originalInvoiceNumber})` : ''} - ${reason}`,
  });

  // Credit: Customer's specific sub-account (reduce customer balance)
  lines.push({
    accountCode: creditAccountCode,
    debit: 0,
    credit: discountAmount,
    description: `تخفيض رصيد العميل${customerName ? ` - ${customerName}` : ''} - خصم ${referenceNumber}`,
  });

  return createJournalEntry({
    description: `قيد خصم مسموح به - ${referenceNumber}${customerName ? ` - ${customerName}` : ''}${originalInvoiceNumber ? ` (فاتورة: ${originalInvoiceNumber})` : ''}`,
    referenceType: 'manual',
    referenceId,
    lines,
    autoPost: true,
  });
}

/**
 * Create journal entry for company-paid shipping expense
 * When company bears the shipping cost (free shipping to customer)
 * 
 * Debit: Shipping Expense
 * Credit: Cash/Bank or Payables (to carrier/supplier)
 */
export async function createShippingExpenseJournalEntry(params: {
  referenceId: string;
  referenceNumber: string;
  expenseAmount: number;
  paymentMethod: 'cash' | 'bank' | 'credit';
  carrierName?: string;
  branchId?: string;
}): Promise<string | null> {
  const { 
    referenceId, 
    referenceNumber, 
    expenseAmount, 
    paymentMethod,
    carrierName,
    branchId
  } = params;

  const lines: JournalEntryLine[] = [];
  
  // Debit: Shipping Expense
  lines.push({
    accountCode: ACCOUNT_CODES.SHIPPING_EXPENSE,
    debit: expenseAmount,
    credit: 0,
    description: `مصروف شحن - ${referenceNumber}${carrierName ? ` - ${carrierName}` : ''}`,
  });

  // Credit: Determine account based on payment method
  let creditAccountCode: string;
  let creditDescription: string;
  
  if (paymentMethod === 'credit') {
    creditAccountCode = ACCOUNT_CODES.PAYABLES;
    creditDescription = `مستحق لشركة الشحن${carrierName ? ` - ${carrierName}` : ''}`;
  } else {
    const paymentSettings = await getPaymentAccountSettings(branchId);
    creditAccountCode = paymentMethod === 'cash' 
      ? (paymentSettings?.cashAccountCode || ACCOUNT_CODES.CASH)
      : (paymentSettings?.bankTransferAccountCode || ACCOUNT_CODES.BANK);
    creditDescription = `دفع مصروف شحن - ${referenceNumber}`;
  }

  lines.push({
    accountCode: creditAccountCode,
    debit: 0,
    credit: expenseAmount,
    description: creditDescription,
  });

  return createJournalEntry({
    description: `قيد مصروف شحن - ${referenceNumber}${carrierName ? ` - ${carrierName}` : ''}`,
    referenceType: 'manual',
    referenceId,
    lines,
    autoPost: true,
  });
}

/**
 * Debit: Inventory (cost of items)
 * Credit: Payables/Cash (amount owed/paid)
 */
export async function createPurchaseJournalEntry(params: {
  batchId: string;
  batchNo: string;
  totalCost: number;
  supplierName?: string;
  supplierId?: string;
  paymentMethod?: 'cash' | 'credit';
}): Promise<string | null> {
  const { batchId, batchNo, totalCost, supplierName, supplierId, paymentMethod = 'credit' } = params;

  // Determine credit account based on payment method and supplier
  let creditAccountCode = ACCOUNT_CODES.PAYABLES;
  if (paymentMethod === 'cash') {
    creditAccountCode = ACCOUNT_CODES.CASH;
  } else if (supplierId) {
    // Get supplier's specific sub-account
    const supplierAccountCode = await getSupplierAccountCode(supplierId);
    if (supplierAccountCode) {
      creditAccountCode = supplierAccountCode;
    }
  }

  const lines: JournalEntryLine[] = [
    {
      accountCode: ACCOUNT_CODES.INVENTORY,
      debit: totalCost,
      credit: 0,
      description: `شراء بضاعة - دفعة ${batchNo}${supplierName ? ` من ${supplierName}` : ''}`,
    },
    {
      accountCode: creditAccountCode,
      debit: 0,
      credit: totalCost,
      description: paymentMethod === 'cash' 
        ? `دفع ثمن البضاعة - دفعة ${batchNo}` 
        : `مستحق للمورد - دفعة ${batchNo}${supplierName ? ` - ${supplierName}` : ''}`,
    },
  ];

  return createJournalEntry({
    description: `قيد شراء بضاعة - دفعة ${batchNo}${supplierName ? ` من ${supplierName}` : ''}`,
    referenceType: 'purchase',
    referenceId: batchId,
    lines,
    autoPost: true,
  });
}

/**
 * Create journal entry for a purchase return
 * Debit: Payables/Cash (reduce what we owe or get refund)
 * Credit: Inventory (remove from inventory)
 */
export async function createPurchaseReturnJournalEntry(params: {
  returnId: string;
  returnCode: string;
  totalAmount: number;
  supplierName?: string;
  supplierId?: string;
}): Promise<string | null> {
  const { returnId, returnCode, totalAmount, supplierName, supplierId } = params;

  // Get supplier's specific sub-account (or parent payables if not linked)
  let debitAccountCode = ACCOUNT_CODES.PAYABLES;
  if (supplierId) {
    const supplierAccountCode = await getSupplierAccountCode(supplierId);
    if (supplierAccountCode) {
      debitAccountCode = supplierAccountCode;
    }
  }

  const lines: JournalEntryLine[] = [
    {
      accountCode: debitAccountCode,
      debit: totalAmount,
      credit: 0,
      description: `تخفيض مستحق للمورد - مرتجع ${returnCode}${supplierName ? ` - ${supplierName}` : ''}`,
    },
    {
      accountCode: ACCOUNT_CODES.INVENTORY,
      debit: 0,
      credit: totalAmount,
      description: `إخراج من المخزون - مرتجع ${returnCode}`,
    },
  ];

  return createJournalEntry({
    description: `قيد مرتجع مشتريات - ${returnCode}${supplierName ? ` - ${supplierName}` : ''}`,
    referenceType: 'purchase_return',
    referenceId: returnId,
    lines,
    autoPost: true,
  });
}

/**
 * Purchase Return Line for detailed journal entry
 */
interface PurchaseReturnLine {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
  accountCode?: string; // Optional: specific inventory account for this line
}

/**
 * Create detailed journal entry for purchase return with line items
 * This function creates a comprehensive journal entry that:
 * 1. Debits Supplier Account (reduces what we owe)
 * 2. Credits Inventory accounts (removes from stock)
 * 3. Credits VAT Receivable (reverses input VAT)
 * 
 * القيد المحاسبي الصحيح لمرتجع المشتريات:
 * من ح/ الموردين (2101)                  [إجمالي الفاتورة]
 * إلى ح/ المخزون (1103/1137)            [صافي القيمة قبل الضريبة]
 * إلى ح/ ضريبة القيمة المضافة (2202)    [قيمة الضريبة المستردة]
 */
export async function createPurchaseReturnJournalEntryWithLines(params: {
  returnId: string;
  returnCode: string;
  originalInvoiceNumber?: string;
  supplierName?: string;
  supplierAccountCode?: string;
  lines: PurchaseReturnLine[];
  subtotalBeforeTax: number;
  totalTaxAmount: number;
  totalAmount: number;
  branchId?: string | null;
  paymentMethod?: 'cash' | 'credit'; // Added: support for cash returns
}): Promise<string | null> {
  const { 
    returnId, 
    returnCode, 
    originalInvoiceNumber,
    supplierName, 
    supplierAccountCode,
    lines: returnLines,
    subtotalBeforeTax,
    totalTaxAmount,
    totalAmount,
    branchId,
    paymentMethod = 'credit' // Default to credit (supplier account)
  } = params;

  const journalLines: JournalEntryLine[] = [];
  
  // Determine debit account based on payment method
  // For credit returns: debit supplier account (reduces what we owe)
  // For cash returns: debit cash/bank account (refund received)
  let debitAccountCode: string;
  let debitDescription: string;
  
  if (paymentMethod === 'cash') {
    // Get cash account from settings or use default
    const paymentSettings = await getPaymentAccountSettings(branchId);
    debitAccountCode = paymentSettings?.cashAccountCode || ACCOUNT_CODES.CASH;
    debitDescription = `استرداد نقدي من المورد${supplierName ? ` - ${supplierName}` : ''} - مرتجع ${returnCode}`;
  } else {
    // Use supplier-specific account or default payables
    debitAccountCode = supplierAccountCode || ACCOUNT_CODES.PAYABLES;
    debitDescription = `تخفيض مستحق للمورد${supplierName ? ` - ${supplierName}` : ''} - مرتجع ${returnCode}${originalInvoiceNumber ? ` من فاتورة ${originalInvoiceNumber}` : ''}`;
  }

  // DEBIT: Cash/Bank (for cash returns) OR Supplier Account (for credit returns)
  // This is the TOTAL amount including VAT
  journalLines.push({
    accountCode: debitAccountCode,
    debit: totalAmount,
    credit: 0,
    description: debitDescription,
  });

  // CREDIT: Inventory accounts (group by account code if different)
  // Use default inventory account or specific accounts per line
  const inventoryAccountsMap = new Map<string, { amount: number; descriptions: string[] }>();
  
  for (const line of returnLines) {
    // Only use accountCode if it's a valid account code format (not UUID)
    // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    const isValidAccountCode = line.accountCode && 
      !line.accountCode.includes('-') && 
      line.accountCode.length <= 10;
    
    const accountCode = isValidAccountCode ? line.accountCode : ACCOUNT_CODES.INVENTORY;
    const existing = inventoryAccountsMap.get(accountCode);
    const lineNetAmount = line.totalAmount - line.taxAmount;
    
    if (existing) {
      existing.amount += lineNetAmount;
      existing.descriptions.push(line.description);
    } else {
      inventoryAccountsMap.set(accountCode, {
        amount: lineNetAmount,
        descriptions: [line.description]
      });
    }
  }

  // Fallback: If no valid inventory accounts found but we have a subtotal, use default
  if (inventoryAccountsMap.size === 0 && subtotalBeforeTax > 0) {
    inventoryAccountsMap.set(ACCOUNT_CODES.INVENTORY, {
      amount: subtotalBeforeTax,
      descriptions: ['مرتجع مشتريات']
    });
  }

  // Add inventory credit lines
  for (const [accountCode, data] of inventoryAccountsMap) {
    if (data.amount > 0) {
      journalLines.push({
        accountCode,
        debit: 0,
        credit: data.amount,
        description: `إخراج من المخزون - مرتجع ${returnCode}: ${data.descriptions.slice(0, 3).join(', ')}${data.descriptions.length > 3 ? '...' : ''}`,
      });
    }
  }

  // CREDIT: VAT Receivable (reverse the input VAT we originally claimed)
  if (totalTaxAmount > 0) {
    journalLines.push({
      accountCode: ACCOUNT_CODES.VAT_RECEIVABLE, // 2202 - ضريبة القيمة المضافة على المشتريات
      debit: 0,
      credit: totalTaxAmount,
      description: `استرداد ضريبة مشتريات - مرتجع ${returnCode}`,
    });
  }

  // Validate balance
  const totalDebit = journalLines.reduce((sum, line) => sum + line.debit, 0);
  const totalCredit = journalLines.reduce((sum, line) => sum + line.credit, 0);
  
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    console.error('Purchase return journal entry is not balanced:', { 
      totalDebit, 
      totalCredit, 
      difference: totalDebit - totalCredit,
      params 
    });
    return null;
  }

  return createJournalEntry({
    description: `قيد مرتجع مشتريات - ${returnCode}${supplierName ? ` - ${supplierName}` : ''}${originalInvoiceNumber ? ` (فاتورة أصلية: ${originalInvoiceNumber})` : ''}`,
    referenceType: 'purchase_return',
    referenceId: returnId,
    lines: journalLines,
    autoPost: true,
  });
}

/**
 * Create journal entry for a payment (to supplier)
 * Debit: Payables (reduce what we owe)
 * Credit: Cash/Bank (payment made) - uses configured account
 */
export async function createPaymentJournalEntry(params: {
  paymentId: string;
  paymentNumber: string;
  amount: number;
  paymentMethod: string;
  supplierName?: string;
  supplierId?: string;
  branchId?: string | null;
}): Promise<string | null> {
  const { paymentId, paymentNumber, amount, paymentMethod, supplierName, supplierId, branchId } = params;

  // Validate amount
  if (!amount || amount <= 0) {
    console.error('createPaymentJournalEntry: Invalid payment amount:', amount);
    return null;
  }

  // Get the configured credit account based on payment method
  const creditAccountCode = await getPaymentMethodAccountCode(paymentMethod, 'credit', branchId);

  // Get supplier's specific sub-account (or parent payables if not linked)
  let debitAccountCode = ACCOUNT_CODES.PAYABLES;
  if (supplierId) {
    const supplierAccountCode = await getSupplierAccountCode(supplierId);
    if (supplierAccountCode) {
      debitAccountCode = supplierAccountCode;
    }
  }

  console.log('createPaymentJournalEntry: Creating entry with:', {
    paymentNumber,
    amount,
    paymentMethod,
    debitAccount: debitAccountCode,
    creditAccount: creditAccountCode,
  });

  const lines: JournalEntryLine[] = [
    {
      accountCode: debitAccountCode,
      debit: amount,
      credit: 0,
      description: `سداد للمورد${supplierName ? ` - ${supplierName}` : ''} - سند ${paymentNumber}`,
    },
    {
      accountCode: creditAccountCode,
      debit: 0,
      credit: amount,
      description: `صرف نقدي/بنكي - سند ${paymentNumber}`,
    },
  ];

  const journalEntryId = await createJournalEntry({
    description: `قيد صرف - سند ${paymentNumber}${supplierName ? ` - ${supplierName}` : ''}`,
    referenceType: 'payment',
    referenceId: paymentId,
    lines,
    autoPost: true,
  });

  if (!journalEntryId) {
    console.error('createPaymentJournalEntry: Failed to create journal entry for payment:', paymentNumber);
  } else {
    console.log('createPaymentJournalEntry: Successfully created journal entry:', journalEntryId);
  }

  return journalEntryId;
}

/**
 * Create journal entry for a receipt (from customer)
 * Debit: Cash/Bank (received) - uses configured account
 * Credit: Receivables (reduce what customer owes)
 */
export async function createReceiptJournalEntry(params: {
  paymentId: string;
  paymentNumber: string;
  amount: number;
  paymentMethod: string;
  customerName?: string;
  customerId?: string;
  branchId?: string | null;
}): Promise<string | null> {
  const { paymentId, paymentNumber, amount, paymentMethod, customerName, customerId, branchId } = params;

  // Get the configured debit account based on payment method
  const debitAccountCode = await getPaymentMethodAccountCode(paymentMethod, 'debit', branchId);

  // Get customer's specific sub-account (or parent receivables if not linked)
  let creditAccountCode = ACCOUNT_CODES.RECEIVABLES;
  if (customerId) {
    const customerAccountCode = await getCustomerAccountCode(customerId);
    if (customerAccountCode) {
      creditAccountCode = customerAccountCode;
    }
  }

  const lines: JournalEntryLine[] = [
    {
      accountCode: debitAccountCode,
      debit: amount,
      credit: 0,
      description: `تحصيل من العميل${customerName ? ` - ${customerName}` : ''} - سند ${paymentNumber}`,
    },
    {
      accountCode: creditAccountCode,
      debit: 0,
      credit: amount,
      description: `تسوية ذمة العميل - سند ${paymentNumber}`,
    },
  ];

  return createJournalEntry({
    description: `قيد قبض - سند ${paymentNumber}${customerName ? ` - ${customerName}` : ''}`,
    referenceType: 'receipt',
    referenceId: paymentId,
    lines,
    autoPost: true,
  });
}

/**
 * Create journal entry for inventory count shortage
 * Debit: Inventory Loss (خسائر عجز المخزون)
 * Credit: Inventory (مخزون البضاعة)
 */
export async function createInventoryShortageJournalEntry(params: {
  countId: string;
  countNumber: string;
  shortageValue: number;
  branchName?: string;
}): Promise<string | null> {
  const { countId, countNumber, shortageValue, branchName } = params;

  const lines: JournalEntryLine[] = [
    {
      accountCode: ACCOUNT_CODES.INVENTORY_LOSS,
      debit: shortageValue,
      credit: 0,
      description: `خسائر عجز جرد ${countNumber}${branchName ? ` - ${branchName}` : ''}`,
    },
    {
      accountCode: ACCOUNT_CODES.INVENTORY,
      debit: 0,
      credit: shortageValue,
      description: `تخفيض مخزون بسبب عجز - جرد ${countNumber}`,
    },
  ];

  return createJournalEntry({
    description: `قيد عجز مخزون - جرد ${countNumber}${branchName ? ` - ${branchName}` : ''}`,
    referenceType: 'manual',
    referenceId: countId,
    lines,
    autoPost: true,
  });
}

/**
 * Create journal entry for inventory count overage
 * Debit: Inventory (مخزون البضاعة)
 * Credit: Inventory Gain (أرباح فروقات المخزون)
 */
export async function createInventoryOverageJournalEntry(params: {
  countId: string;
  countNumber: string;
  overageValue: number;
  branchName?: string;
}): Promise<string | null> {
  const { countId, countNumber, overageValue, branchName } = params;

  const lines: JournalEntryLine[] = [
    {
      accountCode: ACCOUNT_CODES.INVENTORY,
      debit: overageValue,
      credit: 0,
      description: `زيادة مخزون من جرد ${countNumber}${branchName ? ` - ${branchName}` : ''}`,
    },
    {
      accountCode: ACCOUNT_CODES.INVENTORY_GAIN,
      debit: 0,
      credit: overageValue,
      description: `أرباح فروقات جرد - ${countNumber}`,
    },
  ];

  return createJournalEntry({
    description: `قيد زيادة مخزون - جرد ${countNumber}${branchName ? ` - ${branchName}` : ''}`,
    referenceType: 'manual',
    referenceId: countId,
    lines,
    autoPost: true,
  });
}

// Extended account codes for gold and production
// Updated to match actual database account codes
const GOLD_ACCOUNT_CODES = {
  GOLD_INVENTORY: '110301',        // مخزون الذهب الصافي
  GOLD_WIP: '110303',              // مخزون الإنتاج تحت التشغيل
  GOLD_FINISHED: '110304',         // مخزون الإنتاج التام - المصنع
  GOLD_PURCHASES: '510101',        // تكلفة الذهب المباع
  RAW_MATERIALS: '110306',         // مخزون المواد الخام
  RAW_MATERIALS_EXPENSE: '51',     // تكلفة البضاعة المباعة
  GEMSTONE_INVENTORY: '110307',    // مخزون الأحجار الكريمة
  GEMSTONE_PURCHASES: '51',        // تكلفة الأحجار الكريمة
  SCRAP_GOLD: '110302',            // مخزون ذهب الكسر
  FINISHED_GOODS_SHOWROOM: '110305', // مخزون الإنتاج التام - المعارض
  IMPORTED_PIECES: '1137',         // مخزون متاح للبيع - قطع مستوردة
};

/**
 * Create journal entry for gold receipt (استلام ذهب)
 * Debit: Gold Inventory (مخزون الذهب)
 * Credit: Supplier Payables or Cash
 */
export async function createGoldReceiptJournalEntry(params: {
  transactionId: string;
  weightGrams: number;
  valueAmount: number;
  karatName: string;
  supplierName?: string;
  supplierId?: string;
  paymentMethod?: 'cash' | 'credit';
}): Promise<string | null> {
  const { transactionId, weightGrams, valueAmount, karatName, supplierName, supplierId, paymentMethod = 'credit' } = params;

  // Determine credit account based on payment method and supplier
  let creditAccountCode = ACCOUNT_CODES.PAYABLES;
  if (paymentMethod === 'cash') {
    creditAccountCode = ACCOUNT_CODES.CASH;
  } else if (supplierId) {
    const supplierAccountCode = await getSupplierAccountCode(supplierId);
    if (supplierAccountCode) {
      creditAccountCode = supplierAccountCode;
    }
  }

  const lines: JournalEntryLine[] = [
    {
      accountCode: GOLD_ACCOUNT_CODES.GOLD_INVENTORY,
      debit: valueAmount,
      credit: 0,
      description: `استلام ذهب ${karatName} - ${weightGrams} جرام`,
    },
    {
      accountCode: creditAccountCode,
      debit: 0,
      credit: valueAmount,
      description: paymentMethod === 'cash' 
        ? `دفع ثمن ذهب ${karatName}` 
        : `مستحق للمورد${supplierName ? ` - ${supplierName}` : ''}`,
    },
  ];

  return createJournalEntry({
    description: `قيد استلام ذهب ${karatName} - ${weightGrams} جرام${supplierName ? ` من ${supplierName}` : ''}`,
    referenceType: 'purchase',
    referenceId: transactionId,
    lines,
    autoPost: true,
  });
}

/**
 * Create journal entry for gold delivery (تسليم ذهب للإنتاج)
 * Debit: Gold WIP (ذهب تحت التشغيل)
 * Credit: Gold Inventory (مخزون الذهب)
 */
export async function createGoldToProductionJournalEntry(params: {
  transactionId: string;
  weightGrams: number;
  valueAmount: number;
  karatName: string;
  workOrderCode?: string;
}): Promise<string | null> {
  const { transactionId, weightGrams, valueAmount, karatName, workOrderCode } = params;

  const lines: JournalEntryLine[] = [
    {
      accountCode: GOLD_ACCOUNT_CODES.GOLD_WIP,
      debit: valueAmount,
      credit: 0,
      description: `تسليم ذهب للإنتاج ${karatName} - ${weightGrams} جرام${workOrderCode ? ` - أمر ${workOrderCode}` : ''}`,
    },
    {
      accountCode: GOLD_ACCOUNT_CODES.GOLD_INVENTORY,
      debit: 0,
      credit: valueAmount,
      description: `خصم من مخزون الذهب`,
    },
  ];

  return createJournalEntry({
    description: `قيد تسليم ذهب للإنتاج - ${weightGrams} جرام ${karatName}`,
    referenceType: 'manual',
    referenceId: transactionId,
    lines,
    autoPost: true,
  });
}

/**
 * Create journal entry for finished goods from production (إنتاج تام)
 * Debit: Finished Goods Inventory (منتجات ذهب تامة)
 * Credit: Gold WIP (ذهب تحت التشغيل)
 */
export async function createFinishedGoodsJournalEntry(params: {
  movementId: string;
  itemCode: string;
  valueAmount: number;
  workOrderCode?: string;
}): Promise<string | null> {
  const { movementId, itemCode, valueAmount, workOrderCode } = params;

  const lines: JournalEntryLine[] = [
    {
      accountCode: GOLD_ACCOUNT_CODES.GOLD_FINISHED,
      debit: valueAmount,
      credit: 0,
      description: `استلام إنتاج تام - ${itemCode}${workOrderCode ? ` من أمر ${workOrderCode}` : ''}`,
    },
    {
      accountCode: GOLD_ACCOUNT_CODES.GOLD_WIP,
      debit: 0,
      credit: valueAmount,
      description: `إغلاق تكلفة إنتاج تحت التشغيل`,
    },
  ];

  return createJournalEntry({
    description: `قيد استلام إنتاج تام - ${itemCode}`,
    referenceType: 'manual',
    referenceId: movementId,
    lines,
    autoPost: true,
  });
}

/**
 * Create journal entry for finished goods transfer to showroom
 * Debit: Showroom Inventory (مخزون المعرض)
 * Credit: Factory Inventory (مخزون المصنع)
 */
export async function createShowroomTransferJournalEntry(params: {
  movementId: string;
  itemCode: string;
  valueAmount: number;
  fromBranch: string;
  toBranch: string;
}): Promise<string | null> {
  const { movementId, itemCode, valueAmount, fromBranch, toBranch } = params;

  const lines: JournalEntryLine[] = [
    {
      accountCode: GOLD_ACCOUNT_CODES.GOLD_FINISHED,
      debit: valueAmount,
      credit: 0,
      description: `نقل لمعرض ${toBranch} - ${itemCode}`,
    },
    {
      accountCode: GOLD_ACCOUNT_CODES.GOLD_FINISHED,
      debit: 0,
      credit: valueAmount,
      description: `خصم من مخزون ${fromBranch}`,
    },
  ];

  return createJournalEntry({
    description: `قيد نقل بضاعة من ${fromBranch} إلى ${toBranch} - ${itemCode}`,
    referenceType: 'manual',
    referenceId: movementId,
    lines,
    autoPost: true,
  });
}

/**
 * Create journal entry for raw materials purchase
 * Debit: Raw Materials Inventory (مخزون الخامات)
 * Credit: Cash or Payables
 */
export async function createRawMaterialsPurchaseJournalEntry(params: {
  transactionId: string;
  materialName: string;
  quantity: number;
  totalAmount: number;
  supplierName?: string;
  supplierId?: string;
  paymentMethod?: 'cash' | 'credit';
}): Promise<string | null> {
  const { transactionId, materialName, quantity, totalAmount, supplierName, supplierId, paymentMethod = 'credit' } = params;

  // Determine credit account based on payment method and supplier
  let creditAccountCode = ACCOUNT_CODES.PAYABLES;
  if (paymentMethod === 'cash') {
    creditAccountCode = ACCOUNT_CODES.CASH;
  } else if (supplierId) {
    const supplierAccountCode = await getSupplierAccountCode(supplierId);
    if (supplierAccountCode) {
      creditAccountCode = supplierAccountCode;
    }
  }

  const lines: JournalEntryLine[] = [
    {
      accountCode: GOLD_ACCOUNT_CODES.RAW_MATERIALS,
      debit: totalAmount,
      credit: 0,
      description: `شراء خامات ${materialName} - كمية ${quantity}`,
    },
    {
      accountCode: creditAccountCode,
      debit: 0,
      credit: totalAmount,
      description: paymentMethod === 'cash' 
        ? `دفع ثمن خامات` 
        : `مستحق للمورد${supplierName ? ` - ${supplierName}` : ''}`,
    },
  ];

  return createJournalEntry({
    description: `قيد شراء خامات - ${materialName}${supplierName ? ` من ${supplierName}` : ''}`,
    referenceType: 'purchase',
    referenceId: transactionId,
    lines,
    autoPost: true,
  });
}

/**
 * Create journal entry for raw materials consumption in production
 * Debit: Raw Materials Expense (مصاريف خامات)
 * Credit: Raw Materials Inventory (مخزون الخامات)
 */
export async function createRawMaterialsConsumptionJournalEntry(params: {
  transactionId: string;
  materialName: string;
  quantity: number;
  totalAmount: number;
  workOrderCode?: string;
}): Promise<string | null> {
  const { transactionId, materialName, quantity, totalAmount, workOrderCode } = params;

  const lines: JournalEntryLine[] = [
    {
      accountCode: GOLD_ACCOUNT_CODES.RAW_MATERIALS_EXPENSE,
      debit: totalAmount,
      credit: 0,
      description: `صرف خامات ${materialName} - كمية ${quantity}${workOrderCode ? ` - أمر ${workOrderCode}` : ''}`,
    },
    {
      accountCode: GOLD_ACCOUNT_CODES.RAW_MATERIALS,
      debit: 0,
      credit: totalAmount,
      description: `خصم من مخزون الخامات`,
    },
  ];

  return createJournalEntry({
    description: `قيد صرف خامات للإنتاج - ${materialName}`,
    referenceType: 'manual',
    referenceId: transactionId,
    lines,
    autoPost: true,
  });
}

/**
 * Create journal entry for cash vault operations
 */
export async function createCashVaultJournalEntry(params: {
  transactionId: string;
  transactionType: 'deposit' | 'withdrawal';
  amount: number;
  description: string;
  customerName?: string;
  supplierName?: string;
}): Promise<string | null> {
  const { transactionId, transactionType, amount, description, customerName, supplierName } = params;

  const lines: JournalEntryLine[] = [];

  if (transactionType === 'deposit') {
    // Cash in
    lines.push({
      accountCode: ACCOUNT_CODES.CASH,
      debit: amount,
      credit: 0,
      description: `إيداع نقدي - ${description}${customerName ? ` من ${customerName}` : ''}`,
    });
    lines.push({
      accountCode: customerName ? ACCOUNT_CODES.RECEIVABLES : ACCOUNT_CODES.SALES_REVENUE,
      debit: 0,
      credit: amount,
      description: customerName ? `تسوية ذمة ${customerName}` : 'إيراد نقدي',
    });
  } else {
    // Cash out
    lines.push({
      accountCode: supplierName ? ACCOUNT_CODES.PAYABLES : ACCOUNT_CODES.COGS,
      debit: amount,
      credit: 0,
      description: supplierName ? `سداد لـ ${supplierName}` : 'مصروف نقدي',
    });
    lines.push({
      accountCode: ACCOUNT_CODES.CASH,
      debit: 0,
      credit: amount,
      description: `صرف نقدي - ${description}`,
    });
  }

  return createJournalEntry({
    description: `قيد ${transactionType === 'deposit' ? 'إيداع' : 'صرف'} نقدي - ${description}`,
    referenceType: transactionType === 'deposit' ? 'receipt' : 'payment',
    referenceId: transactionId,
    lines,
    autoPost: true,
  });
}

/**
 * Create journal entry for WIP stage movement
 * Only creates entries for:
 * 1. Starting production (من مخزون انتاج خام إلى مخزون تحت التشغيل)
 * 2. Completing production (من مخزون تحت التشغيل إلى الانتاج التام)
 * Internal stage transfers do NOT create journal entries
 */
export async function createWIPMovementJournalEntry(params: {
  movementId: string;
  workOrderCode: string;
  fromStageName?: string;
  toStageName: string;
  goldWeight: number;
  movementType: string;
  valueAmount?: number;
}): Promise<string | null> {
  const { movementId, workOrderCode, fromStageName, toStageName, goldWeight, movementType, valueAmount } = params;

  // Internal stage transfers - NO journal entry
  if (movementType !== 'complete' && fromStageName) {
    console.log('Internal stage transfer - no journal entry needed');
    return null;
  }

  // Calculate value based on gold weight
  const goldValuePerGram = 250; // This should ideally come from gold prices table
  const calculatedValue = valueAmount || (goldWeight * goldValuePerGram);

  const lines: JournalEntryLine[] = [];
  let descriptionText = '';

  if (movementType === 'complete') {
    // قيد 2: إنتاج تام
    // من ح/الانتاج تحت التشغيل إلى ح/الانتاج التام
    lines.push({
      accountCode: GOLD_ACCOUNT_CODES.GOLD_FINISHED,
      debit: calculatedValue,
      credit: 0,
      description: `إنتاج تام - أمر ${workOrderCode} - ${goldWeight} جرام`,
    });
    lines.push({
      accountCode: GOLD_ACCOUNT_CODES.GOLD_WIP,
      debit: 0,
      credit: calculatedValue,
      description: `إغلاق إنتاج تحت التشغيل`,
    });
    descriptionText = `قيد إنتاج تام - أمر ${workOrderCode}`;
  } else if (!fromStageName) {
    // قيد 1: بدء الإنتاج
    // من ح/مخزون انتاج خام إلى ح/مخزون تحت التشغيل
    lines.push({
      accountCode: GOLD_ACCOUNT_CODES.GOLD_WIP,
      debit: calculatedValue,
      credit: 0,
      description: `بدء إنتاج - أمر ${workOrderCode} - ${goldWeight} جرام`,
    });
    lines.push({
      accountCode: GOLD_ACCOUNT_CODES.GOLD_INVENTORY,
      debit: 0,
      credit: calculatedValue,
      description: `صرف من مخزون انتاج خام`,
    });
    descriptionText = `قيد بدء إنتاج - أمر ${workOrderCode}`;
  }

  if (lines.length === 0) {
    return null;
  }

  return createJournalEntry({
    description: descriptionText,
    referenceType: 'manual',
    referenceId: movementId,
    lines,
    autoPost: true,
  });
}

/**
 * Create journal entry for gemstone purchase
 * Debit: Gemstone Inventory (مخزون الأحجار الكريمة)
 * Credit: Supplier Payables or Cash
 */
export async function createGemstonePurchaseJournalEntry(params: {
  stoneCode: string;
  gemstoneType: string;
  caratWeight: number;
  purchasePrice: number;
  supplierName?: string;
  supplierId?: string;
  paymentMethod?: 'cash' | 'credit';
}): Promise<string | null> {
  const { stoneCode, gemstoneType, caratWeight, purchasePrice, supplierName, supplierId, paymentMethod = 'credit' } = params;

  // Determine credit account based on payment method and supplier
  let creditAccountCode = ACCOUNT_CODES.PAYABLES;
  if (paymentMethod === 'cash') {
    creditAccountCode = ACCOUNT_CODES.CASH;
  } else if (supplierId) {
    const supplierAccountCode = await getSupplierAccountCode(supplierId);
    if (supplierAccountCode) {
      creditAccountCode = supplierAccountCode;
    }
  }

  const lines: JournalEntryLine[] = [
    {
      accountCode: GOLD_ACCOUNT_CODES.GEMSTONE_INVENTORY,
      debit: purchasePrice,
      credit: 0,
      description: `شراء ${gemstoneType} - ${stoneCode} - ${caratWeight} قيراط`,
    },
    {
      accountCode: creditAccountCode,
      debit: 0,
      credit: purchasePrice,
      description: paymentMethod === 'cash' 
        ? `دفع ثمن حجر كريم ${gemstoneType}` 
        : `مستحق للمورد${supplierName ? ` - ${supplierName}` : ''}`,
    },
  ];

  return createJournalEntry({
    description: `قيد شراء حجر ${gemstoneType} - ${stoneCode}${supplierName ? ` من ${supplierName}` : ''}`,
    referenceType: 'purchase',
    referenceId: stoneCode,
    lines,
    autoPost: true,
  });
}

/**
 * Create journal entry for gemstone usage in production
 * Debit: WIP / Finished Goods
 * Credit: Gemstone Inventory
 */
export async function createGemstoneUsageJournalEntry(params: {
  stoneCode: string;
  gemstoneType: string;
  caratWeight: number;
  value: number;
  jewelryItemCode: string;
}): Promise<string | null> {
  const { stoneCode, gemstoneType, caratWeight, value, jewelryItemCode } = params;

  const lines: JournalEntryLine[] = [
    {
      accountCode: GOLD_ACCOUNT_CODES.GOLD_FINISHED,
      debit: value,
      credit: 0,
      description: `إضافة ${gemstoneType} للمنتج ${jewelryItemCode}`,
    },
    {
      accountCode: GOLD_ACCOUNT_CODES.GEMSTONE_INVENTORY,
      debit: 0,
      credit: value,
      description: `صرف حجر ${stoneCode} - ${caratWeight} قيراط`,
    },
  ];

  return createJournalEntry({
    description: `قيد ربط حجر ${gemstoneType} بالمنتج ${jewelryItemCode}`,
    referenceType: 'manual',
    referenceId: jewelryItemCode,
    lines,
    autoPost: true,
  });
}

/**
 * Create journal entry for a purchase invoice
 * Debit: Inventory (cost of items)
 * Credit: Payables (amount owed to supplier)
 */
export async function createPurchaseInvoiceJournalEntry(params: {
  invoiceId: string;
  invoiceNumber: string;
  totalAmount: number;
  supplierName?: string;
  supplierId?: string;
  paymentMethod?: 'cash' | 'credit';
}): Promise<string | null> {
  const { invoiceId, invoiceNumber, totalAmount, supplierName, supplierId, paymentMethod = 'credit' } = params;

  // Determine credit account based on payment method and supplier
  let creditAccountCode = ACCOUNT_CODES.PAYABLES;
  if (paymentMethod === 'cash') {
    creditAccountCode = ACCOUNT_CODES.CASH;
  } else if (supplierId) {
    const supplierAccountCode = await getSupplierAccountCode(supplierId);
    if (supplierAccountCode) {
      creditAccountCode = supplierAccountCode;
    }
  }

  const lines: JournalEntryLine[] = [
    {
      accountCode: ACCOUNT_CODES.INVENTORY,
      debit: totalAmount,
      credit: 0,
      description: `شراء بضاعة - فاتورة ${invoiceNumber}${supplierName ? ` من ${supplierName}` : ''}`,
    },
    {
      accountCode: creditAccountCode,
      debit: 0,
      credit: totalAmount,
      description: paymentMethod === 'cash' 
        ? `دفع ثمن البضاعة - فاتورة ${invoiceNumber}` 
        : `مستحق للمورد - فاتورة ${invoiceNumber}${supplierName ? ` - ${supplierName}` : ''}`,
    },
  ];

  return createJournalEntry({
    description: `قيد فاتورة شراء - ${invoiceNumber}${supplierName ? ` من ${supplierName}` : ''}`,
    referenceType: 'purchase',
    referenceId: invoiceId,
    lines,
    autoPost: true,
  });
}

/**
 * Create journal entry for purchase invoice with multiple line types
 * Handles jewelry (inventory), costs (expense accounts), and products (inventory/expense)
 * Now properly separates VAT from the item amounts
 * Uses branch-specific inventory accounts for imported pieces
 */
export async function createPurchaseInvoiceJournalEntryWithLines(params: {
  invoiceId: string;
  invoiceNumber: string;
  supplierName: string;
  supplierId: string; // REQUIRED: ensures we always credit supplier sub-account on credit purchases
  paymentMethod: 'cash' | 'credit' | 'bank';
  bankAccountCode?: string;
  branchId?: string | null; // Branch ID for branch-specific inventory accounts
  lines: Array<{
    itemType: 'jewelry' | 'cost' | 'product' | 'imported_piece';
    totalAmount?: number; // For backward compatibility
    totalBeforeVat?: number;
    vatAmount?: number;
    totalWithVat?: number;
    glAccountId?: string | null;
    warehouseAccountId?: string | null;
    expenseAccountId?: string | null;
    description?: string;
  }>;
}): Promise<string | null> {
  const {
    invoiceId,
    invoiceNumber,
    supplierName,
    supplierId,
    paymentMethod,
    bankAccountCode,
    branchId,
    lines: invoiceLines,
  } = params;

  // Determine credit account based on payment method
  // ✅ NEVER allow posting to 2101 (parent payables). For credit, we must use supplier's sub-account.
  let creditAccountCode: string;

  if (paymentMethod === 'cash') {
    creditAccountCode = ACCOUNT_CODES.CASH;
  } else if (paymentMethod === 'bank') {
    if (!bankAccountCode) {
      toast.error('فشل إنشاء القيد: لم يتم تحديد حساب البنك');
      return null;
    }
    creditAccountCode = bankAccountCode;
  } else {
    // credit
    const supplierAccountCode = await getSupplierAccountCode(supplierId);
    if (!supplierAccountCode) {
      toast.error('فشل إنشاء القيد: المورد غير مربوط بحساب محاسبي');
      return null;
    }
    creditAccountCode = supplierAccountCode;
  }

  const journalLines: JournalEntryLine[] = [];

  // Group amounts by account
  let inventoryTotal = 0;
  let importedPiecesTotal = 0;
  let totalVat = 0;
  const expensesByAccount: Record<string, { amount: number; description: string }> = {};
  const warehousesByAccount: Record<string, { amount: number; description: string }> = {};

  for (const line of invoiceLines) {
    // Support both old (totalAmount) and new (totalBeforeVat) interface
    // If totalBeforeVat is provided, use it. Otherwise, calculate from totalAmount - vatAmount
    const vatAmountForLine = line.vatAmount || 0;
    let lineAmount: number;

    if (line.totalBeforeVat !== undefined && line.totalBeforeVat !== null) {
      lineAmount = line.totalBeforeVat;
    } else if (line.totalAmount !== undefined && line.totalAmount !== null) {
      // Calculate net amount by subtracting VAT from total
      lineAmount = line.totalAmount - vatAmountForLine;
    } else {
      lineAmount = 0;
    }

    totalVat += vatAmountForLine;

    if (line.itemType === 'jewelry') {
      // Jewelry goes to main inventory
      inventoryTotal += lineAmount;
    } else if (line.itemType === 'imported_piece') {
      // Imported pieces go to special inventory account
      if (line.warehouseAccountId) {
        const accountId = line.warehouseAccountId;
        if (!warehousesByAccount[accountId]) {
          warehousesByAccount[accountId] = { amount: 0, description: line.description || '' };
        }
        warehousesByAccount[accountId].amount += lineAmount;
      } else {
        importedPiecesTotal += lineAmount;
      }
    } else if (line.itemType === 'product') {
      // Products go to their warehouse account or main inventory
      if (line.warehouseAccountId) {
        const accountId = line.warehouseAccountId;
        if (!warehousesByAccount[accountId]) {
          warehousesByAccount[accountId] = { amount: 0, description: line.description || '' };
        }
        warehousesByAccount[accountId].amount += lineAmount;
      } else {
        inventoryTotal += lineAmount;
      }
    } else if (line.itemType === 'cost' && (line.expenseAccountId || line.glAccountId)) {
      // Costs and services go to their expense accounts
      const accountId = line.expenseAccountId || line.glAccountId;
      if (accountId) {
        if (!expensesByAccount[accountId]) {
          expensesByAccount[accountId] = { amount: 0, description: line.description || '' };
        }
        expensesByAccount[accountId].amount += lineAmount;
      }
    } else if (line.glAccountId) {
      // Fallback for items with GL account
      const accountId = line.glAccountId;
      if (!expensesByAccount[accountId]) {
        expensesByAccount[accountId] = { amount: 0, description: line.description || '' };
      }
      expensesByAccount[accountId].amount += lineAmount;
    } else {
      // Fallback to inventory for items without specific account
      inventoryTotal += lineAmount;
    }
  }

  // Add inventory line if applicable
  if (inventoryTotal > 0) {
    journalLines.push({
      accountCode: ACCOUNT_CODES.INVENTORY,
      debit: inventoryTotal,
      credit: 0,
      description: `مشتريات مخزون - فاتورة ${invoiceNumber}`,
    });
  }

  // Add imported pieces inventory line - use branch-specific account
  if (importedPiecesTotal > 0) {
    const branchAccountCode = await getBranchImportedPiecesAccountCode(branchId);
    journalLines.push({
      accountCode: branchAccountCode,
      debit: importedPiecesTotal,
      credit: 0,
      description: `مخزون قطع مستوردة - فاتورة ${invoiceNumber}`,
    });
  }

  // Add warehouse-specific inventory lines
  for (const [accountId, data] of Object.entries(warehousesByAccount)) {
    const { data: account } = await dataGateway.getChartOfAccountsById(accountId);

    if (account) {
      journalLines.push({
        accountCode: account.account_code,
        debit: data.amount,
        credit: 0,
        description: data.description || `مخزون - فاتورة ${invoiceNumber}`,
      });
    }
  }

  // Add expense lines for each GL account
  for (const [accountId, data] of Object.entries(expensesByAccount)) {
    const { data: account } = await dataGateway.getChartOfAccountsById(accountId);

    if (account) {
      journalLines.push({
        accountCode: account.account_code,
        debit: data.amount,
        credit: 0,
        description: data.description || `مصروف - فاتورة ${invoiceNumber}`,
      });
    }
  }

  // Add Purchase VAT if applicable
  if (totalVat > 0) {
    journalLines.push({
      accountCode: '2202',
      debit: totalVat,
      credit: 0,
      description: `ضريبة القيمة المضافة على المشتريات - فاتورة ${invoiceNumber}`,
    });
  }

  // Calculate total for credit side (including VAT)
  const totalAmount = invoiceLines.reduce((sum, l) => {
    if (l.totalWithVat !== undefined && l.totalWithVat !== null) {
      return sum + l.totalWithVat;
    }
    if (l.totalBeforeVat !== undefined && l.totalBeforeVat !== null) {
      return sum + l.totalBeforeVat + (l.vatAmount || 0);
    }
    return sum + (l.totalAmount || 0);
  }, 0);

  // Add payables/cash/bank credit
  journalLines.push({
    accountCode: creditAccountCode,
    debit: 0,
    credit: totalAmount,
    description:
      paymentMethod === 'cash'
        ? `دفع فاتورة شراء - ${invoiceNumber}`
        : paymentMethod === 'bank'
          ? `دفع بنكي لفاتورة شراء - ${invoiceNumber}`
          : `مستحق للمورد - فاتورة ${invoiceNumber}${supplierName ? ` - ${supplierName}` : ''}`,
  });

  return createJournalEntry({
    description: `قيد فاتورة شراء - ${invoiceNumber}${supplierName ? ` من ${supplierName}` : ''}`,
    referenceType: 'purchase',
    referenceId: invoiceId,
    lines: journalLines,
    autoPost: true,
  });
}

/**
 * Create journal entry for Cost of Goods Sold when selling an imported piece
 * Debit: COGS - Imported Pieces
 * Credit: Inventory - Imported Pieces (branch-specific)
 */
export async function createImportedPieceCOGSJournalEntry(params: {
  itemCode: string;
  costAmount: number;
  saleId: string;
  branchId?: string | null; // NEW: Branch ID for branch-specific inventory account
  description?: string;
}): Promise<string | null> {
  const { itemCode, costAmount, saleId, branchId, description } = params;

  // Get the branch-specific inventory account code
  const inventoryAccountCode = await getBranchImportedPiecesAccountCode(branchId);

  const lines: JournalEntryLine[] = [
    {
      accountCode: '5102', // COGS - Imported Pieces
      debit: costAmount,
      credit: 0,
      description: description || `تكلفة بضاعة مباعة - قطعة ${itemCode}`,
    },
    {
      accountCode: inventoryAccountCode, // Branch-specific Inventory - Imported Pieces
      debit: 0,
      credit: costAmount,
      description: `خصم من مخزون قطع مستوردة - ${itemCode}`,
    },
  ];

  return createJournalEntry({
    description: `قيد تكلفة بيع قطعة مستوردة - ${itemCode}`,
    referenceType: 'sale',
    referenceId: saleId,
    lines,
    autoPost: true,
  });
}

/**
 * Rebuild journal entry lines for orphan entries (entries without lines)
 * This function attempts to recreate lines based on reference_type and reference_id
 */
export async function rebuildJournalEntryLines(entryId: string): Promise<{ success: boolean; message: string; linesCreated: number }> {
  try {
    // Fetch the journal entry
    const { data: entry, error: entryError } = await dataGateway.fetchTable('journal_entries', { filters: { id: entryId }, single: true });

    if (entryError || !entry) {
      return { success: false, message: 'القيد غير موجود', linesCreated: 0 };
    }

    // Check if lines already exist
    const { data: existingLines } = await dataGateway.fetchTable('journal_entry_lines', { filters: { journal_entry_id: entryId } });

    if (existingLines && existingLines.length > 0) {
      return { success: false, message: 'القيد يحتوي على سطور بالفعل', linesCreated: existingLines.length };
    }

    const referenceType = entry.reference_type;
    const referenceId = entry.reference_id;

    if (!referenceId) {
      // Manual entry without reference - can't rebuild
      return { success: false, message: 'القيد اليدوي لا يمكن إعادة بناء سطوره تلقائياً', linesCreated: 0 };
    }

    let linesCreated = 0;

    // Handle based on reference type
    if (referenceType === 'payment') {
      // Fetch payment details
      const { data: payment } = await dataGateway.getPaymentWithRelations(referenceId);

      if (payment) {
        // Get supplier account (or use default payables)
        let supplierAccountId: string | null = null;
        if (payment.supplier_id) {
          const { data: supplier } = await dataGateway.fetchTable('suppliers', { filters: { id: payment.supplier_id }, single: true });
          supplierAccountId = supplier?.account_id || null;
        }
        
        // If no supplier account, use default payables
        if (!supplierAccountId) {
          supplierAccountId = await getAccountId(ACCOUNT_CODES.PAYABLES);
        }

        // Get cash/bank account
        const cashAccountId = await getAccountId(
          payment.payment_method === 'bank_transfer' || payment.payment_method === 'card' 
            ? ACCOUNT_CODES.BANK 
            : ACCOUNT_CODES.CASH
        );

        // NOTE: This recovery function is disabled in atomic-only mode.
        // Lines should be created via je_create_atomic at JE creation time.
        console.warn('rebuildJournalEntryLines: Line rebuild disabled in atomic-only mode (payment)');
      }
    } else if (referenceType === 'receipt') {
      // NOTE: This recovery function is disabled in atomic-only mode.
      console.warn('rebuildJournalEntryLines: Line rebuild disabled in atomic-only mode (receipt)');
    } else if (referenceType === 'purchase') {
      // NOTE: This recovery function is disabled in atomic-only mode.
      console.warn('rebuildJournalEntryLines: Line rebuild disabled in atomic-only mode (purchase)');
    } else if (referenceType === 'sale') {
      // NOTE: This recovery function is disabled in atomic-only mode.
      console.warn('rebuildJournalEntryLines: Line rebuild disabled in atomic-only mode (sale)');
    }

    // In atomic-only mode, this function cannot rebuild lines - direct writes are blocked.
    // Lines should always be created via je_create_atomic during initial JE creation.
    return { success: false, message: 'إعادة بناء السطور معطلة في وضع الذرية - استخدم je_create_atomic', linesCreated: 0 };
  } catch (error) {
    console.error('Error rebuilding journal entry lines:', error);
    return { success: false, message: 'حدث خطأ أثناء إعادة بناء السطور', linesCreated: 0 };
  }
}

/**
 * Get count of journal entry lines for a given entry
 */
export async function getJournalEntryLinesCount(entryId: string): Promise<number> {
  const { data, error } = await dataGateway.getJournalEntryLinesCount(entryId);
  
  if (error) {
    console.error('Error getting lines count:', error);
    return 0;
  }
  
  return data?.count || 0;
}

/**
 * Fix journal entry lines with NULL credit_amount by recalculating from source
 * This is used when lines were created but credit_amount was set to NULL
 */
export async function fixUnbalancedJournalEntry(entryId: string): Promise<{ success: boolean; message: string }> {
  try {
    // Fetch the journal entry with its lines
    const { data: entry, error: entryError } = await dataGateway.getJournalEntryWithLines(entryId);

    if (entryError || !entry) {
      return { success: false, message: 'القيد غير موجود' };
    }

    const lines = entry.journal_entry_lines || [];
    
    // Calculate current totals
    const totalDebit = lines.reduce((sum: number, line: any) => sum + (line.debit_amount || 0), 0);
    const totalCredit = lines.reduce((sum: number, line: any) => sum + (line.credit_amount || 0), 0);

    // If already balanced, no fix needed
    if (Math.abs(totalDebit - totalCredit) < 0.01) {
      return { success: true, message: 'القيد متوازن بالفعل' };
    }

    // Find lines that should be credit but have NULL or 0 credit_amount
    // These are typically payables lines (debit = 0, credit = NULL or 0)
    const unbalancedAmount = totalDebit - totalCredit;
    
    if (unbalancedAmount <= 0) {
      return { success: false, message: 'لا يمكن إصلاح هذا القيد تلقائياً - المدين أقل من الدائن' };
    }

    // Find the credit line that needs fixing (debit = 0 and credit is NULL or 0)
    const creditLineToFix = lines.find((line: any) => 
      (line.debit_amount === 0 || line.debit_amount === null) && 
      (line.credit_amount === null || line.credit_amount === 0)
    );

    if (!creditLineToFix) {
      // No existing line to fix, need to rebuild
      return { success: false, message: 'لا يوجد سطر دائن للإصلاح - يرجى استخدام إعادة البناء' };
    }

    // NOTE: Fixing unbalanced entries is disabled in atomic-only mode.
    // Journal entries should always be balanced at creation via je_create_atomic validation.
    console.warn('fixUnbalancedJournalEntry: Operation disabled in atomic-only mode - entries must be balanced at creation');
    return { success: false, message: 'إصلاح القيد معطل - القيود يجب أن تكون متوازنة عند الإنشاء عبر je_create_atomic' };
  } catch (error) {
    console.error('Error fixing unbalanced journal entry:', error);
    return { success: false, message: 'حدث خطأ أثناء إصلاح القيد' };
  }
}

/**
 * Check if a journal entry is balanced (total_debit = total_credit)
 */
export async function isJournalEntryBalanced(entryId: string): Promise<boolean> {
  const { data: lines, error } = await dataGateway.fetchTable('journal_entry_lines', { filters: { journal_entry_id: entryId } });

  if (error || !lines) return false;

  const totalDebit = lines.reduce((sum, line) => sum + (line.debit_amount || 0), 0);
  const totalCredit = lines.reduce((sum, line) => sum + (line.credit_amount || 0), 0);

  return Math.abs(totalDebit - totalCredit) < 0.01;
}

// Export ACCOUNT_CODES for external use
export { ACCOUNT_CODES, getAccountId };

/**
 * Create journal entry for inventory transfer between branches
 * This creates a balanced entry that:
 * - Debits target branch inventory account (adding inventory)
 * - Credits source branch inventory account (removing inventory)
 * 
 * ❌ NO sales, NO COGS, NO supplier impact
 * ✅ Pure inventory-to-inventory movement
 */
export async function createInventoryTransferJournalEntry(params: {
  transferId: string;
  sourceBranchId: string;
  targetBranchId: string;
  totalCost: number;
  purchaseInvoiceNumber?: string;
  notes?: string;
}): Promise<string | null> {
  const {
    transferId,
    sourceBranchId,
    targetBranchId,
    totalCost,
    purchaseInvoiceNumber,
    notes
  } = params;

  // Validate total cost
  if (!totalCost || totalCost <= 0) {
    console.warn('No cost to transfer, skipping journal entry creation');
    return null;
  }

  try {
    // Get inventory accounts for both branches
    const sourceInventoryAccountCode = await getBranchInventoryAccountCode(sourceBranchId);
    const targetInventoryAccountCode = await getBranchInventoryAccountCode(targetBranchId);

    if (!sourceInventoryAccountCode || !targetInventoryAccountCode) {
      throw new Error('حساب المخزون غير معرف لأحد الفروع');
    }

    // Validate accounts are not the general inventory account
    if (sourceInventoryAccountCode === '1103' || targetInventoryAccountCode === '1103') {
      throw new Error('ممنوع استخدام حساب المخزون العام (1103) في قيود النقل');
    }

    // Build description
    const description = purchaseInvoiceNumber
      ? `قيد نقل مخزون بين الفروع – فاتورة ${purchaseInvoiceNumber}`
      : `قيد نقل مخزون بين الفروع – نقل رقم ${transferId.slice(0, 8)}`;

    // Create balanced journal entry
    const lines: JournalEntryLine[] = [
      {
        accountCode: targetInventoryAccountCode,
        debit: totalCost,
        credit: 0,
        description: `إضافة مخزون من نقل داخلي${purchaseInvoiceNumber ? ` – فاتورة ${purchaseInvoiceNumber}` : ''}`,
      },
      {
        accountCode: sourceInventoryAccountCode,
        debit: 0,
        credit: totalCost,
        description: `خصم مخزون بسبب نقل داخلي${purchaseInvoiceNumber ? ` – فاتورة ${purchaseInvoiceNumber}` : ''}`,
      },
    ];

    // Create the journal entry
    const entryId = await createJournalEntry({
      description: notes || description,
      referenceType: 'manual', // Will be displayed as 'inventory_transfer' via reference_type override
      referenceId: transferId,
      lines,
      autoPost: true,
    });

    if (!entryId) {
      throw new Error('فشل إنشاء القيد المحاسبي');
    }

    // Successfully created via atomic RPC through createJournalEntry
    console.log(`Inventory transfer journal entry created: ${entryId}`);
    return entryId;
  } catch (error) {
    console.error('Error creating inventory transfer journal entry:', error);
    throw error;
  }
}
