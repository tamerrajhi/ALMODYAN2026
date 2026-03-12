-- Drop all 6 functions first to allow return type changes
DROP FUNCTION IF EXISTS public.get_negative_remaining_list(date, date, uuid, uuid);
DROP FUNCTION IF EXISTS public.get_allow_unallocated_list(date, date, uuid, uuid);
DROP FUNCTION IF EXISTS public.get_formula_mismatch_list(date, date, uuid, uuid);
DROP FUNCTION IF EXISTS public.get_overpaid_list(date, date, uuid, uuid);
DROP FUNCTION IF EXISTS public.get_hb_legacy_list(date, date, uuid, uuid);
DROP FUNCTION IF EXISTS public.get_hb_new_violations_list(date, date, uuid, uuid);