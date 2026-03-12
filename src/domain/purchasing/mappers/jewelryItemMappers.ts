/**
 * Jewelry Item Mappers - Transform raw database rows to DTOs
 */

import type { JewelryItemDTO } from '../dto';

// ===========================
// Type Definitions for Raw Rows
// ===========================

interface RawJewelryItemRow {
  id: string;
  item_code: string;
  description: string | null;
  status: string | null;
  sale_status: string | null;
  gold_weight: number | null;
  total_weight: number | null;
  karat_id: string | null;
  unit_price: number | null;
  total_cost: number | null;
  branch_id: string | null;
  supplier_id: string | null;
  purchase_invoice_id: string | null;
  batch_id: string | null;
  gold_karats?: {
    karat_name: string;
  } | null;
  branches?: {
    branch_name: string;
  } | null;
  suppliers?: {
    supplier_name: string;
  } | null;
}

// ===========================
// Mapper Functions
// ===========================

/**
 * Normalize nullable number to 0
 */
function n(value: number | null | undefined): number {
  return value ?? 0;
}

/**
 * Map raw jewelry item row to DTO
 */
export function mapJewelryItemRowToDTO(row: RawJewelryItemRow): JewelryItemDTO {
  return {
    id: row.id,
    itemCode: row.item_code,
    description: row.description,
    
    // Status (with defaults)
    status: row.status ?? 'available',
    saleStatus: row.sale_status ?? 'available',
    
    // Gold details (normalized)
    goldWeight: n(row.gold_weight),
    totalWeight: n(row.total_weight),
    karatId: row.karat_id,
    karatName: row.gold_karats?.karat_name ?? null,
    
    // Pricing (normalized)
    unitPrice: n(row.unit_price),
    totalCost: n(row.total_cost),
    
    // Location
    branchId: row.branch_id,
    branchName: row.branches?.branch_name ?? null,
    
    // Relations
    supplierId: row.supplier_id,
    supplierName: row.suppliers?.supplier_name ?? null,
    purchaseInvoiceId: row.purchase_invoice_id,
    batchId: row.batch_id,
  };
}

/**
 * Map array of raw jewelry item rows to DTOs
 */
export function mapJewelryItemRowsToDTO(rows: RawJewelryItemRow[]): JewelryItemDTO[] {
  return rows.map(mapJewelryItemRowToDTO);
}
