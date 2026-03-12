-- ============================================
-- PROMPT-2-KS: V1 Purchasing Tables Kill-Switch
-- Blocks INSERT/UPDATE/DELETE on all V1 purchasing tables
-- Keeps SELECT allowed for read compatibility
-- ============================================

-- ============================================
-- 1. purchase_orders (V1)
-- ============================================
CREATE OR REPLACE FUNCTION public.block_legacy_writes__purchase_orders()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'LEGACY_BLOCKED: Direct writes to purchase_orders are disabled. Use atomic RPC (purchase_order_create_v2_atomic, etc).';
END;
$$;

DROP TRIGGER IF EXISTS trg_block_v1_purchase_orders_ins ON public.purchase_orders;
CREATE TRIGGER trg_block_v1_purchase_orders_ins
BEFORE INSERT ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.block_legacy_writes__purchase_orders();

DROP TRIGGER IF EXISTS trg_block_v1_purchase_orders_upd ON public.purchase_orders;
CREATE TRIGGER trg_block_v1_purchase_orders_upd
BEFORE UPDATE ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.block_legacy_writes__purchase_orders();

DROP TRIGGER IF EXISTS trg_block_v1_purchase_orders_del ON public.purchase_orders;
CREATE TRIGGER trg_block_v1_purchase_orders_del
BEFORE DELETE ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.block_legacy_writes__purchase_orders();

-- ============================================
-- 2. purchase_order_items (V1)
-- ============================================
CREATE OR REPLACE FUNCTION public.block_legacy_writes__purchase_order_items()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'LEGACY_BLOCKED: Direct writes to purchase_order_items are disabled. Use atomic RPC.';
END;
$$;

DROP TRIGGER IF EXISTS trg_block_v1_purchase_order_items_ins ON public.purchase_order_items;
CREATE TRIGGER trg_block_v1_purchase_order_items_ins
BEFORE INSERT ON public.purchase_order_items
FOR EACH ROW EXECUTE FUNCTION public.block_legacy_writes__purchase_order_items();

DROP TRIGGER IF EXISTS trg_block_v1_purchase_order_items_upd ON public.purchase_order_items;
CREATE TRIGGER trg_block_v1_purchase_order_items_upd
BEFORE UPDATE ON public.purchase_order_items
FOR EACH ROW EXECUTE FUNCTION public.block_legacy_writes__purchase_order_items();

DROP TRIGGER IF EXISTS trg_block_v1_purchase_order_items_del ON public.purchase_order_items;
CREATE TRIGGER trg_block_v1_purchase_order_items_del
BEFORE DELETE ON public.purchase_order_items
FOR EACH ROW EXECUTE FUNCTION public.block_legacy_writes__purchase_order_items();

-- ============================================
-- 3. purchase_order_receipts (V1)
-- ============================================
CREATE OR REPLACE FUNCTION public.block_legacy_writes__purchase_order_receipts()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'LEGACY_BLOCKED: Direct writes to purchase_order_receipts are disabled. Use atomic RPC.';
END;
$$;

DROP TRIGGER IF EXISTS trg_block_v1_purchase_order_receipts_ins ON public.purchase_order_receipts;
CREATE TRIGGER trg_block_v1_purchase_order_receipts_ins
BEFORE INSERT ON public.purchase_order_receipts
FOR EACH ROW EXECUTE FUNCTION public.block_legacy_writes__purchase_order_receipts();

DROP TRIGGER IF EXISTS trg_block_v1_purchase_order_receipts_upd ON public.purchase_order_receipts;
CREATE TRIGGER trg_block_v1_purchase_order_receipts_upd
BEFORE UPDATE ON public.purchase_order_receipts
FOR EACH ROW EXECUTE FUNCTION public.block_legacy_writes__purchase_order_receipts();

DROP TRIGGER IF EXISTS trg_block_v1_purchase_order_receipts_del ON public.purchase_order_receipts;
CREATE TRIGGER trg_block_v1_purchase_order_receipts_del
BEFORE DELETE ON public.purchase_order_receipts
FOR EACH ROW EXECUTE FUNCTION public.block_legacy_writes__purchase_order_receipts();

-- ============================================
-- 4. po_pr_links (V1)
-- ============================================
CREATE OR REPLACE FUNCTION public.block_legacy_writes__po_pr_links()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'LEGACY_BLOCKED: Direct writes to po_pr_links are disabled. Use atomic RPC.';
END;
$$;

DROP TRIGGER IF EXISTS trg_block_v1_po_pr_links_ins ON public.po_pr_links;
CREATE TRIGGER trg_block_v1_po_pr_links_ins
BEFORE INSERT ON public.po_pr_links
FOR EACH ROW EXECUTE FUNCTION public.block_legacy_writes__po_pr_links();

DROP TRIGGER IF EXISTS trg_block_v1_po_pr_links_upd ON public.po_pr_links;
CREATE TRIGGER trg_block_v1_po_pr_links_upd
BEFORE UPDATE ON public.po_pr_links
FOR EACH ROW EXECUTE FUNCTION public.block_legacy_writes__po_pr_links();

DROP TRIGGER IF EXISTS trg_block_v1_po_pr_links_del ON public.po_pr_links;
CREATE TRIGGER trg_block_v1_po_pr_links_del
BEFORE DELETE ON public.po_pr_links
FOR EACH ROW EXECUTE FUNCTION public.block_legacy_writes__po_pr_links();

