
-- Create missing record_allow_unallocated_event_atomic function
CREATE OR REPLACE FUNCTION public.record_allow_unallocated_event_atomic(
  p_client_request_id uuid,
  p_payment_id uuid,
  p_actor_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_event_id uuid;
  v_existing record;
BEGIN
  -- IDEMPOTENCY CHECK
  SELECT id INTO v_existing FROM payment_unallocated_events WHERE client_request_id = p_client_request_id;
  
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'event_id', v_existing.id
    );
  END IF;
  
  -- Insert event
  INSERT INTO payment_unallocated_events (
    client_request_id,
    payment_id,
    actor_id,
    reason,
    created_at
  ) VALUES (
    p_client_request_id,
    p_payment_id,
    p_actor_id,
    p_reason,
    NOW()
  )
  RETURNING id INTO v_event_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'event_id', v_event_id,
    'payment_id', p_payment_id
  );
END;
$$;

-- Grant execute to authenticated
REVOKE ALL ON FUNCTION public.record_allow_unallocated_event_atomic(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_allow_unallocated_event_atomic(uuid, uuid, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.record_allow_unallocated_event_atomic(uuid, uuid, uuid, text) IS 'Phase 3-B: Record allow_unallocated event with idempotency';
