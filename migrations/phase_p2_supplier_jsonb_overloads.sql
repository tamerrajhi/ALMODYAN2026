-- Migration: phase_p2_supplier_jsonb_overloads.sql
-- Purpose: Add jsonb-accepting overloads for all 4 supplier atomic functions.
--          This lets the generic RPC handler (Group 3) call them with a single
--          jsonb argument, eliminating special-case routing in routes.ts.
-- Idempotent: Uses CREATE OR REPLACE.
-- Does NOT touch the original parameter-based functions.

-- 1) supplier_create_atomic(args jsonb)
CREATE OR REPLACE FUNCTION public.supplier_create_atomic(args jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN public.supplier_create_atomic(
    p_client_request_id := COALESCE(args->>'p_client_request_id', gen_random_uuid()::text),
    p_name              := args->>'p_name',
    p_name_en           := args->>'p_name_en',
    p_phone             := args->>'p_phone',
    p_email             := args->>'p_email',
    p_address           := args->>'p_address',
    p_tax_number        := args->>'p_tax_number',
    p_contact_person    := args->>'p_contact_person'
  );
END;
$$;

-- 2) supplier_update_atomic(args jsonb)
CREATE OR REPLACE FUNCTION public.supplier_update_atomic(args jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN public.supplier_update_atomic(
    p_client_request_id := COALESCE(args->>'p_client_request_id', gen_random_uuid()::text),
    p_supplier_id       := (args->>'p_supplier_id')::uuid,
    p_name              := args->>'p_name',
    p_name_en           := args->>'p_name_en',
    p_phone             := args->>'p_phone',
    p_email             := args->>'p_email',
    p_address           := args->>'p_address',
    p_tax_number        := args->>'p_tax_number',
    p_contact_person    := args->>'p_contact_person'
  );
END;
$$;

-- 3) supplier_archive_atomic(args jsonb)
CREATE OR REPLACE FUNCTION public.supplier_archive_atomic(args jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN public.supplier_archive_atomic(
    p_client_request_id := COALESCE(args->>'p_client_request_id', gen_random_uuid()::text),
    p_supplier_id       := (args->>'p_supplier_id')::uuid,
    p_reason            := args->>'p_reason'
  );
END;
$$;

-- 4) supplier_toggle_status_atomic(args jsonb)
CREATE OR REPLACE FUNCTION public.supplier_toggle_status_atomic(args jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN public.supplier_toggle_status_atomic(
    p_client_request_id := COALESCE(args->>'p_client_request_id', gen_random_uuid()::text),
    p_supplier_id       := (args->>'p_supplier_id')::uuid,
    p_reason            := args->>'p_reason'
  );
END;
$$;
