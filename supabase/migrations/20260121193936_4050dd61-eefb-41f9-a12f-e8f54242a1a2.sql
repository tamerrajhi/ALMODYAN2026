-- ================================================================
-- PURCHASING V2 SCHEMA + ATOMIC RPC SKELETONS + VIEWS
-- Stage-2: Big-Bang Creation
-- ================================================================

-- ================================================================
-- PART 1: V2 TABLES
-- ================================================================

-- 1.1 Purchase Requisitions V2
CREATE TABLE IF NOT EXISTS public.purchase_requisitions_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_number TEXT NOT NULL UNIQUE,
  branch_id UUID REFERENCES public.branches(id),
  department_id UUID REFERENCES public.cost_centers(id),
  cost_center_id UUID REFERENCES public.cost_centers(id),
  requisition_type TEXT NOT NULL DEFAULT 'standard',
  requisition_date DATE NOT NULL DEFAULT CURRENT_DATE,
  required_date DATE,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'cancelled')),
  current_approval_level INTEGER DEFAULT 0,
  required_approval_level INTEGER DEFAULT 1,
  justification TEXT,
  rejection_reason TEXT,
  notes TEXT,
  subtotal NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pr_v2_branch ON public.purchase_requisitions_v2(branch_id);
CREATE INDEX IF NOT EXISTS idx_pr_v2_status ON public.purchase_requisitions_v2(status);
CREATE INDEX IF NOT EXISTS idx_pr_v2_created_at ON public.purchase_requisitions_v2(created_at);
CREATE INDEX IF NOT EXISTS idx_pr_v2_created_by ON public.purchase_requisitions_v2(created_by);

