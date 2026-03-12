-- =============================================
-- Fix: compatibility column expected by unique return RPC
-- Error: column "return_reason" of relation "purchase_returns" does not exist
-- Approach: add return_reason column + keep it in sync with existing reason
-- =============================================

-- 1) Add the missing column (safe: nullable)
ALTER TABLE public.purchase_returns
ADD COLUMN IF NOT EXISTS return_reason text;

-- 2) Sync helper to keep reason/return_reason aligned (backward/forward compatibility)
CREATE OR REPLACE FUNCTION public.trg_sync_purchase_return_reason_cols()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Prefer explicitly provided values; otherwise copy from the other column.
  IF NEW.return_reason IS NULL OR NEW.return_reason = '' THEN
    NEW.return_reason := NEW.reason;
  END IF;

  IF NEW.reason IS NULL OR NEW.reason = '' THEN
    NEW.reason := NEW.return_reason;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_purchase_return_reason_cols ON public.purchase_returns;
CREATE TRIGGER trg_sync_purchase_return_reason_cols
BEFORE INSERT OR UPDATE ON public.purchase_returns
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_purchase_return_reason_cols();