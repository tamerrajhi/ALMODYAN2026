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

    // Get attachment_id from query params
    const url = new URL(req.url);
    const attachmentId = url.searchParams.get('attachment_id');

    if (!attachmentId || attachmentId.trim() === '') {
      return new Response(
        JSON.stringify({ error: 'attachment_id is required', error_ar: 'معرف المرفق مطلوب' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Fetch attachment from database
    const { data: attachment, error: dbError } = await supabase
      .from('attachments')
      .select('*')
      .eq('id', attachmentId.trim())
      .single();

    if (dbError || !attachment) {
      console.error('Database error:', dbError);
      return new Response(
        JSON.stringify({ error: 'Attachment not found', error_ar: 'المرفق غير موجود' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Check if this is a Supabase Storage attachment (has storage_bucket + storage_path)
    if (attachment.storage_bucket && attachment.storage_path) {
      // Generate a signed URL for the file (valid for 1 hour)
      const { data: signedUrlData, error: signedUrlError } = await supabase.storage
        .from(attachment.storage_bucket)
        .createSignedUrl(attachment.storage_path, 3600); // 1 hour expiry

      if (signedUrlError || !signedUrlData?.signedUrl) {
        console.error('Signed URL error:', signedUrlError);
        return new Response(
          JSON.stringify({
            error: 'Failed to generate download URL',
            error_ar: 'فشل في إنشاء رابط التحميل',
            details: signedUrlError?.message,
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          attachment_id: attachment.id,
          file_name: attachment.file_name,
          mime_type: attachment.mime_type,
          download_url: signedUrlData.signedUrl,
          expires_in: 3600,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Legacy: Google Drive attachment (has google_file_id)
    if (attachment.google_file_id) {
      return new Response(
        JSON.stringify({
          success: true,
          attachment_id: attachment.id,
          file_name: attachment.file_name,
          mime_type: attachment.mime_type,
          download_url: `https://drive.google.com/uc?export=download&id=${attachment.google_file_id}`,
          view_url: `https://drive.google.com/file/d/${attachment.google_file_id}/view`,
          thumbnail_url: `https://drive.google.com/thumbnail?id=${attachment.google_file_id}&sz=w400`,
          storage_type: 'google_drive',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // No storage info found
    return new Response(
      JSON.stringify({
        error: 'No storage location found for this attachment',
        error_ar: 'لم يتم العثور على موقع تخزين لهذا المرفق',
      }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('Download attachment error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
