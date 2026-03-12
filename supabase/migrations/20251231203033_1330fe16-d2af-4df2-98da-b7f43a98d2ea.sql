-- Create payment account settings table
CREATE TABLE public.payment_account_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  branch_id UUID REFERENCES public.branches(id) ON DELETE CASCADE,
  cash_account_id UUID REFERENCES public.chart_of_accounts(id),
  bank_transfer_account_id UUID REFERENCES public.chart_of_accounts(id),
  check_account_id UUID REFERENCES public.chart_of_accounts(id),
  card_account_id UUID REFERENCES public.chart_of_accounts(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID,
  
  -- Ensure only one setting per branch (null for general settings)
  CONSTRAINT unique_branch_settings UNIQUE (branch_id)
);

-- Enable RLS
ALTER TABLE public.payment_account_settings ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Authenticated users can view payment account settings"
ON public.payment_account_settings
FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can manage payment account settings"
ON public.payment_account_settings
FOR ALL
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Trigger for updated_at
CREATE TRIGGER update_payment_account_settings_updated_at
BEFORE UPDATE ON public.payment_account_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add comment
COMMENT ON TABLE public.payment_account_settings IS 'Stores payment method to account mappings for receipt and payment vouchers';