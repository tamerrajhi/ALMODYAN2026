-- C-CLOSURE Migration: Fix schema + data integrity

-- Step 1: Make invoice_id nullable (canonical model uses return_id)
ALTER TABLE public.purchase_return_lines 
  ALTER COLUMN invoice_id DROP NOT NULL;

-- Step 2: Fix item_type default from 'jewelry' to 'cost' for general track
ALTER TABLE public.purchase_return_lines 
  ALTER COLUMN item_type SET DEFAULT 'cost';