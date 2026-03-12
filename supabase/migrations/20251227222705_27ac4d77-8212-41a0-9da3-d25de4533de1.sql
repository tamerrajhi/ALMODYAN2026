-- Create storage bucket for supplier documents if not exists
INSERT INTO storage.buckets (id, name, public)
VALUES ('supplier-documents', 'supplier-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for supplier documents
CREATE POLICY "Authenticated users can view supplier documents"
ON storage.objects FOR SELECT
USING (bucket_id = 'supplier-documents' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can upload supplier documents"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'supplier-documents' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete supplier documents"
ON storage.objects FOR DELETE
USING (bucket_id = 'supplier-documents' AND auth.role() = 'authenticated');