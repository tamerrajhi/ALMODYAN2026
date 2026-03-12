-- 1. Drop existing constraint
ALTER TABLE public.item_movements 
DROP CONSTRAINT IF EXISTS check_movement_type_values;

-- 2. Add updated constraint with uppercase values
ALTER TABLE public.item_movements
ADD CONSTRAINT check_movement_type_values 
CHECK ((movement_type = ANY (ARRAY[
  'import'::text, 
  'purchase_return'::text, 
  'purchase_return_void'::text, 
  'transfer'::text, 
  'sale'::text, 
  'SALE'::text,
  'sale_return'::text, 
  'SALE_RETURN'::text,
  'adjustment'::text, 
  'void'::text, 
  'receive'::text, 
  'issue'::text
])));

-- 3. Drop the duplicate pos_begin_request function (text signature)
DROP FUNCTION IF EXISTS public.pos_begin_request(text, text, text);