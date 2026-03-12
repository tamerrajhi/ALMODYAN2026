import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('No authorization header provided');
      return new Response(
        JSON.stringify({ error: 'Authorization header is required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase environment variables');
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the user's token
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      console.error('Authentication failed:', authError);
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Authenticated user:', user.id);

    // Parse form data
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const importBatchNo = formData.get('import_batch_no') as string | null;
    const importInvoiceNo = formData.get('import_invoice_no') as string | null;

    console.log('Received request:', { 
      hasFile: !!file, 
      fileName: file?.name,
      importBatchNo,
      importInvoiceNo
    });

    // Validate required fields
    if (!file) {
      return new Response(
        JSON.stringify({ error: 'File is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!importBatchNo) {
      return new Response(
        JSON.stringify({ error: 'Import batch number is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate file type
    const validTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
    ];
    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    
    if (!validTypes.includes(file.type) && !['xlsx', 'xls'].includes(fileExtension || '')) {
      return new Response(
        JSON.stringify({ error: 'Invalid file type. Only Excel files (.xlsx, .xls) are allowed' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate file size (max 50MB)
    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
      return new Response(
        JSON.stringify({ error: 'File size exceeds 50MB limit' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Generate storage path: imports/{batch_no}/{timestamp}-{originalFileName}
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const sanitizedBatchNo = importBatchNo.replace(/[^a-zA-Z0-9-_]/g, '_');
    const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9-_.]/g, '_');
    const storagePath = `imports/${sanitizedBatchNo}/${timestamp}-${sanitizedFileName}`;
    const bucketName = 'erp-attachments';

    console.log('Uploading file to Supabase Storage:', { bucketName, storagePath, fileName: file.name });

    // Read file data
    const fileBuffer = await file.arrayBuffer();
    const fileData = new Uint8Array(fileBuffer);

    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(storagePath, fileData, {
        contentType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        upsert: false,
      });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      return new Response(
        JSON.stringify({ error: `Failed to upload file: ${uploadError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('File uploaded successfully:', uploadData);

    // Insert attachment record
    const { data: attachmentData, error: attachmentError } = await supabase
      .from('attachments')
      .insert({
        related_module: 'imports',
        related_record_id: importBatchNo,
        attachment_type: 'import_excel',
        file_name: file.name,
        mime_type: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        file_size: file.size,
        storage_bucket: bucketName,
        storage_path: storagePath,
        uploaded_by_user_id: user.id,
      })
      .select()
      .single();

    if (attachmentError) {
      console.error('Database insert error:', attachmentError);
      
      // Try to clean up the uploaded file
      await supabase.storage.from(bucketName).remove([storagePath]);
      
      return new Response(
        JSON.stringify({ error: `Failed to save attachment record: ${attachmentError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Attachment record created:', attachmentData);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Excel file saved successfully',
        attachment: attachmentData
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
