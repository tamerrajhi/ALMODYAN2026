-- Migration: Add 'reversed' to journal_entries.status CHECK constraint
-- Required for payment_voucher_update_atomic and payment_voucher_void_atomic RPCs
-- which mark old journal entries as 'reversed' when creating reversal entries

ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_status_check;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_status_check 
  CHECK (status = ANY (ARRAY['draft'::text, 'posted'::text, 'voided'::text, 'reversed'::text]));
