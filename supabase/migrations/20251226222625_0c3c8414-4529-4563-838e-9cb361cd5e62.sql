-- Create function to check if user has access to a module
CREATE OR REPLACE FUNCTION public.user_has_module_access(
    _user_id UUID,
    _module_id VARCHAR(50)
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT 
        -- Admins have access to all modules
        has_role(_user_id, 'admin'::app_role)
        OR
        -- Check if user's custom role has access to the module
        EXISTS (
            SELECT 1
            FROM user_custom_roles ucr
            JOIN role_modules rm ON ucr.role_id = rm.role_id
            WHERE ucr.user_id = _user_id
            AND rm.module_id = _module_id
            AND rm.is_enabled = true
        )
        OR
        -- If no role_modules configured for this module, allow access (default behavior)
        NOT EXISTS (
            SELECT 1 FROM role_modules WHERE module_id = _module_id
        )
$$;

-- Create function to get all accessible modules for a user
CREATE OR REPLACE FUNCTION public.get_user_accessible_modules(_user_id UUID)
RETURNS SETOF VARCHAR(50)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT DISTINCT module_id
    FROM (
        -- If admin, return all enabled modules
        SELECT ms.module_id
        FROM module_settings ms
        WHERE ms.is_enabled = true
        AND has_role(_user_id, 'admin'::app_role)
        
        UNION
        
        -- Get modules from user's custom roles
        SELECT rm.module_id
        FROM user_custom_roles ucr
        JOIN role_modules rm ON ucr.role_id = rm.role_id
        WHERE ucr.user_id = _user_id
        AND rm.is_enabled = true
        
        UNION
        
        -- Include modules that have no role restrictions (available to all)
        SELECT ms.module_id
        FROM module_settings ms
        WHERE ms.is_enabled = true
        AND NOT EXISTS (
            SELECT 1 FROM role_modules WHERE module_id = ms.module_id
        )
    ) accessible_modules
$$;

-- Insert default module access for all existing roles (all modules enabled by default)
INSERT INTO public.role_modules (role_id, module_id, is_enabled)
SELECT cr.id, ms.module_id, true
FROM public.custom_roles cr
CROSS JOIN public.module_settings ms
ON CONFLICT (role_id, module_id) DO NOTHING;