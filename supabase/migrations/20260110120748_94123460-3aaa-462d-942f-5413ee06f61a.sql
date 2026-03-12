-- Index for searching invoices by number
CREATE INDEX IF NOT EXISTS idx_invoices_purchase_search 
ON invoices (invoice_number) 
WHERE invoice_type = 'purchase';

-- Index for fetching items by purchase invoice
CREATE INDEX IF NOT EXISTS idx_jewelry_items_purchase_invoice_unsold
ON jewelry_items (purchase_invoice_id)
WHERE sold_at IS NULL;