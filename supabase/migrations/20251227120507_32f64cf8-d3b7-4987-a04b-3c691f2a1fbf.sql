-- Create products table for all types of products (jewelry, services, general)
CREATE TABLE public.products (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    product_code TEXT NOT NULL UNIQUE,
    name_ar TEXT NOT NULL,
    name_en TEXT,
    description TEXT,
    product_type TEXT NOT NULL DEFAULT 'general', -- jewelry, service, general
    category TEXT,
    unit TEXT DEFAULT 'piece', -- piece, gram, kg, service
    
    -- للمجوهرات فقط
    karat TEXT,
    metal TEXT,
    weight_grams NUMERIC(10,3),
    stone_type TEXT,
    
    -- الأسعار
    cost_price NUMERIC(12,2) DEFAULT 0,
    selling_price NUMERIC(12,2) DEFAULT 0,
    min_price NUMERIC(12,2) DEFAULT 0,
    
    -- للخدمات
    is_service BOOLEAN DEFAULT false,
    service_duration_minutes INTEGER,
    
    -- الضرائب
    tax_rate NUMERIC(5,2) DEFAULT 15,
    is_tax_inclusive BOOLEAN DEFAULT false,
    
    -- الحالة
    is_active BOOLEAN DEFAULT true,
    branch_id UUID REFERENCES public.branches(id),
    supplier_id UUID REFERENCES public.suppliers(id),
    
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    created_by UUID
);

-- Enable Row Level Security
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Create policies for products
CREATE POLICY "Authenticated users can view products" 
ON public.products 
FOR SELECT 
USING (true);

CREATE POLICY "Authenticated users can insert products" 
ON public.products 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Authenticated users can update products" 
ON public.products 
FOR UPDATE 
USING (true);

CREATE POLICY "Admins can delete products" 
ON public.products 
FOR DELETE 
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_products_updated_at
BEFORE UPDATE ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for faster searches
CREATE INDEX idx_products_code ON public.products(product_code);
CREATE INDEX idx_products_type ON public.products(product_type);
CREATE INDEX idx_products_active ON public.products(is_active);
CREATE INDEX idx_products_branch ON public.products(branch_id);