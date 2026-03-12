import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper: Get branch-specific inventory account (imported pieces)
async function getBranchInventoryAccount(
  supabase: any,
  branchId: string | null
): Promise<{ accountId: string; accountCode: string; accountName: string }> {
  if (!branchId) {
    throw new Error("VALIDATION: branch_id is required for inventory posting");
  }

  const { data, error } = await supabase
    .from("branch_inventory_accounts")
    .select(`
      imported_pieces_account_id,
      imported_pieces_account:chart_of_accounts!branch_inventory_accounts_imported_pieces_account_id_fkey(
        id, account_code, account_name
      )
    `)
    .eq("branch_id", branchId)
    .maybeSingle();

  if (error) throw error;

  const acc = data?.imported_pieces_account;
  if (!acc?.id) {
    throw new Error(`MISSING_BRANCH_ACCOUNT: No imported_pieces_account configured for branch ${branchId}`);
  }

  return {
    accountId: acc.id,
    accountCode: acc.account_code,
    accountName: acc.account_name
  };
}

// DTO for invoice posting diagnostics
interface InvoicePostingDTO {
  invoice_id: string;
  invoice_number: string;
  batch_id: string | null;
  invoice_total_amount: number;
  lines_total_amount: number;
  items_total_cost: number;
  chosen_total_source: 'invoice' | 'lines' | 'items' | 'none';
  chosen_total: number;
}

// Extended diagnostics for dry_run mode
interface DiagnosticsResult extends InvoicePostingDTO {
  found_existing_je: boolean;
  existing_je_id: string | null;
  existing_je_valid: boolean;
  decision: 'ALREADY_POSTED' | 'RELINK' | 'CREATE_NEW' | 'FAIL';
  fail_reason?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { invoice_id, dry_run = false } = body;

