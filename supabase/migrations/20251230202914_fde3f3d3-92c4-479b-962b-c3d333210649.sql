-- Add new fields to purchase_invoice_lines table
ALTER TABLE public.purchase_invoice_lines 
ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES public.branches(id),
ADD COLUMN IF NOT EXISTS warehouse_account_id uuid REFERENCES public.chart_of_accounts(id),
ADD COLUMN IF NOT EXISTS expense_account_id uuid REFERENCES public.chart_of_accounts(id),
ADD COLUMN IF NOT EXISTS unit_id uuid,
ADD COLUMN IF NOT EXISTS currency_id text DEFAULT 'SAR',
ADD COLUMN IF NOT EXISTS vat_amount numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_with_vat numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS notes text,
ADD COLUMN IF NOT EXISTS manual_item_code text;

-- Add new fields to jewelry_items table for imported pieces tracking
ALTER TABLE public.jewelry_items
ADD COLUMN IF NOT EXISTS purchase_invoice_id uuid REFERENCES public.invoices(id),
ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES public.branches(id),
ADD COLUMN IF NOT EXISTS inventory_account_id uuid REFERENCES public.chart_of_accounts(id),
ADD COLUMN IF NOT EXISTS vat_amount numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_with_vat numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS is_available_for_sale boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS sale_status text DEFAULT 'available' CHECK (sale_status IN ('available', 'sold', 'reserved', 'returned'));

-- Create sequence for manual purchase items
INSERT INTO public.code_sequences (id, last_number)
VALUES ('PURCHASE_MANUAL_ITEM', 0)
ON CONFLICT (id) DO NOTHING;

-- Function to generate manual item code
CREATE OR REPLACE FUNCTION public.generate_purchase_manual_item_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    next_num BIGINT;
BEGIN
    UPDATE public.code_sequences
    SET last_number = last_number + 1
    WHERE id = 'PURCHASE_MANUAL_ITEM'
    RETURNING last_number INTO next_num;
    
    IF next_num IS NULL THEN
        INSERT INTO public.code_sequences (id, last_number) VALUES ('PURCHASE_MANUAL_ITEM', 1);
        next_num := 1;
    END IF;
    
    RETURN 'PMI-' || LPAD(next_num::TEXT, 6, '0');
END;
$function$;

-- Add new accounting accounts for the purchasing and inventory system
INSERT INTO public.chart_of_accounts (account_code, account_name, account_name_en, account_type, is_active, is_system)
VALUES 
    ('1137', 'مخزون متاح للبيع - قطع مستوردة', 'Inventory - Imported Pieces for Sale', 'asset', true, true),
    ('2202', 'ضريبة القيمة المضافة على المشتريات', 'Purchase VAT', 'liability', true, true),
    ('5102', 'تكلفة البضاعة المباعة - قطع مستوردة', 'COGS - Imported Pieces', 'expense', true, true)
ON CONFLICT (account_code) DO UPDATE SET
    account_name = EXCLUDED.account_name,
    account_name_en = EXCLUDED.account_name_en,
    is_active = true;

-- Add imported_pieces screen to screens table
INSERT INTO public.screens (screen_key, screen_name, screen_name_en, screen_path, parent_key, icon, sort_order)
VALUES ('imported_pieces', 'قطع مستوردة للبيع', 'Imported Pieces for Sale', '/imported-pieces', 'products', 'Gem', 30)
ON CONFLICT (screen_key) DO NOTHING;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_jewelry_items_purchase_invoice ON public.jewelry_items(purchase_invoice_id);
CREATE INDEX IF NOT EXISTS idx_jewelry_items_sale_status ON public.jewelry_items(sale_status);
CREATE INDEX IF NOT EXISTS idx_jewelry_items_available_for_sale ON public.jewelry_items(is_available_for_sale);
CREATE INDEX IF NOT EXISTS idx_purchase_invoice_lines_warehouse ON public.purchase_invoice_lines(warehouse_id);