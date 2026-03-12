-- =============================================
-- Phase 1: Database Enhancements for POS Return System
-- =============================================

-- 1. Add payment_method and pos_terminal_id to sales table
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'cash';
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS pos_terminal_id TEXT;

-- 2. Create return_settings table for configurable return policies
CREATE TABLE IF NOT EXISTS public.return_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID REFERENCES public.branches(id),
  max_return_days INTEGER DEFAULT 30,
  max_return_amount_without_approval NUMERIC DEFAULT 5000,
  require_manager_approval BOOLEAN DEFAULT false,
  allow_store_credit BOOLEAN DEFAULT true,
  allow_cash_refund BOOLEAN DEFAULT true,
  allow_card_refund BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT,
  UNIQUE(branch_id)
);

-- 3. Create customer_credits table for Store Credit functionality
CREATE TABLE IF NOT EXISTS public.customer_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id),
  branch_id UUID REFERENCES public.branches(id),
  credit_amount NUMERIC NOT NULL DEFAULT 0,
  return_id UUID REFERENCES public.returns(id),
  used_in_sale_id UUID REFERENCES public.sales(id),
  credit_type TEXT NOT NULL CHECK (credit_type IN ('credit', 'debit')),
  balance_after NUMERIC DEFAULT 0,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Add new columns to returns table
ALTER TABLE public.returns ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN DEFAULT false;
ALTER TABLE public.returns ADD COLUMN IF NOT EXISTS approved_by TEXT;
ALTER TABLE public.returns ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE public.returns ADD COLUMN IF NOT EXISTS original_payment_method TEXT;
ALTER TABLE public.returns ADD COLUMN IF NOT EXISTS pos_terminal_id TEXT;
ALTER TABLE public.returns ADD COLUMN IF NOT EXISTS customer_credit_id UUID;

-- 5. Enable RLS on new tables
ALTER TABLE public.return_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_credits ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies for return_settings
CREATE POLICY "Admins can manage return settings"
ON public.return_settings FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can view return settings in their branches"
ON public.return_settings FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR branch_id = ANY(get_user_branches(auth.uid()))
  OR branch_id IS NULL
);

-- 7. RLS Policies for customer_credits
CREATE POLICY "Users can view customer credits in their branches"
ON public.customer_credits FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR branch_id = ANY(get_user_branches(auth.uid()))
);

CREATE POLICY "Users can insert customer credits in their branches"
ON public.customer_credits FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) 
  OR branch_id = ANY(get_user_branches(auth.uid()))
);

-- 8. Create function to get customer credit balance
CREATE OR REPLACE FUNCTION public.get_customer_credit_balance(p_customer_id UUID)
RETURNS NUMERIC AS $$
DECLARE
  v_balance NUMERIC;
BEGIN
  SELECT COALESCE(SUM(
    CASE WHEN credit_type = 'credit' THEN credit_amount
         WHEN credit_type = 'debit' THEN -credit_amount
         ELSE 0 END
  ), 0)
  INTO v_balance
  FROM public.customer_credits
  WHERE customer_id = p_customer_id;
  
  RETURN v_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 9. Insert default return settings (global)
INSERT INTO public.return_settings (
  branch_id, 
  max_return_days, 
  max_return_amount_without_approval,
  require_manager_approval,
  allow_store_credit,
  allow_cash_refund,
  allow_card_refund
) VALUES (
  NULL,
  30,
  5000,
  false,
  true,
  true,
  true
) ON CONFLICT DO NOTHING;

-- 10. Create index for better performance
CREATE INDEX IF NOT EXISTS idx_customer_credits_customer_id ON public.customer_credits(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_credits_return_id ON public.customer_credits(return_id);
CREATE INDEX IF NOT EXISTS idx_returns_requires_approval ON public.returns(requires_approval) WHERE requires_approval = true;