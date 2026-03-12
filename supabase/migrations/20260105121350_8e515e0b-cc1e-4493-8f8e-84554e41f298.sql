-- Create the erp-attachments storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('erp-attachments', 'erp-attachments', true)
ON CONFLICT (id) DO NOTHING;

-- Add storage columns to attachments table if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'attachments' 
    AND column_name = 'storage_bucket'
  ) THEN
    ALTER TABLE public.attachments ADD COLUMN storage_bucket TEXT;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'attachments' 
    AND column_name = 'storage_path'
  ) THEN
    ALTER TABLE public.attachments ADD COLUMN storage_path TEXT;
  END IF;
END $$;

-- Storage policies for erp-attachments bucket
-- Allow authenticated users to upload files
CREATE POLICY "Authenticated users can upload to erp-attachments"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'erp-attachments');

-- Allow authenticated users to read files
CREATE POLICY "Authenticated users can read from erp-attachments"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'erp-attachments');

-- Allow users to delete their own files (based on owner column)
CREATE POLICY "Users can delete their own files from erp-attachments"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'erp-attachments' AND auth.uid()::text = owner_id::text);