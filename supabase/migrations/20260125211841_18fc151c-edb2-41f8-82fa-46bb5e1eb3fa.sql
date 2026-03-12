-- FIX: pos_fail_request must provide a placeholder payload_hash for INSERT path
-- The ON CONFLICT UPDATE path is correct, but INSERT needs a non-null hash

CREATE OR REPLACE FUNCTION public.pos_fail_request(
  p_client_request_id uuid, 
  p_error_code text, 
  p_error_message text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Upsert: if row exists update it, otherwise insert as failed
  -- Use 'guard_fail_no_begin' as placeholder hash when inserting without prior begin
  INSERT INTO public.pos_workflow_requests (
    client_request_id,
    workflow_type,
    status,
    payload_hash,
    error_code,
    error_message,
    created_at,
    updated_at
  ) VALUES (
    p_client_request_id,
    'unknown',
    'failed',
    'guard_fail_no_begin',  -- Placeholder for guard failures that skip begin
    p_error_code,
    p_error_message,
    now(),
    now()
  )
  ON CONFLICT (client_request_id) DO UPDATE
  SET status = 'failed',
      error_code = p_error_code,
      error_message = p_error_message,
      updated_at = now();
END;
$function$;