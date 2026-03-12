-- Create role_modules table to link custom_roles with modules
CREATE TABLE IF NOT EXISTS public.role_modules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id UUID NOT NULL REFERENCES public.custom_roles(id) ON DELETE CASCADE,
    module_id VARCHAR(50) NOT NULL,
    is_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(role_id, module_id)
);

-- Enable RLS
ALTER TABLE public.role_modules ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Admins can manage role modules"
ON public.role_modules
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated users can view role modules"
ON public.role_modules
FOR SELECT
USING (true);

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_role_modules_role_id ON public.role_modules(role_id);
CREATE INDEX IF NOT EXISTS idx_role_modules_module_id ON public.role_modules(module_id);