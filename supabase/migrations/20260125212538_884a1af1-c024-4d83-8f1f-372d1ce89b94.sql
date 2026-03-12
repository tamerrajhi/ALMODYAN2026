-- POS-P2A-FIX: Canonical Writer Gate for sales table
-- Blocks finalized sales without journal_entry_id unless written by atomic RPC

-- B1) Create gating function for sales canonical writers
CREATE OR REPLACE FUNCTION public._sales_context_allows_canonical()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_ctx text;
BEGIN
  GET DIAGNOSTICS v_ctx = PG_CONTEXT;
  
  -- Allow POS sale atomic RPC
  IF v_ctx ILIKE '%complete_pos_sale_atomic%' THEN
    RETURN true;
  END IF;
  
  -- Allow ERP sales invoice atomic RPC (if used)
  IF v_ctx ILIKE '%complete_sales_invoice_atomic%' THEN
    RETURN true;
  END IF;
  
  -- Allow void/reversal RPCs
  IF v_ctx ILIKE '%void_sale_atomic%' OR 
     v_ctx ILIKE '%void_sales_invoice_atomic%' THEN
    RETURN true;
  END IF;
  
  -- Allow return processing RPCs (they update sale totals)
  IF v_ctx ILIKE '%complete_pos_piece_return_atomic%' OR
     v_ctx ILIKE '%complete_erp_sales_return_atomic%' THEN
    RETURN true;
  END IF;
  
  -- Allow data migration/backfill (admin operations)
  IF v_ctx ILIKE '%backfill_%' OR
     v_ctx ILIKE '%migrate_%' THEN
    RETURN true;
  END IF;
  
  RETURN false;
END;
$function$;

-- B2) Create trigger function for canonical writer enforcement
CREATE OR REPLACE FUNCTION public.sales_enforce_canonical_writer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_finalized boolean;
BEGIN
  -- Determine if sale is being finalized
  -- A sale is "finalized" when it has sale_code, payment_method, and final_amount
  v_is_finalized := (
    NEW.sale_code IS NOT NULL AND 
    NEW.payment_method IS NOT NULL AND 
    NEW.final_amount IS NOT NULL AND
    NEW.final_amount > 0
  );
  
  -- For INSERT: block finalized sales without JE unless from canonical writer
  IF TG_OP = 'INSERT' THEN
    IF v_is_finalized AND NEW.journal_entry_id IS NULL THEN
      IF NOT public._sales_context_allows_canonical() THEN
        RAISE EXCEPTION 'DIRECT_WRITE_BLOCKED_SALES: sale must be created via atomic RPC (JE required). sale_code=%, final_amount=%',
          NEW.sale_code, NEW.final_amount;
      END IF;
    END IF;
  END IF;
  
  -- For UPDATE: block updates that finalize without JE
  IF TG_OP = 'UPDATE' THEN
    -- If transitioning from draft to finalized without JE
    IF v_is_finalized AND NEW.journal_entry_id IS NULL THEN
      -- Check if previously was draft (no sale_code or no final_amount)
      IF OLD.sale_code IS NULL OR OLD.final_amount IS NULL OR OLD.final_amount = 0 THEN
        IF NOT public._sales_context_allows_canonical() THEN
          RAISE EXCEPTION 'DIRECT_WRITE_BLOCKED_SALES: sale finalization requires atomic RPC (JE required). sale_code=%',
            NEW.sale_code;
        END IF;
      END IF;
    END IF;
    
    -- Block clearing journal_entry_id on finalized sales
    IF v_is_finalized AND OLD.journal_entry_id IS NOT NULL AND NEW.journal_entry_id IS NULL THEN
      IF NOT public._sales_context_allows_canonical() THEN
        RAISE EXCEPTION 'DIRECT_WRITE_BLOCKED_SALES: cannot remove journal_entry_id from finalized sale. sale_id=%',
          NEW.id;
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$function$;

-- B3) Create trigger on sales table
DROP TRIGGER IF EXISTS trg_sales_enforce_canonical_writer ON public.sales;

CREATE TRIGGER trg_sales_enforce_canonical_writer
  BEFORE INSERT OR UPDATE ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public.sales_enforce_canonical_writer();

-- D) Create reconciliation view for legacy sales without JE
CREATE OR REPLACE VIEW public.sales_missing_je_report AS
SELECT 
  s.id AS sale_id,
  s.sale_code,
  s.branch_id,
  b.branch_name,
  s.customer_id,
  c.full_name AS customer_name,
  s.final_amount,
  s.payment_method,
  s.sold_by,
  s.created_at,
  s.sale_date,
  (SELECT COUNT(*) FROM public.sale_items si WHERE si.sale_id = s.id) AS items_count,
  (SELECT STRING_AGG(ji.item_code, ', ') 
   FROM public.sale_items si 
   JOIN public.jewelry_items ji ON ji.id = si.item_id 
   WHERE si.sale_id = s.id
   LIMIT 5) AS sample_items
FROM public.sales s
LEFT JOIN public.branches b ON b.id = s.branch_id
LEFT JOIN public.customers c ON c.id = s.customer_id
WHERE s.journal_entry_id IS NULL
  AND s.sale_code IS NOT NULL
  AND s.final_amount IS NOT NULL
  AND s.final_amount > 0
  AND s.created_at > now() - interval '90 days'
ORDER BY s.created_at DESC;

COMMENT ON VIEW public.sales_missing_je_report IS 
  'P2A: Reconciliation report for finalized sales without linked Journal Entry (last 90 days). Do NOT auto-backfill - accounting must review.';

-- Grant access to view
GRANT SELECT ON public.sales_missing_je_report TO authenticated;