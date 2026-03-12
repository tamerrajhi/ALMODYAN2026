/**
 * ZATCA QR Code TLV Encoder
 * Complies with Saudi Arabia ZATCA e-invoicing requirements
 * 
 * The QR code must contain 5 mandatory fields in TLV (Tag-Length-Value) format:
 * Tag 1: Seller Name
 * Tag 2: VAT Registration Number
 * Tag 3: Invoice Timestamp (ISO 8601 format)
 * Tag 4: Invoice Total with VAT
 * Tag 5: VAT Amount
 */

// Business configuration - can be customized
export const ZATCA_CONFIG = {
  sellerName: 'Almodyan للمجوهرات',
  vatNumber: '300000000000003', // Replace with actual VAT number
};

/**
 * Encodes a single TLV (Tag-Length-Value) field
 * @param tag - Tag number (1-5)
 * @param value - String value to encode
 * @returns Uint8Array containing the TLV encoded bytes
 */
function encodeTLV(tag: number, value: string): Uint8Array {
  const encoder = new TextEncoder();
  const valueBytes = encoder.encode(value);
  const length = valueBytes.length;
  
  // Create array: [tag, length, ...valueBytes]
  const result = new Uint8Array(2 + length);
  result[0] = tag;
  result[1] = length;
  result.set(valueBytes, 2);
  
  return result;
}

/**
 * Concatenates multiple Uint8Arrays into one
 */
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

/**
 * Converts Uint8Array to Base64 string
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export interface ZatcaQRData {
  sellerName: string;
  vatNumber: string;
  timestamp: Date;
  totalWithVat: number;
  vatAmount: number;
  // Optional fields for full tax invoice (B2B)
  buyerName?: string;
  buyerVatNumber?: string;
}

/**
 * Phase 2 QR Data interface (8 tags required)
 */
export interface Phase2QRData {
  sellerName: string;        // Tag 1
  vatNumber: string;         // Tag 2
  timestamp: Date;           // Tag 3
  totalWithVat: number;      // Tag 4
  vatAmount: number;         // Tag 5
  invoiceHash: string;       // Tag 6 - SHA-256 hash of invoice
  signature: string;         // Tag 7 - Digital signature
  publicKey: string;         // Tag 8 - ECDSA public key or certificate
}

/**
 * Generates ZATCA-compliant TLV Base64 encoded QR data
 * Supports both simplified (B2C) and full (B2B) tax invoices
 * 
 * For simplified invoices: Tags 1-5
 * For full invoices: Tags 1-8 (includes buyer info)
 * 
 * @param data - Invoice data for QR code
 * @returns Base64 encoded TLV string
 */
export function generateZatcaQRData(data: ZatcaQRData): string {
  // Format timestamp as ISO 8601
  const isoTimestamp = data.timestamp.toISOString();
  
  // Format amounts with 2 decimal places
  const totalFormatted = data.totalWithVat.toFixed(2);
  const vatFormatted = data.vatAmount.toFixed(2);
  
  // Encode mandatory fields (Tags 1-5)
  const tlv1 = encodeTLV(1, data.sellerName);
  const tlv2 = encodeTLV(2, data.vatNumber);
  const tlv3 = encodeTLV(3, isoTimestamp);
  const tlv4 = encodeTLV(4, totalFormatted);
  const tlv5 = encodeTLV(5, vatFormatted);
  
  // Start with mandatory fields
  let allTLV = concatArrays(tlv1, tlv2, tlv3, tlv4, tlv5);
  
  // For B2B invoices, add buyer information (Tags 6-8)
  if (data.buyerName && data.buyerVatNumber) {
    const tlv6 = encodeTLV(6, data.buyerName);
    const tlv7 = encodeTLV(7, data.buyerVatNumber);
    // Tag 8 is invoice hash - we'll use a placeholder for now
    const tlv8 = encodeTLV(8, ''); 
    allTLV = concatArrays(allTLV, tlv6, tlv7, tlv8);
  }
  
  // Convert to Base64
  return uint8ArrayToBase64(allTLV);
}

/**
 * Generates ZATCA Phase 2 compliant QR code with all 8 tags
 * Required for production ZATCA integration
 * 
 * Tags:
 * 1 - Seller Name (UTF-8)
 * 2 - VAT Registration Number
 * 3 - Invoice Timestamp (ISO 8601)
 * 4 - Invoice Total with VAT
 * 5 - VAT Amount
 * 6 - Invoice Hash (SHA-256 Base64)
 * 7 - Digital Signature (ECDSA Base64)
 * 8 - Public Key / Certificate (Base64)
 * 
 * @param data - Phase 2 invoice data
 * @returns Base64 encoded TLV string with all 8 tags
 */
