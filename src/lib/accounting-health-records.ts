import * as dataGateway from '@/lib/dataGateway';
import type { HealthCheckIssue } from './accounting-health-checks';

// Types
export interface RecordFilters {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  customerId?: string;
  supplierId?: string;
  sortBy?: 'date' | 'amount' | 'number';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export type DocumentType = 
  | 'sales_invoice' 
  | 'purchase_invoice' 
  | 'customer_receipt' 
  | 'payment_voucher' 
  | 'purchase_return' 
  | 'sales_return'
  | 'journal_entry'
  | 'customer'
  | 'supplier';

export interface AffectedRecord {
  id: string;
  documentNumber: string;
  documentType: DocumentType;
  documentTypeLabel: string;
  customerOrSupplier: string | null;
  date: string;
  amount: number;
  status: string;
  statusLabel: string;
  linkPath: string;
  extraData?: Record<string, any>;
}

export interface FetchResult {
  records: AffectedRecord[];
  totalCount: number;
  totalPages: number;
  totalAmount: number;
}

// Document type labels
const documentTypeLabels: Record<DocumentType, string> = {
  sales_invoice: 'فاتورة مبيعات',
  purchase_invoice: 'فاتورة مشتريات',
  customer_receipt: 'سند قبض',
  payment_voucher: 'سند صرف',
  purchase_return: 'مرتجع مشتريات',
  sales_return: 'مرتجع مبيعات',
  journal_entry: 'قيد محاسبي',
  customer: 'عميل',
  supplier: 'مورد',
};

// Document links map
const documentLinks: Record<string, string> = {
  'SL001': '/accounting/invoices',
  'PY002': '/sales/customer-receipts',
  'PU001': '/purchasing/purchase-invoices',
  'JE001': '/accounting/journal-entries',
  'JE002': '/accounting/journal-entries',
  'BL001': '/customers',
  'BL002': '/suppliers',
  'RT001': '/purchasing/purchase-returns',
  'INV001': '/inventory/raw-materials',
};

// Get link path based on issue code and document type
function getLinkPath(issueCode: string, docType: DocumentType, id: string): string {
  const basePath = documentLinks[issueCode] || '/';
  
  switch (docType) {
    case 'sales_invoice':
      return `/accounting/invoices/${id}`;
    case 'purchase_invoice':
      return `/purchasing/purchase-invoices/${id}`;
    case 'customer_receipt':
      return `/sales/customer-receipts`;
    case 'journal_entry':
      return `/accounting/journal-entries`;
    case 'customer':
      return `/customers`;
    case 'supplier':
      return `/suppliers`;
    default:
      return basePath;
  }
}

// Main function to fetch affected records based on issue type
export async function fetchAffectedRecords(
  issue: HealthCheckIssue,
  filters: RecordFilters = {}
): Promise<FetchResult> {
  const { page = 1, pageSize = 10 } = filters;
  
  switch (issue.issueCode) {
    case 'SL001':
      return fetchSalesInvoicesWithoutJournal(filters);
    case 'PY002':
      return fetchReceiptsWithoutJournal(filters);
    case 'PU001':
      return fetchPurchasesWithoutJournal(filters);
    case 'JE001':
      return fetchUnbalancedJournalEntries(filters);
    case 'JE002':
      return fetchEmptyJournalEntries(filters);
    case 'BL001':
      return fetchCustomerBalanceDiscrepancies(filters);
    case 'BL002':
      return fetchSupplierBalanceDiscrepancies(filters);
    case 'RT001':
      return fetchPurchaseReturns(filters);
    default:
      // Fallback: use details from the issue itself
      return fetchFromIssueDetails(issue, filters);
  }
}

// Fetch sales invoices without journal entries
async function fetchSalesInvoicesWithoutJournal(filters: RecordFilters): Promise<FetchResult> {
  const { search, dateFrom, dateTo, page = 1, pageSize = 10, sortBy = 'date', sortOrder = 'desc' } = filters;
  
  const queryFilters: any[] = [
    { type: 'eq', column: 'invoice_type', value: 'sales' },
    { type: 'is', column: 'journal_entry_id', value: null },
  ];
  
  if (search) {
    queryFilters.push({ type: 'ilike', column: 'invoice_number', value: `%${search}%` });
  }
  if (dateFrom) {
    queryFilters.push({ type: 'gte', column: 'invoice_date', value: dateFrom });
  }
  if (dateTo) {
    queryFilters.push({ type: 'lte', column: 'invoice_date', value: dateTo });
  }
  
  const orderColumn = sortBy === 'amount' ? 'total_amount' : sortBy === 'number' ? 'invoice_number' : 'invoice_date';
  const from = (page - 1) * pageSize;
  
  const { data, count, error } = await dataGateway.queryTable('invoices', {
    select: `
      id,
      invoice_number,
      invoice_date,
      total_amount,
      status,
      customer_id,
      customers!invoices_customer_id_fkey(full_name)
    `,
    count: 'exact',
    filters: queryFilters,
    order: { column: orderColumn, ascending: sortOrder === 'asc' },
    range: { from, to: from + pageSize - 1 },
  });
  
  if (error) {
    console.error('Error fetching sales invoices:', error);
    return { records: [], totalCount: 0, totalPages: 0, totalAmount: 0 };
  }
  
  const records: AffectedRecord[] = ((data as any[]) || []).map(inv => ({
    id: inv.id,
    documentNumber: inv.invoice_number,
    documentType: 'sales_invoice' as DocumentType,
    documentTypeLabel: documentTypeLabels.sales_invoice,
    customerOrSupplier: (inv.customers as any)?.full_name || 'غير محدد',
    date: inv.invoice_date,
    amount: inv.total_amount || 0,
    status: inv.status || 'draft',
    statusLabel: getStatusLabel(inv.status),
    linkPath: `/accounting/invoices/${inv.id}`,
  }));
  
  // Get total amount
  const { data: totalData } = await dataGateway.queryTable('invoices', {
    select: 'total_amount',
    filters: [
      { type: 'eq', column: 'invoice_type', value: 'sales' },
      { type: 'is', column: 'journal_entry_id', value: null },
    ],
  });
  
  const totalAmount = ((totalData as any[]) || []).reduce((sum, inv) => sum + (inv.total_amount || 0), 0);
  
  return {
    records,
    totalCount: count || 0,
    totalPages: Math.ceil((count || 0) / pageSize),
    totalAmount,
  };
}

// Fetch customer receipts without journal entries
async function fetchReceiptsWithoutJournal(filters: RecordFilters): Promise<FetchResult> {
  const { search, dateFrom, dateTo, page = 1, pageSize = 10, sortBy = 'date', sortOrder = 'desc' } = filters;
  
  const queryFilters: any[] = [
    { type: 'is', column: 'journal_entry_id', value: null },
  ];
  
  if (search) {
    queryFilters.push({ type: 'ilike', column: 'receipt_number', value: `%${search}%` });
  }
  if (dateFrom) {
    queryFilters.push({ type: 'gte', column: 'receipt_date', value: dateFrom });
  }
  if (dateTo) {
    queryFilters.push({ type: 'lte', column: 'receipt_date', value: dateTo });
  }
  
  const orderColumn = sortBy === 'amount' ? 'amount' : sortBy === 'number' ? 'receipt_number' : 'receipt_date';
  const from = (page - 1) * pageSize;
  
  const { data, count, error } = await dataGateway.queryTable('customer_receipts', {
    select: `
      id,
      receipt_number,
      receipt_date,
      amount,
      status,
      payment_method,
      customer_id,
      customers!customer_receipts_customer_id_fkey(full_name)
    `,
    count: 'exact',
    filters: queryFilters,
    order: { column: orderColumn, ascending: sortOrder === 'asc' },
    range: { from, to: from + pageSize - 1 },
  });
  
  if (error) {
    console.error('Error fetching receipts:', error);
    return { records: [], totalCount: 0, totalPages: 0, totalAmount: 0 };
  }
  
  const records: AffectedRecord[] = ((data as any[]) || []).map(rec => ({
    id: rec.id,
    documentNumber: rec.receipt_number,
    documentType: 'customer_receipt' as DocumentType,
    documentTypeLabel: documentTypeLabels.customer_receipt,
    customerOrSupplier: (rec.customers as any)?.full_name || 'غير محدد',
    date: rec.receipt_date,
    amount: rec.amount || 0,
    status: rec.status || 'pending',
    statusLabel: getStatusLabel(rec.status),
    linkPath: `/sales/customer-receipts`,
    extraData: { paymentMethod: rec.payment_method },
  }));
  
  const { data: totalData } = await dataGateway.queryTable('customer_receipts', {
    select: 'amount',
    filters: [
      { type: 'is', column: 'journal_entry_id', value: null },
    ],
  });
  
  const totalAmount = ((totalData as any[]) || []).reduce((sum, rec) => sum + (rec.amount || 0), 0);
  
  return {
    records,
    totalCount: count || 0,
    totalPages: Math.ceil((count || 0) / pageSize),
    totalAmount,
  };
}

// Fetch purchase invoices without journal entries
async function fetchPurchasesWithoutJournal(filters: RecordFilters): Promise<FetchResult> {
  const { search, dateFrom, dateTo, page = 1, pageSize = 10, sortBy = 'date', sortOrder = 'desc' } = filters;
  
  const queryFilters: any[] = [
    { type: 'eq', column: 'invoice_type', value: 'purchase' },
    { type: 'is', column: 'journal_entry_id', value: null },
    { type: 'in', column: 'status', value: ['confirmed', 'partial'] },
  ];
  
  if (search) {
    queryFilters.push({ type: 'ilike', column: 'invoice_number', value: `%${search}%` });
  }
  if (dateFrom) {
    queryFilters.push({ type: 'gte', column: 'invoice_date', value: dateFrom });
  }
  if (dateTo) {
    queryFilters.push({ type: 'lte', column: 'invoice_date', value: dateTo });
  }
  
  const orderColumn = sortBy === 'amount' ? 'total_amount' : sortBy === 'number' ? 'invoice_number' : 'invoice_date';
  const from = (page - 1) * pageSize;
  
  const { data, count, error } = await dataGateway.queryTable('invoices', {
    select: `
      id,
      invoice_number,
      invoice_date,
      total_amount,
      status,
      supplier_id,
      suppliers!invoices_supplier_id_fkey(supplier_name)
    `,
    count: 'exact',
    filters: queryFilters,
    order: { column: orderColumn, ascending: sortOrder === 'asc' },
    range: { from, to: from + pageSize - 1 },
  });
  
  if (error) {
    console.error('Error fetching purchase invoices:', error);
    return { records: [], totalCount: 0, totalPages: 0, totalAmount: 0 };
  }
  
  const records: AffectedRecord[] = ((data as any[]) || []).map(inv => ({
    id: inv.id,
    documentNumber: inv.invoice_number,
    documentType: 'purchase_invoice' as DocumentType,
    documentTypeLabel: documentTypeLabels.purchase_invoice,
    customerOrSupplier: (inv.suppliers as any)?.supplier_name || 'غير محدد',
    date: inv.invoice_date,
    amount: inv.total_amount || 0,
    status: inv.status || 'draft',
    statusLabel: getStatusLabel(inv.status),
    linkPath: `/purchasing/purchase-invoices/${inv.id}`,
  }));
  
  const { data: totalData } = await dataGateway.queryTable('invoices', {
    select: 'total_amount',
    filters: [
      { type: 'eq', column: 'invoice_type', value: 'purchase' },
      { type: 'is', column: 'journal_entry_id', value: null },
      { type: 'in', column: 'status', value: ['confirmed', 'partial'] },
    ],
  });
  
  const totalAmount = ((totalData as any[]) || []).reduce((sum, inv) => sum + (inv.total_amount || 0), 0);
  
  return {
    records,
    totalCount: count || 0,
    totalPages: Math.ceil((count || 0) / pageSize),
    totalAmount,
  };
}

// Fetch unbalanced journal entries
async function fetchUnbalancedJournalEntries(filters: RecordFilters): Promise<FetchResult> {
  const { search, dateFrom, dateTo, page = 1, pageSize = 10, sortBy = 'date', sortOrder = 'desc' } = filters;
  
  const queryFilters: any[] = [];
  
  if (search) {
    queryFilters.push({ type: 'ilike', column: 'entry_number', value: `%${search}%` });
  }
  if (dateFrom) {
    queryFilters.push({ type: 'gte', column: 'entry_date', value: dateFrom });
  }
  if (dateTo) {
    queryFilters.push({ type: 'lte', column: 'entry_date', value: dateTo });
  }
  
  const { data: allData, error } = await dataGateway.queryTable('journal_entries', {
    select: 'id, entry_number, entry_date, total_debit, total_credit, description, is_posted',
    count: 'exact',
    filters: queryFilters,
  });
  
  if (error) {
    console.error('Error fetching journal entries:', error);
    return { records: [], totalCount: 0, totalPages: 0, totalAmount: 0 };
  }
  
  // Filter unbalanced entries
  const unbalanced = ((allData as any[]) || []).filter(e => 
    Math.abs((e.total_debit || 0) - (e.total_credit || 0)) > 0.01
  );
  
  // Sort
  unbalanced.sort((a, b) => {
    if (sortBy === 'amount') {
      const diffA = Math.abs((a.total_debit || 0) - (a.total_credit || 0));
      const diffB = Math.abs((b.total_debit || 0) - (b.total_credit || 0));
      return sortOrder === 'asc' ? diffA - diffB : diffB - diffA;
    }
    if (sortBy === 'number') {
      return sortOrder === 'asc' 
        ? a.entry_number.localeCompare(b.entry_number)
        : b.entry_number.localeCompare(a.entry_number);
    }
    return sortOrder === 'asc' 
      ? new Date(a.entry_date).getTime() - new Date(b.entry_date).getTime()
      : new Date(b.entry_date).getTime() - new Date(a.entry_date).getTime();
  });
  
  // Paginate
  const from = (page - 1) * pageSize;
  const paginated = unbalanced.slice(from, from + pageSize);
  
  const records: AffectedRecord[] = paginated.map(entry => ({
    id: entry.id,
    documentNumber: entry.entry_number,
    documentType: 'journal_entry' as DocumentType,
    documentTypeLabel: documentTypeLabels.journal_entry,
    customerOrSupplier: entry.description || null,
    date: entry.entry_date,
    amount: Math.abs((entry.total_debit || 0) - (entry.total_credit || 0)),
    status: entry.is_posted ? 'posted' : 'draft',
    statusLabel: getStatusLabel(entry.is_posted ? 'posted' : 'draft'),
    linkPath: `/accounting/journal-entries`,
    extraData: {
      debit: entry.total_debit,
      credit: entry.total_credit,
      difference: Math.abs((entry.total_debit || 0) - (entry.total_credit || 0)),
    },
  }));
  
  const totalAmount = unbalanced.reduce((sum, e) => 
    sum + Math.abs((e.total_debit || 0) - (e.total_credit || 0)), 0
  );
  
  return {
    records,
    totalCount: unbalanced.length,
    totalPages: Math.ceil(unbalanced.length / pageSize),
    totalAmount,
  };
}

// Fetch empty journal entries
async function fetchEmptyJournalEntries(filters: RecordFilters): Promise<FetchResult> {
  const { search, dateFrom, dateTo, page = 1, pageSize = 10, sortBy = 'date', sortOrder = 'desc' } = filters;
  
  const queryFilters: any[] = [];
  
  if (search) {
    queryFilters.push({ type: 'ilike', column: 'entry_number', value: `%${search}%` });
  }
  if (dateFrom) {
    queryFilters.push({ type: 'gte', column: 'entry_date', value: dateFrom });
  }
  if (dateTo) {
    queryFilters.push({ type: 'lte', column: 'entry_date', value: dateTo });
  }
  
  const { data, error } = await dataGateway.queryTable('journal_entries', {
    select: `
      id, entry_number, entry_date, description, is_posted,
      journal_entry_lines(id)
    `,
    filters: queryFilters,
  });
  
  if (error) {
    console.error('Error fetching journal entries:', error);
    return { records: [], totalCount: 0, totalPages: 0, totalAmount: 0 };
  }
  
  // Filter empty entries
  const emptyEntries = ((data as any[]) || []).filter(e => 
    !e.journal_entry_lines || e.journal_entry_lines.length === 0
  );
  
  // Sort
  emptyEntries.sort((a, b) => {
    if (sortBy === 'number') {
      return sortOrder === 'asc' 
        ? a.entry_number.localeCompare(b.entry_number)
        : b.entry_number.localeCompare(a.entry_number);
    }
    return sortOrder === 'asc' 
      ? new Date(a.entry_date).getTime() - new Date(b.entry_date).getTime()
      : new Date(b.entry_date).getTime() - new Date(a.entry_date).getTime();
  });
  
  // Paginate
  const from = (page - 1) * pageSize;
  const paginated = emptyEntries.slice(from, from + pageSize);
  
  const records: AffectedRecord[] = paginated.map(entry => ({
    id: entry.id,
    documentNumber: entry.entry_number,
    documentType: 'journal_entry' as DocumentType,
    documentTypeLabel: documentTypeLabels.journal_entry,
    customerOrSupplier: entry.description || null,
    date: entry.entry_date,
    amount: 0,
    status: entry.is_posted ? 'posted' : 'draft',
    statusLabel: getStatusLabel(entry.is_posted ? 'posted' : 'draft'),
    linkPath: `/accounting/journal-entries`,
  }));
  
  return {
    records,
    totalCount: emptyEntries.length,
    totalPages: Math.ceil(emptyEntries.length / pageSize),
    totalAmount: 0,
  };
}

// Fetch customer balance discrepancies
async function fetchCustomerBalanceDiscrepancies(filters: RecordFilters): Promise<FetchResult> {
  const { search, page = 1, pageSize = 10, sortBy = 'amount', sortOrder = 'desc' } = filters;
  
  const queryFilters: any[] = [];
  if (search) {
    queryFilters.push({ type: 'or', value: `customer_code.ilike.%${search}%,full_name.ilike.%${search}%` });
  }
  
  const { data: customers, error } = await dataGateway.queryTable('customers', {
    select: 'id, customer_code, full_name, total_purchases',
    filters: queryFilters,
  });
  
  if (error) {
    console.error('Error fetching customers:', error);
    return { records: [], totalCount: 0, totalPages: 0, totalAmount: 0 };
  }
  
  const balanceIssues: AffectedRecord[] = [];
  
  for (const customer of ((customers as any[]) || [])) {
    const { data: sales } = await dataGateway.queryTable('sales', {
      select: 'total_amount',
      filters: [{ type: 'eq', column: 'customer_id', value: customer.id }],
    });
    
    const { data: receipts } = await dataGateway.queryTable('customer_receipts', {
      select: 'amount',
      filters: [{ type: 'eq', column: 'customer_id', value: customer.id }],
    });
    
    const totalSales = ((sales as any[]) || []).reduce((sum, s) => sum + (s.total_amount || 0), 0);
    const totalReceipts = ((receipts as any[]) || []).reduce((sum, r) => sum + (r.amount || 0), 0);
    const calculatedBalance = totalSales - totalReceipts;
    const storedBalance = customer.total_purchases || 0;
    const difference = Math.abs(calculatedBalance - storedBalance);
    
    if (difference > 0.01) {
      balanceIssues.push({
        id: customer.id,
        documentNumber: customer.customer_code,
        documentType: 'customer' as DocumentType,
        documentTypeLabel: documentTypeLabels.customer,
        customerOrSupplier: customer.full_name,
        date: new Date().toISOString().split('T')[0],
        amount: difference,
        status: 'discrepancy',
        statusLabel: 'فرق في الرصيد',
        linkPath: `/customers`,
        extraData: {
          storedBalance,
          calculatedBalance,
          difference: calculatedBalance - storedBalance,
        },
      });
    }
  }
  
  // Sort
  balanceIssues.sort((a, b) => {
    return sortOrder === 'asc' ? a.amount - b.amount : b.amount - a.amount;
  });
  
  // Paginate
  const from = (page - 1) * pageSize;
  const paginated = balanceIssues.slice(from, from + pageSize);
  
  const totalAmount = balanceIssues.reduce((sum, b) => sum + b.amount, 0);
  
  return {
    records: paginated,
    totalCount: balanceIssues.length,
    totalPages: Math.ceil(balanceIssues.length / pageSize),
    totalAmount,
  };
}

// Fetch supplier balance discrepancies
async function fetchSupplierBalanceDiscrepancies(filters: RecordFilters): Promise<FetchResult> {
  const { search, page = 1, pageSize = 10, sortBy = 'amount', sortOrder = 'desc' } = filters;
  
  const queryFilters: any[] = [];
  if (search) {
    queryFilters.push({ type: 'or', value: `supplier_code.ilike.%${search}%,supplier_name.ilike.%${search}%` });
  }
  
  const { data: suppliers, error } = await dataGateway.queryTable('suppliers', {
    select: 'id, supplier_code, supplier_name, current_balance',
    filters: queryFilters,
  });
  
  if (error) {
    console.error('Error fetching suppliers:', error);
    return { records: [], totalCount: 0, totalPages: 0, totalAmount: 0 };
  }
  
  const balanceIssues: AffectedRecord[] = [];
  
  for (const supplier of ((suppliers as any[]) || []).slice(0, 50)) {
    const { data: invoices } = await dataGateway.queryTable('invoices', {
      select: 'total_amount',
      filters: [
        { type: 'eq', column: 'supplier_id', value: supplier.id },
        { type: 'eq', column: 'invoice_type', value: 'purchase' },
        { type: 'in', column: 'status', value: ['confirmed', 'partial'] },
      ],
    });
    
    const totalInvoices = ((invoices as any[]) || []).reduce((sum, i) => sum + (i.total_amount || 0), 0);
    const storedBalance = supplier.current_balance || 0;
    const difference = Math.abs(totalInvoices - storedBalance);
    
    if (difference > 100) {
      balanceIssues.push({
        id: supplier.id,
        documentNumber: supplier.supplier_code,
        documentType: 'supplier' as DocumentType,
        documentTypeLabel: documentTypeLabels.supplier,
        customerOrSupplier: supplier.supplier_name,
        date: new Date().toISOString().split('T')[0],
        amount: difference,
        status: 'discrepancy',
        statusLabel: 'فرق في الرصيد',
        linkPath: `/suppliers`,
        extraData: {
          storedBalance,
          calculatedBalance: totalInvoices,
          difference: totalInvoices - storedBalance,
        },
      });
    }
  }
  
  // Sort
  balanceIssues.sort((a, b) => {
    return sortOrder === 'asc' ? a.amount - b.amount : b.amount - a.amount;
  });
  
  // Paginate
  const from = (page - 1) * pageSize;
  const paginated = balanceIssues.slice(from, from + pageSize);
  
  const totalAmount = balanceIssues.reduce((sum, b) => sum + b.amount, 0);
  
  return {
    records: paginated,
    totalCount: balanceIssues.length,
    totalPages: Math.ceil(balanceIssues.length / pageSize),
    totalAmount,
  };
}

// Fetch purchase returns
async function fetchPurchaseReturns(filters: RecordFilters): Promise<FetchResult> {
  const { search, dateFrom, dateTo, page = 1, pageSize = 10, sortBy = 'date', sortOrder = 'desc' } = filters;
  
  const queryFilters: any[] = [
    { type: 'eq', column: 'invoice_type', value: 'purchase_return' },
  ];
  
  if (search) {
    queryFilters.push({ type: 'ilike', column: 'invoice_number', value: `%${search}%` });
  }
  if (dateFrom) {
    queryFilters.push({ type: 'gte', column: 'invoice_date', value: dateFrom });
  }
  if (dateTo) {
    queryFilters.push({ type: 'lte', column: 'invoice_date', value: dateTo });
  }
  
  const orderColumn = sortBy === 'amount' ? 'total_amount' : sortBy === 'number' ? 'invoice_number' : 'invoice_date';
  const from = (page - 1) * pageSize;
  
  const { data, count, error } = await dataGateway.queryTable('invoices', {
    select: `
      id,
      invoice_number,
      invoice_date,
      total_amount,
      status,
      supplier_id,
      suppliers!invoices_supplier_id_fkey(supplier_name)
    `,
    count: 'exact',
    filters: queryFilters,
    order: { column: orderColumn, ascending: sortOrder === 'asc' },
    range: { from, to: from + pageSize - 1 },
  });
  
  if (error) {
    console.error('Error fetching purchase returns:', error);
    return { records: [], totalCount: 0, totalPages: 0, totalAmount: 0 };
  }
  
  const records: AffectedRecord[] = ((data as any[]) || []).map(inv => ({
    id: inv.id,
    documentNumber: inv.invoice_number,
    documentType: 'purchase_return' as DocumentType,
    documentTypeLabel: documentTypeLabels.purchase_return,
    customerOrSupplier: (inv.suppliers as any)?.supplier_name || 'غير محدد',
    date: inv.invoice_date,
    amount: inv.total_amount || 0,
    status: inv.status || 'draft',
    statusLabel: getStatusLabel(inv.status),
    linkPath: `/purchasing/purchase-returns`,
  }));
  
  const { data: totalData } = await dataGateway.queryTable('invoices', {
    select: 'total_amount',
    filters: [
      { type: 'eq', column: 'invoice_type', value: 'purchase_return' },
    ],
  });
  
  const totalAmount = ((totalData as any[]) || []).reduce((sum, inv) => sum + (inv.total_amount || 0), 0);
  
  return {
    records,
    totalCount: count || 0,
    totalPages: Math.ceil((count || 0) / pageSize),
    totalAmount,
  };
}

// Fallback: fetch from issue details
async function fetchFromIssueDetails(issue: HealthCheckIssue, filters: RecordFilters): Promise<FetchResult> {
  const { page = 1, pageSize = 10, sortOrder = 'desc' } = filters;
  
  const details = issue.details || [];
  const from = (page - 1) * pageSize;
  const paginated = details.slice(from, from + pageSize);
  
  const records: AffectedRecord[] = paginated.map((detail: any, idx: number) => ({
    id: detail.id || `${issue.id}-${idx}`,
    documentNumber: detail.invoiceNumber || detail.entryNumber || detail.receiptNumber || detail.code || '-',
    documentType: 'journal_entry' as DocumentType,
    documentTypeLabel: 'سجل',
    customerOrSupplier: detail.name || detail.description || null,
    date: detail.date || new Date().toISOString().split('T')[0],
    amount: detail.amount || detail.difference || 0,
    status: 'pending',
    statusLabel: 'معلق',
    linkPath: '#',
  }));
  
  return {
    records,
    totalCount: details.length,
    totalPages: Math.ceil(details.length / pageSize),
    totalAmount: issue.affectedAmount || 0,
  };
}

// Helper: Get status label in Arabic
function getStatusLabel(status: string | null): string {
  const statusLabels: Record<string, string> = {
    draft: 'مسودة',
    pending: 'معلق',
    confirmed: 'مؤكد',
    posted: 'مرحّل',
    paid: 'مدفوع',
    partial: 'مدفوع جزئياً',
    cancelled: 'ملغى',
    completed: 'مكتمل',
    discrepancy: 'فرق',
  };
  return statusLabels[status || 'pending'] || status || 'غير محدد';
}

// Export to Excel
export function exportToExcel(records: AffectedRecord[], issueTitle: string): void {
  import('xlsx').then(XLSX => {
    const data = records.map(r => ({
      'رقم المستند': r.documentNumber,
      'نوع المستند': r.documentTypeLabel,
      'العميل/المورد': r.customerOrSupplier || '-',
      'التاريخ': r.date,
      'المبلغ': r.amount,
      'الحالة': r.statusLabel,
    }));
    
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'السجلات');
    
    const fileName = `${issueTitle.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);
  });
}

// Export to PDF
export function exportToPDF(records: AffectedRecord[], issueTitle: string, summary: { totalRecords: number; totalAmount: number }): void {
  import('jspdf').then(({ jsPDF }) => {
    import('jspdf-autotable').then(({ default: autoTable }) => {
      const doc = new jsPDF({ orientation: 'landscape' });
      
      // Title
      doc.setFontSize(16);
      doc.text(issueTitle, doc.internal.pageSize.width / 2, 20, { align: 'center' });
      
      // Summary
      doc.setFontSize(12);
      doc.text(`عدد السجلات: ${summary.totalRecords}`, doc.internal.pageSize.width - 20, 30, { align: 'right' });
      doc.text(`إجمالي المبلغ: ${summary.totalAmount.toLocaleString('ar-SA')} ر.س`, doc.internal.pageSize.width - 20, 38, { align: 'right' });
      
      // Table
      const tableData = records.map(r => [
        r.statusLabel,
        r.amount.toLocaleString('ar-SA'),
        r.date,
        r.customerOrSupplier || '-',
        r.documentTypeLabel,
        r.documentNumber,
      ]);
      
      autoTable(doc, {
        head: [['الحالة', 'المبلغ', 'التاريخ', 'العميل/المورد', 'نوع المستند', 'رقم المستند']],
        body: tableData,
        startY: 45,
        styles: { halign: 'right', font: 'helvetica' },
        headStyles: { fillColor: [41, 128, 185] },
      });
      
      const fileName = `${issueTitle.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
      doc.save(fileName);
    });
  });
}
