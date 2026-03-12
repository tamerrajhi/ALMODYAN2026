import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ZATCA_SANDBOX_URL = 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal';
const ZATCA_PRODUCTION_URL = 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core';

interface SubmitRequest {
  invoiceId: string;
  submitType: 'clearance' | 'reporting';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { invoiceId, submitType }: SubmitRequest = await req.json();

    if (!invoiceId || !submitType) {
      throw new Error('Invoice ID and submit type are required');
    }

    console.log(`Submitting invoice ${invoiceId} for ${submitType}`);

    // Update invoice status to processing
    await supabaseClient
      .from('invoices')
      .update({ zatca_status: 'processing' })
      .eq('id', invoiceId);

    // Fetch invoice with signed XML
    const { data: invoice, error: invoiceError } = await supabaseClient
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .single();

    if (invoiceError) throw invoiceError;
    if (!invoice) throw new Error('Invoice not found');
    if (!invoice.zatca_signed_xml) throw new Error('Invoice must be signed before submission');

    // Fetch ZATCA settings
    const { data: zatcaSettings, error: zatcaError } = await supabaseClient
      .from('zatca_settings')
      .select('*')
      .limit(1)
      .single();

    if (zatcaError) throw zatcaError;
    if (!zatcaSettings) throw new Error('ZATCA settings not configured');

    // Guard: integration_enabled (is_active) must be true
    if (!zatcaSettings.is_active) {
      return new Response(
        JSON.stringify({
          success: false,
          errorCode: 'ZATCA_VIRTUAL_MODE',
          error: 'وضع تجريبي (Virtual) — فعّل التكامل للإرسال',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Determine environment and credentials
    const isProduction = zatcaSettings.environment === 'production';
    const baseUrl = isProduction ? ZATCA_PRODUCTION_URL : ZATCA_SANDBOX_URL;
    const csid = isProduction ? zatcaSettings.production_csid : zatcaSettings.compliance_csid;
    const csidSecret = isProduction ? zatcaSettings.production_csid_secret : zatcaSettings.compliance_csid_secret;

    // Guard: production requires completed onboarding + valid credentials
    if (isProduction) {
      const onboardingReady = zatcaSettings.onboarding_status === 'completed' &&
        !!zatcaSettings.production_csid && !!zatcaSettings.production_csid_secret;
      if (!onboardingReady) {
        return new Response(
          JSON.stringify({
            success: false,
            errorCode: 'ZATCA_NOT_READY',
            error: 'إعدادات الشهادة/التسجيل غير مكتملة للإنتاج',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        );
      }
    }

    if (!csid || !csidSecret) {
      return new Response(
        JSON.stringify({
          success: false,
          errorCode: 'ZATCA_NOT_READY',
          error: 'بيانات الاعتماد (CSID) غير مكتملة. أكمل عملية التسجيل أولاً.',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Prepare API endpoint
    const endpoint = submitType === 'clearance' 
      ? `${baseUrl}/invoices/clearance/single`
      : `${baseUrl}/invoices/reporting/single`;

    // Encode XML to Base64
    const xmlBase64 = btoa(unescape(encodeURIComponent(invoice.zatca_signed_xml)));

    // Prepare request body
    const requestBody = {
      invoiceHash: invoice.zatca_invoice_hash,
      uuid: invoice.zatca_uuid,
      invoice: xmlBase64,
    };

    console.log('Sending to ZATCA:', endpoint);

    // Make API request to ZATCA
    const zatcaResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Language': 'en',
        'Accept-Version': 'V2',
        'Authorization': `Basic ${btoa(`${csid}:${csidSecret}`)}`,
      },
      body: JSON.stringify(requestBody),
    });

    const responseText = await zatcaResponse.text();
    let responseData;
    
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { raw: responseText };
    }

    console.log('ZATCA Response Status:', zatcaResponse.status);
    console.log('ZATCA Response:', JSON.stringify(responseData).substring(0, 500));

    // Determine success status
    const isSuccess = zatcaResponse.status === 200 || zatcaResponse.status === 202;
    const hasWarnings = responseData?.validationResults?.warningMessages?.length > 0;
    const hasErrors = responseData?.validationResults?.errorMessages?.length > 0;

    // Determine final status
    let finalStatus: string;
    if (isSuccess && !hasErrors) {
      finalStatus = submitType === 'clearance' ? 'cleared' : 'reported';
    } else if (hasWarnings && !hasErrors) {
      finalStatus = 'warning';
    } else {
      finalStatus = 'rejected';
    }

    // Get clearance/reporting ID
    const clearanceId = responseData?.clearanceStatus || responseData?.reportingStatus || null;
    const clearedXml = responseData?.clearedInvoice || null;

    // Update invoice with response
    const updateData: Record<string, unknown> = {
      zatca_status: finalStatus,
      zatca_submitted_at: new Date().toISOString(),
      zatca_response: responseData,
      zatca_error_message: hasErrors ? JSON.stringify(responseData?.validationResults?.errorMessages) : null,
      zatca_is_locked: isSuccess && !hasErrors,
    };

    if (submitType === 'clearance') {
      updateData.zatca_clearance_id = clearanceId;
      if (clearedXml) {
        updateData.zatca_cleared_xml = atob(clearedXml);
      }
    } else {
      updateData.zatca_reporting_id = clearanceId;
    }

    await supabaseClient
      .from('invoices')
      .update(updateData)
      .eq('id', invoiceId);

    // Log the action
    await supabaseClient.from('zatca_logs').insert({
      invoice_id: invoiceId,
      action: `submit_${submitType}`,
      request_payload: JSON.stringify({ endpoint, uuid: invoice.zatca_uuid }),
      response_payload: responseData,
      http_status: zatcaResponse.status,
      success: isSuccess && !hasErrors,
      error_message: hasErrors ? JSON.stringify(responseData?.validationResults?.errorMessages) : null,
    });

    return new Response(
      JSON.stringify({
        success: isSuccess && !hasErrors,
        status: finalStatus,
        clearanceId,
        hasWarnings,
        warnings: responseData?.validationResults?.warningMessages || [],
        errors: responseData?.validationResults?.errorMessages || [],
        response: responseData,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error submitting to ZATCA:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Try to update invoice status to rejected
    try {
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );
      
      const { invoiceId } = await req.clone().json();
      if (invoiceId) {
        await supabaseClient
          .from('invoices')
          .update({
            zatca_status: 'rejected',
            zatca_error_message: errorMessage,
          })
          .eq('id', invoiceId);
      }
    } catch (updateError) {
      console.error('Error updating invoice status:', updateError);
    }

    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
