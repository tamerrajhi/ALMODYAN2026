-- Add 'goods_receipt' as valid reference_type for gold_vault_transactions
ALTER TABLE gold_vault_transactions 
DROP CONSTRAINT gold_vault_transactions_reference_type_check;

ALTER TABLE gold_vault_transactions 
ADD CONSTRAINT gold_vault_transactions_reference_type_check 
CHECK (reference_type = ANY (ARRAY['supplier'::text, 'production'::text, 'sale'::text, 'transfer'::text, 'adjustment'::text, 'scrap'::text, 'goods_receipt'::text]));