-- =========================================================
-- P4-9 (D) FIX-ONLY: Restore EXECUTE grants for ERP Sales Returns RPCs
-- الهدف: فكّ Blocker Gate C2 فقط
-- ممنوع: تعديل منطق الدوال / RLS / UI
-- =========================================================

-- 1) امنع PUBLIC دائماً (Hardening)
REVOKE EXECUTE ON FUNCTION public.complete_erp_sales_return_atomic(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.void_erp_sales_return_atomic(jsonb) FROM PUBLIC;

-- 2) اسمح للأدوار التي ينادي بها التطبيق
GRANT EXECUTE ON FUNCTION public.complete_erp_sales_return_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_erp_sales_return_atomic(jsonb) TO service_role;

GRANT EXECUTE ON FUNCTION public.void_erp_sales_return_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_erp_sales_return_atomic(jsonb) TO service_role;