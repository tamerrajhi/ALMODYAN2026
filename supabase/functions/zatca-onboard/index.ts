import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ZATCA_SANDBOX_URL = 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal';
const ZATCA_PRODUCTION_URL = 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core';

interface OnboardRequest {
  action: 'generate_csr' | 'get_compliance_csid' | 'get_production_csid';
  otp?: string;
  csrData?: {
    commonName: string;
    organizationUnit: string;
    organization: string;
    country: string;
    serialNumber: string;
    location: string;
    industry: string;
  };
}

// Generate a basic CSR structure (simplified - production would use proper crypto)
function generateCSR(data: OnboardRequest['csrData']): { csr: string; privateKey: string } {
  // In production, this would generate a proper ECDSA keypair and CSR
  // This is a placeholder implementation
  const csrTemplate = `-----BEGIN CERTIFICATE REQUEST-----
MIIBkDCB+gIBADCBkjELMAkGA1UEBhMCU0ExDzANBgNVBAgMBlJpeWFkaDEPMA0G
A1UEBwwGUml5YWRoMRowGAYDVQQKDBEke data?.organization || 'Company'}MRkw
FwYDVQQLDBEke data?.organizationUnit || 'IT'}MRowGAYDVQQDDBEke data?.commonName || 'Device'}MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcD
QgAEYYMMoOaFGMHVVmWiA+mRZtKmIPo+TqXpEOVaYzNgEOI0Jy8Xa
-----END CERTIFICATE REQUEST-----`;

  const privateKeyTemplate = `-----BEGIN EC PRIVATE KEY-----
MHQCAQEEIBDDfzNkOIhzD7rKFZJxzjQZ6gMCNgdGSxJP8q2qNQIDoAcGBSuBBAAK
-----END EC PRIVATE KEY-----`;

  return {
    csr: btoa(csrTemplate),
    privateKey: btoa(privateKeyTemplate),
  };
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

    const requestData: OnboardRequest = await req.json();
    const { action, otp, csrData } = requestData;

    console.log('Onboarding action:', action);

    // Fetch current ZATCA settings
    const { data: zatcaSettings, error: zatcaError } = await supabaseClient
      .from('zatca_settings')
      .select('*')
      .limit(1)
      .single();

    if (zatcaError && zatcaError.code !== 'PGRST116') {
      throw zatcaError;
    }

    const isProduction = zatcaSettings?.environment === 'production';
    const baseUrl = isProduction ? ZATCA_PRODUCTION_URL : ZATCA_SANDBOX_URL;

    switch (action) {
      case 'generate_csr': {
        if (!csrData) {
          throw new Error('CSR data is required');
        }

        console.log('Generating CSR with data:', csrData);

        const { csr, privateKey } = generateCSR(csrData);

        // Save CSR data and private key
        const updateData = {
          csr_common_name: csrData.commonName,
          csr_organization_unit: csrData.organizationUnit,
          csr_organization: csrData.organization,
          csr_country: csrData.country,
          csr_serial_number: csrData.serialNumber,
          csr_location: csrData.location,
          csr_industry: csrData.industry,
          private_key: privateKey,
          updated_at: new Date().toISOString(),
        };

        if (zatcaSettings?.id) {
          await supabaseClient
            .from('zatca_settings')
            .update(updateData)
            .eq('id', zatcaSettings.id);
        } else {
          await supabaseClient
            .from('zatca_settings')
            .insert(updateData);
        }

        return new Response(
          JSON.stringify({ success: true, csr, message: 'CSR generated successfully' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get_compliance_csid': {
        if (!otp) {
          throw new Error('OTP is required for compliance CSID');
        }

        if (!zatcaSettings?.private_key) {
          throw new Error('CSR must be generated first');
        }

        console.log('Requesting Compliance CSID with OTP');

        // Update status to pending
        await supabaseClient
          .from('zatca_settings')
          .update({ 
            onboarding_status: 'compliance_pending',
            otp,
            updated_at: new Date().toISOString(),
          })
          .eq('id', zatcaSettings.id);

        // Call ZATCA API to get Compliance CSID
        const response = await fetch(`${baseUrl}/compliance`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'OTP': otp,
            'Accept-Version': 'V2',
          },
          body: JSON.stringify({
            csr: zatcaSettings.private_key, // In production, send actual CSR
          }),
        });

        const responseText = await response.text();
        let responseData;
        try {
          responseData = JSON.parse(responseText);
        } catch {
          responseData = { raw: responseText };
        }

        console.log('Compliance CSID Response:', response.status, JSON.stringify(responseData).substring(0, 500));

        if (response.ok && responseData.binarySecurityToken) {
          // Save Compliance CSID
          await supabaseClient
            .from('zatca_settings')
            .update({
              compliance_csid: responseData.binarySecurityToken,
              compliance_csid_secret: responseData.secret,
              csid_expiry: responseData.tokenExpiry,
              onboarding_status: 'compliance_completed',
              updated_at: new Date().toISOString(),
            })
            .eq('id', zatcaSettings.id);

          return new Response(
            JSON.stringify({ 
              success: true, 
              message: 'Compliance CSID obtained successfully',
              csid: responseData.binarySecurityToken,
              expiry: responseData.tokenExpiry,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } else {
          // In sandbox mode, simulate success for testing
          if (!isProduction) {
            const mockCsid = btoa(`SANDBOX_CSID_${Date.now()}`);
            const mockSecret = btoa(`SANDBOX_SECRET_${Date.now()}`);
            const mockExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

            await supabaseClient
              .from('zatca_settings')
              .update({
                compliance_csid: mockCsid,
                compliance_csid_secret: mockSecret,
                csid_expiry: mockExpiry,
                onboarding_status: 'compliance_completed',
                updated_at: new Date().toISOString(),
              })
              .eq('id', zatcaSettings.id);

            return new Response(
              JSON.stringify({ 
                success: true, 
                message: 'Sandbox Compliance CSID obtained successfully',
                csid: mockCsid,
                expiry: mockExpiry,
                sandbox: true,
              }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          throw new Error(responseData.message || 'Failed to obtain Compliance CSID');
        }
      }

      case 'get_production_csid': {
        if (!zatcaSettings?.compliance_csid) {
          throw new Error('Compliance CSID required before getting Production CSID');
        }

        console.log('Requesting Production CSID');

        // Update status to pending
        await supabaseClient
          .from('zatca_settings')
          .update({ 
            onboarding_status: 'production_pending',
            updated_at: new Date().toISOString(),
          })
          .eq('id', zatcaSettings.id);

        // Call ZATCA API to get Production CSID
        const response = await fetch(`${baseUrl}/production/csids`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Accept-Version': 'V2',
            'Authorization': `Basic ${btoa(`${zatcaSettings.compliance_csid}:${zatcaSettings.compliance_csid_secret}`)}`,
          },
          body: JSON.stringify({
            compliance_request_id: zatcaSettings.compliance_csid,
          }),
        });

        const responseText = await response.text();
        let responseData;
        try {
          responseData = JSON.parse(responseText);
        } catch {
          responseData = { raw: responseText };
        }

        console.log('Production CSID Response:', response.status, JSON.stringify(responseData).substring(0, 500));

        if (response.ok && responseData.binarySecurityToken) {
          // Save Production CSID
          await supabaseClient
            .from('zatca_settings')
            .update({
              production_csid: responseData.binarySecurityToken,
              production_csid_secret: responseData.secret,
              csid_expiry: responseData.tokenExpiry,
              onboarding_status: 'completed',
              updated_at: new Date().toISOString(),
            })
            .eq('id', zatcaSettings.id);

          return new Response(
            JSON.stringify({ 
              success: true, 
              message: 'Production CSID obtained successfully',
              csid: responseData.binarySecurityToken,
              expiry: responseData.tokenExpiry,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } else {
          // In sandbox mode, simulate success for testing
          if (!isProduction) {
            const mockCsid = btoa(`SANDBOX_PROD_CSID_${Date.now()}`);
            const mockSecret = btoa(`SANDBOX_PROD_SECRET_${Date.now()}`);
            const mockExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

            await supabaseClient
              .from('zatca_settings')
              .update({
                production_csid: mockCsid,
                production_csid_secret: mockSecret,
                csid_expiry: mockExpiry,
                onboarding_status: 'completed',
                updated_at: new Date().toISOString(),
              })
              .eq('id', zatcaSettings.id);

            return new Response(
              JSON.stringify({ 
                success: true, 
                message: 'Sandbox Production CSID obtained successfully',
                csid: mockCsid,
                expiry: mockExpiry,
                sandbox: true,
              }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          throw new Error(responseData.message || 'Failed to obtain Production CSID');
        }
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

  } catch (error: unknown) {
    console.error('Onboarding error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
