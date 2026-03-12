CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "plpgsql" WITH SCHEMA "pg_catalog";
CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";
BEGIN;

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: account_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.account_type AS ENUM (
    'asset',
    'liability',
    'equity',
    'revenue',
    'expense'
);


--
-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_role AS ENUM (
    'admin',
    'purchases_clerk'
);


--
-- Name: batch_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.batch_status AS ENUM (
    'DRAFT',
    'VALIDATED',
    'IMPORTED',
    'FAILED'
);


--
-- Name: label_job_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.label_job_status AS ENUM (
    'CREATED',
    'GENERATED',
    'PRINTED',
    'FAILED'
);


--
-- Name: label_job_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.label_job_type AS ENUM (
    'ITEM',
    'SET',
    'BATCH_ITEMS',
    'BATCH_SETS',
    'BATCH_ALL'
);


--
-- Name: can_approve_transfer_requests(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_approve_transfer_requests(_user_id uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    -- Admins can always approve
    IF public.has_role(_user_id, 'admin') THEN
        RETURN true;
    END IF;
    
    -- Check if user has a custom role with approve_transfers permission
    RETURN EXISTS (
        SELECT 1
        FROM public.user_custom_roles ucr
        JOIN public.role_permissions rp ON rp.role_id = ucr.role_id
        JOIN public.screens s ON s.id = rp.screen_id
        WHERE ucr.user_id = _user_id
          AND s.screen_key = 'transfer_requests'
          AND (rp.custom_permissions->>'can_approve')::boolean = true
    );
END;
$$;


--
-- Name: generate_batch_no(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_batch_no() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    today_str TEXT;
    batch_count INTEGER;
BEGIN
    today_str := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
    
    SELECT COUNT(*) + 1 INTO batch_count
    FROM public.purchase_batches
    WHERE batch_no LIKE 'PB-' || today_str || '%';
    
    RETURN 'PB-' || today_str || '-' || LPAD(batch_count::TEXT, 4, '0');
END;
$$;


--
-- Name: generate_customer_code(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_customer_code() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    next_num INTEGER;
BEGIN
    SELECT COALESCE(MAX(CAST(SUBSTRING(customer_code FROM 5) AS INTEGER)), 0) + 1
    INTO next_num
    FROM public.customers
    WHERE customer_code LIKE 'CUS-%';
    
    RETURN 'CUS-' || LPAD(next_num::TEXT, 6, '0');
END;
$$;


--
-- Name: generate_inventory_count_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_inventory_count_number() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    today_str TEXT;
    count_num INTEGER;
BEGIN
    today_str := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
    
    SELECT COUNT(*) + 1 INTO count_num
    FROM public.inventory_counts
    WHERE count_number LIKE 'IC-' || today_str || '%';
    
    RETURN 'IC-' || today_str || '-' || LPAD(count_num::TEXT, 4, '0');
END;
$$;


--
-- Name: generate_invoice_number(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_invoice_number(invoice_type_param text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    prefix TEXT;
    today_str TEXT;
    invoice_count INTEGER;
BEGIN
    prefix := CASE 
        WHEN invoice_type_param = 'sales' THEN 'INV-S'
        WHEN invoice_type_param = 'purchase' THEN 'INV-P'
        WHEN invoice_type_param = 'sales_return' THEN 'INV-SR'
        WHEN invoice_type_param = 'purchase_return' THEN 'INV-PR'
        ELSE 'INV'
    END;
    
    today_str := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
    
    SELECT COUNT(*) + 1 INTO invoice_count
    FROM public.invoices
    WHERE invoice_number LIKE prefix || '-' || today_str || '%';
    
    RETURN prefix || '-' || today_str || '-' || LPAD(invoice_count::TEXT, 4, '0');
END;
$$;


--
-- Name: generate_invoice_number(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_invoice_number(invoice_type_param text, branch_code_param text DEFAULT NULL::text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    prefix TEXT;
    today_str TEXT;
    invoice_count INTEGER;
    branch_part TEXT;
BEGIN
    prefix := CASE 
        WHEN invoice_type_param = 'sales' THEN 'INV-S'
        WHEN invoice_type_param = 'purchase' THEN 'INV-P'
        WHEN invoice_type_param = 'sales_return' THEN 'INV-SR'
        WHEN invoice_type_param = 'purchase_return' THEN 'INV-PR'
        ELSE 'INV'
    END;
    
    today_str := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
    
    -- Add branch code if provided
    branch_part := COALESCE(branch_code_param, '');
    IF branch_part != '' THEN
        branch_part := '-' || branch_part;
    END IF;
    
    SELECT COUNT(*) + 1 INTO invoice_count
    FROM public.invoices
    WHERE invoice_number LIKE prefix || branch_part || '-' || today_str || '%';
    
    RETURN prefix || branch_part || '-' || today_str || '-' || LPAD(invoice_count::TEXT, 4, '0');
END;
$$;


--
-- Name: generate_journal_entry_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_journal_entry_number() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    today_str TEXT;
    entry_count INTEGER;
BEGIN
    today_str := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
    
    SELECT COUNT(*) + 1 INTO entry_count
    FROM public.journal_entries
    WHERE entry_number LIKE 'JE-' || today_str || '%';
    
    RETURN 'JE-' || today_str || '-' || LPAD(entry_count::TEXT, 4, '0');
END;
$$;


--
-- Name: generate_payment_number(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_payment_number(payment_type_param text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    prefix TEXT;
    today_str TEXT;
    payment_count INTEGER;
BEGIN
    prefix := CASE 
        WHEN payment_type_param = 'receipt' THEN 'REC'
        WHEN payment_type_param = 'payment' THEN 'PAY'
        ELSE 'PM'
    END;
    
    today_str := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
    
    SELECT COUNT(*) + 1 INTO payment_count
    FROM public.payments
    WHERE payment_number LIKE prefix || '-' || today_str || '%';
    
    RETURN prefix || '-' || today_str || '-' || LPAD(payment_count::TEXT, 4, '0');
END;
$$;


--
-- Name: generate_return_code(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_return_code() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    today_str TEXT;
    return_count INTEGER;
BEGIN
    today_str := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
    
    SELECT COUNT(*) + 1 INTO return_count
    FROM public.returns
    WHERE return_code LIKE 'RT-' || today_str || '%';
    
    RETURN 'RT-' || today_str || '-' || LPAD(return_count::TEXT, 4, '0');
END;
$$;


--
-- Name: generate_sale_code(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_sale_code() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    today_str TEXT;
    sale_count INTEGER;
BEGIN
    today_str := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
    
    SELECT COUNT(*) + 1 INTO sale_count
    FROM public.sales
    WHERE sale_code LIKE 'SL-' || today_str || '%';
    
    RETURN 'SL-' || today_str || '-' || LPAD(sale_count::TEXT, 4, '0');
END;
$$;


--
-- Name: generate_transfer_request_code(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_transfer_request_code() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    today_str TEXT;
    request_count INTEGER;
BEGIN
    today_str := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
    
    SELECT COUNT(*) + 1 INTO request_count
    FROM public.transfer_requests
    WHERE request_code LIKE 'TR-' || today_str || '%';
    
    RETURN 'TR-' || today_str || '-' || LPAD(request_count::TEXT, 4, '0');
END;
$$;


--
-- Name: get_email_by_username(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_email_by_username(p_username text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_email TEXT;
BEGIN
  SELECT email INTO v_email 
  FROM public.profiles 
  WHERE LOWER(username) = LOWER(p_username);
  
  RETURN v_email;
END;
$$;


--
-- Name: get_next_item_code(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_next_item_code() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    next_num BIGINT;
BEGIN
    -- Lock the row and increment atomically
    UPDATE public.code_sequences
    SET last_number = last_number + 1
    WHERE id = 'ITEM'
    RETURNING last_number INTO next_num;
    
    IF next_num IS NULL THEN
        RAISE EXCEPTION 'ITEM sequence not found in code_sequences';
    END IF;
    
    RETURN 'ITM-' || LPAD(next_num::TEXT, 8, '0');
END;
$$;


--
-- Name: get_next_set_code(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_next_set_code() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    next_num BIGINT;
BEGIN
    -- Lock the row and increment atomically
    UPDATE public.code_sequences
    SET last_number = last_number + 1
    WHERE id = 'SET'
    RETURNING last_number INTO next_num;
    
    IF next_num IS NULL THEN
        RAISE EXCEPTION 'SET sequence not found in code_sequences';
    END IF;
    
    RETURN 'SET-' || LPAD(next_num::TEXT, 6, '0');
END;
$$;


--
-- Name: get_user_branches(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_branches(_user_id uuid) RETURNS uuid[]
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    branch_ids UUID[];
BEGIN
    -- Admins can access all branches
    IF public.has_role(_user_id, 'admin') THEN
        SELECT array_agg(id) INTO branch_ids FROM public.branches WHERE is_active = true;
    ELSE
        SELECT array_agg(branch_id) INTO branch_ids 
        FROM public.user_branches 
        WHERE user_id = _user_id;
    END IF;
    
    RETURN COALESCE(branch_ids, ARRAY[]::UUID[]);
END;
$$;


--
-- Name: get_user_id_by_username(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_id_by_username(p_username text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT user_id INTO v_user_id 
  FROM public.profiles 
  WHERE LOWER(username) = LOWER(p_username);
  
  RETURN v_user_id;
END;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, email)
  VALUES (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.email
  );
  RETURN new;
END;
$$;


--
-- Name: has_permission(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_permission(_user_id uuid, _resource text, _action text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  -- Admins have all permissions
  IF public.has_role(_user_id, 'admin') THEN
    RETURN true;
  END IF;
  
  -- Check specific permission
  RETURN EXISTS (
    SELECT 1
    FROM public.permissions
    WHERE user_id = _user_id
      AND resource = _resource
      AND (
        (_action = 'create' AND can_create = true) OR
        (_action = 'read' AND can_read = true) OR
        (_action = 'update' AND can_update = true) OR
        (_action = 'delete' AND can_delete = true)
      )
  );
END;
$$;


--
-- Name: has_role(uuid, public.app_role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_roles
        WHERE user_id = _user_id
          AND role = _role
    )
$$;


--
-- Name: has_screen_permission(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_screen_permission(_user_id uuid, _screen_key text, _permission text DEFAULT 'view'::text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    has_perm BOOLEAN;
BEGIN
    -- Admins have all permissions
    IF public.has_role(_user_id, 'admin') THEN
        RETURN true;
    END IF;
    
    SELECT EXISTS (
        SELECT 1
        FROM public.user_custom_roles ucr
        JOIN public.role_permissions rp ON rp.role_id = ucr.role_id
        JOIN public.screens s ON s.id = rp.screen_id
        WHERE ucr.user_id = _user_id
          AND s.screen_key = _screen_key
          AND (
              (_permission = 'view' AND rp.can_view = true) OR
              (_permission = 'create' AND rp.can_create = true) OR
              (_permission = 'edit' AND rp.can_edit = true) OR
              (_permission = 'delete' AND rp.can_delete = true)
          )
    ) INTO has_perm;
    
    RETURN has_perm;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


SET default_table_access_method = heap;

--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    user_name text,
    user_role text,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL,
    ip_address text,
    action_type text NOT NULL,
    entity_type text NOT NULL,
    entity_id text,
    entity_code text,
    old_value jsonb,
    new_value jsonb,
    branch_id uuid,
    branch_name text,
    description text,
    channel text DEFAULT 'WEB'::text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: branches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.branches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_code text NOT NULL,
    branch_name text NOT NULL,
    address text,
    phone text,
    manager_name text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    branch_type text DEFAULT 'jewelry'::text NOT NULL,
    CONSTRAINT branches_branch_type_check CHECK ((branch_type = ANY (ARRAY['gold'::text, 'jewelry'::text])))
);


--
-- Name: chart_of_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chart_of_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_code text NOT NULL,
    account_name text NOT NULL,
    account_name_en text,
    account_type public.account_type NOT NULL,
    parent_id uuid,
    is_active boolean DEFAULT true NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    description text,
    current_balance numeric DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: code_sequences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.code_sequences (
    id text NOT NULL,
    last_number bigint DEFAULT 0
);


--
-- Name: custom_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.custom_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    role_name text NOT NULL,
    role_name_en text,
    description text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_code text NOT NULL,
    full_name text NOT NULL,
    phone text,
    email text,
    address text,
    notes text,
    loyalty_points integer DEFAULT 0,
    total_purchases numeric DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    vat_number text,
    customer_type text DEFAULT 'individual'::text,
    company_name text,
    CONSTRAINT customers_customer_type_check CHECK ((customer_type = ANY (ARRAY['individual'::text, 'company'::text])))
);


--
-- Name: fiscal_years; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fiscal_years (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    year_name text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    is_active boolean DEFAULT false,
    is_closed boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: gold_karats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gold_karats (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    karat_value integer NOT NULL,
    karat_name text NOT NULL,
    purity_percentage numeric NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: gold_prices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gold_prices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    karat_id uuid NOT NULL,
    price_date date DEFAULT CURRENT_DATE NOT NULL,
    buy_price_per_gram numeric NOT NULL,
    sell_price_per_gram numeric NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: gold_scrap; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gold_scrap (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid NOT NULL,
    scrap_date date DEFAULT CURRENT_DATE NOT NULL,
    karat_id uuid NOT NULL,
    weight_grams numeric NOT NULL,
    reason text,
    notes text,
    recorded_by text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: import_row_errors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.import_row_errors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    batch_id uuid,
    row_number integer NOT NULL,
    model text,
    stockcode text,
    error_message text NOT NULL,
    raw_row_json jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: inventory_count_journal_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_count_journal_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    count_id uuid NOT NULL,
    journal_entry_id uuid NOT NULL,
    entry_type text NOT NULL,
    amount numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT inventory_count_journal_entries_entry_type_check CHECK ((entry_type = ANY (ARRAY['shortage'::text, 'overage'::text])))
);


--
-- Name: inventory_count_readings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_count_readings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    count_id uuid NOT NULL,
    item_code text NOT NULL,
    item_id uuid,
    actual_weight numeric,
    location text,
    read_by uuid NOT NULL,
    read_at timestamp with time zone DEFAULT now(),
    read_method text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT inventory_count_readings_read_method_check CHECK ((read_method = ANY (ARRAY['barcode'::text, 'rfid'::text, 'manual'::text])))
);


--
-- Name: inventory_count_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_count_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    count_id uuid NOT NULL,
    item_id uuid,
    item_code text NOT NULL,
    result_type text NOT NULL,
    system_weight numeric,
    actual_weight numeric,
    weight_difference numeric,
    system_cost numeric,
    calculated_value numeric,
    karat text,
    gold_price_used numeric,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT inventory_count_results_result_type_check CHECK ((result_type = ANY (ARRAY['matched'::text, 'shortage'::text, 'overage'::text, 'weight_diff'::text])))
);


--
-- Name: inventory_count_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_count_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    count_id uuid NOT NULL,
    item_id uuid NOT NULL,
    item_code text NOT NULL,
    description text,
    g_weight numeric,
    d_weight numeric,
    b_weight numeric,
    cost numeric,
    tag_price numeric,
    metal text,
    karat text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: inventory_counts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_counts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    count_number text NOT NULL,
    branch_id uuid NOT NULL,
    count_type text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    start_date timestamp with time zone DEFAULT now() NOT NULL,
    end_date timestamp with time zone,
    created_by uuid NOT NULL,
    reviewed_by uuid,
    approved_by uuid,
    reviewed_at timestamp with time zone,
    approved_at timestamp with time zone,
    notes text,
    total_system_items integer DEFAULT 0,
    total_counted_items integer DEFAULT 0,
    total_matched integer DEFAULT 0,
    total_shortage integer DEFAULT 0,
    total_overage integer DEFAULT 0,
    total_weight_diff integer DEFAULT 0,
    shortage_value numeric DEFAULT 0,
    overage_value numeric DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT inventory_counts_count_type_check CHECK ((count_type = ANY (ARRAY['full'::text, 'partial'::text, 'specific'::text]))),
    CONSTRAINT inventory_counts_status_check CHECK ((status = ANY (ARRAY['open'::text, 'counting'::text, 'reviewing'::text, 'approved'::text])))
);


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_number text NOT NULL,
    invoice_type text NOT NULL,
    invoice_date date DEFAULT CURRENT_DATE NOT NULL,
    due_date date,
    customer_id uuid,
    supplier_id uuid,
    sale_id uuid,
    return_id uuid,
    branch_id uuid,
    subtotal numeric DEFAULT 0,
    tax_amount numeric DEFAULT 0,
    discount_amount numeric DEFAULT 0,
    total_amount numeric DEFAULT 0,
    paid_amount numeric DEFAULT 0,
    remaining_amount numeric DEFAULT 0,
    status text DEFAULT 'pending'::text,
    notes text,
    journal_entry_id uuid,
    created_by text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: item_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_id uuid NOT NULL,
    movement_type text NOT NULL,
    from_branch_id uuid,
    to_branch_id uuid,
    reference_id uuid,
    reference_type text,
    notes text,
    performed_by text,
    movement_date timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: jewelry_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jewelry_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_code text NOT NULL,
    set_id uuid,
    batch_id uuid,
    is_single boolean DEFAULT false,
    division text,
    stockcode text,
    model text,
    supp_ref text,
    supplier_id uuid,
    description text,
    type text,
    cost_code text,
    tag1 text,
    tag2 text,
    tag3 text,
    tag4 text,
    tag5 text,
    cost numeric(12,2),
    tag_price numeric(12,2),
    minimum_price numeric(12,2),
    g_weight numeric(10,4),
    d_weight numeric(10,4),
    b_weight numeric(10,4),
    stone text,
    metal text,
    rate_type text,
    clarity text,
    created_at timestamp with time zone DEFAULT now(),
    raw_row_json jsonb,
    extra_fields_json jsonb,
    raw_headers_json jsonb,
    branch_id uuid,
    sold_at timestamp with time zone,
    sold_price numeric,
    sale_id uuid
);


--
-- Name: jewelry_sets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jewelry_sets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    set_code text NOT NULL,
    model text NOT NULL,
    supp_ref text,
    division text,
    description text,
    supplier_id uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: journal_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entry_number text NOT NULL,
    entry_date date DEFAULT CURRENT_DATE NOT NULL,
    description text,
    reference_type text,
    reference_id uuid,
    is_posted boolean DEFAULT false NOT NULL,
    posted_at timestamp with time zone,
    posted_by text,
    total_debit numeric DEFAULT 0,
    total_credit numeric DEFAULT 0,
    created_by text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: journal_entry_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_entry_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    journal_entry_id uuid NOT NULL,
    account_id uuid NOT NULL,
    debit_amount numeric DEFAULT 0,
    credit_amount numeric DEFAULT 0,
    description text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: label_print_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.label_print_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    batch_id uuid,
    job_type public.label_job_type NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    created_by text,
    status public.label_job_status DEFAULT 'CREATED'::public.label_job_status,
    pdf_url_or_path text,
    details_json jsonb
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_number text NOT NULL,
    payment_type text NOT NULL,
    payment_date date DEFAULT CURRENT_DATE NOT NULL,
    amount numeric NOT NULL,
    payment_method text DEFAULT 'cash'::text,
    customer_id uuid,
    supplier_id uuid,
    invoice_id uuid,
    bank_account text,
    check_number text,
    notes text,
    journal_entry_id uuid,
    created_by text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    resource text NOT NULL,
    can_create boolean DEFAULT false NOT NULL,
    can_read boolean DEFAULT true NOT NULL,
    can_update boolean DEFAULT false NOT NULL,
    can_delete boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    full_name text,
    created_at timestamp with time zone DEFAULT now(),
    mfa_enabled boolean DEFAULT false,
    mfa_method text,
    phone text,
    username text,
    email text,
    is_active boolean DEFAULT true
);


--
-- Name: purchase_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    batch_no text NOT NULL,
    uploaded_file_name text NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now(),
    uploaded_by text,
    status public.batch_status DEFAULT 'DRAFT'::public.batch_status,
    total_rows integer DEFAULT 0,
    imported_rows integer DEFAULT 0,
    failed_rows integer DEFAULT 0,
    duplicates_skipped integer DEFAULT 0,
    allow_duplicates boolean DEFAULT false,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    raw_headers_json jsonb,
    branch_id uuid
);


--
-- Name: return_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.return_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    return_id uuid NOT NULL,
    item_id uuid NOT NULL,
    sale_item_id uuid,
    return_price numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: returns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.returns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    return_code text NOT NULL,
    sale_id uuid,
    branch_id uuid,
    customer_id uuid,
    return_date timestamp with time zone DEFAULT now() NOT NULL,
    total_amount numeric DEFAULT 0,
    reason text,
    notes text,
    processed_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    role_id uuid NOT NULL,
    screen_id uuid NOT NULL,
    can_view boolean DEFAULT false,
    can_create boolean DEFAULT false,
    can_edit boolean DEFAULT false,
    can_delete boolean DEFAULT false,
    custom_permissions jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: sale_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sale_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sale_id uuid NOT NULL,
    item_id uuid NOT NULL,
    sale_price numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: sales; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sale_code text NOT NULL,
    branch_id uuid,
    customer_id uuid,
    total_items integer DEFAULT 0,
    total_amount numeric DEFAULT 0,
    discount_amount numeric DEFAULT 0,
    final_amount numeric DEFAULT 0,
    payment_method text DEFAULT 'cash'::text,
    notes text,
    sold_by text,
    sale_date timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: screens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.screens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    screen_key text NOT NULL,
    screen_name text NOT NULL,
    screen_name_en text,
    screen_path text NOT NULL,
    parent_key text,
    icon text,
    sort_order integer DEFAULT 0
);


--
-- Name: suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suppliers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supplier_name text NOT NULL,
    supplier_ref text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: transfer_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transfer_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transfer_id uuid NOT NULL,
    item_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: transfer_request_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transfer_request_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    item_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: transfer_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transfer_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_code text NOT NULL,
    from_branch_id uuid,
    to_branch_id uuid NOT NULL,
    requested_by uuid NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    rejection_reason text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT transfer_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'completed'::text])))
);


--
-- Name: transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transfers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    from_branch_id uuid,
    to_branch_id uuid NOT NULL,
    transferred_by text,
    transfer_date timestamp with time zone DEFAULT now() NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_branches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_branches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    is_primary boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_custom_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_custom_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_otp; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_otp (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    otp_code text NOT NULL,
    otp_type text DEFAULT 'email'::text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    verified boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role NOT NULL
);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: branches branches_branch_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_branch_code_key UNIQUE (branch_code);


--
-- Name: branches branches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_pkey PRIMARY KEY (id);


--
-- Name: chart_of_accounts chart_of_accounts_account_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chart_of_accounts
    ADD CONSTRAINT chart_of_accounts_account_code_key UNIQUE (account_code);


--
-- Name: chart_of_accounts chart_of_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chart_of_accounts
    ADD CONSTRAINT chart_of_accounts_pkey PRIMARY KEY (id);


--
-- Name: code_sequences code_sequences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.code_sequences
    ADD CONSTRAINT code_sequences_pkey PRIMARY KEY (id);


--
-- Name: custom_roles custom_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_roles
    ADD CONSTRAINT custom_roles_pkey PRIMARY KEY (id);


--
-- Name: custom_roles custom_roles_role_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_roles
    ADD CONSTRAINT custom_roles_role_name_key UNIQUE (role_name);


--
-- Name: customers customers_customer_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_customer_code_key UNIQUE (customer_code);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: fiscal_years fiscal_years_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_years
    ADD CONSTRAINT fiscal_years_pkey PRIMARY KEY (id);


--
-- Name: gold_karats gold_karats_karat_value_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gold_karats
    ADD CONSTRAINT gold_karats_karat_value_key UNIQUE (karat_value);


--
-- Name: gold_karats gold_karats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gold_karats
    ADD CONSTRAINT gold_karats_pkey PRIMARY KEY (id);


--
-- Name: gold_prices gold_prices_karat_id_price_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gold_prices
    ADD CONSTRAINT gold_prices_karat_id_price_date_key UNIQUE (karat_id, price_date);


--
-- Name: gold_prices gold_prices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gold_prices
    ADD CONSTRAINT gold_prices_pkey PRIMARY KEY (id);


--
-- Name: gold_scrap gold_scrap_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gold_scrap
    ADD CONSTRAINT gold_scrap_pkey PRIMARY KEY (id);


--
-- Name: import_row_errors import_row_errors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_row_errors
    ADD CONSTRAINT import_row_errors_pkey PRIMARY KEY (id);


--
-- Name: inventory_count_journal_entries inventory_count_journal_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_journal_entries
    ADD CONSTRAINT inventory_count_journal_entries_pkey PRIMARY KEY (id);


--
-- Name: inventory_count_readings inventory_count_readings_count_id_item_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_readings
    ADD CONSTRAINT inventory_count_readings_count_id_item_code_key UNIQUE (count_id, item_code);


--
-- Name: inventory_count_readings inventory_count_readings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_readings
    ADD CONSTRAINT inventory_count_readings_pkey PRIMARY KEY (id);


--
-- Name: inventory_count_results inventory_count_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_results
    ADD CONSTRAINT inventory_count_results_pkey PRIMARY KEY (id);


--
-- Name: inventory_count_snapshots inventory_count_snapshots_count_id_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_snapshots
    ADD CONSTRAINT inventory_count_snapshots_count_id_item_id_key UNIQUE (count_id, item_id);


--
-- Name: inventory_count_snapshots inventory_count_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_snapshots
    ADD CONSTRAINT inventory_count_snapshots_pkey PRIMARY KEY (id);


--
-- Name: inventory_counts inventory_counts_count_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_counts
    ADD CONSTRAINT inventory_counts_count_number_key UNIQUE (count_number);


--
-- Name: inventory_counts inventory_counts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_counts
    ADD CONSTRAINT inventory_counts_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_invoice_number_key UNIQUE (invoice_number);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: item_movements item_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_movements
    ADD CONSTRAINT item_movements_pkey PRIMARY KEY (id);


--
-- Name: jewelry_items jewelry_items_item_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jewelry_items
    ADD CONSTRAINT jewelry_items_item_code_key UNIQUE (item_code);


--
-- Name: jewelry_items jewelry_items_item_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jewelry_items
    ADD CONSTRAINT jewelry_items_item_code_unique UNIQUE (item_code);


--
-- Name: jewelry_items jewelry_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jewelry_items
    ADD CONSTRAINT jewelry_items_pkey PRIMARY KEY (id);


--
-- Name: jewelry_sets jewelry_sets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jewelry_sets
    ADD CONSTRAINT jewelry_sets_pkey PRIMARY KEY (id);


--
-- Name: jewelry_sets jewelry_sets_set_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jewelry_sets
    ADD CONSTRAINT jewelry_sets_set_code_key UNIQUE (set_code);


--
-- Name: jewelry_sets jewelry_sets_set_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jewelry_sets
    ADD CONSTRAINT jewelry_sets_set_code_unique UNIQUE (set_code);


--
-- Name: journal_entries journal_entries_entry_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_entry_number_key UNIQUE (entry_number);


--
-- Name: journal_entries journal_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_pkey PRIMARY KEY (id);


--
-- Name: journal_entry_lines journal_entry_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entry_lines
    ADD CONSTRAINT journal_entry_lines_pkey PRIMARY KEY (id);


--
-- Name: label_print_jobs label_print_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.label_print_jobs
    ADD CONSTRAINT label_print_jobs_pkey PRIMARY KEY (id);


--
-- Name: payments payments_payment_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_payment_number_key UNIQUE (payment_number);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);


--
-- Name: permissions permissions_user_id_resource_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_user_id_resource_key UNIQUE (user_id, resource);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_key UNIQUE (user_id);


--
-- Name: purchase_batches purchase_batches_batch_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_batches
    ADD CONSTRAINT purchase_batches_batch_no_key UNIQUE (batch_no);


--
-- Name: purchase_batches purchase_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_batches
    ADD CONSTRAINT purchase_batches_pkey PRIMARY KEY (id);


--
-- Name: return_items return_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.return_items
    ADD CONSTRAINT return_items_pkey PRIMARY KEY (id);


--
-- Name: returns returns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.returns
    ADD CONSTRAINT returns_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_role_id_screen_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_screen_id_key UNIQUE (role_id, screen_id);


--
-- Name: sale_items sale_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_items
    ADD CONSTRAINT sale_items_pkey PRIMARY KEY (id);


--
-- Name: sales sales_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_pkey PRIMARY KEY (id);


--
-- Name: sales sales_sale_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_sale_code_key UNIQUE (sale_code);


--
-- Name: screens screens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.screens
    ADD CONSTRAINT screens_pkey PRIMARY KEY (id);


--
-- Name: screens screens_screen_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.screens
    ADD CONSTRAINT screens_screen_key_key UNIQUE (screen_key);


--
-- Name: suppliers suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);


--
-- Name: transfer_items transfer_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfer_items
    ADD CONSTRAINT transfer_items_pkey PRIMARY KEY (id);


--
-- Name: transfer_request_items transfer_request_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfer_request_items
    ADD CONSTRAINT transfer_request_items_pkey PRIMARY KEY (id);


--
-- Name: transfer_requests transfer_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfer_requests
    ADD CONSTRAINT transfer_requests_pkey PRIMARY KEY (id);


--
-- Name: transfers transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfers
    ADD CONSTRAINT transfers_pkey PRIMARY KEY (id);


--
-- Name: user_branches user_branches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_branches
    ADD CONSTRAINT user_branches_pkey PRIMARY KEY (id);


--
-- Name: user_branches user_branches_user_id_branch_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_branches
    ADD CONSTRAINT user_branches_user_id_branch_id_key UNIQUE (user_id, branch_id);


--
-- Name: user_custom_roles user_custom_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_custom_roles
    ADD CONSTRAINT user_custom_roles_pkey PRIMARY KEY (id);


--
-- Name: user_custom_roles user_custom_roles_user_id_role_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_custom_roles
    ADD CONSTRAINT user_custom_roles_user_id_role_id_key UNIQUE (user_id, role_id);


--
-- Name: user_otp user_otp_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_otp
    ADD CONSTRAINT user_otp_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_user_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);


--
-- Name: idx_audit_logs_action_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_action_type ON public.audit_logs USING btree (action_type);


--
-- Name: idx_audit_logs_branch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_branch_id ON public.audit_logs USING btree (branch_id);


--
-- Name: idx_audit_logs_entity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_entity_id ON public.audit_logs USING btree (entity_id);


--
-- Name: idx_audit_logs_entity_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_entity_type ON public.audit_logs USING btree (entity_type);


--
-- Name: idx_audit_logs_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_timestamp ON public.audit_logs USING btree ("timestamp" DESC);


--
-- Name: idx_audit_logs_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_user_id ON public.audit_logs USING btree (user_id);


--
-- Name: idx_customers_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_type ON public.customers USING btree (customer_type);


--
-- Name: idx_customers_vat_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_vat_number ON public.customers USING btree (vat_number) WHERE (vat_number IS NOT NULL);


--
-- Name: idx_import_row_errors_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_import_row_errors_batch ON public.import_row_errors USING btree (batch_id);


--
-- Name: idx_item_movements_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_movements_item_id ON public.item_movements USING btree (item_id);


--
-- Name: idx_item_movements_movement_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_movements_movement_date ON public.item_movements USING btree (movement_date DESC);


--
-- Name: idx_jewelry_items_batch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jewelry_items_batch_id ON public.jewelry_items USING btree (batch_id);


--
-- Name: idx_jewelry_items_model; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jewelry_items_model ON public.jewelry_items USING btree (model);


--
-- Name: idx_jewelry_items_set_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jewelry_items_set_id ON public.jewelry_items USING btree (set_id);


--
-- Name: idx_jewelry_items_stockcode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jewelry_items_stockcode ON public.jewelry_items USING btree (stockcode);


--
-- Name: idx_jewelry_items_supp_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jewelry_items_supp_ref ON public.jewelry_items USING btree (supp_ref);


--
-- Name: idx_jewelry_sets_model; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jewelry_sets_model ON public.jewelry_sets USING btree (model);


--
-- Name: idx_label_print_jobs_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_label_print_jobs_batch ON public.label_print_jobs USING btree (batch_id);


--
-- Name: idx_profiles_username; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_username ON public.profiles USING btree (username);


--
-- Name: profiles_username_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX profiles_username_unique ON public.profiles USING btree (username) WHERE (username IS NOT NULL);


--
-- Name: branches update_branches_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_branches_updated_at BEFORE UPDATE ON public.branches FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: chart_of_accounts update_chart_of_accounts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_chart_of_accounts_updated_at BEFORE UPDATE ON public.chart_of_accounts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: custom_roles update_custom_roles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_custom_roles_updated_at BEFORE UPDATE ON public.custom_roles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: customers update_customers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: gold_karats update_gold_karats_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_gold_karats_updated_at BEFORE UPDATE ON public.gold_karats FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: gold_prices update_gold_prices_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_gold_prices_updated_at BEFORE UPDATE ON public.gold_prices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: inventory_counts update_inventory_counts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_inventory_counts_updated_at BEFORE UPDATE ON public.inventory_counts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: invoices update_invoices_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: journal_entries update_journal_entries_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_journal_entries_updated_at BEFORE UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: permissions update_permissions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_permissions_updated_at BEFORE UPDATE ON public.permissions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: transfer_requests update_transfer_requests_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_transfer_requests_updated_at BEFORE UPDATE ON public.transfer_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: audit_logs audit_logs_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: audit_logs audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: chart_of_accounts chart_of_accounts_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chart_of_accounts
    ADD CONSTRAINT chart_of_accounts_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.chart_of_accounts(id);


--
-- Name: gold_prices gold_prices_karat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gold_prices
    ADD CONSTRAINT gold_prices_karat_id_fkey FOREIGN KEY (karat_id) REFERENCES public.gold_karats(id) ON DELETE CASCADE;


--
-- Name: gold_scrap gold_scrap_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gold_scrap
    ADD CONSTRAINT gold_scrap_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: gold_scrap gold_scrap_karat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gold_scrap
    ADD CONSTRAINT gold_scrap_karat_id_fkey FOREIGN KEY (karat_id) REFERENCES public.gold_karats(id);


--
-- Name: import_row_errors import_row_errors_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_row_errors
    ADD CONSTRAINT import_row_errors_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.purchase_batches(id) ON DELETE CASCADE;


--
-- Name: inventory_count_journal_entries inventory_count_journal_entries_count_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_journal_entries
    ADD CONSTRAINT inventory_count_journal_entries_count_id_fkey FOREIGN KEY (count_id) REFERENCES public.inventory_counts(id) ON DELETE CASCADE;


--
-- Name: inventory_count_journal_entries inventory_count_journal_entries_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_journal_entries
    ADD CONSTRAINT inventory_count_journal_entries_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id);


--
-- Name: inventory_count_readings inventory_count_readings_count_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_readings
    ADD CONSTRAINT inventory_count_readings_count_id_fkey FOREIGN KEY (count_id) REFERENCES public.inventory_counts(id) ON DELETE CASCADE;


--
-- Name: inventory_count_readings inventory_count_readings_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_readings
    ADD CONSTRAINT inventory_count_readings_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.jewelry_items(id);


--
-- Name: inventory_count_results inventory_count_results_count_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_results
    ADD CONSTRAINT inventory_count_results_count_id_fkey FOREIGN KEY (count_id) REFERENCES public.inventory_counts(id) ON DELETE CASCADE;


--
-- Name: inventory_count_results inventory_count_results_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_results
    ADD CONSTRAINT inventory_count_results_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.jewelry_items(id);


--
-- Name: inventory_count_snapshots inventory_count_snapshots_count_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_snapshots
    ADD CONSTRAINT inventory_count_snapshots_count_id_fkey FOREIGN KEY (count_id) REFERENCES public.inventory_counts(id) ON DELETE CASCADE;


--
-- Name: inventory_count_snapshots inventory_count_snapshots_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_snapshots
    ADD CONSTRAINT inventory_count_snapshots_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.jewelry_items(id);


--
-- Name: inventory_counts inventory_counts_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_counts
    ADD CONSTRAINT inventory_counts_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: invoices invoices_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: invoices invoices_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: invoices invoices_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id);


--
-- Name: invoices invoices_return_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_return_id_fkey FOREIGN KEY (return_id) REFERENCES public.returns(id);


--
-- Name: invoices invoices_sale_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.sales(id);


--
-- Name: invoices invoices_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);


--
-- Name: item_movements item_movements_from_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_movements
    ADD CONSTRAINT item_movements_from_branch_id_fkey FOREIGN KEY (from_branch_id) REFERENCES public.branches(id);


--
-- Name: item_movements item_movements_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_movements
    ADD CONSTRAINT item_movements_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.jewelry_items(id) ON DELETE CASCADE;


--
-- Name: item_movements item_movements_to_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_movements
    ADD CONSTRAINT item_movements_to_branch_id_fkey FOREIGN KEY (to_branch_id) REFERENCES public.branches(id);


--
-- Name: jewelry_items jewelry_items_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jewelry_items
    ADD CONSTRAINT jewelry_items_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.purchase_batches(id);


--
-- Name: jewelry_items jewelry_items_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jewelry_items
    ADD CONSTRAINT jewelry_items_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: jewelry_items jewelry_items_sale_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jewelry_items
    ADD CONSTRAINT jewelry_items_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.sales(id);


--
-- Name: jewelry_items jewelry_items_set_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jewelry_items
    ADD CONSTRAINT jewelry_items_set_id_fkey FOREIGN KEY (set_id) REFERENCES public.jewelry_sets(id);


--
-- Name: jewelry_items jewelry_items_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jewelry_items
    ADD CONSTRAINT jewelry_items_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);


--
-- Name: jewelry_sets jewelry_sets_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jewelry_sets
    ADD CONSTRAINT jewelry_sets_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);


--
-- Name: journal_entry_lines journal_entry_lines_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entry_lines
    ADD CONSTRAINT journal_entry_lines_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.chart_of_accounts(id);


--
-- Name: journal_entry_lines journal_entry_lines_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entry_lines
    ADD CONSTRAINT journal_entry_lines_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id) ON DELETE CASCADE;


--
-- Name: label_print_jobs label_print_jobs_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.label_print_jobs
    ADD CONSTRAINT label_print_jobs_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.purchase_batches(id);


--
-- Name: payments payments_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: payments payments_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id);


--
-- Name: payments payments_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id);


