INSERT INTO public.workflow_types (code, description, is_enabled) 
VALUES ('payment_voucher', 'Payment voucher atomic workflow', true)
ON CONFLICT (code) DO NOTHING;