-- =====================================================
-- Stage 0 Cleanup: Drop orphaned functions from deleted
-- "Excel Payment Batches Import Center" module
-- =====================================================

DROP FUNCTION IF EXISTS public.generate_import_payment_batch_number();
DROP FUNCTION IF EXISTS public.update_import_payment_batch_stats();