--
-- Name: payments payments_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);


--
-- Name: profiles profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: purchase_batches purchase_batches_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_batches
    ADD CONSTRAINT purchase_batches_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: return_items return_items_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.return_items
    ADD CONSTRAINT return_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.jewelry_items(id);


--
-- Name: return_items return_items_return_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.return_items
    ADD CONSTRAINT return_items_return_id_fkey FOREIGN KEY (return_id) REFERENCES public.returns(id) ON DELETE CASCADE;


--
-- Name: return_items return_items_sale_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.return_items
    ADD CONSTRAINT return_items_sale_item_id_fkey FOREIGN KEY (sale_item_id) REFERENCES public.sale_items(id);


--
-- Name: returns returns_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.returns
    ADD CONSTRAINT returns_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: returns returns_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.returns
    ADD CONSTRAINT returns_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: returns returns_sale_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.returns
    ADD CONSTRAINT returns_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.sales(id);


--
-- Name: role_permissions role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.custom_roles(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_screen_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_screen_id_fkey FOREIGN KEY (screen_id) REFERENCES public.screens(id) ON DELETE CASCADE;


--
-- Name: sale_items sale_items_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_items
    ADD CONSTRAINT sale_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.jewelry_items(id);


--
-- Name: sale_items sale_items_sale_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_items
    ADD CONSTRAINT sale_items_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.sales(id) ON DELETE CASCADE;


--
-- Name: sales sales_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: sales sales_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: transfer_items transfer_items_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfer_items
    ADD CONSTRAINT transfer_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.jewelry_items(id);


--
-- Name: transfer_items transfer_items_transfer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfer_items
    ADD CONSTRAINT transfer_items_transfer_id_fkey FOREIGN KEY (transfer_id) REFERENCES public.transfers(id) ON DELETE CASCADE;


--
-- Name: transfer_request_items transfer_request_items_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfer_request_items
    ADD CONSTRAINT transfer_request_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.jewelry_items(id);


--
-- Name: transfer_request_items transfer_request_items_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfer_request_items
    ADD CONSTRAINT transfer_request_items_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.transfer_requests(id) ON DELETE CASCADE;


--
-- Name: transfer_requests transfer_requests_from_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfer_requests
    ADD CONSTRAINT transfer_requests_from_branch_id_fkey FOREIGN KEY (from_branch_id) REFERENCES public.branches(id);


--
-- Name: transfer_requests transfer_requests_to_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfer_requests
    ADD CONSTRAINT transfer_requests_to_branch_id_fkey FOREIGN KEY (to_branch_id) REFERENCES public.branches(id);


--
-- Name: transfers transfers_from_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfers
    ADD CONSTRAINT transfers_from_branch_id_fkey FOREIGN KEY (from_branch_id) REFERENCES public.branches(id);


--
-- Name: transfers transfers_to_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfers
    ADD CONSTRAINT transfers_to_branch_id_fkey FOREIGN KEY (to_branch_id) REFERENCES public.branches(id);


--
-- Name: user_branches user_branches_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_branches
    ADD CONSTRAINT user_branches_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: user_branches user_branches_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_branches
    ADD CONSTRAINT user_branches_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_custom_roles user_custom_roles_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_custom_roles
    ADD CONSTRAINT user_custom_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.custom_roles(id) ON DELETE CASCADE;


--
-- Name: user_custom_roles user_custom_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_custom_roles
    ADD CONSTRAINT user_custom_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: journal_entry_lines Admins can delete journal entry lines; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can delete journal entry lines" ON public.journal_entry_lines FOR DELETE USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: chart_of_accounts Admins can delete non-system accounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can delete non-system accounts" ON public.chart_of_accounts FOR DELETE USING ((public.has_role(auth.uid(), 'admin'::public.app_role) AND (is_system = false)));


--
-- Name: user_roles Admins can delete user roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can delete user roles" ON public.user_roles FOR DELETE USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: user_roles Admins can insert user roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can insert user roles" ON public.user_roles FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: fiscal_years Admins can manage fiscal years; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage fiscal years" ON public.fiscal_years USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: gold_karats Admins can manage karats; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage karats" ON public.gold_karats USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: permissions Admins can manage permissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage permissions" ON public.permissions USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: role_permissions Admins can manage role permissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage role permissions" ON public.role_permissions USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: custom_roles Admins can manage roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage roles" ON public.custom_roles USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: screens Admins can manage screens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage screens" ON public.screens USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: user_branches Admins can manage user branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage user branches" ON public.user_branches USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: user_custom_roles Admins can manage user custom roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage user custom roles" ON public.user_custom_roles USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: chart_of_accounts Admins can update accounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update accounts" ON public.chart_of_accounts FOR UPDATE USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: journal_entry_lines Admins can update journal entry lines; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update journal entry lines" ON public.journal_entry_lines FOR UPDATE USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: user_roles Admins can update user roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update user roles" ON public.user_roles FOR UPDATE USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: transfer_requests Authenticated users can create requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can create requests" ON public.transfer_requests FOR INSERT WITH CHECK ((auth.uid() = requested_by));


--
-- Name: branches Authenticated users can delete branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can delete branches" ON public.branches FOR DELETE USING (true);


--
-- Name: audit_logs Authenticated users can insert audit logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can insert audit logs" ON public.audit_logs FOR INSERT WITH CHECK (true);


--
-- Name: purchase_batches Authenticated users can insert batches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can insert batches" ON public.purchase_batches FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: branches Authenticated users can insert branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can insert branches" ON public.branches FOR INSERT WITH CHECK (true);


--
-- Name: customers Authenticated users can insert customers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can insert customers" ON public.customers FOR INSERT WITH CHECK (true);


--
-- Name: import_row_errors Authenticated users can insert errors; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can insert errors" ON public.import_row_errors FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: invoices Authenticated users can insert invoices; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can insert invoices" ON public.invoices FOR INSERT WITH CHECK (true);


--
-- Name: item_movements Authenticated users can insert item_movements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can insert item_movements" ON public.item_movements FOR INSERT WITH CHECK (true);


--
-- Name: jewelry_items Authenticated users can insert items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can insert items" ON public.jewelry_items FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: journal_entries Authenticated users can insert journal entries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can insert journal entries" ON public.journal_entries FOR INSERT WITH CHECK (true);


--
-- Name: journal_entry_lines Authenticated users can insert journal entry lines; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can insert journal entry lines" ON public.journal_entry_lines FOR INSERT WITH CHECK (true);


--
-- Name: payments Authenticated users can insert payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can insert payments" ON public.payments FOR INSERT WITH CHECK (true);


--
-- Name: gold_prices Authenticated users can insert prices; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can insert prices" ON public.gold_prices FOR INSERT WITH CHECK (true);


--
-- Name: label_print_jobs Authenticated users can insert print jobs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can insert print jobs" ON public.label_print_jobs FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: transfer_request_items Authenticated users can insert request items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can insert request items" ON public.transfer_request_items FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.transfer_requests tr
  WHERE ((tr.id = transfer_request_items.request_id) AND (tr.requested_by = auth.uid())))));


