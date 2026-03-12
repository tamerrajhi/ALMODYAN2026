-- =========================================
-- P-ACC-CONFIG-01-CREATE
-- Dynamic Branch Accounting Configuration
-- =========================================

-- B1.1) جدول مفاتيح الإعدادات المحاسبية
CREATE TABLE IF NOT EXISTS public.accounting_config_keys (
  key TEXT PRIMARY KEY,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Seed المفاتيح الأساسية
INSERT INTO public.accounting_config_keys (key, description) VALUES
  ('inventory', 'حساب المخزون للمشتريات والمرتجعات'),
  ('vat_input', 'حساب ضريبة المدخلات القابلة للاسترداد'),
  ('ap_supplier', 'حساب الذمم الدائنة / الموردين'),
  ('cogs', 'حساب تكلفة البضاعة المباعة'),
  ('sales_revenue', 'حساب إيرادات المبيعات'),
  ('vat_output', 'حساب ضريبة المخرجات')
ON CONFLICT (key) DO NOTHING;

-- B1.2) جدول إعدادات الفروع المحاسبية
CREATE TABLE IF NOT EXISTS public.branch_accounting_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  config_key TEXT NOT NULL REFERENCES public.accounting_config_keys(key),
  account_id UUID NOT NULL REFERENCES public.chart_of_accounts(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- NULL branch_id = Global Default
  CONSTRAINT uq_branch_accounting_config UNIQUE (branch_id, config_key)
);

-- Enable RLS
ALTER TABLE public.branch_accounting_config ENABLE ROW LEVEL SECURITY;

-- RLS Policies (admin only for now)
CREATE POLICY "Admin can manage branch accounting config"
  ON public.branch_accounting_config
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated users can view branch accounting config"
  ON public.branch_accounting_config
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_branch_accounting_config_lookup 
  ON public.branch_accounting_config(branch_id, config_key) 
  WHERE is_active = true;

-- =========================================
-- B2) Resolver Functions (No Hardcode!)
-- =========================================

-- B2.1) get_branch_account_id: returns account_id or NULL
CREATE OR REPLACE FUNCTION public.get_branch_account_id(
  p_branch_id UUID,
  p_config_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  -- 1) Try branch-specific config first
  IF p_branch_id IS NOT NULL THEN
    SELECT account_id INTO v_account_id
    FROM branch_accounting_config
    WHERE branch_id = p_branch_id
      AND config_key = p_config_key
      AND is_active = true
    LIMIT 1;
    
    IF v_account_id IS NOT NULL THEN
      RETURN v_account_id;
    END IF;
  END IF;
  
  -- 2) Fallback to global default (branch_id IS NULL)
  SELECT account_id INTO v_account_id
  FROM branch_accounting_config
  WHERE branch_id IS NULL
    AND config_key = p_config_key
    AND is_active = true
  LIMIT 1;
  
  RETURN v_account_id;
END;
$$;

-- B2.2) require_branch_account_id: throws error if not found
CREATE OR REPLACE FUNCTION public.require_branch_account_id(
  p_branch_id UUID,
  p_config_key TEXT,
  p_context TEXT DEFAULT 'operation'
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  v_account_id := get_branch_account_id(p_branch_id, p_config_key);
  
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'CONFIG_ERROR: Missing accounting config [%] for branch [%] in context [%]',
      p_config_key, COALESCE(p_branch_id::text, 'GLOBAL'), p_context;
  END IF;
  
  RETURN v_account_id;
END;
$$;

-- =========================================
-- B3) Health Check View
-- =========================================
CREATE OR REPLACE VIEW public.v_branch_accounting_health AS
SELECT 
  b.id AS branch_id,
  b.branch_code,
  b.branch_name,
  b.is_active AS branch_active,
  get_branch_account_id(b.id, 'inventory') AS inventory_account_id,
  get_branch_account_id(b.id, 'vat_input') AS vat_input_account_id,
  get_branch_account_id(b.id, 'ap_supplier') AS ap_supplier_account_id,
  get_branch_account_id(b.id, 'cogs') AS cogs_account_id,
  get_branch_account_id(b.id, 'sales_revenue') AS sales_revenue_account_id,
  get_branch_account_id(b.id, 'vat_output') AS vat_output_account_id
FROM public.branches b
WHERE b.is_active = true

UNION ALL

-- Global defaults row
SELECT
  NULL::UUID AS branch_id,
  'GLOBAL' AS branch_code,
  'Global Defaults' AS branch_name,
  true AS branch_active,
  get_branch_account_id(NULL, 'inventory') AS inventory_account_id,
  get_branch_account_id(NULL, 'vat_input') AS vat_input_account_id,
  get_branch_account_id(NULL, 'ap_supplier') AS ap_supplier_account_id,
  get_branch_account_id(NULL, 'cogs') AS cogs_account_id,
  get_branch_account_id(NULL, 'sales_revenue') AS sales_revenue_account_id,
  get_branch_account_id(NULL, 'vat_output') AS vat_output_account_id;

-- Grant permissions
GRANT SELECT ON public.v_branch_accounting_health TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_branch_account_id(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.require_branch_account_id(UUID, TEXT, TEXT) TO authenticated;