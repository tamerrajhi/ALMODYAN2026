-- ============================================================
-- STAGE-1 FIX — STEP 3b: REVOKE anon EXECUTE (+ PUBLIC) from WRITE RPCs
-- Must revoke from PUBLIC first, then anon, since anon inherits from PUBLIC
-- ============================================================

-- REVOKE from PUBLIC (this is the key - anon inherits from PUBLIC)
REVOKE EXECUTE ON FUNCTION public.complete_imported_serial_transfer_atomic(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_pos_sales_return_atomic(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_purchase_invoice_atomic(uuid, jsonb, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_purchase_invoice_atomic(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_purchase_return_unique_items_atomic(uuid, jsonb, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_sales_invoice_atomic(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_sales_invoice_atomic(uuid, jsonb, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_sales_return_atomic(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_transfer_atomic(uuid, uuid, uuid[], text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_transfer_atomic(jsonb) FROM PUBLIC;

-- Also revoke the ones that were already OK (to be safe)
REVOKE EXECUTE ON FUNCTION public.complete_pos_credit_note_atomic(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_purchase_return_atomic(jsonb) FROM PUBLIC;

-- Re-grant to authenticated and service_role only
GRANT EXECUTE ON FUNCTION public.complete_imported_serial_transfer_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_pos_sales_return_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_purchase_invoice_atomic(uuid, jsonb, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_purchase_invoice_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_unique_items_atomic(uuid, jsonb, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_unique_items_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_sales_invoice_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_sales_invoice_atomic(uuid, jsonb, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_sales_return_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_transfer_atomic(uuid, uuid, uuid[], text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_transfer_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_pos_credit_note_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_atomic(jsonb) TO authenticated;

GRANT EXECUTE ON FUNCTION public.complete_imported_serial_transfer_atomic(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_pos_sales_return_atomic(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_purchase_invoice_atomic(uuid, jsonb, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_purchase_invoice_atomic(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_unique_items_atomic(uuid, jsonb, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_unique_items_atomic(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_sales_invoice_atomic(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_sales_invoice_atomic(uuid, jsonb, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_sales_return_atomic(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_transfer_atomic(uuid, uuid, uuid[], text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_transfer_atomic(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_pos_credit_note_atomic(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_purchase_return_atomic(jsonb) TO service_role;