--
-- Name: sales Authenticated users can insert sales; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can insert sales" ON public.sales FOR INSERT WITH CHECK (true);


--
-- Name: gold_scrap Authenticated users can insert scrap; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can insert scrap" ON public.gold_scrap FOR INSERT WITH CHECK (true);


--
-- Name: jewelry_sets Authenticated users can insert sets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can insert sets" ON public.jewelry_sets FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: suppliers Authenticated users can insert suppliers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can insert suppliers" ON public.suppliers FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: transfer_items Authenticated users can insert transfer_items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can insert transfer_items" ON public.transfer_items FOR INSERT WITH CHECK (true);


--
-- Name: transfers Authenticated users can insert transfers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can insert transfers" ON public.transfers FOR INSERT WITH CHECK (true);


--
-- Name: code_sequences Authenticated users can read sequences; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can read sequences" ON public.code_sequences FOR SELECT TO authenticated USING (true);


--
-- Name: purchase_batches Authenticated users can update batches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can update batches" ON public.purchase_batches FOR UPDATE TO authenticated USING (true);


--
-- Name: branches Authenticated users can update branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can update branches" ON public.branches FOR UPDATE USING (true);


--
-- Name: customers Authenticated users can update customers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can update customers" ON public.customers FOR UPDATE USING (true);


