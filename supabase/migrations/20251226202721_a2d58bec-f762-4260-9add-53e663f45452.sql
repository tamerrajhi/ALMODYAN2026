-- Create daily settlements table
CREATE TABLE public.daily_settlements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  settlement_number TEXT NOT NULL UNIQUE,
  settlement_date DATE NOT NULL DEFAULT CURRENT_DATE,
  branch_id UUID NOT NULL REFERENCES public.branches(id),
  cashier_id UUID NOT NULL,
  cashier_name TEXT,
  
  -- Cash reconciliation
  cash_vault_id UUID REFERENCES public.cash_vaults(id),
  system_cash_balance NUMERIC DEFAULT 0,
  actual_cash_balance NUMERIC DEFAULT 0,
  cash_difference NUMERIC DEFAULT 0,
  
  -- Gold reconciliation (optional)
  gold_vault_id UUID REFERENCES public.gold_vaults(id),
  system_gold_weight NUMERIC DEFAULT 0,
  actual_gold_weight NUMERIC DEFAULT 0,
  gold_difference NUMERIC DEFAULT 0,
  
  -- Sales summary
  total_sales_count INTEGER DEFAULT 0,
  total_sales_amount NUMERIC DEFAULT 0,
  total_returns_count INTEGER DEFAULT 0,
  total_returns_amount NUMERIC DEFAULT 0,
  
  -- Payment methods breakdown
  cash_received NUMERIC DEFAULT 0,
  card_received NUMERIC DEFAULT 0,
  bank_transfer_received NUMERIC DEFAULT 0,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  
  -- Approval workflow
  submitted_at TIMESTAMP WITH TIME ZONE,
  approved_by UUID,
  approved_at TIMESTAMP WITH TIME ZONE,
  rejection_reason TEXT,
  
  -- Journal entry for differences
  journal_entry_id UUID REFERENCES public.journal_entries(id),
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.daily_settlements ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view settlements in their branches"
  ON public.daily_settlements FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role) OR branch_id = ANY(get_user_branches(auth.uid())));

CREATE POLICY "Users can create settlements in their branches"
  ON public.daily_settlements FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR branch_id = ANY(get_user_branches(auth.uid())));

CREATE POLICY "Users can update pending settlements"
  ON public.daily_settlements FOR UPDATE
  USING (has_role(auth.uid(), 'admin'::app_role) OR (branch_id = ANY(get_user_branches(auth.uid())) AND status = 'pending'));