-- Create attachments table for storing file metadata
CREATE TABLE public.attachments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  related_module TEXT NOT NULL,
  related_record_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  google_file_id TEXT,
  file_size INTEGER,
  uploaded_by_user_id UUID,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attachment_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes for common queries
CREATE INDEX idx_attachments_related ON public.attachments (related_module, related_record_id);
CREATE INDEX idx_attachments_type ON public.attachments (attachment_type);
CREATE INDEX idx_attachments_user ON public.attachments (uploaded_by_user_id);

-- Enable RLS
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;

-- Policy: Authenticated users can view all attachments
CREATE POLICY "attachments_select_policy" ON public.attachments
  FOR SELECT TO authenticated USING (true);

-- Policy: Authenticated users can insert attachments
CREATE POLICY "attachments_insert_policy" ON public.attachments
  FOR INSERT TO authenticated WITH CHECK (true);

-- Policy: Users can only delete their own attachments
CREATE POLICY "attachments_delete_policy" ON public.attachments
  FOR DELETE TO authenticated USING (uploaded_by_user_id = auth.uid());