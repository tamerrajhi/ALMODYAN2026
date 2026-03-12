import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CreateBatchInvoiceRequest {
  batch_id: string;
  invoice_number?: string;
  invoice_date?: string;
  due_date?: string;
  delivery_date?: string;
  payment_terms?: string;
  notes?: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization header is required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client with service role key
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the user's token
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Authenticated user:', user.id, user.email);

    // Parse request body
    const body: CreateBatchInvoiceRequest = await req.json();
    const { batch_id, invoice_date, due_date, payment_terms, notes } = body;

    if (!batch_id) {
      return new Response(
        JSON.stringify({ error: 'batch_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Creating invoice for batch:', batch_id);

    // Fetch batch details
    const { data: batch, error: batchError } = await supabase
      .from('purchase_batches')
      .select('*, branches(branch_code, branch_name), suppliers(supplier_name)')
      .eq('id', batch_id)
      .single();

    if (batchError || !batch) {
      return new Response(
        JSON.stringify({ error: `Batch not found: ${batchError?.message || 'Unknown error'}` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // IDEMPOTENCY CHECK 1: Check if batch already has invoice_id linked
    if (batch.invoice_id) {
      const { data: existingInvoice } = await supabase
        .from('invoices')
        .select('id, invoice_number, journal_entry_id')
        .eq('id', batch.invoice_id)
        .single();

      if (existingInvoice) {
        console.log('Invoice already exists via batch.invoice_id:', existingInvoice.id);
        return new Response(
          JSON.stringify({ 
            success: true, 
            invoice_id: existingInvoice.id,
            invoice_number: existingInvoice.invoice_number,
            journal_entry_id: existingInvoice.journal_entry_id,
            already_exists: true,
            message: 'الفاتورة مرتبطة بالدفعة مسبقاً'
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // IDEMPOTENCY CHECK 2: Check if invoice exists with batch_id (auto-relink)
    const { data: existingByBatchId } = await supabase
      .from('invoices')
      .select('id, invoice_number, journal_entry_id')
      .eq('batch_id', batch_id)
      .eq('invoice_type', 'purchase')
      .maybeSingle();

    if (existingByBatchId) {
      console.log('Found existing invoice with batch_id, auto-relinking:', existingByBatchId.id);
      
      // Re-link the batch to this invoice
      const { error: relinkError } = await supabase
        .from('purchase_batches')
        .update({ 
          invoice_id: existingByBatchId.id, 
          needs_invoice: false 
        })
        .eq('id', batch_id);

      if (relinkError) {
        console.error('Relink error:', relinkError);
        return new Response(
          JSON.stringify({ 
            error: `فشل إعادة ربط الفاتورة: ${relinkError.message}`,
            invoice_id: existingByBatchId.id
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          invoice_id: existingByBatchId.id,
          invoice_number: existingByBatchId.invoice_number,
          journal_entry_id: existingByBatchId.journal_entry_id,
          already_exists: true,
          relinked: true,
          message: 'تم إعادة ربط الفاتورة الموجودة بالدفعة'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if needs_invoice is false (already processed)
    if (batch.needs_invoice === false) {
      return new Response(
        JSON.stringify({ error: 'هذه الدفعة لا تحتاج إلى فاتورة' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate required supplier_id
    if (!batch.supplier_id) {
      return new Response(
        JSON.stringify({ error: 'الدفعة لا تحتوي على مورد مرتبط' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch items from batch for invoice lines
    console.log('[create-batch-invoice] Fetching items from jewelry_items', { batch_id });
    const { data: items, error: itemsError } = await supabase
      .from('jewelry_items')
      .select('id, item_code, description, cost, g_weight')
      .eq('batch_id', batch_id);

    if (itemsError) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch items: ${itemsError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const itemsCount = items?.length || 0;
    if (itemsCount === 0) {
      return new Response(
        JSON.stringify({ error: 'لا توجد قطع في هذه الدفعة' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Calculate total cost
    const totalCost = (items || []).reduce((sum, item) => sum + (item.cost || 0), 0);

    // Generate stable client_request_id for idempotency (use batch_id as UUID)
    // The RPC expects a valid UUID, so we use the batch_id directly
    const clientRequestId = batch_id;

    // Build RPC payload for purchase_invoice_create_atomic
    const rpcPayload = {
      client_request_id: clientRequestId,
      invoice: {
        supplier_id: batch.supplier_id,
        branch_id: batch.branch_id,
        invoice_date: invoice_date || new Date().toISOString().split('T')[0],
        due_date: due_date || null,
        notes: notes || `فاتورة مشتريات للدفعة ${batch.batch_no}`,
        purchase_type: 'import', // Batch imports are always 'import' type
        batch_id: batch_id, // Link to batch
      },
      // Create one summary line for all items in batch
      items: [{
        line_number: 1,
        item_type: 'imported_piece',
        item_id: null,
        item_code: 'IMPORT-SUMMARY',
        description: `ملخص قطع مستوردة (${itemsCount} قطعة) - دفعة ${batch.batch_no}`,
        quantity: itemsCount,
        unit_price: totalCost / Math.max(itemsCount, 1),
        tax_rate: 0, // Import batches typically have 0% VAT
        discount_amount: 0,
        is_inclusive: false,
        gl_account_id: null,
        warehouse_account_id: null,
      }],
      created_by: user.email || 'system',
    };

    console.log('[create-batch-invoice] Calling purchase_invoice_create_atomic RPC', {
      clientRequestId,
      batchId: batch_id,
      supplierId: batch.supplier_id,
      itemsCount,
      totalCost,
    });

    // Call the atomic RPC - this ensures JE is created atomically
    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      'purchase_invoice_create_atomic',
      { p_payload: rpcPayload }
    );

    if (rpcError) {
      console.error('[create-batch-invoice] RPC error:', rpcError);
      return new Response(
        JSON.stringify({ 
          error: `فشل إنشاء الفاتورة: ${rpcError.message}`,
          error_code: 'RPC_ERROR'
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse RPC response
    const result = rpcResult as {
      success: boolean;
      cached?: boolean;
      invoiceId?: string;
      invoiceNumber?: string;
      journalEntryId?: string;
      error_code?: string;
      error?: string;
    };

    if (!result.success) {
      console.error('[create-batch-invoice] RPC returned failure:', result);
      return new Response(
        JSON.stringify({ 
          error: result.error || 'فشل إنشاء الفاتورة',
          error_code: result.error_code || 'RPC_FAILED'
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // HARD ASSERTION: journal_entry_id MUST NOT be NULL
    if (!result.journalEntryId) {
      console.error('[create-batch-invoice] CRITICAL: JE_CREATE_FAILED - Invoice created without journal entry', {
        invoiceId: result.invoiceId,
        invoiceNumber: result.invoiceNumber,
      });
      
      return new Response(
        JSON.stringify({ 
          error: 'تم إنشاء الفاتورة لكن فشل إنشاء القيد المحاسبي',
          error_code: 'JE_CREATE_FAILED',
          invoice_id: result.invoiceId,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[create-batch-invoice] Invoice created via atomic RPC:', {
      invoiceId: result.invoiceId,
      invoiceNumber: result.invoiceNumber,
      journalEntryId: result.journalEntryId,
      cached: result.cached,
    });

    // Update items with invoice ID
    const { error: updateItemsError } = await supabase
      .from('jewelry_items')
      .update({ purchase_invoice_id: result.invoiceId })
      .eq('batch_id', batch_id);

    if (updateItemsError) {
      console.error('Failed to update items with invoice_id:', updateItemsError);
      // Non-fatal - invoice was created successfully
    }

    // Update batch: set invoice_id and needs_invoice = false
    const { error: updateBatchError } = await supabase
      .from('purchase_batches')
      .update({ 
        invoice_id: result.invoiceId,
        needs_invoice: false
      })
      .eq('id', batch_id);

    if (updateBatchError) {
      console.error('Failed to update batch:', updateBatchError);
      return new Response(
        JSON.stringify({ 
          error: `تم إنشاء الفاتورة لكن فشل ربطها بالدفعة: ${updateBatchError.message}`,
          invoice_id: result.invoiceId,
          invoice_number: result.invoiceNumber,
          journal_entry_id: result.journalEntryId,
          partial_success: true
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verification: Ensure batch was actually updated
    const { data: verification, error: verifyError } = await supabase
      .from('purchase_batches')
      .select('invoice_id, needs_invoice')
      .eq('id', batch_id)
      .single();

    if (verifyError || !verification?.invoice_id) {
      console.error('Verification failed:', verifyError, verification);
      return new Response(
        JSON.stringify({ 
          error: 'تم إنشاء الفاتورة لكن فشل التحقق من ربطها بالدفعة',
          invoice_id: result.invoiceId,
          invoice_number: result.invoiceNumber,
          journal_entry_id: result.journalEntryId,
          partial_success: true
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Verification passed: batch.invoice_id =', verification.invoice_id);

    // Log audit
    await supabase.from('audit_logs').insert({
      user_id: user.id,
      user_name: user.email,
      action_type: 'Create',
      entity_type: 'Invoice',
      entity_id: result.invoiceId,
      entity_code: result.invoiceNumber,
      new_value: { 
        batch_id, 
        items_count: itemsCount, 
        total_cost: totalCost,
        journal_entry_id: result.journalEntryId,
        created_via: 'purchase_invoice_create_atomic'
      },
      branch_id: batch.branch_id,
      description: `إنشاء فاتورة للدفعة ${batch.batch_no} عبر RPC الذري`,
    });

    console.log('Batch invoice creation completed successfully via atomic RPC');

    return new Response(
      JSON.stringify({ 
        success: true, 
        invoice_id: result.invoiceId,
        invoice_number: result.invoiceNumber,
        journal_entry_id: result.journalEntryId,
        items_count: itemsCount,
        total_cost: totalCost,
        already_exists: result.cached || false,
        message: 'تم إنشاء الفاتورة بنجاح'
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Unexpected error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: `Internal server error: ${errorMessage}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
