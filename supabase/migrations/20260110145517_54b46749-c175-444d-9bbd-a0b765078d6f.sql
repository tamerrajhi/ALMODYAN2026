-- =====================================================
-- POS Returns Workflow Enhancement Migration
-- Adds status-based workflow, approval tracking, and performance indexes
-- =====================================================

-- 1) Add status and workflow columns to returns table
ALTER TABLE public.returns
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'accounting_approved', 'posted', 'cancelled', 'reversed')),
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submitted_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS posted_by TEXT,
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversed_by TEXT,
  ADD COLUMN IF NOT EXISTS original_return_id UUID REFERENCES public.returns(id),
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS journal_entry_id UUID REFERENCES public.journal_entries(id),
  ADD COLUMN IF NOT EXISTS original_sale_branch_id UUID REFERENCES public.branches(id);

-- 2) Update existing returns to 'posted' status (they were already processed)
UPDATE public.returns 
SET status = 'posted', 
    posted_at = created_at 
WHERE status IS NULL OR status = 'draft';

-- 3) Add item_movements.cost column if not exists (for tracking return costs)
ALTER TABLE public.item_movements
  ADD COLUMN IF NOT EXISTS cost NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS journal_entry_id UUID REFERENCES public.journal_entries(id);

-- 4) Performance Indexes for returns queries
CREATE INDEX IF NOT EXISTS idx_returns_status ON public.returns(status);
CREATE INDEX IF NOT EXISTS idx_returns_sale_id ON public.returns(sale_id);
CREATE INDEX IF NOT EXISTS idx_returns_original_return_id ON public.returns(original_return_id);
CREATE INDEX IF NOT EXISTS idx_returns_branch_status ON public.returns(branch_id, status);

-- 5) Performance Indexes for return_items queries
CREATE INDEX IF NOT EXISTS idx_return_items_return_id ON public.return_items(return_id);
CREATE INDEX IF NOT EXISTS idx_return_items_item_id ON public.return_items(item_id);

-- 6) Performance Indexes for item_movements
CREATE INDEX IF NOT EXISTS idx_item_movements_return_id ON public.item_movements(return_id);
CREATE INDEX IF NOT EXISTS idx_item_movements_journal_entry_id ON public.item_movements(journal_entry_id);

-- 7) Performance Indexes for jewelry_items (commonly used in returns)
CREATE INDEX IF NOT EXISTS idx_jewelry_items_sale_id ON public.jewelry_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_jewelry_items_branch_status ON public.jewelry_items(branch_id, sale_status);

-- 8) Performance Indexes for journal_entries (for returns lookup)
CREATE INDEX IF NOT EXISTS idx_journal_entries_ref ON public.journal_entries(reference_type, reference_id);

-- 9) Add Customer Credits Liability account if not exists (2310)
INSERT INTO public.chart_of_accounts (
  account_code, 
  account_name, 
  account_name_en, 
  account_type, 
  is_active, 
  is_system, 
  description
)
SELECT 
  '2310', 
  'أرصدة العملاء الدائنة', 
  'Customer Credits Liability', 
  'liability', 
  true, 
  true, 
  'حساب التزامات أرصدة العملاء من المرتجعات'
WHERE NOT EXISTS (
  SELECT 1 FROM public.chart_of_accounts WHERE account_code = '2310'
);