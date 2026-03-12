import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CleanupResult {
  success: boolean;
  deleted_items: number;
  deleted_errors: number;
  deleted_invoice_lines: number;
  deleted_invoice: boolean;
  deleted_batch: boolean;
  deleted_orphan_sets: number;
  cancelled_invoice: boolean;
  warnings: string[];
  batch_info?: {
    batch_no: string;
    uploaded_file_name: string | null;
  };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { batch_id } = await req.json();

    if (!batch_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'batch_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[cleanup-import-batch] Starting cleanup for batch_id: ${batch_id}`);

    const result: CleanupResult = {
      success: false,
      deleted_items: 0,
      deleted_errors: 0,
      deleted_invoice_lines: 0,
      deleted_invoice: false,
      deleted_batch: false,
      deleted_orphan_sets: 0,
      cancelled_invoice: false,
      warnings: [],
    };

    // Step 0: Fetch batch info first
    const { data: batchData, error: batchFetchError } = await supabase
      .from('purchase_batches')
      .select('id, batch_no, uploaded_file_name, invoice_id, status')
      .eq('id', batch_id)
      .single();

    if (batchFetchError || !batchData) {
      console.log(`[cleanup-import-batch] Batch not found: ${batch_id}`);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Batch not found',
          batch_id 
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    result.batch_info = {
      batch_no: batchData.batch_no,
      uploaded_file_name: batchData.uploaded_file_name,
    };

    console.log(`[cleanup-import-batch] Found batch: ${batchData.batch_no}, status: ${batchData.status}, invoice_id: ${batchData.invoice_id}`);

    // Step 1: Get set_ids linked to this batch's items BEFORE deleting items
    const { data: linkedSets } = await supabase
      .from('jewelry_items')
      .select('set_id')
      .eq('batch_id', batch_id)
      .not('set_id', 'is', null);

    const setIdsFromBatch = [...new Set((linkedSets || []).map(i => i.set_id).filter(Boolean))];
    console.log(`[cleanup-import-batch] Found ${setIdsFromBatch.length} unique sets linked to batch items`);

    // Step A: Delete import_row_errors for this batch
    const { data: deletedErrors, error: errorsError } = await supabase
      .from('import_row_errors')
      .delete()
      .eq('batch_id', batch_id)
      .select('id');

    if (errorsError) {
      result.warnings.push(`Failed to delete import_row_errors: ${errorsError.message}`);
      console.error(`[cleanup-import-batch] Error deleting errors:`, errorsError);
    } else {
      result.deleted_errors = deletedErrors?.length || 0;
      console.log(`[cleanup-import-batch] Deleted ${result.deleted_errors} import_row_errors`);
    }

    // Step B: Delete jewelry_items for this batch
    const { data: deletedItems, error: itemsError } = await supabase
      .from('jewelry_items')
      .delete()
      .eq('batch_id', batch_id)
      .select('id');

    if (itemsError) {
      result.warnings.push(`Failed to delete jewelry_items: ${itemsError.message}`);
      console.error(`[cleanup-import-batch] Error deleting items:`, itemsError);
    } else {
      result.deleted_items = deletedItems?.length || 0;
      console.log(`[cleanup-import-batch] Deleted ${result.deleted_items} jewelry_items`);
    }

    // Step C: Handle invoice - check BOTH directions (batch.invoice_id AND invoice.batch_id)
    let invoiceToHandle = batchData.invoice_id;

    // Also check for invoice with batch_id pointing to this batch (bidirectional)
    if (!invoiceToHandle) {
      const { data: invoiceByBatchId } = await supabase
        .from('invoices')
        .select('id')
        .eq('batch_id', batch_id)
        .maybeSingle();
      
      if (invoiceByBatchId) {
        invoiceToHandle = invoiceByBatchId.id;
        console.log(`[cleanup-import-batch] Found invoice by batch_id: ${invoiceToHandle}`);
      }
    }

    if (invoiceToHandle) {
      console.log(`[cleanup-import-batch] Handling invoice: ${invoiceToHandle}`);

      // Check if invoice has accounting entries
      const { data: invoice } = await supabase
        .from('invoices')
        .select('id, invoice_number, journal_entry_id, status')
        .eq('id', invoiceToHandle)
        .single();

      if (invoice?.journal_entry_id) {
        // Invoice has accounting - CANCEL instead of delete
        console.log(`[cleanup-import-batch] Invoice has journal entry - cancelling instead of deleting`);
        
        const { error: cancelError } = await supabase
          .from('invoices')
          .update({ 
            status: 'cancelled', 
            notes: `تم إلغاء الفاتورة بسبب حذف الدفعة ${batchData.batch_no}`,
            batch_id: null // Clear the batch link
          })
          .eq('id', invoiceToHandle);

        if (cancelError) {
          result.warnings.push(`Failed to cancel invoice: ${cancelError.message}`);
          console.error(`[cleanup-import-batch] Error cancelling invoice:`, cancelError);
        } else {
          result.cancelled_invoice = true;
          console.log(`[cleanup-import-batch] Cancelled invoice: ${invoiceToHandle}`);
        }
      } else {
        // Safe to delete invoice - no accounting entries
        
        // C1: Delete purchase_invoice_lines first
        const { data: deletedLines, error: linesError } = await supabase
          .from('purchase_invoice_lines')
          .delete()
          .eq('invoice_id', invoiceToHandle)
          .select('id');

        if (linesError) {
          result.warnings.push(`Failed to delete purchase_invoice_lines: ${linesError.message}`);
          console.error(`[cleanup-import-batch] Error deleting invoice lines:`, linesError);
        } else {
          result.deleted_invoice_lines = deletedLines?.length || 0;
          console.log(`[cleanup-import-batch] Deleted ${result.deleted_invoice_lines} purchase_invoice_lines`);
        }

        // C2: Delete the invoice itself
        const { error: invoiceError } = await supabase
          .from('invoices')
          .delete()
          .eq('id', invoiceToHandle);

        if (invoiceError) {
          result.warnings.push(`Failed to delete invoice: ${invoiceError.message}`);
          console.error(`[cleanup-import-batch] Error deleting invoice:`, invoiceError);
        } else {
          result.deleted_invoice = true;
          console.log(`[cleanup-import-batch] Deleted invoice: ${invoiceToHandle}`);
        }
      }

      // C3: Clear invoice_id from batch (in case batch deletion fails)
      await supabase
        .from('purchase_batches')
        .update({ invoice_id: null })
        .eq('id', batch_id);
    }

    // Step D: Delete the batch record itself
    const { error: batchDeleteError } = await supabase
      .from('purchase_batches')
      .delete()
      .eq('id', batch_id);

    if (batchDeleteError) {
      result.warnings.push(`Failed to delete batch: ${batchDeleteError.message}`);
      console.error(`[cleanup-import-batch] Error deleting batch:`, batchDeleteError);
    } else {
      result.deleted_batch = true;
      console.log(`[cleanup-import-batch] Deleted batch record`);
    }

    // Step E: Delete orphan sets (sets that were linked to this batch and now have no items)
    if (setIdsFromBatch.length > 0) {
      for (const setId of setIdsFromBatch) {
        const { count } = await supabase
          .from('jewelry_items')
          .select('*', { count: 'exact', head: true })
          .eq('set_id', setId);

        if (count === 0) {
          const { error: setDeleteError } = await supabase
            .from('jewelry_sets')
            .delete()
            .eq('id', setId);

          if (setDeleteError) {
            result.warnings.push(`Failed to delete orphan set ${setId}: ${setDeleteError.message}`);
            console.error(`[cleanup-import-batch] Error deleting orphan set:`, setDeleteError);
          } else {
            result.deleted_orphan_sets++;
            console.log(`[cleanup-import-batch] Deleted orphan set: ${setId}`);
          }
        }
      }
    }

    // Final verification
    const { count: remainingItems } = await supabase
      .from('jewelry_items')
      .select('*', { count: 'exact', head: true })
      .eq('batch_id', batch_id);

    const { count: remainingErrors } = await supabase
      .from('import_row_errors')
      .select('*', { count: 'exact', head: true })
      .eq('batch_id', batch_id);

    const { data: batchStillExists } = await supabase
      .from('purchase_batches')
      .select('id')
      .eq('id', batch_id)
      .maybeSingle();

    if (remainingItems && remainingItems > 0) {
      result.warnings.push(`Verification failed: ${remainingItems} items still exist`);
    }
    if (remainingErrors && remainingErrors > 0) {
      result.warnings.push(`Verification failed: ${remainingErrors} errors still exist`);
    }
    if (batchStillExists) {
      result.warnings.push(`Verification failed: batch record still exists`);
    }

    result.success = result.warnings.length === 0;

    console.log(`[cleanup-import-batch] Cleanup complete:`, JSON.stringify(result));

    return new Response(
      JSON.stringify(result),
      { 
        status: result.success ? 200 : 207, // 207 Multi-Status if partial success
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('[cleanup-import-batch] Unexpected error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error',
        deleted_items: 0,
        deleted_errors: 0,
        deleted_invoice_lines: 0,
        deleted_invoice: false,
        deleted_batch: false,
        deleted_orphan_sets: 0,
        cancelled_invoice: false,
        warnings: [error instanceof Error ? error.message : 'Unknown error'],
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