--
-- Name: invoices Authenticated users can update invoices; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can update invoices" ON public.invoices FOR UPDATE USING (true);


--
-- Name: jewelry_items Authenticated users can update items for transfers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can update items for transfers" ON public.jewelry_items FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: gold_prices Authenticated users can update prices; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can update prices" ON public.gold_prices FOR UPDATE USING (true);


--
-- Name: label_print_jobs Authenticated users can update print jobs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can update print jobs" ON public.label_print_jobs FOR UPDATE TO authenticated USING (true);


--
-- Name: sales Authenticated users can update sales; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can update sales" ON public.sales FOR UPDATE USING (true);


--
-- Name: code_sequences Authenticated users can update sequences; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can update sequences" ON public.code_sequences FOR UPDATE TO authenticated USING (true);


--
-- Name: transfers Authenticated users can update transfers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can update transfers" ON public.transfers FOR UPDATE USING (true);


--
-- Name: chart_of_accounts Authenticated users can view accounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view accounts" ON public.chart_of_accounts FOR SELECT USING (true);


--
-- Name: purchase_batches Authenticated users can view batches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view batches" ON public.purchase_batches FOR SELECT TO authenticated USING (true);


--
-- Name: branches Authenticated users can view branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view branches" ON public.branches FOR SELECT USING (true);


