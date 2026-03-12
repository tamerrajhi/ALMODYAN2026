-- =============================================
-- Phase 1: RPC for server-side aggregation
-- =============================================

-- Create the inventory summary RPC function
CREATE OR REPLACE FUNCTION get_inventory_summary_by_branch()
RETURNS TABLE (
  branch_id UUID,
  branch_name TEXT,
  branch_code TEXT,
  total_items BIGINT,
  total_g_weight NUMERIC,
  total_d_weight NUMERIC,
  total_cost NUMERIC,
  total_tag_price NUMERIC
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    b.id as branch_id,
    b.branch_name::TEXT as branch_name,
    b.branch_code::TEXT as branch_code,
    COALESCE(COUNT(ji.id), 0)::BIGINT as total_items,
    COALESCE(SUM(ji.g_weight), 0)::NUMERIC as total_g_weight,
    COALESCE(SUM(ji.d_weight), 0)::NUMERIC as total_d_weight,
    COALESCE(SUM(ji.cost), 0)::NUMERIC as total_cost,
    COALESCE(SUM(ji.tag_price), 0)::NUMERIC as total_tag_price
  FROM branches b
  LEFT JOIN jewelry_items ji ON ji.branch_id = b.id AND ji.sold_at IS NULL
  WHERE b.is_active = true
  GROUP BY b.id, b.branch_name, b.branch_code
  ORDER BY b.branch_name;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_inventory_summary_by_branch() TO anon, authenticated;

-- =============================================
-- Indexes for performance
-- =============================================

-- Partial index for unsold items by branch (covers the most common query pattern)
CREATE INDEX IF NOT EXISTS idx_jewelry_items_branch_unsold 
ON jewelry_items(branch_id, item_code) 
WHERE sold_at IS NULL;

-- Index for item_code lookups (if not exists)
CREATE INDEX IF NOT EXISTS idx_jewelry_items_item_code 
ON jewelry_items(item_code);

-- Index for model lookups (used in search)
CREATE INDEX IF NOT EXISTS idx_jewelry_items_model 
ON jewelry_items(model) 
WHERE model IS NOT NULL;

-- Index for stockcode lookups (used in search)
CREATE INDEX IF NOT EXISTS idx_jewelry_items_stockcode 
ON jewelry_items(stockcode) 
WHERE stockcode IS NOT NULL;