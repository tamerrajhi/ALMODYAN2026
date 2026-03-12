-- P4-3: Create pos_sale_requests table for idempotency tracking
-- This table is required by complete_pos_sale_atomic RPC

CREATE TABLE IF NOT EXISTS public.pos_sale_requests (
  client_request_id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'succeeded', 'failed')),
  payload_hash text,
  sale_id uuid,
  invoice_id uuid,
  journal_entry_id uuid,
  error_message text,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_pos_sale_requests_status ON public.pos_sale_requests(status);
CREATE INDEX IF NOT EXISTS idx_pos_sale_requests_created_at ON public.pos_sale_requests(created_at);

-- Enable RLS (restrict to system/service role operations)
ALTER TABLE public.pos_sale_requests ENABLE ROW LEVEL SECURITY;

-- Only allow authenticated users to view their own requests (optional - RPC runs as definer)
-- The RPC uses SECURITY DEFINER so it bypasses RLS

COMMENT ON TABLE public.pos_sale_requests IS 'P4-3: Idempotency tracking for POS sales atomic operations';