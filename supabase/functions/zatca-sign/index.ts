import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Base64 encoding helper
function base64Encode(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data));
}

// Calculate SHA-256 hash
async function sha256Hash(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBytes = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBytes);
  const hashArray = new Uint8Array(hashBuffer);
  return base64Encode(hashArray);
}

// Generate TLV encoded data for QR code
function encodeTLV(tag: number, value: string): Uint8Array {
  const encoder = new TextEncoder();
  const valueBytes = encoder.encode(value);
  const length = valueBytes.length;
  const result = new Uint8Array(2 + length);
  result[0] = tag;
  result[1] = length;
  result.set(valueBytes, 2);
  return result;
}

function concatArrays(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

interface SignRequest {
  invoiceId: string;
  xml: string;
  invoiceCounter: number;
  sellerName: string;
  vatNumber: string;
  timestamp: string;
  totalWithVat: number;
  vatAmount: number;
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

    const requestData: SignRequest = await req.json();
    const { invoiceId, xml, invoiceCounter, sellerName, vatNumber, timestamp, totalWithVat, vatAmount } = requestData;

    if (!invoiceId || !xml) {
      throw new Error('Invoice ID and XML are required');
    }

    console.log('Signing invoice:', invoiceId);

    // Fetch ZATCA settings
    const { data: zatcaSettings, error: zatcaError } = await supabaseClient
      .from('zatca_settings')
      .select('*')
      .limit(1)
      .single();

    if (zatcaError && zatcaError.code !== 'PGRST116') {
      throw zatcaError;
    }

    // Guard: production mode requires integration enabled + completed onboarding
    if (zatcaSettings?.environment === 'production') {
      if (!zatcaSettings.is_active) {
        return new Response(
          JSON.stringify({
            success: false,
            errorCode: 'ZATCA_VIRTUAL_MODE',
            error: 'التكامل غير مفعّل — فعّل التكامل للإرسال',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        );
      }
      if (zatcaSettings.onboarding_status !== 'completed' || !zatcaSettings.production_csid) {
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

    // Calculate invoice hash
    const invoiceHash = await sha256Hash(xml);
    console.log('Invoice hash calculated:', invoiceHash);

    // Get previous invoice hash for chain
    const previousHash = zatcaSettings?.last_invoice_hash || 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==';

    // For production, we would use the private key to sign
    // This is a simplified version - in production use proper X.509 signing
    const privateKey = zatcaSettings?.private_key;
    
    // Generate signature (simplified - in production use proper ECDSA)
    const signatureData = `${invoiceHash}|${previousHash}|${invoiceCounter}`;
    const signatureHash = await sha256Hash(signatureData);
    
    // In production, this would be an actual ECDSA signature
    const signature = signatureHash;
    
    // Public key placeholder (in production, extract from certificate)
    const publicKey = zatcaSettings?.compliance_csid || zatcaSettings?.production_csid || '';

    // Generate Phase 2 QR Code (8 tags)
    const tlv1 = encodeTLV(1, sellerName);
    const tlv2 = encodeTLV(2, vatNumber);
    const tlv3 = encodeTLV(3, timestamp);
    const tlv4 = encodeTLV(4, totalWithVat.toFixed(2));
    const tlv5 = encodeTLV(5, vatAmount.toFixed(2));
    const tlv6 = encodeTLV(6, invoiceHash);
    const tlv7 = encodeTLV(7, signature);
    const tlv8 = encodeTLV(8, publicKey);

    const allTLV = concatArrays(tlv1, tlv2, tlv3, tlv4, tlv5, tlv6, tlv7, tlv8);
    const qrCodeData = base64Encode(allTLV);

    console.log('QR Code generated');

    // Insert signature into XML (simplified - would need proper XAdES in production)
    const signedXml = xml.replace(
      '<!-- Signature will be inserted here -->',
      `<sig:Signature xmlns:sig="http://www.w3.org/2000/09/xmldsig#">
        <sig:SignedInfo>
          <sig:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"/>
          <sig:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/>
          <sig:Reference>
            <sig:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
            <sig:DigestValue>${invoiceHash}</sig:DigestValue>
          </sig:Reference>
        </sig:SignedInfo>
        <sig:SignatureValue>${signature}</sig:SignatureValue>
      </sig:Signature>`
    );

    // Update ZATCA settings with new hash and counter
    await supabaseClient
      .from('zatca_settings')
      .update({
        last_invoice_hash: invoiceHash,
        invoice_counter: invoiceCounter,
        updated_at: new Date().toISOString(),
      })
      .eq('id', zatcaSettings?.id);

    // Update invoice with signed data
    await supabaseClient
      .from('invoices')
      .update({
        zatca_signed_xml: signedXml,
        zatca_qr_code: qrCodeData,
        zatca_invoice_hash: invoiceHash,
        zatca_previous_hash: previousHash,
        zatca_invoice_counter: invoiceCounter,
        updated_at: new Date().toISOString(),
      })
      .eq('id', invoiceId);

    // Log the action
    await supabaseClient.from('zatca_logs').insert({
      invoice_id: invoiceId,
      action: 'sign_invoice',
      request_payload: JSON.stringify({ invoiceCounter, previousHash }),
      response_payload: { invoiceHash, qrCodeData: qrCodeData.substring(0, 100) + '...' },
      success: true,
    });

    console.log('Invoice signed successfully');

    return new Response(
      JSON.stringify({
        success: true,
        signedXml,
        qrCodeData,
        invoiceHash,
        previousHash,
        signature,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error signing invoice:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
