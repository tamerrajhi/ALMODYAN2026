import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user from token
    const token = authHeader.replace('Bearer ', '');
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid authentication token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Get model_code from query params
    const url = new URL(req.url);
    const modelCode = url.searchParams.get('model_code');

    if (!modelCode || modelCode.trim() === '') {
      return new Response(
        JSON.stringify({ error: 'model_code is required', error_ar: 'كود الموديل مطلوب' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Fetch attachments from database
    const { data: attachments, error: dbError } = await supabase
      .from('attachments')
      .select('*')
      .eq('related_module', 'sets')
      .eq('related_record_id', modelCode.trim())
      .eq('attachment_type', 'set_image')
      .order('uploaded_at', { ascending: false });

    if (dbError) {
      console.error('Database error:', dbError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch attachments', details: dbError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Generate URLs for each attachment
    const imagesWithUrls = await Promise.all(
      attachments.map(async (attachment) => {
        // Check if this is a Supabase Storage attachment
        if (attachment.storage_bucket && attachment.storage_path) {
          // Get public URL (bucket is public)
          const { data: publicUrlData } = supabase.storage
            .from(attachment.storage_bucket)
            .getPublicUrl(attachment.storage_path);

          return {
            ...attachment,
            thumbnail_url: publicUrlData.publicUrl,
            view_url: publicUrlData.publicUrl,
            download_url: publicUrlData.publicUrl,
            storage_type: 'supabase',
          };
        }

        // Legacy: Google Drive attachment
        if (attachment.google_file_id) {
          return {
            ...attachment,
            thumbnail_url: `https://drive.google.com/thumbnail?id=${attachment.google_file_id}&sz=w400`,
            view_url: `https://drive.google.com/file/d/${attachment.google_file_id}/view`,
            download_url: `https://drive.google.com/uc?export=download&id=${attachment.google_file_id}`,
            storage_type: 'google_drive',
          };
        }

        // No storage info
        return {
          ...attachment,
          thumbnail_url: null,
          view_url: null,
          download_url: null,
          storage_type: 'unknown',
        };
      }),
    );

    return new Response(
      JSON.stringify({
        success: true,
        model_code: modelCode,
        count: imagesWithUrls.length,
        images: imagesWithUrls,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('Get images error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
