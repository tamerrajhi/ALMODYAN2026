-- Add new columns to transfers table for status, approval workflow, and reversal
ALTER TABLE transfers 
ADD COLUMN IF NOT EXISTS status text DEFAULT 'posted' CHECK (status IN ('draft', 'awaiting_approval', 'approved', 'posted', 'reversed')),
ADD COLUMN IF NOT EXISTS purchase_invoice_id uuid REFERENCES invoices(id),
ADD COLUMN IF NOT EXISTS journal_entry_id uuid REFERENCES journal_entries(id),
ADD COLUMN IF NOT EXISTS total_cost numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS approved_at timestamptz,
ADD COLUMN IF NOT EXISTS approved_by text,
ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
ADD COLUMN IF NOT EXISTS reversed_by text,
ADD COLUMN IF NOT EXISTS reverse_journal_entry_id uuid REFERENCES journal_entries(id),
ADD COLUMN IF NOT EXISTS reversal_reason text;

-- Add cost and journal_entry_id to item_movements table
ALTER TABLE item_movements
ADD COLUMN IF NOT EXISTS cost numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS journal_entry_id uuid REFERENCES journal_entries(id);

-- Update existing transfers to 'posted' status
UPDATE transfers SET status = 'posted' WHERE status IS NULL;

-- Create index for transfer status filtering
CREATE INDEX IF NOT EXISTS idx_transfers_status ON transfers(status);
CREATE INDEX IF NOT EXISTS idx_transfers_purchase_invoice ON transfers(purchase_invoice_id);

-- Create index for item_movements reference lookups
CREATE INDEX IF NOT EXISTS idx_item_movements_journal ON item_movements(journal_entry_id);

-- Add comment for documentation
COMMENT ON COLUMN transfers.status IS 'Transfer status: draft, awaiting_approval, approved, posted, reversed';