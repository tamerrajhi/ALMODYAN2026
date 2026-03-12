import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface JewelryItem {
  model: string;
  description: string;
  type: string;
  stockcode: string | null;
  batch_id: string | null;
}

interface BatchInfo {
  id: string;
  batch_no: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing authorization header', error_ar: 'التفويض مفقود' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user from token
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid authentication token', error_ar: 'رمز المصادقة غير صالح' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const { search_text, batch_no, invoice_no } = await req.json();

    console.log('Search params:', { search_text, batch_no, invoice_no });

    // Get batch IDs if batch_no filter is provided
    let batchIdFilter: string[] | null = null;
    if (batch_no && batch_no.trim()) {
      const { data: batches, error: batchError } = await supabase
        .from('purchase_batches')
        .select('id, batch_no')
        .ilike('batch_no', `%${batch_no.trim()}%`);

      if (batchError) {
        console.error('Batch query error:', batchError);
      } else if (batches && batches.length > 0) {
        batchIdFilter = batches.map((b: BatchInfo) => b.id);
      } else {
        // No matching batches, return empty result
        return new Response(
          JSON.stringify({
            success: true,
            count: 0,
            models: [],
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Build the query for jewelry items
    let query = supabase
      .from('jewelry_items')
      .select('model, description, type, stockcode, batch_id')
      .not('model', 'is', null);

    // Apply text search filter
    if (search_text && search_text.trim()) {
      const searchTerm = search_text.trim();
      query = query.or(`model.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%,stockcode.ilike.%${searchTerm}%`);
    }

    // Apply batch ID filter
    if (batchIdFilter) {
      query = query.in('batch_id', batchIdFilter);
    }

    // Execute query
    const { data: items, error: queryError } = await query.limit(200);

    if (queryError) {
      console.error('Query error:', queryError);
      return new Response(
        JSON.stringify({ success: false, error: 'Database query failed', error_ar: 'فشل استعلام قاعدة البيانات', details: queryError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get all unique batch IDs to fetch batch numbers
    const batchIds = [...new Set((items || []).filter((i: JewelryItem) => i.batch_id).map((i: JewelryItem) => i.batch_id))];
    
    // Fetch batch numbers
    const batchMap = new Map<string, string>();
    if (batchIds.length > 0) {
      const { data: batchData } = await supabase
        .from('purchase_batches')
        .select('id, batch_no')
        .in('id', batchIds);

      if (batchData) {
        for (const batch of batchData as BatchInfo[]) {
          batchMap.set(batch.id, batch.batch_no);
        }
      }
    }

    // Group by model to get unique models
    const modelMap = new Map<string, {
      model: string;
      description: string;
      type: string;
      stockcode: string | null;
      batch_no: string | null;
      batch_id: string | null;
    }>();

    for (const item of (items || []) as JewelryItem[]) {
      const model = item.model;
      if (!model) continue;

      // Only keep one entry per model, prefer the one with batch info
      if (!modelMap.has(model) || (item.batch_id && !modelMap.get(model)?.batch_id)) {
        modelMap.set(model, {
          model: item.model,
          description: item.description || '',
          type: item.type || '',
          stockcode: item.stockcode,
          batch_no: item.batch_id ? batchMap.get(item.batch_id) || null : null,
          batch_id: item.batch_id,
        });
      }
    }

    const models = Array.from(modelMap.values());

    console.log(`Found ${models.length} unique models`);

    return new Response(
      JSON.stringify({
        success: true,
        count: models.length,
        models,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Search error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error', error_ar: 'خطأ داخلي في الخادم', details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