--
-- Name: customers Authenticated users can view customers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view customers" ON public.customers FOR SELECT USING (true);


--
-- Name: import_row_errors Authenticated users can view errors; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view errors" ON public.import_row_errors FOR SELECT TO authenticated USING (true);


--
-- Name: fiscal_years Authenticated users can view fiscal years; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view fiscal years" ON public.fiscal_years FOR SELECT USING (true);


--
-- Name: jewelry_items Authenticated users can view items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view items" ON public.jewelry_items FOR SELECT TO authenticated USING (true);


--
-- Name: journal_entry_lines Authenticated users can view journal entry lines; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view journal entry lines" ON public.journal_entry_lines FOR SELECT USING (true);


--
-- Name: gold_karats Authenticated users can view karats; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view karats" ON public.gold_karats FOR SELECT USING (true);


--
-- Name: payments Authenticated users can view payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view payments" ON public.payments FOR SELECT USING (true);


--
-- Name: gold_prices Authenticated users can view prices; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view prices" ON public.gold_prices FOR SELECT USING (true);


--
-- Name: label_print_jobs Authenticated users can view print jobs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view print jobs" ON public.label_print_jobs FOR SELECT TO authenticated USING (true);


--
-- Name: role_permissions Authenticated users can view role permissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view role permissions" ON public.role_permissions FOR SELECT USING (true);


