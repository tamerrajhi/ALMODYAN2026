import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface SeedResult {
  success: boolean
  message: string
  stats: {
    deletedInvoices: number
    deletedJournalEntries: number
    deletedPayments: number
    createdSalesInvoices: number
    createdPurchaseInvoices: number
    createdReturns: number
    createdReceipts: number
    createdPaymentVouchers: number
    createdJournalEntries: number
  }
  errors: string[]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    const result: SeedResult = {
      success: false,
      message: '',
      stats: {
        deletedInvoices: 0,
        deletedJournalEntries: 0,
        deletedPayments: 0,
        createdSalesInvoices: 0,
        createdPurchaseInvoices: 0,
        createdReturns: 0,
        createdReceipts: 0,
        createdPaymentVouchers: 0,
        createdJournalEntries: 0,
      },
      errors: []
    }

    console.log('🧹 Starting data cleanup...')

    // Step 1: Delete all related data in correct order (FK constraints)
    
    // Delete accounting health check data
    await supabase.from('accounting_health_check_results').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    await supabase.from('accounting_health_check_runs').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    await supabase.from('accounting_audit_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    console.log('✓ Deleted health check data')

    // Delete credit notes
    await supabase.from('credit_note_items').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    await supabase.from('credit_notes').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    console.log('✓ Deleted credit notes')

    // Delete customer receipts
    const { data: receiptsDeleted } = await supabase.from('customer_receipts').delete().neq('id', '00000000-0000-0000-0000-000000000000').select('id')
    result.stats.deletedPayments += receiptsDeleted?.length || 0
    console.log('✓ Deleted customer receipts')

    // Delete payments
    const { data: paymentsDeleted } = await supabase.from('payments').delete().neq('id', '00000000-0000-0000-0000-000000000000').select('id')
    result.stats.deletedPayments += paymentsDeleted?.length || 0
    console.log('✓ Deleted payments')

    // Delete purchase returns
    await supabase.from('purchase_returns').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    console.log('✓ Deleted purchase returns')

    // Delete sales return items and returns
    await supabase.from('return_items').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    await supabase.from('returns').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    console.log('✓ Deleted sales returns')

    // Delete sale items
    await supabase.from('sale_items').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    console.log('✓ Deleted sale items')

    // Delete sales
    await supabase.from('sales').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    console.log('✓ Deleted sales')

    // Delete invoice lines
    await supabase.from('purchase_invoice_lines').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    console.log('✓ Deleted invoice lines')

    // Delete invoices
    const { data: invoicesDeleted } = await supabase.from('invoices').delete().neq('id', '00000000-0000-0000-0000-000000000000').select('id')
    result.stats.deletedInvoices = invoicesDeleted?.length || 0
    console.log('✓ Deleted invoices')

    // Delete journal entry lines first, then entries
    await supabase.from('journal_entry_lines').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    const { data: jeDeleted } = await supabase.from('journal_entries').delete().neq('id', '00000000-0000-0000-0000-000000000000').select('id')
    result.stats.deletedJournalEntries = jeDeleted?.length || 0
    console.log('✓ Deleted journal entries')

    // Delete vault transactions
    await supabase.from('cash_vault_transactions').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    await supabase.from('gold_vault_transactions').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    console.log('✓ Deleted vault transactions')

    // Delete item movements
    await supabase.from('item_movements').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    console.log('✓ Deleted item movements')

    // Reset customer balances
    await supabase.from('customers').update({ total_purchases: 0, loyalty_points: 0 }).neq('id', '00000000-0000-0000-0000-000000000000')
    console.log('✓ Reset customer balances')

    // Reset supplier balances
    await supabase.from('suppliers').update({ current_balance: 0 }).neq('id', '00000000-0000-0000-0000-000000000000')
    console.log('✓ Reset supplier balances')

    // Reset account balances
    await supabase.from('chart_of_accounts').update({ current_balance: 0 }).neq('id', '00000000-0000-0000-0000-000000000000')
    console.log('✓ Reset account balances')

    console.log('🌱 Starting test data creation...')

    // Get customers
    const { data: customers } = await supabase.from('customers').select('id, full_name').limit(4)
    if (!customers || customers.length === 0) {
      result.errors.push('No customers found')
      throw new Error('No customers found')
    }
    console.log(`✓ Found ${customers.length} customers`)

    // Get suppliers
    const { data: suppliers } = await supabase.from('suppliers').select('id, supplier_name').limit(5)
    if (!suppliers || suppliers.length === 0) {
      result.errors.push('No suppliers found')
      throw new Error('No suppliers found')
    }
    console.log(`✓ Found ${suppliers.length} suppliers`)

    // Get a branch
    const { data: branches } = await supabase.from('branches').select('id, branch_code').limit(1)
    const branchId = branches?.[0]?.id
    const branchCode = branches?.[0]?.branch_code
    if (!branchId) {
      result.errors.push('No branches found')
      throw new Error('No branches found')
    }
    console.log(`✓ Using branch: ${branchCode}`)

    // Get chart of accounts
    const { data: accounts } = await supabase.from('chart_of_accounts').select('id, account_code, account_name')
    const getAccountId = (code: string) => accounts?.find(a => a.account_code === code)?.id
    
    const cashAccountId = getAccountId('1101')
    const receivablesAccountId = getAccountId('1201')
    const payablesAccountId = getAccountId('2101')
    const salesRevenueAccountId = getAccountId('4101')
    const purchasesAccountId = getAccountId('5101')
    const vatOutputAccountId = getAccountId('2105')
    const vatInputAccountId = getAccountId('1108')

    console.log('✓ Got account IDs')

    // Helper to generate invoice number
    const generateInvoiceNumber = (type: string, index: number) => {
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      return `INV-${type}-${date}-${String(index).padStart(4, '0')}`
    }

    // Helper to generate JE number
    const generateJENumber = (index: number) => {
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      return `JE-${date}-${String(index).padStart(4, '0')}`
    }

    let jeIndex = 1

    // Create sales invoices (10)
    const salesInvoicesData = [
      { customer: 0, amount: 5000, tax: 750, status: 'paid', paymentMethod: 'cash' },
      { customer: 1, amount: 3500, tax: 525, status: 'paid', paymentMethod: 'card' },
      { customer: 2, amount: 8000, tax: 1200, status: 'partially_paid', paidAmount: 4000, paymentMethod: 'cash' },
      { customer: 0, amount: 12000, tax: 1800, status: 'partially_paid', paidAmount: 3600, paymentMethod: 'bank_transfer' },
      { customer: 1, amount: 2500, tax: 375, status: 'pending', paymentMethod: null },
      { customer: 2, amount: 6000, tax: 900, status: 'pending', paymentMethod: null },
      { customer: 0, amount: 1500, tax: 0, status: 'paid', paymentMethod: 'cash' },
      { customer: 1, amount: 4200, tax: 0, status: 'paid', paymentMethod: 'card' },
      { customer: 2, amount: 9500, tax: 1425, status: 'partially_paid', paidAmount: 5000, paymentMethod: 'cash' },
      { customer: 0, amount: 7300, tax: 0, status: 'pending', paymentMethod: null },
    ]

    const createdSalesInvoices: any[] = []

    for (let i = 0; i < salesInvoicesData.length; i++) {
      const data = salesInvoicesData[i]
      const customer = customers[data.customer % customers.length]
      const totalAmount = data.amount + data.tax
      const paidAmount = data.status === 'paid' ? totalAmount : (data.paidAmount || 0)

      const invoiceNumber = generateInvoiceNumber('S', i + 1)
      
      // Create invoice
      const { data: invoice, error: invoiceError } = await supabase.from('invoices').insert({
        invoice_number: invoiceNumber,
        invoice_type: 'sales',
        customer_id: customer.id,
        branch_id: branchId,
        invoice_date: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        subtotal: data.amount,
        tax_amount: data.tax,
        total_amount: totalAmount,
        paid_amount: paidAmount,
        remaining_amount: totalAmount - paidAmount,
        status: data.status,
        payment_method: data.paymentMethod,
        notes: `فاتورة مبيعات اختبارية #${i + 1}`,
      }).select().single()

      if (invoiceError) {
        console.error(`Error creating sales invoice ${i + 1}:`, invoiceError)
        result.errors.push(`Failed to create sales invoice ${i + 1}: ${invoiceError.message}`)
        continue
      }

      createdSalesInvoices.push(invoice)
      result.stats.createdSalesInvoices++

      // Create journal entry for the invoice
      const jeNumber = generateJENumber(jeIndex++)
      const { data: journalEntry, error: jeError } = await supabase.from('journal_entries').insert({
        entry_number: jeNumber,
        entry_date: invoice.invoice_date,
        description: `قيد فاتورة مبيعات ${invoiceNumber}`,
        reference_type: 'sales_invoice',
        reference_id: invoice.id,
        total_debit: totalAmount,
        total_credit: totalAmount,
        status: 'posted',
        is_auto_generated: true,
      }).select().single()

      if (!jeError && journalEntry) {
        // Debit: Receivables or Cash
        const debitAccountId = data.status === 'paid' ? cashAccountId : receivablesAccountId
        await supabase.from('journal_entry_lines').insert([
          {
            entry_id: journalEntry.id,
            account_id: debitAccountId,
            debit_amount: totalAmount,
            credit_amount: 0,
            description: `مدين - ${data.status === 'paid' ? 'نقدية' : 'ذمم عملاء'}`
          },
          {
            entry_id: journalEntry.id,
            account_id: salesRevenueAccountId,
            debit_amount: 0,
            credit_amount: data.amount,
            description: 'دائن - إيرادات مبيعات'
          },
          ...(data.tax > 0 ? [{
            entry_id: journalEntry.id,
            account_id: vatOutputAccountId,
            debit_amount: 0,
            credit_amount: data.tax,
            description: 'دائن - ضريبة مخرجات'
          }] : [])
        ])

        // Update invoice with journal entry
        await supabase.from('invoices').update({ journal_entry_id: journalEntry.id }).eq('id', invoice.id)
        result.stats.createdJournalEntries++
      }

      console.log(`✓ Created sales invoice ${i + 1}: ${invoiceNumber}`)
    }

    // Create purchase invoices (8)
    const purchaseInvoicesData = [
      { supplier: 0, amount: 15000, tax: 2250, status: 'paid' },
      { supplier: 1, amount: 8500, tax: 1275, status: 'paid' },
      { supplier: 2, amount: 22000, tax: 3300, status: 'partially_paid', paidAmount: 11000 },
      { supplier: 0, amount: 5000, tax: 0, status: 'pending' },
      { supplier: 3, amount: 3200, tax: 0, status: 'paid' },
      { supplier: 1, amount: 11000, tax: 1650, status: 'partially_paid', paidAmount: 5500 },
      { supplier: 2, amount: 7800, tax: 1170, status: 'pending' },
      { supplier: 0, amount: 4500, tax: 675, status: 'paid' },
    ]

    const createdPurchaseInvoices: any[] = []

    for (let i = 0; i < purchaseInvoicesData.length; i++) {
      const data = purchaseInvoicesData[i]
      const supplier = suppliers[data.supplier % suppliers.length]
      const totalAmount = data.amount + data.tax
      const paidAmount = data.status === 'paid' ? totalAmount : (data.paidAmount || 0)

      const invoiceNumber = generateInvoiceNumber('P', i + 1)
      
      const { data: invoice, error: invoiceError } = await supabase.from('invoices').insert({
        invoice_number: invoiceNumber,
        invoice_type: 'purchase',
        supplier_id: supplier.id,
        branch_id: branchId,
        invoice_date: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        subtotal: data.amount,
        tax_amount: data.tax,
        total_amount: totalAmount,
        paid_amount: paidAmount,
        remaining_amount: totalAmount - paidAmount,
        status: data.status,
        notes: `فاتورة مشتريات اختبارية #${i + 1}`,
      }).select().single()

      if (invoiceError) {
        console.error(`Error creating purchase invoice ${i + 1}:`, invoiceError)
        result.errors.push(`Failed to create purchase invoice ${i + 1}: ${invoiceError.message}`)
        continue
      }

      createdPurchaseInvoices.push(invoice)
      result.stats.createdPurchaseInvoices++

      // Create journal entry
      const jeNumber = generateJENumber(jeIndex++)
      const { data: journalEntry, error: jeError } = await supabase.from('journal_entries').insert({
        entry_number: jeNumber,
        entry_date: invoice.invoice_date,
        description: `قيد فاتورة مشتريات ${invoiceNumber}`,
        reference_type: 'purchase_invoice',
        reference_id: invoice.id,
        total_debit: totalAmount,
        total_credit: totalAmount,
        status: 'posted',
        is_auto_generated: true,
      }).select().single()

      if (!jeError && journalEntry) {
        await supabase.from('journal_entry_lines').insert([
          {
            entry_id: journalEntry.id,
            account_id: purchasesAccountId,
            debit_amount: data.amount,
            credit_amount: 0,
            description: 'مدين - مشتريات'
          },
          ...(data.tax > 0 ? [{
            entry_id: journalEntry.id,
            account_id: vatInputAccountId,
            debit_amount: data.tax,
            credit_amount: 0,
            description: 'مدين - ضريبة مدخلات'
          }] : []),
          {
            entry_id: journalEntry.id,
            account_id: data.status === 'paid' ? cashAccountId : payablesAccountId,
            debit_amount: 0,
            credit_amount: totalAmount,
            description: `دائن - ${data.status === 'paid' ? 'نقدية' : 'ذمم موردين'}`
          },
        ])

        await supabase.from('invoices').update({ journal_entry_id: journalEntry.id }).eq('id', invoice.id)
        result.stats.createdJournalEntries++
      }

      console.log(`✓ Created purchase invoice ${i + 1}: ${invoiceNumber}`)
    }

    // Create sales returns (3)
    const salesReturnsData = [
      { invoiceIndex: 0, amount: 1000, tax: 150 },
      { invoiceIndex: 2, amount: 2500, tax: 375 },
      { invoiceIndex: 6, amount: 500, tax: 0 },
    ]

    for (let i = 0; i < salesReturnsData.length; i++) {
      const data = salesReturnsData[i]
      const originalInvoice = createdSalesInvoices[data.invoiceIndex]
      if (!originalInvoice) continue

      const totalAmount = data.amount + data.tax
      const returnNumber = generateInvoiceNumber('SR', i + 1)

      const { data: returnInvoice, error: returnError } = await supabase.from('invoices').insert({
        invoice_number: returnNumber,
        invoice_type: 'sales_return',
        customer_id: originalInvoice.customer_id,
        branch_id: branchId,
        linked_invoice_id: originalInvoice.id,
        invoice_date: new Date().toISOString().slice(0, 10),
        subtotal: data.amount,
        tax_amount: data.tax,
        total_amount: totalAmount,
        paid_amount: 0,
        remaining_amount: totalAmount,
        status: 'completed',
        notes: `مرتجع مبيعات من فاتورة ${originalInvoice.invoice_number}`,
      }).select().single()

      if (!returnError && returnInvoice) {
        result.stats.createdReturns++

        // Create journal entry
        const jeNumber = generateJENumber(jeIndex++)
        const { data: journalEntry } = await supabase.from('journal_entries').insert({
          entry_number: jeNumber,
          entry_date: returnInvoice.invoice_date,
          description: `قيد مرتجع مبيعات ${returnNumber}`,
          reference_type: 'sales_return',
          reference_id: returnInvoice.id,
          total_debit: totalAmount,
          total_credit: totalAmount,
          status: 'posted',
          is_auto_generated: true,
        }).select().single()

        if (journalEntry) {
          await supabase.from('journal_entry_lines').insert([
            {
              entry_id: journalEntry.id,
              account_id: salesRevenueAccountId,
              debit_amount: data.amount,
              credit_amount: 0,
              description: 'مدين - مردودات مبيعات'
            },
            ...(data.tax > 0 ? [{
              entry_id: journalEntry.id,
              account_id: vatOutputAccountId,
              debit_amount: data.tax,
              credit_amount: 0,
              description: 'مدين - عكس ضريبة مخرجات'
            }] : []),
            {
              entry_id: journalEntry.id,
              account_id: receivablesAccountId,
              debit_amount: 0,
              credit_amount: totalAmount,
              description: 'دائن - ذمم عملاء'
            },
          ])
          result.stats.createdJournalEntries++
        }

        console.log(`✓ Created sales return ${i + 1}: ${returnNumber}`)
      }
    }

    // Create purchase returns (3)
    const purchaseReturnsData = [
      { invoiceIndex: 0, amount: 3000, tax: 450 },
      { invoiceIndex: 1, amount: 1500, tax: 225 },
      { invoiceIndex: 4, amount: 800, tax: 0 },
    ]

    for (let i = 0; i < purchaseReturnsData.length; i++) {
      const data = purchaseReturnsData[i]
      const originalInvoice = createdPurchaseInvoices[data.invoiceIndex]
      if (!originalInvoice) continue

      const totalAmount = data.amount + data.tax
      const returnNumber = generateInvoiceNumber('PR', i + 1)

      const { data: returnInvoice, error: returnError } = await supabase.from('invoices').insert({
        invoice_number: returnNumber,
        invoice_type: 'purchase_return',
        supplier_id: originalInvoice.supplier_id,
        branch_id: branchId,
        linked_invoice_id: originalInvoice.id,
        invoice_date: new Date().toISOString().slice(0, 10),
        subtotal: data.amount,
        tax_amount: data.tax,
        total_amount: totalAmount,
        paid_amount: 0,
        remaining_amount: totalAmount,
        status: 'completed',
        notes: `مرتجع مشتريات من فاتورة ${originalInvoice.invoice_number}`,
      }).select().single()

      if (!returnError && returnInvoice) {
        result.stats.createdReturns++

        // Create journal entry
        const jeNumber = generateJENumber(jeIndex++)
        const { data: journalEntry } = await supabase.from('journal_entries').insert({
          entry_number: jeNumber,
          entry_date: returnInvoice.invoice_date,
          description: `قيد مرتجع مشتريات ${returnNumber}`,
          reference_type: 'purchase_return',
          reference_id: returnInvoice.id,
          total_debit: totalAmount,
          total_credit: totalAmount,
          status: 'posted',
          is_auto_generated: true,
        }).select().single()

        if (journalEntry) {
          await supabase.from('journal_entry_lines').insert([
            {
              entry_id: journalEntry.id,
              account_id: payablesAccountId,
              debit_amount: totalAmount,
              credit_amount: 0,
              description: 'مدين - ذمم موردين'
            },
            {
              entry_id: journalEntry.id,
              account_id: purchasesAccountId,
              debit_amount: 0,
              credit_amount: data.amount,
              description: 'دائن - مردودات مشتريات'
            },
            ...(data.tax > 0 ? [{
              entry_id: journalEntry.id,
              account_id: vatInputAccountId,
              debit_amount: 0,
              credit_amount: data.tax,
              description: 'دائن - عكس ضريبة مدخلات'
            }] : []),
          ])
          result.stats.createdJournalEntries++
        }

        console.log(`✓ Created purchase return ${i + 1}: ${returnNumber}`)
      }
    }

    // Create customer receipts (5)
    const customerReceiptsData = [
      { invoiceIndex: 0, amount: 5750 }, // Full payment for invoice 1
      { invoiceIndex: 1, amount: 4025 }, // Full payment for invoice 2
      { invoiceIndex: 2, amount: 4000 }, // Partial for invoice 3
      { invoiceIndex: 3, amount: 3600 }, // Partial for invoice 4
      { invoiceIndex: 6, amount: 1500 }, // Full for invoice 7
    ]

    for (let i = 0; i < customerReceiptsData.length; i++) {
      const data = customerReceiptsData[i]
      const invoice = createdSalesInvoices[data.invoiceIndex]
      if (!invoice) continue

      const receiptNumber = `REC${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${String(i + 1).padStart(4, '0')}`

      const { data: receipt, error: receiptError } = await supabase.from('customer_receipts').insert({
        receipt_number: receiptNumber,
        customer_id: invoice.customer_id,
        invoice_id: invoice.id,
        branch_id: branchId,
        amount: data.amount,
        payment_method: ['cash', 'card', 'bank_transfer'][i % 3],
        receipt_date: new Date().toISOString().slice(0, 10),
        status: 'completed',
        notes: `سند قبض من عميل - فاتورة ${invoice.invoice_number}`,
      }).select().single()

      if (!receiptError && receipt) {
        result.stats.createdReceipts++

        // Create journal entry
        const jeNumber = generateJENumber(jeIndex++)
        const { data: journalEntry } = await supabase.from('journal_entries').insert({
          entry_number: jeNumber,
          entry_date: receipt.receipt_date,
          description: `قيد سند قبض ${receiptNumber}`,
          reference_type: 'receipt',
          reference_id: receipt.id,
          total_debit: data.amount,
          total_credit: data.amount,
          status: 'posted',
          is_auto_generated: true,
        }).select().single()

        if (journalEntry) {
          await supabase.from('journal_entry_lines').insert([
            {
              entry_id: journalEntry.id,
              account_id: cashAccountId,
              debit_amount: data.amount,
              credit_amount: 0,
              description: 'مدين - نقدية'
            },
            {
              entry_id: journalEntry.id,
              account_id: receivablesAccountId,
              debit_amount: 0,
              credit_amount: data.amount,
              description: 'دائن - ذمم عملاء'
            },
          ])

          await supabase.from('customer_receipts').update({ journal_entry_id: journalEntry.id }).eq('id', receipt.id)
          result.stats.createdJournalEntries++
        }

        console.log(`✓ Created customer receipt ${i + 1}: ${receiptNumber}`)
      }
    }

    // Create payment vouchers (5)
    const paymentVouchersData = [
      { invoiceIndex: 0, amount: 17250 }, // Full payment
      { invoiceIndex: 1, amount: 9775 },  // Full payment
      { invoiceIndex: 2, amount: 11000 }, // Partial
      { invoiceIndex: 4, amount: 3200 },  // Full
      { invoiceIndex: 7, amount: 5175 },  // Full
    ]

    for (let i = 0; i < paymentVouchersData.length; i++) {
      const data = paymentVouchersData[i]
      const invoice = createdPurchaseInvoices[data.invoiceIndex]
      if (!invoice) continue

      const paymentNumber = `PAY${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${String(i + 1).padStart(4, '0')}`

      const { data: payment, error: paymentError } = await supabase.from('payments').insert({
        payment_number: paymentNumber,
        payment_type: 'payment',
        supplier_id: invoice.supplier_id,
        invoice_id: invoice.id,
        amount: data.amount,
        payment_method: ['cash', 'bank_transfer', 'check'][i % 3],
        payment_date: new Date().toISOString().slice(0, 10),
        status: 'completed',
        notes: `سند صرف لمورد - فاتورة ${invoice.invoice_number}`,
      }).select().single()

      if (!paymentError && payment) {
        result.stats.createdPaymentVouchers++

        // Create journal entry
        const jeNumber = generateJENumber(jeIndex++)
        const { data: journalEntry } = await supabase.from('journal_entries').insert({
          entry_number: jeNumber,
          entry_date: payment.payment_date,
          description: `قيد سند صرف ${paymentNumber}`,
          reference_type: 'payment',
          reference_id: payment.id,
          total_debit: data.amount,
          total_credit: data.amount,
          status: 'posted',
          is_auto_generated: true,
        }).select().single()

        if (journalEntry) {
          await supabase.from('journal_entry_lines').insert([
            {
              entry_id: journalEntry.id,
              account_id: payablesAccountId,
              debit_amount: data.amount,
              credit_amount: 0,
              description: 'مدين - ذمم موردين'
            },
            {
              entry_id: journalEntry.id,
              account_id: cashAccountId,
              debit_amount: 0,
              credit_amount: data.amount,
              description: 'دائن - نقدية'
            },
          ])

          await supabase.from('payments').update({ journal_entry_id: journalEntry.id }).eq('id', payment.id)
          result.stats.createdJournalEntries++
        }

        console.log(`✓ Created payment voucher ${i + 1}: ${paymentNumber}`)
      }
    }

    // Update account balances based on journal entries
    console.log('📊 Updating account balances...')
    
    const { data: allJELines } = await supabase
      .from('journal_entry_lines')
      .select('account_id, debit_amount, credit_amount')

    if (allJELines) {
      const balances: Record<string, number> = {}
      for (const line of allJELines) {
        if (!balances[line.account_id]) balances[line.account_id] = 0
        balances[line.account_id] += (line.debit_amount || 0) - (line.credit_amount || 0)
      }

      for (const [accountId, balance] of Object.entries(balances)) {
        await supabase.from('chart_of_accounts')
          .update({ current_balance: balance })
          .eq('id', accountId)
      }
      console.log('✓ Updated account balances')
    }

    result.success = true
    result.message = 'تم تهيئة بيانات الاختبار بنجاح'

    console.log('✅ Seed completed successfully!')
    console.log('Stats:', JSON.stringify(result.stats, null, 2))

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'حدث خطأ غير معروف'
    console.error('Seed error:', error)
    return new Response(JSON.stringify({
      success: false,
      message: errorMessage,
      errors: [errorMessage],
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
