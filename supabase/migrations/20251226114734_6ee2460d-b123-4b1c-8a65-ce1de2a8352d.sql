-- Create backup_logs table to track backup history
CREATE TABLE public.backup_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  backup_type TEXT NOT NULL DEFAULT 'pre_import',
  file_name TEXT NOT NULL,
  tables_included TEXT[] NOT NULL,
  total_records INTEGER DEFAULT 0,
  created_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  notes TEXT
);

-- Enable RLS
ALTER TABLE public.backup_logs ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Authenticated users can view backup logs"
  ON public.backup_logs
  FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can insert backup logs"
  ON public.backup_logs
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Admins can delete backup logs"
  ON public.backup_logs
  FOR DELETE
  USING (has_role(auth.uid(), 'admin'::app_role));