export function generatePhase2QRCode(data: Phase2QRData): string {
  // Format timestamp as ISO 8601
  const isoTimestamp = data.timestamp.toISOString();
  
  // Format amounts with 2 decimal places
  const totalFormatted = data.totalWithVat.toFixed(2);
  const vatFormatted = data.vatAmount.toFixed(2);
  
  // Encode all 8 mandatory fields for Phase 2
  const tlv1 = encodeTLV(1, data.sellerName);           // Seller Name
  const tlv2 = encodeTLV(2, data.vatNumber);            // VAT Number
  const tlv3 = encodeTLV(3, isoTimestamp);              // Timestamp
  const tlv4 = encodeTLV(4, totalFormatted);            // Total with VAT
  const tlv5 = encodeTLV(5, vatFormatted);              // VAT Amount
  const tlv6 = encodeTLV(6, data.invoiceHash);          // Invoice Hash
  const tlv7 = encodeTLV(7, data.signature);            // Digital Signature
  const tlv8 = encodeTLV(8, data.publicKey);            // Public Key
  
  // Concatenate all TLV fields
  const allTLV = concatArrays(tlv1, tlv2, tlv3, tlv4, tlv5, tlv6, tlv7, tlv8);
  
  // Convert to Base64
  return uint8ArrayToBase64(allTLV);
}

/**
 * Encodes binary data as TLV (for signature and public key)
 * @param tag - Tag number
 * @param base64Data - Base64 encoded binary data
 * @returns Uint8Array containing the TLV encoded bytes
 */
export function encodeBinaryTLV(tag: number, base64Data: string): Uint8Array {
  // Decode Base64 to binary
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  const length = bytes.length;
  
  // Handle lengths > 127 (extended length encoding)
  if (length > 127) {
    // For lengths > 127, we need multi-byte length encoding
    if (length <= 255) {
      const result = new Uint8Array(3 + length);
      result[0] = tag;
      result[1] = 0x81; // Indicates 1 byte follows for length
      result[2] = length;
      result.set(bytes, 3);
      return result;
    } else {
      const result = new Uint8Array(4 + length);
      result[0] = tag;
      result[1] = 0x82; // Indicates 2 bytes follow for length
      result[2] = (length >> 8) & 0xFF;
      result[3] = length & 0xFF;
      result.set(bytes, 4);
      return result;
    }
  }
  
  // Standard length encoding
  const result = new Uint8Array(2 + length);
  result[0] = tag;
  result[1] = length;
  result.set(bytes, 2);
  
  return result;
}

/**
 * Helper function to generate ZATCA QR data for simplified invoice (B2C)
 */
export function generateInvoiceZatcaQR(
  timestamp: Date,
  totalWithVat: number,
  vatAmount: number
): string {
  return generateZatcaQRData({
    sellerName: ZATCA_CONFIG.sellerName,
    vatNumber: ZATCA_CONFIG.vatNumber,
    timestamp,
    totalWithVat,
    vatAmount,
  });
}

/**
 * Helper function to generate ZATCA QR data for full tax invoice (B2B)
 */
export function generateFullInvoiceZatcaQR(
  timestamp: Date,
  totalWithVat: number,
  vatAmount: number,
  buyerName: string,
  buyerVatNumber: string
): string {
  return generateZatcaQRData({
    sellerName: ZATCA_CONFIG.sellerName,
    vatNumber: ZATCA_CONFIG.vatNumber,
    timestamp,
    totalWithVat,
    vatAmount,
    buyerName,
    buyerVatNumber,
  });
}

/**
 * Helper function to generate Phase 2 QR code with crypto data
 */
export function generatePhase2InvoiceQR(
  timestamp: Date,
  totalWithVat: number,
  vatAmount: number,
  invoiceHash: string,
  signature: string,
  publicKey: string
): string {
  return generatePhase2QRCode({
    sellerName: ZATCA_CONFIG.sellerName,
    vatNumber: ZATCA_CONFIG.vatNumber,
    timestamp,
    totalWithVat,
    vatAmount,
    invoiceHash,
    signature,
    publicKey,
  });
}

/**
 * Determines if an invoice should be a full tax invoice (B2B)
 * based on whether the buyer has a VAT number
 */
export function isB2BInvoice(buyerVatNumber?: string | null): boolean {
  return !!buyerVatNumber && buyerVatNumber.trim().length > 0;
}

/**
 * Validates ZATCA QR code format
 * @param base64QR - Base64 encoded QR data
 * @returns Validation result with decoded tags
 */
export function validateZatcaQR(base64QR: string): { valid: boolean; tags: Record<number, string>; errors: string[] } {
  const errors: string[] = [];
  const tags: Record<number, string> = {};
  
  try {
    // Decode Base64
    const binaryString = atob(base64QR);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    // Parse TLV
    let offset = 0;
    while (offset < bytes.length) {
      const tag = bytes[offset];
      const length = bytes[offset + 1];
      const value = new TextDecoder().decode(bytes.slice(offset + 2, offset + 2 + length));
      tags[tag] = value;
      offset += 2 + length;
    }
    
    // Validate required tags
    const requiredTags = [1, 2, 3, 4, 5];
    for (const tagNum of requiredTags) {
      if (!tags[tagNum]) {
        errors.push(`Missing required tag ${tagNum}`);
      }
    }
    
    return { valid: errors.length === 0, tags, errors };
  } catch (e) {
    return { valid: false, tags: {}, errors: ['Invalid Base64 or TLV format'] };
  }
}
