-- Revoke all then re-grant to authenticated
REVOKE ALL ON FUNCTION public.get_monitoring_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_monitoring_summary() TO authenticated;