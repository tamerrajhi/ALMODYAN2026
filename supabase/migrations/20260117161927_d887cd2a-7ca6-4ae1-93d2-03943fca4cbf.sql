-- Add 'idempotency_smoke' to valid_workflow_type constraint on pos_workflow_requests
-- This is needed for the smoke test RPC

-- Drop existing constraint
ALTER TABLE public.pos_workflow_requests 
DROP CONSTRAINT IF EXISTS valid_workflow_type;

-- Add updated constraint with idempotency_smoke
ALTER TABLE public.pos_workflow_requests
ADD CONSTRAINT valid_workflow_type CHECK (
  workflow_type = ANY (ARRAY[
    'pos_sale'::text, 
    'pos_return'::text, 
    'sales_invoice'::text, 
    'sales_return'::text, 
    'purchase_invoice'::text, 
    'purchase_return'::text, 
    'purchase_return_unique'::text, 
    'purchase_return_general'::text, 
    'purchase_receipt'::text, 
    'customer_receipt'::text, 
    'supplier_payment'::text, 
    'transfer'::text, 
    'imported_serial_transfer'::text, 
    'inventory_adjustment'::text, 
    'work_order'::text, 
    'daily_settlement'::text,
    'idempotency_smoke'::text,
    'convert_prs_to_pos'::text
  ])
);