/**
 * DTO for invoice posting diagnostics
 * Used to display why accounting posting succeeded or failed
 */
export interface InvoicePostingDTO {
  invoice_id: string;
  invoice_number: string;
  batch_id: string | null;
  invoice_total_amount: number;
  lines_total_amount: number;
  items_total_cost: number;
  chosen_total_source: 'invoice' | 'lines' | 'items' | 'none';
  chosen_total: number;
}

/**
 * Response from post-invoice-accounting edge function
 */
export interface PostInvoiceAccountingResponse {
  success?: boolean;
  already_exists?: boolean;
  journal_entry_id?: string;
  entry_number?: string;
  message?: string;
  error?: string;
  details?: string;
  diagnostics?: InvoicePostingDTO;
}
