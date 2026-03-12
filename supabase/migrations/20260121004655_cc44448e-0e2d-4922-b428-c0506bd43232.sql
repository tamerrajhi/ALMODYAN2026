-- ============================================================
-- STAGE-1 FIX — STEP 3: REVOKE anon EXECUTE from WRITE RPCs
-- Scope: only remove EXECUTE from role "anon" for the flagged variants
-- Keep: authenticated + service_role as-is
-- ============================================================

-- 1) REVOKE from anon (only the RISK ones)
REVOKE EXECUTE ON FUNCTION public.complete_imported_serial_transfer_atomic(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.complete_pos_sales_return_atomic(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.complete_purchase_invoice_atomic(uuid, jsonb, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.complete_purchase_invoice_atomic(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.complete_purchase_return_unique_items_atomic(uuid, jsonb, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.complete_sales_invoice_atomic(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.complete_sales_invoice_atomic(uuid, jsonb, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.complete_sales_return_atomic(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_transfer_atomic(uuid, uuid, uuid[], text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_transfer_atomic(jsonb) FROM anon;

-- 2) SAFETY: Ensure authenticated keeps EXECUTE (idempotent)
GRANT EXECUTE ON FUNCTION public.complete_imported_serial_transfer_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_pos_sales_return_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_purchase_invoice_atomic(uuid, jsonb, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_purchase_invoice_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_unique_items_atomic(uuid, jsonb, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_sales_invoice_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_sales_invoice_atomic(uuid, jsonb, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_sales_return_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_transfer_atomic(uuid, uuid, uuid[], text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_transfer_atomic(jsonb) TO authenticated;