--
-- Name: custom_roles Authenticated users can view roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view roles" ON public.custom_roles FOR SELECT USING (true);


--
-- Name: gold_scrap Authenticated users can view scrap; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view scrap" ON public.gold_scrap FOR SELECT USING (true);


--
-- Name: screens Authenticated users can view screens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view screens" ON public.screens FOR SELECT USING (true);


--
-- Name: jewelry_sets Authenticated users can view sets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view sets" ON public.jewelry_sets FOR SELECT TO authenticated USING (true);


--
-- Name: suppliers Authenticated users can view suppliers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view suppliers" ON public.suppliers FOR SELECT TO authenticated USING (true);


--
-- Name: transfer_items Authenticated users can view transfer_items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view transfer_items" ON public.transfer_items FOR SELECT USING (true);


--
-- Name: transfers Authenticated users can view transfers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view transfers" ON public.transfers FOR SELECT USING (true);


--
-- Name: audit_logs Only admins can view audit logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Only admins can view audit logs" ON public.audit_logs FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: user_otp System can manage OTP; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "System can manage OTP" ON public.user_otp USING (true);


--
-- Name: inventory_counts Users can create counts in their branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create counts in their branches" ON public.inventory_counts FOR INSERT WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR (branch_id = ANY (public.get_user_branches(auth.uid())))));


