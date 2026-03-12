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

    // Parse request body
    const body = await req.json();
    const { attachment_id } = body;

    if (!attachment_id) {
      return new Response(
        JSON.stringify({ error: 'attachment_id is required', error_ar: 'معرف المرفق مطلوب' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Fetch attachment to get storage info and verify ownership
    const { data: attachment, error: fetchError } = await supabase
      .from('attachments')
      .select('*')
      .eq('id', attachment_id)
      .single();

    if (fetchError || !attachment) {
      return new Response(
        JSON.stringify({ error: 'Attachment not found', error_ar: 'المرفق غير موجود' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Check if user owns this attachment
    if (attachment.uploaded_by_user_id !== user.id) {
      return new Response(
        JSON.stringify({
          error: 'You can only delete your own attachments',
          error_ar: 'يمكنك حذف المرفقات التي رفعتها فقط',
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Delete from storage
    if (attachment.storage_bucket && attachment.storage_path) {
      // Supabase Storage
      const { error: storageError } = await supabase.storage
        .from(attachment.storage_bucket)
        .remove([attachment.storage_path]);

      if (storageError) {
        console.error('Storage delete error:', storageError);
        // Continue with DB delete even if storage delete fails
      }
    }
    // Note: We no longer delete from Google Drive - legacy attachments remain as-is

    // Delete from database
    const { error: deleteError } = await supabase.from('attachments').delete().eq('id', attachment_id);

    if (deleteError) {
      console.error('Database delete error:', deleteError);
      return new Response(
        JSON.stringify({ error: 'Failed to delete attachment record', details: deleteError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'تم حذف الصورة بنجاح',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('Delete error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