-- 1.2 Purchase Requisition Items V2
CREATE TABLE IF NOT EXISTS public.purchase_requisition_items_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_id UUID NOT NULL REFERENCES public.purchase_requisitions_v2(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL DEFAULT 1,
  item_code TEXT,
  item_description TEXT NOT NULL,
  quantity NUMERIC(15,4) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_of_measure TEXT DEFAULT 'unit',
  estimated_unit_price NUMERIC(15,2) NOT NULL DEFAULT 0,
  estimated_total NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(5,4) NOT NULL DEFAULT 0.15,
  tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_with_tax NUMERIC(15,2) NOT NULL DEFAULT 0,
  suggested_supplier_id UUID REFERENCES public.suppliers(id),
  warehouse_id UUID REFERENCES public.branches(id),
  cost_center_id UUID REFERENCES public.cost_centers(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pri_v2_requisition ON public.purchase_requisition_items_v2(requisition_id);
CREATE INDEX IF NOT EXISTS idx_pri_v2_supplier ON public.purchase_requisition_items_v2(suggested_supplier_id);

-- 1.3 PR Approval History V2
CREATE TABLE IF NOT EXISTS public.pr_approval_history_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_id UUID NOT NULL REFERENCES public.purchase_requisitions_v2(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('created', 'submitted', 'approved', 'rejected', 'hold', 'cancelled')),
  approval_level INTEGER,
  performed_by UUID,
  performed_by_name TEXT,
  performed_by_role TEXT,
  comments TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prah_v2_requisition ON public.pr_approval_history_v2(requisition_id);
CREATE INDEX IF NOT EXISTS idx_prah_v2_created_at ON public.pr_approval_history_v2(created_at);

-- 1.4 PR Approval Thresholds V2
CREATE TABLE IF NOT EXISTS public.pr_approval_thresholds_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  threshold_name TEXT NOT NULL,
  min_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  max_amount NUMERIC(15,2),
  approver_role TEXT NOT NULL,
  approval_order INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prat_v2_active ON public.pr_approval_thresholds_v2(is_active);

-- 1.5 Purchase Orders V2
CREATE TABLE IF NOT EXISTS public.purchase_orders_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT NOT NULL UNIQUE,
  branch_id UUID REFERENCES public.branches(id),
  supplier_id UUID REFERENCES public.suppliers(id),
  order_type TEXT NOT NULL DEFAULT 'standard' CHECK (order_type IN ('standard', 'blanket', 'contract')),
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_delivery_date DATE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'sent', 'partially_received', 'received', 'cancelled')),
  payment_terms TEXT,
  delivery_terms TEXT,
  shipping_address TEXT,
  subtotal NUMERIC(15,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_v2_branch ON public.purchase_orders_v2(branch_id);
CREATE INDEX IF NOT EXISTS idx_po_v2_supplier ON public.purchase_orders_v2(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_v2_status ON public.purchase_orders_v2(status);
CREATE INDEX IF NOT EXISTS idx_po_v2_created_at ON public.purchase_orders_v2(created_at);

-- 1.6 Purchase Order Items V2
CREATE TABLE IF NOT EXISTS public.purchase_order_items_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.purchase_orders_v2(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL DEFAULT 1,
  item_type TEXT NOT NULL DEFAULT 'product' CHECK (item_type IN ('product', 'jewelry', 'service', 'cost')),
  product_id UUID,
  item_code TEXT,
  item_description TEXT NOT NULL,
  quantity NUMERIC(15,4) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  received_quantity NUMERIC(15,4) NOT NULL DEFAULT 0,
  remaining_quantity NUMERIC(15,4) GENERATED ALWAYS AS (quantity - received_quantity) STORED,
  unit_of_measure TEXT DEFAULT 'unit',
  unit_price NUMERIC(15,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(5,4) NOT NULL DEFAULT 0.15,
  tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(15,2) NOT NULL DEFAULT 0,
  pr_item_id UUID REFERENCES public.purchase_requisition_items_v2(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_poi_v2_order ON public.purchase_order_items_v2(order_id);
CREATE INDEX IF NOT EXISTS idx_poi_v2_product ON public.purchase_order_items_v2(product_id);

-- 1.7 Purchase Order Receipts V2
CREATE TABLE IF NOT EXISTS public.purchase_order_receipts_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number TEXT NOT NULL UNIQUE,
  order_id UUID NOT NULL REFERENCES public.purchase_orders_v2(id),
  order_item_id UUID NOT NULL REFERENCES public.purchase_order_items_v2(id),
  branch_id UUID REFERENCES public.branches(id),
  receipt_date DATE NOT NULL DEFAULT CURRENT_DATE,
  received_quantity NUMERIC(15,4) NOT NULL CHECK (received_quantity > 0),
  rejected_quantity NUMERIC(15,4) NOT NULL DEFAULT 0,
  received_weight NUMERIC(15,4),
  vault_id UUID,
  notes TEXT,
  received_by UUID,
  received_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_por_v2_order ON public.purchase_order_receipts_v2(order_id);
CREATE INDEX IF NOT EXISTS idx_por_v2_item ON public.purchase_order_receipts_v2(order_item_id);
CREATE INDEX IF NOT EXISTS idx_por_v2_date ON public.purchase_order_receipts_v2(receipt_date);

-- 1.8 PO-PR Links V2
CREATE TABLE IF NOT EXISTS public.po_pr_links_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.purchase_orders_v2(id) ON DELETE CASCADE,
  requisition_id UUID NOT NULL REFERENCES public.purchase_requisitions_v2(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(order_id, requisition_id)
);

CREATE INDEX IF NOT EXISTS idx_popr_v2_order ON public.po_pr_links_v2(order_id);
CREATE INDEX IF NOT EXISTS idx_popr_v2_requisition ON public.po_pr_links_v2(requisition_id);

-- ================================================================
-- PART 2: NUMBER GENERATORS
-- ================================================================

-- 2.1 PR Number Generator V2
CREATE OR REPLACE FUNCTION public.generate_pr_number_v2()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix TEXT := 'PR';
  v_date_part TEXT := to_char(CURRENT_DATE, 'YYYYMMDD');
  v_seq INTEGER;
  v_number TEXT;
BEGIN
  UPDATE code_sequences
  SET next_value = next_value + 1, updated_at = now()
  WHERE id = 'purchase_requisition_v2'
  RETURNING next_value INTO v_seq;
  
  IF v_seq IS NULL THEN
    INSERT INTO code_sequences (id, prefix, next_value, padding)
    VALUES ('purchase_requisition_v2', 'PR', 2, 4)
    ON CONFLICT (id) DO UPDATE SET next_value = code_sequences.next_value + 1
    RETURNING next_value INTO v_seq;
  END IF;
  
  v_number := v_prefix || '-' || v_date_part || '-' || lpad(v_seq::TEXT, 4, '0');
  RETURN v_number;
END;
$$;

-- 2.2 PO Number Generator V2
CREATE OR REPLACE FUNCTION public.generate_po_number_v2()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix TEXT := 'PO';
  v_date_part TEXT := to_char(CURRENT_DATE, 'YYYYMMDD');
  v_seq INTEGER;
  v_number TEXT;
BEGIN
  UPDATE code_sequences
  SET next_value = next_value + 1, updated_at = now()
  WHERE id = 'purchase_order_v2'
  RETURNING next_value INTO v_seq;
  
  IF v_seq IS NULL THEN
    INSERT INTO code_sequences (id, prefix, next_value, padding)
    VALUES ('purchase_order_v2', 'PO', 2, 4)
    ON CONFLICT (id) DO UPDATE SET next_value = code_sequences.next_value + 1
    RETURNING next_value INTO v_seq;
  END IF;
  
  v_number := v_prefix || '-' || v_date_part || '-' || lpad(v_seq::TEXT, 4, '0');
  RETURN v_number;
END;
$$;

-- 2.3 Receipt Number Generator V2
CREATE OR REPLACE FUNCTION public.generate_receipt_number_v2()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix TEXT := 'RCV';
  v_date_part TEXT := to_char(CURRENT_DATE, 'YYYYMMDD');
  v_seq INTEGER;
  v_number TEXT;
BEGIN
  UPDATE code_sequences
  SET next_value = next_value + 1, updated_at = now()
  WHERE id = 'po_receipt_v2'
  RETURNING next_value INTO v_seq;
  
  IF v_seq IS NULL THEN
    INSERT INTO code_sequences (id, prefix, next_value, padding)
    VALUES ('po_receipt_v2', 'RCV', 2, 4)
    ON CONFLICT (id) DO UPDATE SET next_value = code_sequences.next_value + 1
    RETURNING next_value INTO v_seq;
  END IF;
  
  v_number := v_prefix || '-' || v_date_part || '-' || lpad(v_seq::TEXT, 4, '0');
  RETURN v_number;
END;
$$;

-- ================================================================
-- PART 3: V2 ATOMIC RPCs
-- ================================================================

-- 3.1 Requisition Upsert V2 Atomic
CREATE OR REPLACE FUNCTION public.requisition_upsert_v2_atomic(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_request_id UUID;
  v_workflow_check JSONB;
  v_requisition_id UUID;
  v_requisition_number TEXT;
  v_is_update BOOLEAN := false;
  v_pr JSONB;
  v_items JSONB;
  v_item JSONB;
  v_subtotal NUMERIC := 0;
  v_tax_total NUMERIC := 0;
  v_total NUMERIC := 0;
  v_item_total NUMERIC;
  v_item_tax NUMERIC;
  v_line_num INTEGER := 0;
  v_result JSONB;
BEGIN
  -- Parse client_request_id
  v_client_request_id := (p_payload->>'client_request_id')::UUID;
  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_REQUEST_ID', 'message', 'client_request_id is required');
  END IF;

  -- Begin workflow (idempotency check)
  v_workflow_check := begin_workflow_request(v_client_request_id, 'requisition_upsert_v2', p_payload);
  IF (v_workflow_check->>'status') = 'completed' THEN
    RETURN v_workflow_check->'result';
  ELSIF (v_workflow_check->>'status') NOT IN ('started', 'new') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'WORKFLOW_CONFLICT', 'status', v_workflow_check->>'status');
  END IF;

  BEGIN
    v_pr := p_payload->'requisition';
    v_items := p_payload->'items';
    
    -- Check if update
    IF v_pr->>'id' IS NOT NULL AND v_pr->>'id' != '' THEN
      v_requisition_id := (v_pr->>'id')::UUID;
      v_is_update := true;
      
      -- Validate exists and is draft
      IF NOT EXISTS (SELECT 1 FROM purchase_requisitions_v2 WHERE id = v_requisition_id AND status = 'draft') THEN
        PERFORM core_workflow_failed(v_client_request_id, 'INVALID_STATUS', 'Requisition must be in draft status to update');
        RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_STATUS', 'message', 'Only draft requisitions can be updated');
      END IF;
      
      SELECT requisition_number INTO v_requisition_number FROM purchase_requisitions_v2 WHERE id = v_requisition_id;
    ELSE
      v_requisition_id := gen_random_uuid();
      v_requisition_number := generate_pr_number_v2();
    END IF;

    -- Calculate totals from items
    IF v_items IS NOT NULL AND jsonb_array_length(v_items) > 0 THEN
      FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) LOOP
        v_item_total := COALESCE((v_item->>'quantity')::NUMERIC, 1) * COALESCE((v_item->>'estimated_unit_price')::NUMERIC, 0);
        v_item_tax := v_item_total * COALESCE((v_item->>'tax_rate')::NUMERIC, 0.15);
        v_subtotal := v_subtotal + v_item_total;
        v_tax_total := v_tax_total + v_item_tax;
      END LOOP;
    END IF;
    v_total := v_subtotal + v_tax_total;

    -- Upsert requisition
    INSERT INTO purchase_requisitions_v2 (
      id, requisition_number, branch_id, department_id, cost_center_id,
      requisition_type, requisition_date, required_date, priority, status,
      required_approval_level, justification, notes, subtotal, tax_amount, total_amount,
      created_by, created_at, updated_at
    ) VALUES (
      v_requisition_id,
      v_requisition_number,
      (v_pr->>'branch_id')::UUID,
      (v_pr->>'department_id')::UUID,
      (v_pr->>'cost_center_id')::UUID,
      COALESCE(v_pr->>'requisition_type', 'standard'),
      COALESCE((v_pr->>'requisition_date')::DATE, CURRENT_DATE),
      (v_pr->>'required_date')::DATE,
      COALESCE(v_pr->>'priority', 'medium'),
      'draft',
      COALESCE((v_pr->>'required_approval_level')::INTEGER, 1),
      v_pr->>'justification',
      v_pr->>'notes',
      v_subtotal,
      v_tax_total,
      v_total,
      (v_pr->>'created_by')::UUID,
      now(),
      now()
    )
    ON CONFLICT (id) DO UPDATE SET
      branch_id = EXCLUDED.branch_id,
      department_id = EXCLUDED.department_id,
      cost_center_id = EXCLUDED.cost_center_id,
      requisition_type = EXCLUDED.requisition_type,
      requisition_date = EXCLUDED.requisition_date,
      required_date = EXCLUDED.required_date,
      priority = EXCLUDED.priority,
      required_approval_level = EXCLUDED.required_approval_level,
      justification = EXCLUDED.justification,
      notes = EXCLUDED.notes,
      subtotal = EXCLUDED.subtotal,
      tax_amount = EXCLUDED.tax_amount,
      total_amount = EXCLUDED.total_amount,
      updated_at = now();

    -- Delete old items if update
    IF v_is_update THEN
      DELETE FROM purchase_requisition_items_v2 WHERE requisition_id = v_requisition_id;
    END IF;

    -- Insert items
    IF v_items IS NOT NULL AND jsonb_array_length(v_items) > 0 THEN
      FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) LOOP
        v_line_num := v_line_num + 1;
        v_item_total := COALESCE((v_item->>'quantity')::NUMERIC, 1) * COALESCE((v_item->>'estimated_unit_price')::NUMERIC, 0);
        v_item_tax := v_item_total * COALESCE((v_item->>'tax_rate')::NUMERIC, 0.15);
        
        INSERT INTO purchase_requisition_items_v2 (
          requisition_id, line_number, item_code, item_description,
          quantity, unit_of_measure, estimated_unit_price, estimated_total,
          tax_rate, tax_amount, total_with_tax, suggested_supplier_id,
          warehouse_id, cost_center_id, notes
        ) VALUES (
          v_requisition_id,
          v_line_num,
          v_item->>'item_code',
          COALESCE(v_item->>'item_description', 'Item ' || v_line_num),
          COALESCE((v_item->>'quantity')::NUMERIC, 1),
          COALESCE(v_item->>'unit_of_measure', 'unit'),
          COALESCE((v_item->>'estimated_unit_price')::NUMERIC, 0),
          v_item_total,
          COALESCE((v_item->>'tax_rate')::NUMERIC, 0.15),
          v_item_tax,
          v_item_total + v_item_tax,
          (v_item->>'suggested_supplier_id')::UUID,
          (v_item->>'warehouse_id')::UUID,
          (v_item->>'cost_center_id')::UUID,
          v_item->>'notes'
        );
      END LOOP;
    END IF;

    -- Insert approval history
    INSERT INTO pr_approval_history_v2 (requisition_id, action, performed_by, performed_by_name, comments)
    VALUES (v_requisition_id, CASE WHEN v_is_update THEN 'created' ELSE 'created' END, 
            (v_pr->>'created_by')::UUID, v_pr->>'created_by_name', 
            CASE WHEN v_is_update THEN 'Requisition updated' ELSE 'Requisition created' END);

    -- Build result
    v_result := jsonb_build_object(
      'success', true,
      'requisition_id', v_requisition_id,
      'requisition_number', v_requisition_number,
      'status', 'draft',
      'is_update', v_is_update,
      'total_amount', v_total,
      'items_count', v_line_num
    );

    PERFORM core_workflow_success(v_client_request_id, v_requisition_id, v_result);
    RETURN v_result;
    
  EXCEPTION WHEN OTHERS THEN
    PERFORM core_workflow_failed(v_client_request_id, 'EXCEPTION', SQLERRM);
    RETURN jsonb_build_object('success', false, 'error_code', 'EXCEPTION', 'message', SQLERRM);
  END;
END;
$$;

-- 3.2 Requisition Submit V2 Atomic
CREATE OR REPLACE FUNCTION public.requisition_submit_v2_atomic(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_request_id UUID;
  v_workflow_check JSONB;
  v_requisition_id UUID;
  v_current_status TEXT;
  v_requisition_number TEXT;
  v_total_amount NUMERIC;
  v_required_level INTEGER;
  v_result JSONB;
BEGIN
  v_client_request_id := (p_payload->>'client_request_id')::UUID;
  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_REQUEST_ID');
  END IF;

  v_workflow_check := begin_workflow_request(v_client_request_id, 'requisition_submit_v2', p_payload);
  IF (v_workflow_check->>'status') = 'completed' THEN
    RETURN v_workflow_check->'result';
  ELSIF (v_workflow_check->>'status') NOT IN ('started', 'new') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'WORKFLOW_CONFLICT');
  END IF;

  BEGIN
    v_requisition_id := (p_payload->>'requisition_id')::UUID;
    
    -- Get current state
    SELECT status, requisition_number, total_amount, required_approval_level
    INTO v_current_status, v_requisition_number, v_total_amount, v_required_level
    FROM purchase_requisitions_v2
    WHERE id = v_requisition_id;
    
    IF v_current_status IS NULL THEN
      PERFORM core_workflow_failed(v_client_request_id, 'NOT_FOUND', 'Requisition not found');
      RETURN jsonb_build_object('success', false, 'error_code', 'NOT_FOUND');
    END IF;
    
    -- Validate status transition
    IF v_current_status != 'draft' THEN
      PERFORM core_workflow_failed(v_client_request_id, 'INVALID_TRANSITION', 'Can only submit draft requisitions');
      RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_TRANSITION', 'current_status', v_current_status);
    END IF;

    -- Determine required approval level based on amount
    SELECT COALESCE(MAX(approval_order), 1) INTO v_required_level
    FROM pr_approval_thresholds_v2
    WHERE is_active = true
      AND min_amount <= v_total_amount
      AND (max_amount IS NULL OR max_amount >= v_total_amount);

    -- Update status
    UPDATE purchase_requisitions_v2
    SET status = 'submitted',
        current_approval_level = 0,
        required_approval_level = v_required_level,
        updated_at = now()
    WHERE id = v_requisition_id;

    -- Log history
    INSERT INTO pr_approval_history_v2 (requisition_id, action, approval_level, performed_by, performed_by_name, comments)
    VALUES (v_requisition_id, 'submitted', 0, (p_payload->>'performed_by')::UUID, p_payload->>'performed_by_name', p_payload->>'comments');

    v_result := jsonb_build_object(
      'success', true,
      'requisition_id', v_requisition_id,
      'requisition_number', v_requisition_number,
      'status', 'submitted',
      'required_approval_level', v_required_level
    );

    PERFORM core_workflow_success(v_client_request_id, v_requisition_id, v_result);
    RETURN v_result;

  EXCEPTION WHEN OTHERS THEN
    PERFORM core_workflow_failed(v_client_request_id, 'EXCEPTION', SQLERRM);
    RETURN jsonb_build_object('success', false, 'error_code', 'EXCEPTION', 'message', SQLERRM);
  END;
END;
$$;

-- 3.3 Requisition Approve V2 Atomic
CREATE OR REPLACE FUNCTION public.requisition_approve_v2_atomic(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_request_id UUID;
  v_workflow_check JSONB;
  v_requisition_id UUID;
  v_action TEXT;
  v_current_status TEXT;
  v_current_level INTEGER;
  v_required_level INTEGER;
  v_new_status TEXT;
  v_new_level INTEGER;
  v_result JSONB;
BEGIN
  v_client_request_id := (p_payload->>'client_request_id')::UUID;
  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_REQUEST_ID');
  END IF;

  v_workflow_check := begin_workflow_request(v_client_request_id, 'requisition_approve_v2', p_payload);
  IF (v_workflow_check->>'status') = 'completed' THEN
    RETURN v_workflow_check->'result';
  ELSIF (v_workflow_check->>'status') NOT IN ('started', 'new') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'WORKFLOW_CONFLICT');
  END IF;

  BEGIN
    v_requisition_id := (p_payload->>'requisition_id')::UUID;
    v_action := COALESCE(p_payload->>'action', 'approve');

    -- Get current state
    SELECT status, current_approval_level, required_approval_level
    INTO v_current_status, v_current_level, v_required_level
    FROM purchase_requisitions_v2
    WHERE id = v_requisition_id;

    IF v_current_status IS NULL THEN
      PERFORM core_workflow_failed(v_client_request_id, 'NOT_FOUND', 'Requisition not found');
      RETURN jsonb_build_object('success', false, 'error_code', 'NOT_FOUND');
    END IF;

    -- Validate can be approved/rejected
    IF v_current_status NOT IN ('submitted', 'draft') THEN
      PERFORM core_workflow_failed(v_client_request_id, 'INVALID_TRANSITION', 'Cannot approve/reject from current status');
      RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_TRANSITION', 'current_status', v_current_status);
    END IF;

    -- Determine new status based on action
    IF v_action = 'reject' THEN
      v_new_status := 'rejected';
      v_new_level := v_current_level;
    ELSIF v_action = 'approve' THEN
      v_new_level := v_current_level + 1;
      IF v_new_level >= v_required_level THEN
        v_new_status := 'approved';
      ELSE
        v_new_status := 'submitted'; -- Still pending next level
      END IF;
    ELSE
      v_new_status := v_current_status;
      v_new_level := v_current_level;
    END IF;

    -- Update requisition
    UPDATE purchase_requisitions_v2
    SET status = v_new_status,
        current_approval_level = v_new_level,
        rejection_reason = CASE WHEN v_action = 'reject' THEN p_payload->>'comments' ELSE rejection_reason END,
        updated_at = now()
    WHERE id = v_requisition_id;

    -- Log history
    INSERT INTO pr_approval_history_v2 (requisition_id, action, approval_level, performed_by, performed_by_name, performed_by_role, comments)
    VALUES (v_requisition_id, v_action, v_new_level, (p_payload->>'performed_by')::UUID, 
            p_payload->>'performed_by_name', p_payload->>'performed_by_role', p_payload->>'comments');

    v_result := jsonb_build_object(
      'success', true,
      'requisition_id', v_requisition_id,
      'action', v_action,
      'previous_status', v_current_status,
      'new_status', v_new_status,
      'approval_level', v_new_level,
      'is_fully_approved', v_new_status = 'approved'
    );

    PERFORM core_workflow_success(v_client_request_id, v_requisition_id, v_result);
    RETURN v_result;

  EXCEPTION WHEN OTHERS THEN
    PERFORM core_workflow_failed(v_client_request_id, 'EXCEPTION', SQLERRM);
    RETURN jsonb_build_object('success', false, 'error_code', 'EXCEPTION', 'message', SQLERRM);
  END;
END;
$$;

-- 3.4 Convert PR to PO V2 Atomic
CREATE OR REPLACE FUNCTION public.convert_pr_to_po_v2_atomic(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_request_id UUID;
  v_workflow_check JSONB;
  v_requisition_id UUID;
  v_order_id UUID;
  v_order_number TEXT;
  v_pr_status TEXT;
  v_pr_branch_id UUID;
  v_items JSONB;
  v_item JSONB;
  v_subtotal NUMERIC := 0;
  v_tax_total NUMERIC := 0;
  v_total NUMERIC := 0;
  v_line_num INTEGER := 0;
  v_item_total NUMERIC;
  v_item_tax NUMERIC;
  v_po_item_id UUID;
  v_result JSONB;
BEGIN
  v_client_request_id := (p_payload->>'client_request_id')::UUID;
  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_REQUEST_ID');
  END IF;

  v_workflow_check := begin_workflow_request(v_client_request_id, 'convert_pr_to_po_v2', p_payload);
  IF (v_workflow_check->>'status') = 'completed' THEN
    RETURN v_workflow_check->'result';
  ELSIF (v_workflow_check->>'status') NOT IN ('started', 'new') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'WORKFLOW_CONFLICT');
  END IF;

  BEGIN
    v_requisition_id := (p_payload->>'requisition_id')::UUID;
    v_items := p_payload->'items';

    -- Validate PR exists and is approved
    SELECT status, branch_id INTO v_pr_status, v_pr_branch_id
    FROM purchase_requisitions_v2
    WHERE id = v_requisition_id;

    IF v_pr_status IS NULL THEN
      PERFORM core_workflow_failed(v_client_request_id, 'NOT_FOUND', 'Requisition not found');
      RETURN jsonb_build_object('success', false, 'error_code', 'NOT_FOUND');
    END IF;

    IF v_pr_status != 'approved' THEN
      PERFORM core_workflow_failed(v_client_request_id, 'INVALID_STATUS', 'Requisition must be approved to convert');
      RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_STATUS', 'current_status', v_pr_status);
    END IF;

    -- Generate PO
    v_order_id := gen_random_uuid();
    v_order_number := generate_po_number_v2();

    -- Calculate totals
    IF v_items IS NOT NULL AND jsonb_array_length(v_items) > 0 THEN
      FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) LOOP
        v_item_total := COALESCE((v_item->>'quantity')::NUMERIC, 1) * COALESCE((v_item->>'unit_price')::NUMERIC, 0);
        v_item_tax := v_item_total * COALESCE((v_item->>'tax_rate')::NUMERIC, 0.15);
        v_subtotal := v_subtotal + v_item_total;
        v_tax_total := v_tax_total + v_item_tax;
      END LOOP;
    END IF;
    v_total := v_subtotal + v_tax_total;

    -- Create PO
    INSERT INTO purchase_orders_v2 (
      id, order_number, branch_id, supplier_id, order_type, order_date, expected_delivery_date,
      status, payment_terms, delivery_terms, subtotal, tax_amount, total_amount, notes, created_by
    ) VALUES (
      v_order_id,
      v_order_number,
      COALESCE((p_payload->>'branch_id')::UUID, v_pr_branch_id),
      (p_payload->>'supplier_id')::UUID,
      COALESCE(p_payload->>'order_type', 'standard'),
      COALESCE((p_payload->>'order_date')::DATE, CURRENT_DATE),
      (p_payload->>'expected_delivery_date')::DATE,
      'draft',
      p_payload->>'payment_terms',
      p_payload->>'delivery_terms',
      v_subtotal,
      v_tax_total,
      v_total,
      p_payload->>'notes',
      (p_payload->>'created_by')::UUID
    );

    -- Create PO items
    IF v_items IS NOT NULL AND jsonb_array_length(v_items) > 0 THEN
      FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) LOOP
        v_line_num := v_line_num + 1;
        v_po_item_id := gen_random_uuid();
        v_item_total := COALESCE((v_item->>'quantity')::NUMERIC, 1) * COALESCE((v_item->>'unit_price')::NUMERIC, 0);
        v_item_tax := v_item_total * COALESCE((v_item->>'tax_rate')::NUMERIC, 0.15);

        INSERT INTO purchase_order_items_v2 (
          id, order_id, line_number, item_type, product_id, item_code, item_description,
          quantity, unit_of_measure, unit_price, tax_rate, tax_amount, line_total, pr_item_id, notes
        ) VALUES (
          v_po_item_id,
          v_order_id,
          v_line_num,
          COALESCE(v_item->>'item_type', 'product'),
          (v_item->>'product_id')::UUID,
          v_item->>'item_code',
          COALESCE(v_item->>'item_description', 'Item ' || v_line_num),
          COALESCE((v_item->>'quantity')::NUMERIC, 1),
          COALESCE(v_item->>'unit_of_measure', 'unit'),
          COALESCE((v_item->>'unit_price')::NUMERIC, 0),
          COALESCE((v_item->>'tax_rate')::NUMERIC, 0.15),
          v_item_tax,
          v_item_total + v_item_tax,
          (v_item->>'pr_item_id')::UUID,
          v_item->>'notes'
        );
      END LOOP;
    END IF;

    -- Create link
    INSERT INTO po_pr_links_v2 (order_id, requisition_id)
    VALUES (v_order_id, v_requisition_id);

    v_result := jsonb_build_object(
      'success', true,
      'order_id', v_order_id,
      'order_number', v_order_number,
      'requisition_id', v_requisition_id,
      'status', 'draft',
      'total_amount', v_total,
      'items_count', v_line_num
    );

    PERFORM core_workflow_success(v_client_request_id, v_order_id, v_result);
    RETURN v_result;

  EXCEPTION WHEN OTHERS THEN
    PERFORM core_workflow_failed(v_client_request_id, 'EXCEPTION', SQLERRM);
    RETURN jsonb_build_object('success', false, 'error_code', 'EXCEPTION', 'message', SQLERRM);
  END;
END;
$$;

-- 3.5 Purchase Order Update V2 Atomic
CREATE OR REPLACE FUNCTION public.purchase_order_update_v2_atomic(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_request_id UUID;
  v_workflow_check JSONB;
  v_order_id UUID;
  v_action TEXT;
  v_current_status TEXT;
  v_new_status TEXT;
  v_order_number TEXT;
  v_result JSONB;
BEGIN
  v_client_request_id := (p_payload->>'client_request_id')::UUID;
  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_REQUEST_ID');
  END IF;

  v_workflow_check := begin_workflow_request(v_client_request_id, 'purchase_order_update_v2', p_payload);
  IF (v_workflow_check->>'status') = 'completed' THEN
    RETURN v_workflow_check->'result';
  ELSIF (v_workflow_check->>'status') NOT IN ('started', 'new') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'WORKFLOW_CONFLICT');
  END IF;

  BEGIN
    v_order_id := (p_payload->>'order_id')::UUID;
    v_action := COALESCE(p_payload->>'action', 'submit');

    SELECT status, order_number INTO v_current_status, v_order_number
    FROM purchase_orders_v2
    WHERE id = v_order_id;

    IF v_current_status IS NULL THEN
      PERFORM core_workflow_failed(v_client_request_id, 'NOT_FOUND', 'Order not found');
      RETURN jsonb_build_object('success', false, 'error_code', 'NOT_FOUND');
    END IF;

    -- Validate transitions
    CASE v_action
      WHEN 'submit' THEN
        IF v_current_status != 'draft' THEN
          PERFORM core_workflow_failed(v_client_request_id, 'INVALID_TRANSITION', 'Only draft orders can be submitted');
          RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_TRANSITION');
        END IF;
        v_new_status := 'submitted';
      WHEN 'approve' THEN
        IF v_current_status != 'submitted' THEN
          PERFORM core_workflow_failed(v_client_request_id, 'INVALID_TRANSITION', 'Only submitted orders can be approved');
          RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_TRANSITION');
        END IF;
        v_new_status := 'approved';
      WHEN 'send' THEN
        IF v_current_status != 'approved' THEN
          PERFORM core_workflow_failed(v_client_request_id, 'INVALID_TRANSITION', 'Only approved orders can be sent');
          RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_TRANSITION');
        END IF;
        v_new_status := 'sent';
      WHEN 'cancel' THEN
        IF v_current_status IN ('received', 'cancelled') THEN
          PERFORM core_workflow_failed(v_client_request_id, 'INVALID_TRANSITION', 'Cannot cancel completed orders');
          RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_TRANSITION');
        END IF;
        v_new_status := 'cancelled';
      ELSE
        v_new_status := v_current_status;
    END CASE;

    UPDATE purchase_orders_v2
    SET status = v_new_status, updated_at = now()
    WHERE id = v_order_id;

    v_result := jsonb_build_object(
      'success', true,
      'order_id', v_order_id,
      'order_number', v_order_number,
      'action', v_action,
      'previous_status', v_current_status,
      'new_status', v_new_status
    );

    PERFORM core_workflow_success(v_client_request_id, v_order_id, v_result);
    RETURN v_result;

  EXCEPTION WHEN OTHERS THEN
    PERFORM core_workflow_failed(v_client_request_id, 'EXCEPTION', SQLERRM);
    RETURN jsonb_build_object('success', false, 'error_code', 'EXCEPTION', 'message', SQLERRM);
  END;
END;
$$;

-- 3.6 Purchase Order Receive V2 Atomic
CREATE OR REPLACE FUNCTION public.purchase_order_receive_v2_atomic(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_request_id UUID;
  v_workflow_check JSONB;
  v_order_id UUID;
  v_order_status TEXT;
  v_receipts JSONB;
  v_receipt JSONB;
  v_receipt_number TEXT;
  v_receipt_id UUID;
  v_order_item_id UUID;
  v_current_received NUMERIC;
  v_ordered_qty NUMERIC;
  v_new_received NUMERIC;
  v_total_received INTEGER := 0;
  v_all_received BOOLEAN := true;
  v_branch_id UUID;
  v_result JSONB;
BEGIN
  v_client_request_id := (p_payload->>'client_request_id')::UUID;
  IF v_client_request_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'MISSING_REQUEST_ID');
  END IF;

  v_workflow_check := begin_workflow_request(v_client_request_id, 'purchase_order_receive_v2', p_payload);
  IF (v_workflow_check->>'status') = 'completed' THEN
    RETURN v_workflow_check->'result';
  ELSIF (v_workflow_check->>'status') NOT IN ('started', 'new') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'WORKFLOW_CONFLICT');
  END IF;

  BEGIN
    v_order_id := (p_payload->>'order_id')::UUID;
    v_receipts := p_payload->'receipts';
    v_branch_id := (p_payload->>'branch_id')::UUID;

    -- Validate order
    SELECT status, branch_id INTO v_order_status, v_branch_id
    FROM purchase_orders_v2
    WHERE id = v_order_id;

    IF v_order_status IS NULL THEN
      PERFORM core_workflow_failed(v_client_request_id, 'NOT_FOUND', 'Order not found');
      RETURN jsonb_build_object('success', false, 'error_code', 'NOT_FOUND');
    END IF;

    IF v_order_status NOT IN ('sent', 'approved', 'partially_received') THEN
      PERFORM core_workflow_failed(v_client_request_id, 'INVALID_STATUS', 'Order cannot receive items in current status');
      RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_STATUS', 'current_status', v_order_status);
    END IF;

    -- Process each receipt
    IF v_receipts IS NOT NULL AND jsonb_array_length(v_receipts) > 0 THEN
      FOR v_receipt IN SELECT * FROM jsonb_array_elements(v_receipts) LOOP
        v_order_item_id := (v_receipt->>'order_item_id')::UUID;
        
        -- Get current item state
        SELECT quantity, received_quantity INTO v_ordered_qty, v_current_received
        FROM purchase_order_items_v2
        WHERE id = v_order_item_id AND order_id = v_order_id;

        IF v_ordered_qty IS NULL THEN
          CONTINUE; -- Skip invalid items
        END IF;

        v_new_received := COALESCE((v_receipt->>'received_quantity')::NUMERIC, 0);
        IF v_new_received <= 0 THEN
          CONTINUE;
        END IF;

        -- Generate receipt number
        v_receipt_number := generate_receipt_number_v2();
        v_receipt_id := gen_random_uuid();

        -- Insert receipt
        INSERT INTO purchase_order_receipts_v2 (
          id, receipt_number, order_id, order_item_id, branch_id, receipt_date,
          received_quantity, rejected_quantity, received_weight, vault_id, notes,
          received_by, received_by_name
        ) VALUES (
          v_receipt_id,
          v_receipt_number,
          v_order_id,
          v_order_item_id,
          COALESCE((v_receipt->>'branch_id')::UUID, v_branch_id),
          COALESCE((v_receipt->>'receipt_date')::DATE, CURRENT_DATE),
          v_new_received,
          COALESCE((v_receipt->>'rejected_quantity')::NUMERIC, 0),
          (v_receipt->>'received_weight')::NUMERIC,
          (v_receipt->>'vault_id')::UUID,
          v_receipt->>'notes',
          (p_payload->>'received_by')::UUID,
          p_payload->>'received_by_name'
        );

        -- Update item received quantity
        UPDATE purchase_order_items_v2
        SET received_quantity = received_quantity + v_new_received
        WHERE id = v_order_item_id;

        v_total_received := v_total_received + 1;
      END LOOP;
    END IF;

    -- Check if all items fully received
    SELECT NOT EXISTS (
      SELECT 1 FROM purchase_order_items_v2
      WHERE order_id = v_order_id AND received_quantity < quantity
    ) INTO v_all_received;

    -- Update order status
    UPDATE purchase_orders_v2
    SET status = CASE WHEN v_all_received THEN 'received' ELSE 'partially_received' END,
        updated_at = now()
    WHERE id = v_order_id;

    v_result := jsonb_build_object(
      'success', true,
      'order_id', v_order_id,
      'receipts_created', v_total_received,
      'all_received', v_all_received,
      'new_status', CASE WHEN v_all_received THEN 'received' ELSE 'partially_received' END
    );

    PERFORM core_workflow_success(v_client_request_id, v_order_id, v_result);
    RETURN v_result;

  EXCEPTION WHEN OTHERS THEN
    PERFORM core_workflow_failed(v_client_request_id, 'EXCEPTION', SQLERRM);
    RETURN jsonb_build_object('success', false, 'error_code', 'EXCEPTION', 'message', SQLERRM);
  END;
