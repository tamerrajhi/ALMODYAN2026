-- =====================================================
-- STEP 5A: M4 Legacy Type-Mismatch Cleanup Migration (v2)
-- =====================================================
-- GOAL: Fix 4 legacy records where purchase_returns.purchase_type = 'general'
--       but linked invoice.purchase_type = 'import'
--
-- ISSUE: trg_lock_posted_general_return blocks purchase_type changes on confirmed returns
-- SOLUTION: Temporarily disable BOTH triggers, apply fix, re-enable both
--
-- EVIDENCE (Captured 2026-01-28):
-- | return_id                              | current_type | invoice_type | status    |
-- |----------------------------------------|--------------|--------------|-----------|
-- | 4c1107e8-308b-4dc0-8e55-2e0b20bdca58   | general      | import       | confirmed |
-- | c21f616c-14dd-4b0e-a82d-d94e9a5cd536   | general      | import       | confirmed |
-- | fade9eeb-9583-40da-8f4e-350ff1a9945a   | general      | import       | confirmed |
-- | f3645721-dcd8-40d6-b188-76c774a7c23a   | general      | import       | voided    |
--
-- TRIGGERS TO TEMPORARILY DISABLE:
-- 1. trg_prevent_purchase_return_type_change - blocks type change after creation
-- 2. trg_lock_posted_general_return - blocks field changes on confirmed/posted
-- =====================================================

-- A) Safety Snapshot (stored as comment evidence)
-- The 4 rows before update:
-- 4c1107e8-308b-4dc0-8e55-2e0b20bdca58: general -> import (linked to 379bbf78-eaca-4fe9-8f86-8b1788ba03fc)
-- c21f616c-14dd-4b0e-a82d-d94e9a5cd536: general -> import (linked to 379bbf78-eaca-4fe9-8f86-8b1788ba03fc)
-- fade9eeb-9583-40da-8f4e-350ff1a9945a: general -> import (linked to 379bbf78-eaca-4fe9-8f86-8b1788ba03fc)
-- f3645721-dcd8-40d6-b188-76c774a7c23a: general -> import (linked to 56086e5e-14b9-41a6-9107-9e6cc9314362)

-- B) Temporarily disable BOTH triggers
DROP TRIGGER IF EXISTS trg_prevent_purchase_return_type_change ON purchase_returns;
DROP TRIGGER IF EXISTS trg_lock_posted_general_return ON purchase_returns;

-- C) Apply Fix (ONLY 4 ROWS) - Set purchase_type to match linked invoice
UPDATE purchase_returns pr
SET purchase_type = inv.purchase_type
FROM invoices inv
WHERE pr.purchase_invoice_id = inv.id
  AND pr.id IN (
    '4c1107e8-308b-4dc0-8e55-2e0b20bdca58',
    'c21f616c-14dd-4b0e-a82d-d94e9a5cd536',
    'fade9eeb-9583-40da-8f4e-350ff1a9945a',
    'f3645721-dcd8-40d6-b188-76c774a7c23a'
  )
  AND pr.purchase_type IS DISTINCT FROM inv.purchase_type;

-- D) Re-create BOTH triggers with EXACT same definitions

-- D1: Type-change prevention trigger
CREATE TRIGGER trg_prevent_purchase_return_type_change
  BEFORE UPDATE ON public.purchase_returns
  FOR EACH ROW
  EXECUTE FUNCTION prevent_purchase_return_type_change();

-- D2: Lock posted general return trigger
CREATE TRIGGER trg_lock_posted_general_return
  BEFORE UPDATE ON public.purchase_returns
  FOR EACH ROW
  EXECUTE FUNCTION guard_posted_general_return();