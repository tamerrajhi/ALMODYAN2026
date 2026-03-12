-- Fix profiles table RLS - restrict to owner and admins only
DROP POLICY IF EXISTS "Users can view profiles based on permissions" ON public.profiles;

CREATE POLICY "Users can view own profile"
ON public.profiles
FOR SELECT
TO authenticated
USING (id = auth.uid());

CREATE POLICY "Admins can view all profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Fix audit_logs INSERT policy - only allow users to insert their own actions
DROP POLICY IF EXISTS "Users can insert audit logs" ON public.audit_logs;

CREATE POLICY "Users can insert their own audit logs"
ON public.audit_logs
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

-- Restrict suppliers table to admins and purchasing roles
DROP POLICY IF EXISTS "Authenticated users can view suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Users can view suppliers" ON public.suppliers;

CREATE POLICY "Admins can view all suppliers"
ON public.suppliers
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users with purchasing permission can view suppliers"
ON public.suppliers
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_custom_roles ucr
    JOIN public.role_permissions rp ON rp.role_id = ucr.role_id
    JOIN public.screens s ON s.id = rp.screen_id
    WHERE ucr.user_id = auth.uid()
    AND s.screen_path = '/purchasing/orders'
    AND rp.can_view = true
  )
);