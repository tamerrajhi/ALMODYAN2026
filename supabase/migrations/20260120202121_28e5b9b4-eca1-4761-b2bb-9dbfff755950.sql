-- Grant execute permission on get_monitoring_summary to authenticated users
GRANT EXECUTE ON FUNCTION public.get_monitoring_summary() TO authenticated;