END;
$$;

-- ================================================================
-- PART 4: V2 READ VIEWS
-- ================================================================

-- 4.1 Purchase Requisitions V2 View
CREATE OR REPLACE VIEW public.purchase_requisitions_v2_view AS
SELECT 
  pr.id,
  pr.requisition_number,
  pr.branch_id,
  b.branch_name,
  pr.department_id,
  d.center_name AS department_name,
  pr.cost_center_id,
  cc.center_name AS cost_center_name,
  pr.requisition_type,
  pr.requisition_date,
  pr.required_date,
  pr.priority,
  pr.status,
  pr.current_approval_level,
  pr.required_approval_level,
  pr.justification,
  pr.rejection_reason,
  pr.notes,
  pr.subtotal,
  pr.tax_amount,
  pr.total_amount,
  pr.created_by,
  pr.created_at,
  pr.updated_at,
  (SELECT COUNT(*) FROM purchase_requisition_items_v2 pri WHERE pri.requisition_id = pr.id) AS items_count
FROM purchase_requisitions_v2 pr
LEFT JOIN branches b ON b.id = pr.branch_id
LEFT JOIN cost_centers d ON d.id = pr.department_id
LEFT JOIN cost_centers cc ON cc.id = pr.cost_center_id;

-- 4.2 Purchase Orders V2 View
CREATE OR REPLACE VIEW public.purchase_orders_v2_view AS
SELECT 
  po.id,
  po.order_number,
  po.branch_id,
  b.branch_name,
  po.supplier_id,
  s.supplier_name,
  po.order_type,
  po.order_date,
  po.expected_delivery_date,
  po.status,
  po.payment_terms,
  po.delivery_terms,
  po.subtotal,
  po.discount_amount,
  po.tax_amount,
  po.total_amount,
  po.notes,
  po.created_by,
  po.created_at,
  po.updated_at,
  (SELECT COUNT(*) FROM purchase_order_items_v2 poi WHERE poi.order_id = po.id) AS items_count,
  (SELECT COUNT(*) FROM po_pr_links_v2 lnk WHERE lnk.order_id = po.id) AS linked_pr_count