--
-- Name: inventory_count_journal_entries Users can insert count journal entries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert count journal entries" ON public.inventory_count_journal_entries FOR INSERT WITH CHECK (true);


--
-- Name: profiles Users can insert own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));


--
-- Name: inventory_count_readings Users can insert readings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert readings" ON public.inventory_count_readings FOR INSERT WITH CHECK (true);


--
-- Name: inventory_count_results Users can insert results; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert results" ON public.inventory_count_results FOR INSERT WITH CHECK (true);


--
-- Name: return_items Users can insert return items for accessible returns; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert return items for accessible returns" ON public.return_items FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.returns r
  WHERE ((r.id = return_items.return_id) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR (r.branch_id = ANY (public.get_user_branches(auth.uid()))))))));


--
-- Name: returns Users can insert returns in their branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert returns in their branches" ON public.returns FOR INSERT WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR (branch_id = ANY (public.get_user_branches(auth.uid())))));


--
-- Name: sale_items Users can insert sale items for accessible sales; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert sale items for accessible sales" ON public.sale_items FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.sales s
  WHERE ((s.id = sale_items.sale_id) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR (s.branch_id = ANY (public.get_user_branches(auth.uid()))))))));


--
-- Name: inventory_count_snapshots Users can insert snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert snapshots" ON public.inventory_count_snapshots FOR INSERT WITH CHECK (true);


