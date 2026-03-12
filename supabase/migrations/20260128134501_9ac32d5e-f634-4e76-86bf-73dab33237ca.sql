-- ============================================================
-- D2-5.2 | Phase B — SAFE Legacy Cleanup (Disable legacy triggers + NO-OP functions + security)
-- Goal: Remove legacy side-effects WITHOUT breaking system.
-- Strategy: disable legacy triggers; keep functions as NO-OP wrappers; keep backups for rollback.
-- ============================================================

-- ------------------------------------------------------------
-- B1) SECURITY: REVOKE anon EXECUTE on atomic RPCs (HIGH RISK GAP)
-- NOTE: Keep service_role + authenticated. Adjust if you use other roles.
-- ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.complete_purchase_return_general_atomic(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.complete_purchase_return_unique_items_atomic(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.void_purchase_return_atomic(jsonb) FROM anon;

-- Ensure authenticated/service_role have execute
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_general_atomic(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_unique_items_atomic(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.void_purchase_return_atomic(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.complete_purchase_return_general_atomic(jsonb) IS
  'D2-5.2 B1: SECURITY — anon EXECUTE revoked. Canonical atomic RPC.';
COMMENT ON FUNCTION public.complete_purchase_return_unique_items_atomic(jsonb) IS
  'D2-5.2 B1: SECURITY — anon EXECUTE revoked. Canonical atomic RPC.';
COMMENT ON FUNCTION public.void_purchase_return_atomic(jsonb) IS
  'D2-5.2 B1: SECURITY — anon EXECUTE revoked. Canonical atomic RPC.';

-- ------------------------------------------------------------
-- B2) DISABLE legacy triggers to stop overlapping mechanisms
-- Keep canonical triggers intact.
-- ------------------------------------------------------------

-- invoices legacy trigger
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE t.tgname = 'update_linked_invoice_on_return_trigger'
      AND c.relname = 'invoices'
  ) THEN
    EXECUTE 'ALTER TABLE public.invoices DISABLE TRIGGER update_linked_invoice_on_return_trigger';
  END IF;
END $$;

-- purchase_invoice_lines legacy triggers
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE t.tgname = 'update_invoice_after_return_trigger'
      AND c.relname = 'purchase_invoice_lines'
  ) THEN
    EXECUTE 'ALTER TABLE public.purchase_invoice_lines DISABLE TRIGGER update_invoice_after_return_trigger';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE t.tgname = 'restore_on_purchase_return_line_delete'
      AND c.relname = 'purchase_invoice_lines'
  ) THEN
    EXECUTE 'ALTER TABLE public.purchase_invoice_lines DISABLE TRIGGER restore_on_purchase_return_line_delete';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE t.tgname = 'validate_purchase_return_qty_trigger'
      AND c.relname = 'purchase_invoice_lines'
  ) THEN
    EXECUTE 'ALTER TABLE public.purchase_invoice_lines DISABLE TRIGGER validate_purchase_return_qty_trigger';
  END IF;
END $$;

-- ------------------------------------------------------------
-- B3) Make legacy trigger functions NO-OP (with backups)
-- Reason: even if someone re-enables triggers by mistake, functions do nothing.
-- ------------------------------------------------------------

-- 3.1 update_invoice_after_purchase_return (trigger)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'update_invoice_after_purchase_return'
      AND n.nspname = 'public'
  ) THEN
    ALTER FUNCTION public.update_invoice_after_purchase_return() RENAME TO update_invoice_after_purchase_return_d2_5_2_backup;
  END IF;
EXCEPTION WHEN undefined_function THEN
  NULL;
END $$;

CREATE OR REPLACE FUNCTION public.update_invoice_after_purchase_return()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- D2-5.2: NO-OP legacy mirror logic disabled. Canonical triggers handle totals/returned_qty.
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.update_invoice_after_purchase_return() IS
  'D2-5.2 B3: LEGACY NO-OP wrapper. Original renamed to update_invoice_after_purchase_return_d2_5_2_backup.';

-- 3.2 update_linked_invoice_on_return_change (trigger)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'update_linked_invoice_on_return_change'
      AND n.nspname = 'public'
  ) THEN
    ALTER FUNCTION public.update_linked_invoice_on_return_change() RENAME TO update_linked_invoice_on_return_change_d2_5_2_backup;
  END IF;
EXCEPTION WHEN undefined_function THEN
  NULL;
END $$;

CREATE OR REPLACE FUNCTION public.update_linked_invoice_on_return_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- D2-5.2: NO-OP legacy totals mirror recalc disabled. Canonical totals trigger exists.
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.update_linked_invoice_on_return_change() IS
  'D2-5.2 B3: LEGACY NO-OP wrapper. Original renamed to update_linked_invoice_on_return_change_d2_5_2_backup.';

-- 3.3 restore_inventory_on_purchase_return_delete (trigger)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'restore_inventory_on_purchase_return_delete'
      AND n.nspname = 'public'
  ) THEN
    ALTER FUNCTION public.restore_inventory_on_purchase_return_delete() RENAME TO restore_inventory_on_purchase_return_delete_d2_5_2_backup;
  END IF;
EXCEPTION WHEN undefined_function THEN
  NULL;
END $$;

CREATE OR REPLACE FUNCTION public.restore_inventory_on_purchase_return_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- D2-5.2: NO-OP legacy delete restore disabled. Canonical flow should manage inventory correctly.
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.restore_inventory_on_purchase_return_delete() IS
  'D2-5.2 B3: LEGACY NO-OP wrapper. Original renamed to restore_inventory_on_purchase_return_delete_d2_5_2_backup.';

-- 3.4 validate_purchase_return_quantity (trigger) — keep as NO-OP to avoid blocking writes
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'validate_purchase_return_quantity'
      AND n.nspname = 'public'
  ) THEN
    ALTER FUNCTION public.validate_purchase_return_quantity() RENAME TO validate_purchase_return_quantity_d2_5_2_backup;
  END IF;
EXCEPTION WHEN undefined_function THEN
  NULL;
END $$;

CREATE OR REPLACE FUNCTION public.validate_purchase_return_quantity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
BEGIN
  -- D2-5.2: NO-OP legacy mirror-based validation disabled.
  -- Canonical atomic RPC should enforce quantities.
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.validate_purchase_return_quantity() IS
  'D2-5.2 B3: LEGACY NO-OP wrapper. Original renamed to validate_purchase_return_quantity_d2_5_2_backup.';

-- ------------------------------------------------------------
-- B4) Drop one-time helpers (safe per Evidence: no active calls)
-- Keep backups not needed; these are helpers not triggers.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.backfill_truly_orphan_purchase_returns();
DROP FUNCTION IF EXISTS public.repair_purchase_return_je_lines(uuid);

-- ============================================================
-- END D2-5.2 Phase B
-- ============================================================