FROM purchase_orders_v2 po
LEFT JOIN branches b ON b.id = po.branch_id
LEFT JOIN suppliers s ON s.id = po.supplier_id;

-- 4.3 Purchase Order Detail V2 View
CREATE OR REPLACE VIEW public.purchase_order_detail_v2_view AS
SELECT 
  poi.id AS item_id,
  poi.order_id,
  po.order_number,
  poi.line_number,
  poi.item_type,
  poi.product_id,
  poi.item_code,
  poi.item_description,
  poi.quantity,
  poi.received_quantity,
  poi.remaining_quantity,
  poi.unit_of_measure,
  poi.unit_price,
  poi.discount_amount,
  poi.tax_rate,
  poi.tax_amount,
  poi.line_total,
  poi.pr_item_id,
  poi.notes,
  po.status AS order_status,
  po.supplier_id,
  s.supplier_name,
  po.branch_id,
  b.branch_name
FROM purchase_order_items_v2 poi
JOIN purchase_orders_v2 po ON po.id = poi.order_id
LEFT JOIN suppliers s ON s.id = po.supplier_id
LEFT JOIN branches b ON b.id = po.branch_id;

-- ================================================================
-- PART 5: ENABLE RLS (basic policies)
-- ================================================================

ALTER TABLE public.purchase_requisitions_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_requisition_items_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pr_approval_history_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pr_approval_thresholds_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_receipts_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.po_pr_links_v2 ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read
CREATE POLICY "pr_v2_select" ON public.purchase_requisitions_v2 FOR SELECT TO authenticated USING (true);
CREATE POLICY "pri_v2_select" ON public.purchase_requisition_items_v2 FOR SELECT TO authenticated USING (true);
CREATE POLICY "prah_v2_select" ON public.pr_approval_history_v2 FOR SELECT TO authenticated USING (true);
CREATE POLICY "prat_v2_select" ON public.pr_approval_thresholds_v2 FOR SELECT TO authenticated USING (true);
CREATE POLICY "po_v2_select" ON public.purchase_orders_v2 FOR SELECT TO authenticated USING (true);
CREATE POLICY "poi_v2_select" ON public.purchase_order_items_v2 FOR SELECT TO authenticated USING (true);
CREATE POLICY "por_v2_select" ON public.purchase_order_receipts_v2 FOR SELECT TO authenticated USING (true);
CREATE POLICY "popr_v2_select" ON public.po_pr_links_v2 FOR SELECT TO authenticated USING (true);

-- All writes via RPC only (SECURITY DEFINER bypasses RLS)