-- S-Clean-3: RLS Hardening for jewelry_items and item_movements
-- Remove risky broad RLS policies that enable legacy direct writes

-- =============================================================================
-- PART 1: HARDEN jewelry_items UPDATE policy
-- =============================================================================

-- Drop the overly permissive UPDATE policy
DROP POLICY IF EXISTS "Authenticated users can update items for transfers" ON public.jewelry_items;

-- Create hardened UPDATE policy: only admin role can update directly
-- (SECURITY DEFINER RPCs and service_role bypass RLS automatically)
CREATE POLICY "jewelry_items_update_hardened"
ON public.jewelry_items
FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
);

-- =============================================================================
-- PART 2: HARDEN item_movements INSERT policy
-- =============================================================================

-- Drop the overly permissive INSERT policy
DROP POLICY IF EXISTS "Authenticated users can insert item_movements" ON public.item_movements;

-- Create hardened INSERT policy: only admin role can insert directly
-- (SECURITY DEFINER RPCs and service_role bypass RLS automatically)
CREATE POLICY "item_movements_insert_hardened"
ON public.item_movements
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
);