    if (!invoice_id) {
      return new Response(
        JSON.stringify({ error: 'invoice_id مطلوب' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Starting post-invoice-accounting for invoice_id:', invoice_id, 'dry_run:', dry_run);

    // 1. Fetch the invoice with supplier info and batch_id
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select(`
        id,
        invoice_number,
        invoice_type,
        purchase_type,
        status,
        supplier_id,
        branch_id,
        batch_id,
        subtotal,
        tax_amount,
        total_amount,
        journal_entry_id,
        invoice_date,
        suppliers:supplier_id (
          id,
          supplier_name,
          account_id,
          chart_of_accounts:account_id (account_code)
        )
      `)
      .eq('id', invoice_id)
      .single();

    if (invoiceError || !invoice) {
      console.error('Invoice fetch error:', invoiceError);
      return new Response(
        JSON.stringify({ error: 'لم يتم العثور على الفاتورة', details: invoiceError?.message }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Invoice fetched:', invoice.invoice_number, 'batch_id:', invoice.batch_id, 'journal_entry_id:', invoice.journal_entry_id);

    // 2. CANONICAL MATCHING: Search for existing JE by reference
    const { data: existingJeByRef } = await supabase
      .from('journal_entries')
      .select('id, is_posted, entry_date, total_debit, total_credit, branch_id, entry_number')
      .eq('reference_type', 'purchase_invoice')
      .eq('reference_id', invoice_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    console.log('Existing JE by reference:', existingJeByRef?.id || 'none');

    // 3. Safety validation for existing JE
    const isExistingJeValid = existingJeByRef && 
      (existingJeByRef.is_posted === true || existingJeByRef.is_posted === null) && // Allow null as "not set"
      Number(existingJeByRef.total_debit) > 0 && 
      Number(existingJeByRef.total_credit) > 0;

    // 4. Idempotency: If invoice.journal_entry_id already exists, return already_posted
    if (invoice.journal_entry_id) {
      console.log('Journal entry already linked:', invoice.journal_entry_id);
      
      if (dry_run) {
        return new Response(
          JSON.stringify({
            dry_run: true,
            decision: 'ALREADY_POSTED',
            invoice_id: invoice.id,
            invoice_number: invoice.invoice_number,
            journal_entry_id: invoice.journal_entry_id,
            message: 'القيد المحاسبي مرتبط مسبقاً'
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({
          success: true,
          already_posted: true,
          journal_entry_id: invoice.journal_entry_id,
          message: 'القيد المحاسبي موجود مسبقاً'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5. RELINK LOGIC: If existing JE found by reference but not linked
    if (existingJeByRef && isExistingJeValid) {
      console.log('Found valid existing JE for relink:', existingJeByRef.id);
      
      if (dry_run) {
        return new Response(
          JSON.stringify({
            dry_run: true,
            decision: 'RELINK',
            invoice_id: invoice.id,
            invoice_number: invoice.invoice_number,
            existing_je_id: existingJeByRef.id,
            existing_je_entry_number: existingJeByRef.entry_number,
            existing_je_total: existingJeByRef.total_debit,
            message: 'سيتم ربط الفاتورة بالقيد الموجود'
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Perform the relink
      const { error: relinkError } = await supabase
        .from('invoices')
        .update({
          journal_entry_id: existingJeByRef.id,
          status: 'posted',
        })
        .eq('id', invoice_id);

      if (relinkError) {
        console.error('Relink error:', relinkError);
        return new Response(
          JSON.stringify({ error: 'فشل ربط الفاتورة بالقيد الموجود', details: relinkError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Log the relink action
      await supabase.from('audit_logs').insert({
        entity_type: 'Invoice',
        entity_id: invoice_id,
        entity_code: invoice.invoice_number,
        action_type: 'ACCOUNTING_RELINK',
        description: `تم ربط الفاتورة ${invoice.invoice_number} بالقيد الموجود ${existingJeByRef.entry_number}`,
        metadata: {
          journal_entry_id: existingJeByRef.id,
          entry_number: existingJeByRef.entry_number,
          relinked: true,
        },
      });

      console.log('Invoice relinked to existing JE:', existingJeByRef.id);

      return new Response(
        JSON.stringify({
          success: true,
          relinked: true,
          journal_entry_id: existingJeByRef.id,
          entry_number: existingJeByRef.entry_number,
          message: `تم ربط الفاتورة بالقيد الموجود - ${existingJeByRef.entry_number}`
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Log if existing JE found but invalid
    if (existingJeByRef && !isExistingJeValid) {
      console.warn('Found existing JE but invalid for relink:', {
        id: existingJeByRef.id,
        is_posted: existingJeByRef.is_posted,
        total_debit: existingJeByRef.total_debit,
        total_credit: existingJeByRef.total_credit,
      });
    }

    // 6. Validate invoice for new JE creation
    if (invoice.invoice_type !== 'purchase') {
      const result = { error: 'الترحيل المحاسبي متاح فقط لفواتير الشراء' };
      if (dry_run) {
        return new Response(
          JSON.stringify({ dry_run: true, decision: 'FAIL', fail_reason: result.error }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify(result),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (invoice.status === 'cancelled') {
      const result = { error: 'لا يمكن ترحيل فاتورة ملغاة' };
      if (dry_run) {
        return new Response(
          JSON.stringify({ dry_run: true, decision: 'FAIL', fail_reason: result.error }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify(result),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!invoice.supplier_id) {
      const result = { error: 'الفاتورة ليس لها مورد مرتبط' };
      if (dry_run) {
        return new Response(
          JSON.stringify({ dry_run: true, decision: 'FAIL', fail_reason: result.error }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify(result),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Gate Check: batch_id required for imported items calculation
    if (!invoice.batch_id) {
      const result = { 
        error: 'الفاتورة غير مرتبطة بدفعة batch_id',
        details: 'يجب ربط الفاتورة بدفعة استيراد قبل الترحيل المحاسبي'
      };
      if (dry_run) {
        return new Response(
          JSON.stringify({ dry_run: true, decision: 'FAIL', fail_reason: result.error }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify(result),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 7. CANONICAL SOURCE: Calculate totals from multiple sources with priority
    const invoiceTotalAmount = Number(invoice.total_amount) || 0;
    let linesTotalAmount = 0;
    let itemsTotalCost = 0;

    // Source: purchase_invoice_lines
    const { data: invoiceLines } = await supabase
      .from('purchase_invoice_lines')
      .select('total_cost, total_amount, tax_amount')
      .eq('invoice_id', invoice_id);

    if (invoiceLines && invoiceLines.length > 0) {
      linesTotalAmount = invoiceLines.reduce((sum, line) => {
        const lineTotal = Number(line.total_amount) || Number(line.total_cost) || 0;
        return sum + lineTotal;
      }, 0);
    }

    // Source: jewelry_items via batch_id
    const { data: batchItems } = await supabase
      .from('jewelry_items')
      .select('cost')
      .eq('batch_id', invoice.batch_id);

    if (batchItems && batchItems.length > 0) {
      itemsTotalCost = batchItems.reduce((sum, item) => sum + Number(item.cost || 0), 0);
    }

    // Determine canonical source with priority: lines > items > invoice
    let chosenSource: 'invoice' | 'lines' | 'items' | 'none' = 'none';
    let totalCost = 0;

    if (linesTotalAmount > 0) {
      chosenSource = 'lines';
      totalCost = linesTotalAmount;
    } else if (itemsTotalCost > 0) {
      chosenSource = 'items';
      totalCost = itemsTotalCost;
    } else if (invoiceTotalAmount > 0) {
      chosenSource = 'invoice';
      totalCost = invoiceTotalAmount;
    }

    // Build DTO for diagnostics
    const postingDTO: InvoicePostingDTO = {
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      batch_id: invoice.batch_id,
      invoice_total_amount: invoiceTotalAmount,
      lines_total_amount: linesTotalAmount,
      items_total_cost: itemsTotalCost,
      chosen_total_source: chosenSource,
      chosen_total: totalCost,
    };

    console.log('Posting DTO:', JSON.stringify(postingDTO));

    // Validate: total must be > 0
    if (totalCost <= 0) {
      console.error('All total sources are 0:', postingDTO);
      const result = { 
        error: 'إجمالي الفاتورة يجب أن يكون أكبر من صفر',
        diagnostics: postingDTO,
        debug: { 
          linesTotal: linesTotalAmount, 
          itemsTotal: itemsTotalCost, 
          invoiceTotal: invoiceTotalAmount,
          batch_id: invoice.batch_id 
        }
      };
      if (dry_run) {
        return new Response(
          JSON.stringify({ 
            dry_run: true, 
            decision: 'FAIL', 
            fail_reason: result.error,
            diagnostics: postingDTO,
            found_existing_je: !!existingJeByRef,
            existing_je_id: existingJeByRef?.id || null,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify(result),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // DRY RUN: Return diagnostics without making changes
    if (dry_run) {
      const diagnosticsResult: DiagnosticsResult = {
        ...postingDTO,
        found_existing_je: !!existingJeByRef,
        existing_je_id: existingJeByRef?.id || null,
        existing_je_valid: isExistingJeValid || false,
        decision: 'CREATE_NEW',
      };
      
      return new Response(
        JSON.stringify({
          dry_run: true,
          diagnostics: diagnosticsResult,
          message: 'سيتم إنشاء قيد محاسبي جديد'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 8. Calculate tax and subtotal
    let taxAmount = Number(invoice.tax_amount) || 0;
    let subtotal = Number(invoice.subtotal) || totalCost;

    if (chosenSource === 'lines' && invoiceLines && invoiceLines.length > 0) {
      taxAmount = invoiceLines.reduce((sum, line) => sum + Number(line.tax_amount || 0), 0);
      subtotal = totalCost - taxAmount;
    } else if (chosenSource === 'items') {
      taxAmount = 0;
      subtotal = totalCost;
    }

    console.log('Totals calculated:', { totalCost, subtotal, taxAmount, source: chosenSource });

    // 9. Get branch-specific inventory account (PINV-FIX: No more hardcode!)
    const branchInventory = await getBranchInventoryAccount(supabase, invoice.branch_id);
    
    // Guard: Prevent posting to general inventory accounts
    if (branchInventory.accountCode === "1301" || branchInventory.accountCode === "1103") {
      throw new Error(`FORBIDDEN_ACCOUNT: Cannot post to general inventory account ${branchInventory.accountCode}. Must use branch-specific inventory account.`);
    }

    const inventoryAccountId = branchInventory.accountId;
    const inventoryAccountCode = branchInventory.accountCode;
    const supplierAccountCode = (invoice.suppliers as any)?.chart_of_accounts?.account_code || '2101';
    const vatInputAccountCode = '2105';

    console.log('Account codes:', { inventoryAccountCode, supplierAccountCode, vatInputAccountCode, branchInventoryId: inventoryAccountId });

    // 10. Get supplier and VAT account IDs (inventory already fetched)
    const { data: accounts, error: accountsError } = await supabase
      .from('chart_of_accounts')
      .select('id, account_code, account_name')
      .in('account_code', [supplierAccountCode, vatInputAccountCode]);

    if (accountsError || !accounts || accounts.length < 1) {
      console.error('Accounts fetch error:', accountsError);
      return new Response(
        JSON.stringify({ error: 'فشل جلب حسابات الدليل المحاسبي', details: accountsError?.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Inventory account already fetched via getBranchInventoryAccount
    const supplierAccount = accounts.find(a => a.account_code === supplierAccountCode);
    const vatInputAccount = accounts.find(a => a.account_code === vatInputAccountCode);

    if (!supplierAccount) {
      return new Response(
        JSON.stringify({ 
          error: 'حساب المورد غير موجود',
          required: [supplierAccountCode],
          found: accounts.map(a => a.account_code)
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 11. Generate journal entry number
    const { data: entryNumber, error: entryNumError } = await supabase.rpc('generate_journal_entry_number');
    
    if (entryNumError || !entryNumber) {
      console.error('Entry number generation error:', entryNumError);
      return new Response(
        JSON.stringify({ error: 'فشل توليد رقم القيد', details: entryNumError?.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Generated entry number:', entryNumber);

    // 12. Create journal entry with correct column names
    const { data: journalEntry, error: jeError } = await supabase
      .from('journal_entries')
      .insert({
        entry_number: entryNumber,
        entry_date: invoice.invoice_date ?? new Date().toISOString().slice(0, 10),
        description: `قيد فاتورة استيراد - ${invoice.invoice_number}`,
        reference_type: 'purchase_invoice',
        reference_id: invoice_id,
        branch_id: invoice.branch_id,
        total_debit: totalCost,
        total_credit: totalCost,
        is_posted: true,
        posted_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (jeError || !journalEntry) {
      console.error('Journal entry creation error:', jeError);
      return new Response(
        JSON.stringify({ error: 'فشل إنشاء القيد المحاسبي', details: jeError?.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Journal entry created:', journalEntry.id);

    // 13. Create journal entry lines with DEFENSIVE INSERT
    // ALLOWED_JEL_COLUMNS based on actual schema audit:
    // id, journal_entry_id, account_id, debit_amount, credit_amount, description, created_at
    const ALLOWED_JEL_COLUMNS = [
      'journal_entry_id',
      'account_id', 
      'debit_amount',
      'credit_amount',
      'description',
    ];

    function pickAllowed(obj: Record<string, any>): Record<string, any> {
      const out: Record<string, any> = {};
      for (const k of ALLOWED_JEL_COLUMNS) {
        if (k in obj) out[k] = obj[k];
      }
      return out;
    }

    const rawLines = [];

    // Debit: Inventory (subtotal without tax) - USES BRANCH-SPECIFIC ACCOUNT
    rawLines.push({
      journal_entry_id: journalEntry.id,
      account_id: inventoryAccountId,  // Direct from getBranchInventoryAccount
      debit_amount: subtotal,
      credit_amount: 0,
      description: `مخزون - فاتورة استيراد ${invoice.invoice_number} (${inventoryAccountCode})`,
    });

    // Debit: VAT Input (if tax exists)
    if (taxAmount > 0 && vatInputAccount) {
      rawLines.push({
        journal_entry_id: journalEntry.id,
        account_id: vatInputAccount.id,
        debit_amount: taxAmount,
        credit_amount: 0,
        description: `ضريبة مدخلات - فاتورة استيراد ${invoice.invoice_number}`,
      });
    }

    // Credit: Supplier/Payables (total amount)
    rawLines.push({
      journal_entry_id: journalEntry.id,
      account_id: supplierAccount.id,
      debit_amount: 0,
      credit_amount: totalCost,
      description: `ذمم دائنة - ${(invoice.suppliers as any)?.supplier_name || 'مورد'} - ${invoice.invoice_number}`,
    });

    // Sanitize lines to only include allowed columns
    const sanitizedLines = rawLines.map(pickAllowed);

    console.log('Inserting journal lines:', sanitizedLines.length, 'lines');

    const { error: linesError } = await supabase
      .from('journal_entry_lines')
      .insert(sanitizedLines);

    if (linesError) {
      console.error('Journal lines creation error:', linesError);
      // Rollback: delete the journal entry
      await supabase.from('journal_entries').delete().eq('id', journalEntry.id);
      return new Response(
        JSON.stringify({ 
          error: 'فشل إنشاء بنود القيد المحاسبي', 
          details: linesError.message,
          hint: 'تحقق من أعمدة جدول journal_entry_lines',
          table: 'journal_entry_lines',
          attempted_columns: Object.keys(sanitizedLines[0] || {}),
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Journal lines created:', sanitizedLines.length);

    // 14. Update invoice with journal_entry_id and status
    const { error: updateError } = await supabase
      .from('invoices')
      .update({
        journal_entry_id: journalEntry.id,
        status: 'posted',
      })
      .eq('id', invoice_id);

    if (updateError) {
      console.error('Invoice update error:', updateError);
    }

    // 15. Log the action
    await supabase.from('audit_logs').insert({
      entity_type: 'Invoice',
      entity_id: invoice_id,
      entity_code: invoice.invoice_number,
      action_type: 'ACCOUNTING_POST',
      description: `تم ترحيل فاتورة الاستيراد ${invoice.invoice_number} - قيد رقم ${entryNumber}`,
      metadata: {
        journal_entry_id: journalEntry.id,
        entry_number: entryNumber,
        total_amount: totalCost,
        source: chosenSource,
        diagnostics: postingDTO,
      },
    });

    console.log('Accounting posting completed successfully');

    return new Response(
      JSON.stringify({
        success: true,
        journal_entry_id: journalEntry.id,
        entry_number: entryNumber,
        message: `تم الترحيل المحاسبي بنجاح - قيد رقم ${entryNumber}`,
        diagnostics: postingDTO,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Unexpected error in post-invoice-accounting:', error);
    return new Response(
      JSON.stringify({ error: 'خطأ غير متوقع', details: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
