-- ============================================================
-- D2-5.3 | Phase B — SAFE Hardening
-- B1: Revoke anon/PUBLIC from atomic RPCs + regrant to authenticated/service_role
-- B2: Mark mirror view deprecated (no drop)
-- B3: Backfill invoices.total_returned_amount drift (idempotent)
-- ============================================================

-- ------------------------------------------------------------
-- B1) SECURITY HARDENING
-- Revoke EXECUTE from anon + PUBLIC for all public.*_atomic functions
-- Then regrant only to authenticated + service_role.
-- ------------------------------------------------------------

DO $$
DECLARE
  r RECORD;
  v_sig TEXT;
BEGIN
  FOR r IN
    SELECT
      n.nspname AS schema_name,
      p.proname AS func_name,
      pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (
        p.proname LIKE '%\_atomic' ESCAPE '\'
        OR p.proname IN ('atomic_begin_request', 'atomic_success', 'atomic_failed')
      )
  LOOP
    v_sig := format('%I.%I(%s)', r.schema_name, r.func_name, r.args);

    -- Revoke from PUBLIC first (covers inherited perms)
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC;', v_sig);

    -- Revoke from anon explicitly
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon;', v_sig);

    -- Regrant to authenticated + service_role
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated;', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role;', v_sig);
  END LOOP;
END $$;

-- Governance comments on critical entrypoints
COMMENT ON FUNCTION public.purchase_invoice_create_atomic(jsonb) IS
  'D2-5.3 B1: SECURITY — anon/PUBLIC EXECUTE revoked; granted only to authenticated/service_role.';
COMMENT ON FUNCTION public.purchase_order_receive_v2_atomic(jsonb) IS
  'D2-5.3 B1: SECURITY — anon/PUBLIC EXECUTE revoked; granted only to authenticated/service_role.';
COMMENT ON FUNCTION public.complete_sales_invoice_atomic(uuid) IS
  'D2-5.3 B1: SECURITY — anon/PUBLIC EXECUTE revoked; granted only to authenticated/service_role.';

-- ------------------------------------------------------------
-- B2) MIRROR ARTIFACTS — DEPRECATION ONLY (NO DROP)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public'
      AND c.relkind IN ('v','m')
      AND c.relname='v_purchase_return_invoices_mirror'
  ) THEN
    EXECUTE $c$
      COMMENT ON VIEW public.v_purchase_return_invoices_mirror IS
      'DEPRECATED (D2-5.3 B2): Legacy compatibility view for older reports/screens. Do not write against it. Canonical flows use purchase_returns + purchase_return_lines + purchase_invoice_lines.';
    $c$;
  END IF;
END $$;

-- ------------------------------------------------------------
-- B3) ONE-TIME/IDEMPOTENT BACKFILL — invoices.total_returned_amount DRIFT
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.d2_5_3_backfill_invoice_total_returned_amount()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_amount_expr text;
  v_nullable boolean;
  v_updated_count bigint := 0;
BEGIN
  -- Detect amount column on purchase_return_lines (prefer total_amount, then line_total, then amount)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='purchase_return_lines' AND column_name='total_amount'
  ) THEN
    v_amount_expr := 'COALESCE(prl.total_amount, 0)';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='purchase_return_lines' AND column_name='line_total'
  ) THEN
    v_amount_expr := 'COALESCE(prl.line_total, 0)';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='purchase_return_lines' AND column_name='amount'
  ) THEN
    v_amount_expr := 'COALESCE(prl.amount, 0)';
  ELSE
    -- Fallback: qty * unit_price
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='purchase_invoice_lines' AND column_name='unit_price'
    ) THEN
      v_amount_expr := 'COALESCE(prl.quantity,0) * COALESCE(pil.unit_price,0)';
    ELSE
      v_amount_expr := 'COALESCE(prl.quantity,0)';
    END IF;
  END IF;

  -- Check if invoices.total_returned_amount is nullable
  SELECT (is_nullable = 'YES') INTO v_nullable
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='invoices' AND column_name='total_returned_amount';

  -- Build update dynamically with detected amount expression
  EXECUTE format($sql$
    WITH expected AS (
      SELECT
        pil.invoice_id,
        SUM(%s) AS expected_total
      FROM public.purchase_return_lines prl
      JOIN public.purchase_returns pr
        ON pr.id = prl.return_id
      JOIN public.purchase_invoice_lines pil
        ON pil.id = prl.invoice_line_id
      WHERE pr.purchase_type = 'general'
        AND pr.status NOT IN ('voided','cancelled')
        AND prl.invoice_line_id IS NOT NULL
      GROUP BY pil.invoice_id
    ),
    target AS (
      SELECT
        i.id AS invoice_id,
        e.expected_total
      FROM public.invoices i
      LEFT JOIN expected e ON e.invoice_id = i.id
    )
    UPDATE public.invoices i
    SET total_returned_amount = %s
    FROM target t
    WHERE i.id = t.invoice_id
      AND i.total_returned_amount IS DISTINCT FROM %s
    ;
  $sql$,
    v_amount_expr,
    CASE
      WHEN v_nullable THEN 't.expected_total'
      ELSE 'COALESCE(t.expected_total, 0)'
    END,
    CASE
      WHEN v_nullable THEN 't.expected_total'
      ELSE 'COALESCE(t.expected_total, 0)'
    END
  );

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  -- Log backfill
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='audit_events'
  ) THEN
    INSERT INTO public.audit_events(entity_type, action, entity_id, payload)
    VALUES (
      'system',
      'd2_5_3_backfill_invoice_total_returned_amount',
      NULL,
      jsonb_build_object(
        'migration', 'D2-5.3 B3',
        'timestamp', now()::text,
        'updated_count', v_updated_count,
        'amount_expr', v_amount_expr,
        'nullable_total_returned_amount', v_nullable
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'updated_count', v_updated_count,
    'amount_expr', v_amount_expr,
    'nullable_total_returned_amount', v_nullable
  );
END;
$$;

-- Restrict helper execution to service_role only
REVOKE ALL ON FUNCTION public.d2_5_3_backfill_invoice_total_returned_amount() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.d2_5_3_backfill_invoice_total_returned_amount() FROM anon;
REVOKE EXECUTE ON FUNCTION public.d2_5_3_backfill_invoice_total_returned_amount() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.d2_5_3_backfill_invoice_total_returned_amount() TO service_role;

COMMENT ON FUNCTION public.d2_5_3_backfill_invoice_total_returned_amount() IS
  'D2-5.3 B3: One-time idempotent backfill to repair invoices.total_returned_amount drift from canonical GENERAL returns. service_role only.';

-- Execute the backfill now
SELECT public.d2_5_3_backfill_invoice_total_returned_amount();