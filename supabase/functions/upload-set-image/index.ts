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

    // Parse form data
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const modelCode = formData.get('model_code') as string | null;

    // Validate inputs
    if (!modelCode || modelCode.trim() === '') {
      return new Response(
        JSON.stringify({ error: 'model_code is required', error_ar: 'كود الموديل مطلوب' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Validate that model exists in jewelry_items
    const { data: existingModel, error: modelError } = await supabase
      .from('jewelry_items')
      .select('model')
      .eq('model', modelCode.trim())
      .limit(1);

    if (modelError) {
      console.error('Model validation error:', modelError);
      return new Response(
        JSON.stringify({ error: 'Failed to validate model', error_ar: 'فشل التحقق من الموديل' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (!existingModel || existingModel.length === 0) {
      return new Response(
        JSON.stringify({
          error: 'Model does not exist in the system',
          error_ar: 'الموديل غير موجود في النظام',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (!file) {
      return new Response(
        JSON.stringify({ error: 'file is required', error_ar: 'الملف مطلوب' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return new Response(
        JSON.stringify({
          error: 'Invalid file type. Only JPG, PNG, WEBP allowed',
          error_ar: 'نوع الملف غير صالح. يُسمح فقط بـ JPG, PNG, WEBP',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Validate file size (10MB max)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return new Response(
        JSON.stringify({
          error: 'File size exceeds 10MB limit',
          error_ar: 'حجم الملف يتجاوز 10 ميجابايت',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Get file extension
    const fileExtension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const sanitizedModelCode = modelCode.trim().replace(/[^a-zA-Z0-9-_]/g, '_');
    const bucketName = 'erp-attachments';

    // Count existing images for this model to generate sequence number
    const { count } = await supabase
      .from('attachments')
      .select('*', { count: 'exact', head: true })
      .eq('related_module', 'sets')
      .eq('related_record_id', modelCode.trim())
      .eq('attachment_type', 'set_image');

    const sequence = String((count || 0) + 1).padStart(3, '0');

    // Generate new filename: {model_code}_{sequence}.{extension}
    const newFileName = `${sanitizedModelCode}_${sequence}.${fileExtension}`;
    const storagePath = `sets-images/${sanitizedModelCode}/${newFileName}`;

    console.log('Uploading file to Supabase Storage:', { bucketName, storagePath, originalFileName: file.name, newFileName });

    // Read file data
    const fileBuffer = await file.arrayBuffer();

    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(storagePath, fileBuffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error('Supabase Storage upload error:', uploadError);
      return new Response(
        JSON.stringify({
          error: 'Failed to upload file to storage',
          error_ar: 'فشل في رفع الملف إلى المخزن',
          details: uploadError.message,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log('File uploaded successfully:', uploadData);

    // Save metadata to database
    const { data: attachment, error: dbError } = await supabase
      .from('attachments')
      .insert({
        related_module: 'sets',
        related_record_id: modelCode.trim(),
        file_name: file.name,
        mime_type: file.type,
        file_size: file.size,
        uploaded_by_user_id: user.id,
        attachment_type: 'set_image',
        storage_bucket: bucketName,
        storage_path: storagePath,
      })
      .select()
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
      // Cleanup: delete the uploaded file from storage if DB insert fails
      await supabase.storage.from(bucketName).remove([storagePath]);
      return new Response(
        JSON.stringify({ error: 'Failed to save attachment metadata', details: dbError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'تم رفع الصورة بنجاح',
        attachment: {
          id: attachment.id,
          file_name: attachment.file_name,
          storage_bucket: attachment.storage_bucket,
          storage_path: attachment.storage_path,
          uploaded_at: attachment.uploaded_at,
        },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('Upload error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return new Response(
      JSON.stringify({ error: 'Internal server error', details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
