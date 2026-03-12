-- Create company_settings table for letterhead and company info
CREATE TABLE public.company_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_name VARCHAR(255) NOT NULL DEFAULT 'اسم الشركة',
  company_name_en VARCHAR(255) DEFAULT 'Company Name',
  logo_url TEXT,
  commercial_registration VARCHAR(50),
  tax_number VARCHAR(50),
  address TEXT,
  address_en TEXT,
  city VARCHAR(100),
  city_en VARCHAR(100),
  country VARCHAR(100) DEFAULT 'المملكة العربية السعودية',
  country_en VARCHAR(100) DEFAULT 'Saudi Arabia',
  phone VARCHAR(50),
  email VARCHAR(255),
  website VARCHAR(255),
  postal_code VARCHAR(20),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read company settings
CREATE POLICY "Anyone can view company settings"
ON public.company_settings
FOR SELECT
USING (true);

-- Only admins can modify company settings
CREATE POLICY "Admins can manage company settings"
ON public.company_settings
FOR ALL
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Insert default company settings
INSERT INTO public.company_settings (
  company_name, 
  company_name_en, 
  country, 
  country_en
) VALUES (
  'اسم الشركة',
  'Company Name',
  'المملكة العربية السعودية',
  'Saudi Arabia'
);

-- Create trigger for updated_at
CREATE TRIGGER update_company_settings_updated_at
BEFORE UPDATE ON public.company_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();