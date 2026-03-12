-- Create label_print_logs table for tracking print jobs
CREATE TABLE public.label_print_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  items_count INTEGER NOT NULL,
  labels_count INTEGER NOT NULL,
  printer_name TEXT,
  zpl_hash TEXT,
  status TEXT DEFAULT 'success',
  error_message TEXT,
  item_serials JSONB
);

-- Enable Row Level Security
ALTER TABLE public.label_print_logs ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to insert their own logs
CREATE POLICY "Users can insert their own print logs"
  ON public.label_print_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Allow users to view their own logs
CREATE POLICY "Users can view their own print logs"
  ON public.label_print_logs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);