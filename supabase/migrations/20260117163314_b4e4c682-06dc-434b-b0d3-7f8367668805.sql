
-- Add hold_lock_test to valid workflow types
ALTER TABLE public.pos_workflow_requests
DROP CONSTRAINT IF EXISTS valid_workflow_type;

ALTER TABLE public.pos_workflow_requests
ADD CONSTRAINT valid_workflow_type CHECK (
  workflow_type = ANY (ARRAY[
    'pos_sale',
    'pos_return',
    'sales_invoice',
    'sales_return',
    'purchase_invoice',
    'purchase_return',
    'purchase_return_unique',
    'purchase_return_general',
    'purchase_receipt',
    'customer_receipt',
    'supplier_payment',
    'transfer',
    'imported_serial_transfer',
    'inventory_adjustment',
    'work_order',
    'daily_settlement',
    'idempotency_smoke',
    'convert_prs_to_pos',
    'hold_lock_test'
  ]::text[])
);
