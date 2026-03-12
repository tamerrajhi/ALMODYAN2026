import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

// Validate XML structure
function validateXMLStructure(xml: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check required elements
  const requiredElements = [
    'ProfileID',
    'ID',
    'UUID',
    'IssueDate',
    'IssueTime',
    'InvoiceTypeCode',
    'DocumentCurrencyCode',
    'AccountingSupplierParty',
    'TaxTotal',
    'LegalMonetaryTotal',
    'InvoiceLine',
  ];

  for (const element of requiredElements) {
    if (!xml.includes(`<cbc:${element}`) && !xml.includes(`<cac:${element}`)) {
      errors.push(`Missing required element: ${element}`);
    }
  }

  // Check for seller VAT number
  if (!xml.includes('PartyTaxScheme')) {
    errors.push('Missing seller tax scheme information');
  }

  // Check currency
  if (!xml.includes('SAR')) {
    warnings.push('Currency should be SAR for Saudi invoices');
  }

  // Check invoice type code
  if (!xml.includes('InvoiceTypeCode')) {
    errors.push('Missing invoice type code');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

// Validate amounts
function validateAmounts(invoice: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const subtotal = Number(invoice.subtotal || 0);
  const taxAmount = Number(invoice.tax_amount || 0);
  const totalAmount = Number(invoice.total_amount || 0);
  const discountAmount = Number(invoice.discount_amount || 0);

  // Check that total = subtotal + tax - discount
  const expectedTotal = subtotal + taxAmount - discountAmount;
  if (Math.abs(totalAmount - expectedTotal) > 0.01) {
    errors.push(`Total amount mismatch: expected ${expectedTotal.toFixed(2)}, got ${totalAmount.toFixed(2)}`);
  }

  // Check tax rate
  const taxRate = subtotal > 0 ? (taxAmount / subtotal) * 100 : 0;
  if (taxRate > 0 && Math.abs(taxRate - 15) > 0.5) {
    warnings.push(`Unusual tax rate: ${taxRate.toFixed(2)}% (expected 15%)`);
  }

  // Check for negative amounts
  if (subtotal < 0) errors.push('Subtotal cannot be negative');
  if (taxAmount < 0) errors.push('Tax amount cannot be negative');
  if (totalAmount < 0) errors.push('Total amount cannot be negative');

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

// Validate hash chain
function validateHashChain(invoice: Record<string, unknown>, previousInvoice: Record<string, unknown> | null): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const currentPreviousHash = invoice.zatca_previous_hash as string;
  const previousInvoiceHash = previousInvoice?.zatca_invoice_hash as string;

  // First invoice doesn't need hash chain validation
  if (!previousInvoice && !currentPreviousHash) {
    return { isValid: true, errors: [], warnings: [] };
  }

  // Check hash chain integrity
  if (previousInvoice && currentPreviousHash !== previousInvoiceHash) {
    errors.push('Hash chain broken: previous hash does not match last invoice hash');
  }

  // Check invoice counter sequence
  const currentCounter = Number(invoice.zatca_invoice_counter || 0);
  const previousCounter = Number(previousInvoice?.zatca_invoice_counter || 0);

  if (previousInvoice && currentCounter !== previousCounter + 1) {
    warnings.push(`Invoice counter gap: expected ${previousCounter + 1}, got ${currentCounter}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
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

    const { invoiceId, validateHashChain: checkHashChain = true } = await req.json();

    if (!invoiceId) {
      throw new Error('Invoice ID is required');
    }

    console.log('Validating invoice:', invoiceId);

    // Fetch invoice
    const { data: invoice, error: invoiceError } = await supabaseClient
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .single();

    if (invoiceError) throw invoiceError;
    if (!invoice) throw new Error('Invoice not found');

    const allErrors: string[] = [];
    const allWarnings: string[] = [];

    // Validate XML if signed
    if (invoice.zatca_signed_xml) {
      const xmlResult = validateXMLStructure(invoice.zatca_signed_xml);
      allErrors.push(...xmlResult.errors);
      allWarnings.push(...xmlResult.warnings);
    } else {
      allWarnings.push('Invoice has not been signed yet');
    }

    // Validate amounts
    const amountResult = validateAmounts(invoice);
    allErrors.push(...amountResult.errors);
    allWarnings.push(...amountResult.warnings);

    // Validate hash chain
    if (checkHashChain && invoice.zatca_invoice_counter > 1) {
      const { data: previousInvoice } = await supabaseClient
        .from('invoices')
        .select('*')
        .eq('zatca_invoice_counter', invoice.zatca_invoice_counter - 1)
        .single();

      const hashResult = validateHashChain(invoice, previousInvoice);
      allErrors.push(...hashResult.errors);
      allWarnings.push(...hashResult.warnings);
    }

    // Check required fields
    if (!invoice.invoice_number) allErrors.push('Missing invoice number');
    if (!invoice.invoice_date) allErrors.push('Missing invoice date');
    if (!invoice.total_amount) allErrors.push('Missing total amount');

    // Check ZATCA specific fields
    if (!invoice.zatca_uuid) allWarnings.push('Missing ZATCA UUID');
    if (!invoice.zatca_invoice_type) allWarnings.push('Missing ZATCA invoice type');

    const isValid = allErrors.length === 0;

    console.log('Validation result:', { isValid, errors: allErrors.length, warnings: allWarnings.length });

    // Log validation
    await supabaseClient.from('zatca_logs').insert({
      invoice_id: invoiceId,
      action: 'validate',
      response_payload: { isValid, errors: allErrors, warnings: allWarnings },
      success: isValid,
      error_message: allErrors.length > 0 ? allErrors.join('; ') : null,
    });

    return new Response(
      JSON.stringify({
        success: true,
        isValid,
        errors: allErrors,
        warnings: allWarnings,
        invoice: {
          id: invoice.id,
          invoiceNumber: invoice.invoice_number,
          status: invoice.zatca_status,
          isSigned: !!invoice.zatca_signed_xml,
          isLocked: invoice.zatca_is_locked,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Validation error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
