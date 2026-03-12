-- Create the missing payment_unallocated_events table
-- This table tracks events when payments are allowed without allocations (exceptions)
CREATE TABLE IF NOT EXISTS public.payment_unallocated_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID REFERENCES public.payments(id),
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID
);

-- Enable RLS
ALTER TABLE public.payment_unallocated_events ENABLE ROW LEVEL SECURITY;

-- Create policy for authenticated users to read
CREATE POLICY "Authenticated users can view payment_unallocated_events"
  ON public.payment_unallocated_events
  FOR SELECT
  TO authenticated
  USING (true);

-- Create policy for authenticated users to insert (for tracking exceptions)
CREATE POLICY "Authenticated users can insert payment_unallocated_events"
  ON public.payment_unallocated_events
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

COMMENT ON TABLE public.payment_unallocated_events IS 'Tracks exceptions where supplier payments are allowed without invoice allocations';