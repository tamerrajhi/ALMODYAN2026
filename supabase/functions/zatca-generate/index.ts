import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InvoiceData {
  invoiceId: string;
  invoiceNumber: string;
  invoiceType: 'standard' | 'simplified';
  documentType: 'invoice' | 'credit_note' | 'debit_note';
  invoiceDate: string;
  invoiceTime: string;
  uuid: string;
  previousHash?: string;
  invoiceCounter: number;
  // Original invoice reference (for credit/debit notes)
  originalInvoiceNumber?: string;
  originalInvoiceUuid?: string;
  // Seller
  sellerName: string;
  sellerVatNumber: string;
  sellerAddress: string;
  sellerCity: string;
  sellerPostalCode: string;
  sellerCountry: string;
  // Buyer (for standard invoices)
  buyerName?: string;
  buyerVatNumber?: string;
  buyerAddress?: string;
  buyerCity?: string;
  buyerPostalCode?: string;
  buyerCountry?: string;
  // Amounts
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  taxRate: number;
  // Lines
  lines: InvoiceLine[];
}

interface InvoiceLine {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  lineTotal: number;
}

function generateUBL21XML(data: InvoiceData): string {
  // Determine invoice type code based on document type
  // 388 = Standard Invoice, 381 = Credit Note, 383 = Debit Note
  let invoiceTypeCode: string;
  switch (data.documentType) {
    case 'credit_note':
      invoiceTypeCode = '381';
      break;
    case 'debit_note':
      invoiceTypeCode = '383';
      break;
    default:
      invoiceTypeCode = '388';
  }
  
  const invoiceSubType = data.invoiceType === 'standard' ? '0100000' : '0200000';
  
  // Format date and time
  const issueDate = data.invoiceDate;
  const issueTime = data.invoiceTime || '00:00:00';
  
  // Calculate line extension amount
  const lineExtensionAmount = data.lines.reduce((sum, line) => sum + (line.quantity * line.unitPrice), 0);
  
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI>
      <ext:ExtensionContent>
        <!-- Signature will be inserted here -->
      </ext:ExtensionContent>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>${escapeXml(data.invoiceNumber)}</cbc:ID>
  <cbc:UUID>${data.uuid}</cbc:UUID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:IssueTime>${issueTime}</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="${invoiceSubType}">${invoiceTypeCode}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>`;

  // Add BillingReference for Credit/Debit notes
  if ((data.documentType === 'credit_note' || data.documentType === 'debit_note') && data.originalInvoiceNumber) {
    xml += `
  <cac:BillingReference>
    <cac:InvoiceDocumentReference>
      <cbc:ID>${escapeXml(data.originalInvoiceNumber)}</cbc:ID>
      ${data.originalInvoiceUuid ? `<cbc:UUID>${data.originalInvoiceUuid}</cbc:UUID>` : ''}
    </cac:InvoiceDocumentReference>
  </cac:BillingReference>`;
  }

  // Add Previous Invoice Hash if exists
  if (data.previousHash) {
    xml += `
  <cac:AdditionalDocumentReference>
    <cbc:ID>PIH</cbc:ID>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${data.previousHash}</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>`;
  }

  // Invoice Counter Reference
  xml += `
  <cac:AdditionalDocumentReference>
    <cbc:ID>ICV</cbc:ID>
    <cbc:UUID>${data.invoiceCounter}</cbc:UUID>
  </cac:AdditionalDocumentReference>`;

  // Seller (AccountingSupplierParty)
  xml += `
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="CRN">${escapeXml(data.sellerVatNumber)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PostalAddress>
        <cbc:StreetName>${escapeXml(data.sellerAddress)}</cbc:StreetName>
        <cbc:CityName>${escapeXml(data.sellerCity)}</cbc:CityName>
        <cbc:PostalZone>${escapeXml(data.sellerPostalCode)}</cbc:PostalZone>
        <cac:Country>
          <cbc:IdentificationCode>${escapeXml(data.sellerCountry)}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(data.sellerVatNumber)}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(data.sellerName)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>`;

  // Buyer (AccountingCustomerParty) - Required for standard invoices
  if (data.invoiceType === 'standard' && data.buyerName) {
    xml += `
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="NAT">${escapeXml(data.buyerVatNumber || '')}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PostalAddress>
        <cbc:StreetName>${escapeXml(data.buyerAddress || '')}</cbc:StreetName>
        <cbc:CityName>${escapeXml(data.buyerCity || '')}</cbc:CityName>
        <cbc:PostalZone>${escapeXml(data.buyerPostalCode || '')}</cbc:PostalZone>
        <cac:Country>
          <cbc:IdentificationCode>${escapeXml(data.buyerCountry || 'SA')}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(data.buyerVatNumber || '')}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(data.buyerName)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>`;
  }

  // Allowance/Charge (Discount)
  if (data.discountAmount > 0) {
    xml += `
  <cac:AllowanceCharge>
    <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
    <cbc:AllowanceChargeReason>Discount</cbc:AllowanceChargeReason>
    <cbc:Amount currencyID="SAR">${data.discountAmount.toFixed(2)}</cbc:Amount>
    <cac:TaxCategory>
      <cbc:ID>S</cbc:ID>
      <cbc:Percent>${data.taxRate}</cbc:Percent>
      <cac:TaxScheme>
        <cbc:ID>VAT</cbc:ID>
      </cac:TaxScheme>
    </cac:TaxCategory>
  </cac:AllowanceCharge>`;
  }

  // Tax Total
  xml += `
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="SAR">${data.taxAmount.toFixed(2)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="SAR">${data.subtotal.toFixed(2)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="SAR">${data.taxAmount.toFixed(2)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>${data.taxRate}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>`;

  // Legal Monetary Total
  xml += `
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="SAR">${lineExtensionAmount.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="SAR">${data.subtotal.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="SAR">${data.totalAmount.toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:AllowanceTotalAmount currencyID="SAR">${data.discountAmount.toFixed(2)}</cbc:AllowanceTotalAmount>
    <cbc:PayableAmount currencyID="SAR">${data.totalAmount.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>`;

  // Invoice Lines
  data.lines.forEach((line, index) => {
    const lineExtAmount = line.quantity * line.unitPrice;
    xml += `
  <cac:InvoiceLine>
    <cbc:ID>${index + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="PCE">${line.quantity}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="SAR">${lineExtAmount.toFixed(2)}</cbc:LineExtensionAmount>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="SAR">${line.taxAmount.toFixed(2)}</cbc:TaxAmount>
      <cbc:RoundingAmount currencyID="SAR">${line.lineTotal.toFixed(2)}</cbc:RoundingAmount>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Name>${escapeXml(line.description)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>${line.taxRate}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="SAR">${line.unitPrice.toFixed(2)}</cbc:PriceAmount>
      <cac:AllowanceCharge>
        <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
        <cbc:AllowanceChargeReason>Discount</cbc:AllowanceChargeReason>
        <cbc:Amount currencyID="SAR">${line.discountAmount.toFixed(2)}</cbc:Amount>
      </cac:AllowanceCharge>
    </cac:Price>
  </cac:InvoiceLine>`;
  });

  xml += `
</Invoice>`;

  return xml;
}

function escapeXml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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

    const { invoiceId } = await req.json();

    if (!invoiceId) {
      throw new Error('Invoice ID is required');
    }

    console.log('Generating XML for invoice:', invoiceId);

    // Fetch invoice data
    const { data: invoice, error: invoiceError } = await supabaseClient
      .from('invoices')
      .select(`
        *,
        customers (full_name, vat_number, address),
        suppliers (supplier_name, vat_number, address)
      `)
      .eq('id', invoiceId)
      .single();

    if (invoiceError) throw invoiceError;
    if (!invoice) throw new Error('Invoice not found');

    // Fetch company settings
    const { data: company, error: companyError } = await supabaseClient
      .from('company_settings')
      .select('*')
      .limit(1)
      .single();

    if (companyError) throw companyError;

    // Fetch invoice lines
    const { data: lines, error: linesError } = await supabaseClient
      .from('purchase_invoice_lines')
      .select('*')
      .eq('invoice_id', invoiceId);

    if (linesError) throw linesError;

    // Fetch ZATCA settings
    const { data: zatcaSettings, error: zatcaError } = await supabaseClient
      .from('zatca_settings')
      .select('*')
      .limit(1)
      .single();

    // Note: XML generation works even when is_active=false (Virtual mode).
    // This allows local preview/generation of ZATCA artifacts without submission.
    const isVirtualMode = !zatcaSettings?.is_active;

    // Get previous hash and counter
    const previousHash = zatcaSettings?.last_invoice_hash || '';
    const invoiceCounter = (zatcaSettings?.invoice_counter || 0) + 1;

    // Determine invoice type
    const isB2B = invoice.customers?.vat_number ? true : false;
    const invoiceType = isB2B ? 'standard' : 'simplified';
    
    // Determine document type (invoice, credit_note, debit_note)
    let documentType: 'invoice' | 'credit_note' | 'debit_note' = 'invoice';
    if (invoice.invoice_type === 'sales_return' || invoice.invoice_type === 'purchase_return') {
      documentType = 'credit_note';
    }

    // Prepare invoice data
    const invoiceData: InvoiceData = {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      invoiceType,
      documentType,
      invoiceDate: new Date(invoice.invoice_date).toISOString().split('T')[0],
      invoiceTime: new Date(invoice.invoice_date).toISOString().split('T')[1].split('.')[0],
      uuid: invoice.zatca_uuid || crypto.randomUUID(),
      previousHash,
      invoiceCounter,
      // Original invoice reference for credit/debit notes
      originalInvoiceNumber: invoice.linked_invoice_id ? invoice.linked_invoice?.invoice_number : undefined,
      originalInvoiceUuid: invoice.linked_invoice_id ? invoice.linked_invoice?.zatca_uuid : undefined,
      // Seller
      sellerName: company.company_name,
      sellerVatNumber: company.tax_number || '',
      sellerAddress: company.address || '',
      sellerCity: company.city || '',
      sellerPostalCode: company.postal_code || '',
      sellerCountry: company.country || 'SA',
      // Buyer
      buyerName: invoice.customers?.full_name,
      buyerVatNumber: invoice.customers?.vat_number,
      buyerAddress: invoice.customers?.address,
      buyerCity: '',
      buyerPostalCode: '',
      buyerCountry: 'SA',
      // Amounts
      subtotal: invoice.subtotal || 0,
      discountAmount: invoice.discount_amount || 0,
      taxAmount: invoice.tax_amount || 0,
      totalAmount: invoice.total_amount || 0,
      taxRate: 15,
      // Lines
      lines: (lines || []).map(line => ({
        id: line.id,
        description: line.description || line.product_name || '',
        quantity: line.quantity || 1,
        unitPrice: line.unit_price || 0,
        discountAmount: line.discount_amount || 0,
        taxRate: line.tax_rate || 15,
        taxAmount: line.tax_amount || 0,
        lineTotal: line.total_amount || 0,
      })),
    };

    // Generate XML
    const xml = generateUBL21XML(invoiceData);

    console.log('XML generated successfully');

    // Log the action
    await supabaseClient.from('zatca_logs').insert({
      invoice_id: invoiceId,
      action: 'generate_xml',
      request_payload: JSON.stringify({ invoiceType, invoiceCounter }),
      success: true,
    });

    return new Response(
      JSON.stringify({
        success: true,
        xml,
        invoiceType,
        invoiceCounter,
        uuid: invoiceData.uuid,
        virtualMode: isVirtualMode,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error generating ZATCA XML:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