-- ============================================
-- 5. purchase_requisitions (V1)
-- ============================================
CREATE OR REPLACE FUNCTION public.block_legacy_writes__purchase_requisitions()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'LEGACY_BLOCKED: Direct writes to purchase_requisitions are disabled. Use atomic RPC (requisition_upsert_v2_atomic, etc).';
END;
$$;

DROP TRIGGER IF EXISTS trg_block_v1_purchase_requisitions_ins ON public.purchase_requisitions;
CREATE TRIGGER trg_block_v1_purchase_requisitions_ins
BEFORE INSERT ON public.purchase_requisitions
FOR EACH ROW EXECUTE FUNCTION public.block_legacy_writes__purchase_requisitions();

DROP TRIGGER IF EXISTS trg_block_v1_purchase_requisitions_upd ON public.purchase_requisitions;
CREATE TRIGGER trg_block_v1_purchase_requisitions_upd
BEFORE UPDATE ON public.purchase_requisitions
FOR EACH ROW EXECUTE FUNCTION public.block_legacy_writes__purchase_requisitions();

DROP TRIGGER IF EXISTS trg_block_v1_purchase_requisitions_del ON public.purchase_requisitions;
CREATE TRIGGER trg_block_v1_purchase_requisitions_del
BEFORE DELETE ON public.purchase_requisitions
FOR EACH ROW EXECUTE FUNCTION public.block_legacy_writes__purchase_requisitions();

-- ============================================
-- 6. purchase_requisition_items (V1)
-- ============================================
CREATE OR REPLACE FUNCTION public.block_legacy_writes__purchase_requisition_items()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'LEGACY_BLOCKED: Direct writes to purchase_requisition_items are disabled. Use atomic RPC.';
END;
$$;

DROP TRIGGER IF EXISTS trg_block_v1_purchase_requisition_items_ins ON public.purchase_requisition_items;
CREATE TRIGGER trg_block_v1_purchase_requisition_items_ins
BEFORE INSERT ON public.purchase_requisition_items
FOR EACH ROW EXECUTE FUNCTION public.block_legacy_writes__purchase_requisition_items();

DROP TRIGGER IF EXISTS trg_block_v1_purchase_requisition_items_upd ON public.purchase_requisition_items;
CREATE TRIGGER trg_block_v1_purchase_requisition_items_upd
BEFORE UPDATE ON public.purchase_requisition_items
FOR EACH ROW EXECUTE FUNCTION public.block_legacy_writes__purchase_requisition_items();

DROP TRIGGER IF EXISTS trg_block_v1_purchase_requisition_items_del ON public.purchase_requisition_items;
CREATE TRIGGER trg_block_v1_purchase_requisition_items_del
BEFORE DELETE ON public.purchase_requisition_items
FOR EACH ROW EXECUTE FUNCTION public.block_legacy_writes__purchase_requisition_items();

-- ============================================
-- 7. pr_approval_history (V1)
-- ============================================
CREATE OR REPLACE FUNCTION public.block_legacy_writes__pr_approval_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'LEGACY_BLOCKED: Direct writes to pr_approval_history are disabled. Use atomic RPC (pr_approval_record_v2_atomic).';
END;
$$;

DROP TRIGGER IF EXISTS trg_block_v1_pr_approval_history_ins ON public.pr_approval_history;
CREATE TRIGGER trg_block_v1_pr_approval_history_ins
BEFORE INSERT ON public.pr_approval_history
FOR EACH ROW EXECUTE FUNCTION public.block_legacy_writes__pr_approval_history();

DROP TRIGGER IF EXISTS trg_block_v1_pr_approval_history_upd ON public.pr_approval_history;
CREATE TRIGGER trg_block_v1_pr_approval_history_upd
BEFORE UPDATE ON public.pr_approval_history
FOR EACH ROW EXECUTE FUNCTION public.block_legacy_writes__pr_approval_history();

DROP TRIGGER IF EXISTS trg_block_v1_pr_approval_history_del ON public.pr_approval_history;
CREATE TRIGGER trg_block_v1_pr_approval_history_del
BEFORE DELETE ON public.pr_approval_history
FOR EACH ROW EXECUTE FUNCTION public.block_legacy_writes__pr_approval_history();

-- ============================================
-- Documentation
-- ============================================
COMMENT ON FUNCTION public.block_legacy_writes__purchase_orders() IS 'PROMPT-2-KS: Blocks V1 direct writes. Use atomic RPCs instead.';
COMMENT ON FUNCTION public.block_legacy_writes__purchase_order_items() IS 'PROMPT-2-KS: Blocks V1 direct writes. Use atomic RPCs instead.';
COMMENT ON FUNCTION public.block_legacy_writes__purchase_order_receipts() IS 'PROMPT-2-KS: Blocks V1 direct writes. Use atomic RPCs instead.';
COMMENT ON FUNCTION public.block_legacy_writes__po_pr_links() IS 'PROMPT-2-KS: Blocks V1 direct writes. Use atomic RPCs instead.';
COMMENT ON FUNCTION public.block_legacy_writes__purchase_requisitions() IS 'PROMPT-2-KS: Blocks V1 direct writes. Use atomic RPCs instead.';
COMMENT ON FUNCTION public.block_legacy_writes__purchase_requisition_items() IS 'PROMPT-2-KS: Blocks V1 direct writes. Use atomic RPCs instead.';
COMMENT ON FUNCTION public.block_legacy_writes__pr_approval_history() IS 'PROMPT-2-KS: Blocks V1 direct writes. Use atomic RPCs instead.';