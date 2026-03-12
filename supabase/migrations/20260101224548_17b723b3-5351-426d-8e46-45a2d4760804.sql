-- Create zatca_settings table
CREATE TABLE public.zatca_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Environment settings
  environment TEXT NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),
  is_active BOOLEAN DEFAULT false,
  api_base_url TEXT DEFAULT 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal',
  
  -- CSR data
  csr_common_name TEXT,
  csr_organization_unit TEXT,
  csr_organization TEXT,
  csr_country TEXT DEFAULT 'SA',
  csr_serial_number TEXT,
  csr_location TEXT,
  csr_industry TEXT,
  
  -- Certificates
  otp TEXT,
  private_key TEXT,
  compliance_csid TEXT,
  compliance_csid_secret TEXT,
  production_csid TEXT,
  production_csid_secret TEXT,
  csid_expiry TIMESTAMPTZ,
  
  -- Registration status
  onboarding_status TEXT DEFAULT 'not_started' CHECK (onboarding_status IN ('not_started', 'compliance_pending', 'compliance_completed', 'production_pending', 'completed')),
  last_invoice_hash TEXT,
  invoice_counter INTEGER DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.zatca_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Admins can manage zatca settings" ON public.zatca_settings
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated users can view zatca settings" ON public.zatca_settings
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Create zatca_logs table
CREATE TABLE public.zatca_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  request_payload TEXT,
  response_payload JSONB,
  http_status INTEGER,
  success BOOLEAN DEFAULT false,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT
);

-- Enable RLS
ALTER TABLE public.zatca_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for zatca_logs
CREATE POLICY "Admins can manage zatca logs" ON public.zatca_logs
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated users can view zatca logs" ON public.zatca_logs
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Add ZATCA columns to invoices table
ALTER TABLE public.invoices 
  ADD COLUMN IF NOT EXISTS zatca_uuid UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS zatca_invoice_type TEXT DEFAULT 'simplified' CHECK (zatca_invoice_type IN ('standard', 'simplified')),
  ADD COLUMN IF NOT EXISTS zatca_status TEXT DEFAULT 'pending' CHECK (zatca_status IN ('pending', 'processing', 'cleared', 'reported', 'rejected', 'warning')),
  ADD COLUMN IF NOT EXISTS zatca_clearance_id TEXT,
  ADD COLUMN IF NOT EXISTS zatca_reporting_id TEXT,
  ADD COLUMN IF NOT EXISTS zatca_signed_xml TEXT,
  ADD COLUMN IF NOT EXISTS zatca_cleared_xml TEXT,
  ADD COLUMN IF NOT EXISTS zatca_qr_code TEXT,
  ADD COLUMN IF NOT EXISTS zatca_previous_hash TEXT,
  ADD COLUMN IF NOT EXISTS zatca_invoice_hash TEXT,
  ADD COLUMN IF NOT EXISTS zatca_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS zatca_response JSONB,
  ADD COLUMN IF NOT EXISTS zatca_error_message TEXT,
  ADD COLUMN IF NOT EXISTS zatca_is_locked BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS zatca_invoice_counter INTEGER;

-- Create trigger to update updated_at on zatca_settings
CREATE TRIGGER update_zatca_settings_updated_at
  BEFORE UPDATE ON public.zatca_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default settings row
INSERT INTO public.zatca_settings (id) 
VALUES (gen_random_uuid())
ON CONFLICT DO NOTHING;