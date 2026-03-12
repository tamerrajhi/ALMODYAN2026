import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PostMovementsResult {
  success: boolean;
  batch_no: string;
  created_count: number;
  skipped_count: number;
  total_items: number;
  already_posted: boolean;
  error?: string;
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

    console.log(`[post-batch-import-movements] Starting for batch_id: ${batch_id}`);

    // Step 1: Fetch batch and validate status
    const { data: batch, error: batchError } = await supabase
      .from('purchase_batches')
      .select('id, batch_no, status, branch_id, supplier_id')
      .eq('id', batch_id)
      .single();

    if (batchError || !batch) {
      console.log(`[post-batch-import-movements] Batch not found: ${batch_id}`);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Batch not found',
          batch_id 
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (batch.status !== 'IMPORTED') {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Batch status is '${batch.status}', expected 'IMPORTED'`,
          batch_no: batch.batch_no
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[post-batch-import-movements] Found batch: ${batch.batch_no}, status: ${batch.status}`);

    // Step 2: Get all jewelry_items for this batch
    const { data: items, error: itemsError } = await supabase
      .from('jewelry_items')
      .select('id, item_code, cost, branch_id, created_at')
      .eq('batch_id', batch_id);

    if (itemsError) {
      console.error(`[post-batch-import-movements] Error fetching items:`, itemsError);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Failed to fetch items: ${itemsError.message}`,
          batch_no: batch.batch_no
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!items || items.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'No items found for this batch',
          batch_no: batch.batch_no,
          total_items: 0
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[post-batch-import-movements] Found ${items.length} items`);

    // Step 3: Idempotency Check - Check if movements already exist for this batch
    // We use reference_id = batch_id AND reference_type = 'batch' AND movement_type = 'IMPORT'
    const { data: existingMovements, error: existingError } = await supabase
      .from('item_movements')
      .select('id, item_id')
      .eq('reference_id', batch_id)
      .eq('reference_type', 'batch')
      .eq('movement_type', 'import');

    if (existingError) {
      console.error(`[post-batch-import-movements] Error checking existing movements:`, existingError);
    }

    const existingItemIds = new Set((existingMovements || []).map(m => m.item_id));
    const alreadyPostedCount = existingItemIds.size;

    console.log(`[post-batch-import-movements] Found ${alreadyPostedCount} existing movements`);

    // If all items already have movements, return early
    if (alreadyPostedCount >= items.length) {
      console.log(`[post-batch-import-movements] All movements already exist, skipping`);
      return new Response(
        JSON.stringify({
          success: true,
          batch_no: batch.batch_no,
          created_count: 0,
          skipped_count: items.length,
          total_items: items.length,
          already_posted: true,
        } as PostMovementsResult),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 4: Filter items that don't have movements yet
    const itemsNeedingMovements = items.filter(item => !existingItemIds.has(item.id));

    console.log(`[post-batch-import-movements] Creating movements for ${itemsNeedingMovements.length} items`);

    // Step 5: Create movements in batches
    const BATCH_SIZE = 100;
    let createdCount = 0;

    for (let i = 0; i < itemsNeedingMovements.length; i += BATCH_SIZE) {
      const chunk = itemsNeedingMovements.slice(i, i + BATCH_SIZE);
      
      const movementsToInsert = chunk.map(item => ({
        item_id: item.id,
        movement_type: 'import',
        movement_date: item.created_at || new Date().toISOString(),
        reference_type: 'batch',
        reference_id: batch_id,
        reference_code: batch.batch_no,
        to_branch_id: item.branch_id || batch.branch_id,
        cost: item.cost || 0,
        notes: `استيراد قطعة جديدة - دفعة ${batch.batch_no}`,
      }));

      const { data: insertedMovements, error: insertError } = await supabase
        .from('item_movements')
        .insert(movementsToInsert)
        .select('id');

      if (insertError) {
        console.error(`[post-batch-import-movements] Error inserting movements chunk ${i}:`, insertError);
        // Continue with next chunk, don't fail completely
      } else {
        createdCount += insertedMovements?.length || 0;
      }
    }

    console.log(`[post-batch-import-movements] Created ${createdCount} movements`);

    const result: PostMovementsResult = {
      success: true,
      batch_no: batch.batch_no,
      created_count: createdCount,
      skipped_count: alreadyPostedCount,
      total_items: items.length,
      already_posted: false,
    };

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[post-batch-import-movements] Unexpected error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error',
        created_count: 0,
        skipped_count: 0,
        total_items: 0,
        already_posted: false,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
