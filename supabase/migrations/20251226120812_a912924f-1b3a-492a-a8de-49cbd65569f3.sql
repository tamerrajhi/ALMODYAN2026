
-- Create gold_vaults table
CREATE TABLE public.gold_vaults (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    branch_id UUID REFERENCES public.branches(id),
    vault_name TEXT NOT NULL,
    vault_type TEXT NOT NULL DEFAULT 'main' CHECK (vault_type IN ('main', 'production', 'showroom', 'scrap')),
    account_id UUID REFERENCES public.chart_of_accounts(id),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create gold_vault_transactions table
CREATE TABLE public.gold_vault_transactions (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    vault_id UUID NOT NULL REFERENCES public.gold_vaults(id),
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('receive', 'deliver', 'transfer_in', 'transfer_out')),
    gold_type TEXT NOT NULL DEFAULT 'pure' CHECK (gold_type IN ('pure', 'scrap', 'alloy')),
    karat_id UUID REFERENCES public.gold_karats(id),
    weight_grams NUMERIC NOT NULL,
    from_vault_id UUID REFERENCES public.gold_vaults(id),
    to_vault_id UUID REFERENCES public.gold_vaults(id),
    reference_type TEXT CHECK (reference_type IN ('supplier', 'production', 'sale', 'transfer', 'adjustment', 'scrap')),
    reference_id UUID,
    supplier_id UUID REFERENCES public.suppliers(id),
    notes TEXT,
    performed_by TEXT,
    journal_entry_id UUID REFERENCES public.journal_entries(id),
    transaction_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create cash_vaults table
CREATE TABLE public.cash_vaults (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    branch_id UUID REFERENCES public.branches(id),
    vault_name TEXT NOT NULL,
    account_id UUID REFERENCES public.chart_of_accounts(id),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create cash_vault_transactions table
CREATE TABLE public.cash_vault_transactions (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    vault_id UUID NOT NULL REFERENCES public.cash_vaults(id),
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('receipt', 'payment')),
    amount NUMERIC NOT NULL,
    currency TEXT NOT NULL DEFAULT 'SAR',
    payment_method TEXT DEFAULT 'cash' CHECK (payment_method IN ('cash', 'check', 'transfer', 'card')),
    reference_type TEXT CHECK (reference_type IN ('sale', 'purchase', 'expense', 'salary', 'customer', 'supplier', 'other')),
    reference_id UUID,
    customer_id UUID REFERENCES public.customers(id),
    supplier_id UUID REFERENCES public.suppliers(id),
    notes TEXT,
    performed_by TEXT,
    journal_entry_id UUID REFERENCES public.journal_entries(id),
    transaction_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.gold_vaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gold_vault_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_vaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_vault_transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for gold_vaults
CREATE POLICY "Users can view gold vaults in their branches" ON public.gold_vaults
FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role) OR (branch_id = ANY (get_user_branches(auth.uid()))));

CREATE POLICY "Admins can insert gold vaults" ON public.gold_vaults
FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update gold vaults" ON public.gold_vaults
FOR UPDATE USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS Policies for gold_vault_transactions
CREATE POLICY "Users can view gold vault transactions in their branches" ON public.gold_vault_transactions
FOR SELECT USING (
    has_role(auth.uid(), 'admin'::app_role) OR 
    EXISTS (SELECT 1 FROM gold_vaults gv WHERE gv.id = vault_id AND gv.branch_id = ANY (get_user_branches(auth.uid())))
);

CREATE POLICY "Users can insert gold vault transactions in their branches" ON public.gold_vault_transactions
FOR INSERT WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role) OR 
    EXISTS (SELECT 1 FROM gold_vaults gv WHERE gv.id = vault_id AND gv.branch_id = ANY (get_user_branches(auth.uid())))
);

-- RLS Policies for cash_vaults
CREATE POLICY "Users can view cash vaults in their branches" ON public.cash_vaults
FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role) OR (branch_id = ANY (get_user_branches(auth.uid()))));

CREATE POLICY "Admins can insert cash vaults" ON public.cash_vaults
FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update cash vaults" ON public.cash_vaults
FOR UPDATE USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS Policies for cash_vault_transactions
CREATE POLICY "Users can view cash vault transactions in their branches" ON public.cash_vault_transactions
FOR SELECT USING (
    has_role(auth.uid(), 'admin'::app_role) OR 
    EXISTS (SELECT 1 FROM cash_vaults cv WHERE cv.id = vault_id AND cv.branch_id = ANY (get_user_branches(auth.uid())))
);

CREATE POLICY "Users can insert cash vault transactions in their branches" ON public.cash_vault_transactions
FOR INSERT WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role) OR 
    EXISTS (SELECT 1 FROM cash_vaults cv WHERE cv.id = vault_id AND cv.branch_id = ANY (get_user_branches(auth.uid())))
);

-- Add triggers for updated_at
CREATE TRIGGER update_gold_vaults_updated_at
BEFORE UPDATE ON public.gold_vaults
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_cash_vaults_updated_at
BEFORE UPDATE ON public.cash_vaults
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
