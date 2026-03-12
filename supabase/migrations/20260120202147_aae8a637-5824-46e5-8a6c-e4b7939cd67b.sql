-- Grant execute permissions on all drill-down list functions to authenticated users (with correct signatures)
GRANT EXECUTE ON FUNCTION public.get_hb_legacy_list(date, date, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_hb_new_violations_list(date, date, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_allow_unallocated_list(date, date, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_formula_mismatch_list(date, date, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_negative_remaining_list(date, date, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_overpaid_list(date, date, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_stuck_workflows_list(text, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_unbalanced_je_list(date, date, text) TO authenticated;