--
-- Name: inventory_counts Users can update counts in their branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update counts in their branches" ON public.inventory_counts FOR UPDATE USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR (branch_id = ANY (public.get_user_branches(auth.uid())))));


--
-- Name: profiles Users can update own profile or admins can update any; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own profile or admins can update any" ON public.profiles FOR UPDATE USING (((auth.uid() = user_id) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: returns Users can update returns in their branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update returns in their branches" ON public.returns FOR UPDATE USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR (branch_id = ANY (public.get_user_branches(auth.uid())))));


--
-- Name: inventory_count_journal_entries Users can view count journal entries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view count journal entries" ON public.inventory_count_journal_entries FOR SELECT USING (true);


--
-- Name: inventory_counts Users can view counts from their branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view counts from their branches" ON public.inventory_counts FOR SELECT USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR (branch_id = ANY (public.get_user_branches(auth.uid())))));


--
-- Name: invoices Users can view invoices from their branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view invoices from their branches" ON public.invoices FOR SELECT USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR (branch_id = ANY (public.get_user_branches(auth.uid())))));


--
-- Name: item_movements Users can view movements for their branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view movements for their branches" ON public.item_movements FOR SELECT USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR (from_branch_id = ANY (public.get_user_branches(auth.uid()))) OR (to_branch_id = ANY (public.get_user_branches(auth.uid())))));


--
-- Name: user_otp Users can view own OTP; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own OTP" ON public.user_otp FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: user_branches Users can view own branch assignments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own branch assignments" ON public.user_branches FOR SELECT USING (((auth.uid() = user_id) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: user_custom_roles Users can view own custom roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own custom roles" ON public.user_custom_roles FOR SELECT USING (((auth.uid() = user_id) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: permissions Users can view own permissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own permissions" ON public.permissions FOR SELECT USING (((auth.uid() = user_id) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: user_roles Users can view own roles or admins can view all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own roles or admins can view all" ON public.user_roles FOR SELECT USING (((auth.uid() = user_id) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: profiles Users can view profiles based on permissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view profiles based on permissions" ON public.profiles FOR SELECT USING (((auth.uid() = user_id) OR public.has_role(auth.uid(), 'admin'::public.app_role) OR public.can_approve_transfer_requests(auth.uid())));


--
-- Name: inventory_count_readings Users can view readings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view readings" ON public.inventory_count_readings FOR SELECT USING (true);


--
-- Name: transfer_request_items Users can view request items based on permissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view request items based on permissions" ON public.transfer_request_items FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.transfer_requests tr
  WHERE ((tr.id = transfer_request_items.request_id) AND ((tr.requested_by = auth.uid()) OR public.can_approve_transfer_requests(auth.uid()))))));


--
-- Name: transfer_requests Users can view requests based on permissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view requests based on permissions" ON public.transfer_requests FOR SELECT USING (((auth.uid() = requested_by) OR public.can_approve_transfer_requests(auth.uid())));


--
-- Name: inventory_count_results Users can view results; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view results" ON public.inventory_count_results FOR SELECT USING (true);


--
-- Name: return_items Users can view return items for accessible returns; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view return items for accessible returns" ON public.return_items FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.returns r
  WHERE ((r.id = return_items.return_id) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR (r.branch_id = ANY (public.get_user_branches(auth.uid()))))))));


--
-- Name: returns Users can view returns from their branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view returns from their branches" ON public.returns FOR SELECT USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR (branch_id = ANY (public.get_user_branches(auth.uid())))));


--
-- Name: sale_items Users can view sale items for accessible sales; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view sale items for accessible sales" ON public.sale_items FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.sales s
  WHERE ((s.id = sale_items.sale_id) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR (s.branch_id = ANY (public.get_user_branches(auth.uid()))))))));


--
-- Name: sales Users can view sales from their branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view sales from their branches" ON public.sales FOR SELECT USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR (branch_id = ANY (public.get_user_branches(auth.uid())))));


--
-- Name: inventory_count_snapshots Users can view snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view snapshots" ON public.inventory_count_snapshots FOR SELECT USING (true);


--
-- Name: journal_entries Users with accounting access can view journal entries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users with accounting access can view journal entries" ON public.journal_entries FOR SELECT USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_screen_permission(auth.uid(), 'journal_entries'::text, 'view'::text) OR public.has_screen_permission(auth.uid(), 'accounting'::text, 'view'::text)));


--
-- Name: transfer_requests Users with approval permission can update requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users with approval permission can update requests" ON public.transfer_requests FOR UPDATE USING (public.can_approve_transfer_requests(auth.uid()));


--
-- Name: chart_of_accounts Users with permissions can insert accounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users with permissions can insert accounts" ON public.chart_of_accounts FOR INSERT WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_screen_permission(auth.uid(), 'chart_of_accounts'::text, 'create'::text)));


--
-- Name: journal_entries Users with permissions can update journal entries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users with permissions can update journal entries" ON public.journal_entries FOR UPDATE USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_screen_permission(auth.uid(), 'journal_entries'::text, 'edit'::text)));


--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: branches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

--
-- Name: chart_of_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: code_sequences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.code_sequences ENABLE ROW LEVEL SECURITY;

--
-- Name: custom_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.custom_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

--
-- Name: fiscal_years; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fiscal_years ENABLE ROW LEVEL SECURITY;

--
-- Name: gold_karats; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gold_karats ENABLE ROW LEVEL SECURITY;

--
-- Name: gold_prices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gold_prices ENABLE ROW LEVEL SECURITY;

--
-- Name: gold_scrap; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gold_scrap ENABLE ROW LEVEL SECURITY;

--
-- Name: import_row_errors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.import_row_errors ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_count_journal_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_count_journal_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_count_readings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_count_readings ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_count_results; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_count_results ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_count_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_count_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_counts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_counts ENABLE ROW LEVEL SECURITY;

--
-- Name: invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: item_movements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.item_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: jewelry_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.jewelry_items ENABLE ROW LEVEL SECURITY;

--
-- Name: jewelry_sets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.jewelry_sets ENABLE ROW LEVEL SECURITY;

--
-- Name: journal_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: journal_entry_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.journal_entry_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: label_print_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.label_print_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

--
-- Name: permissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: purchase_batches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchase_batches ENABLE ROW LEVEL SECURITY;

--
-- Name: return_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.return_items ENABLE ROW LEVEL SECURITY;

--
-- Name: returns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.returns ENABLE ROW LEVEL SECURITY;

--
-- Name: role_permissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: sale_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;

--
-- Name: sales; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

--
-- Name: screens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.screens ENABLE ROW LEVEL SECURITY;

--
-- Name: suppliers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

--
-- Name: transfer_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transfer_items ENABLE ROW LEVEL SECURITY;

--
-- Name: transfer_request_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transfer_request_items ENABLE ROW LEVEL SECURITY;

--
-- Name: transfer_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transfer_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: transfers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transfers ENABLE ROW LEVEL SECURITY;

--
-- Name: user_branches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_branches ENABLE ROW LEVEL SECURITY;

--
-- Name: user_custom_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_custom_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: user_otp; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_otp ENABLE ROW LEVEL SECURITY;

--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--




COMMIT;