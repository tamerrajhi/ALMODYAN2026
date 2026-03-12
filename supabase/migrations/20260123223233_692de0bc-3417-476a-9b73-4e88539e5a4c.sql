-- Add post_return_status column to returns table
ALTER TABLE public.returns 
ADD COLUMN IF NOT EXISTS post_return_status text DEFAULT 'inspection' 
CHECK (post_return_status IN ('inspection', 'available'));

-- Add comment for documentation
COMMENT ON COLUMN public.returns.post_return_status IS 'Status to set on returned jewelry items: inspection (requires review before resale) or available (immediately available for sale)';