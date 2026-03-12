-- Add account_id to customers table
ALTER TABLE public.customers 
ADD COLUMN account_id UUID REFERENCES public.chart_of_accounts(id);

-- Create index for performance
CREATE INDEX idx_customers_account_id ON public.customers(account_id);

-- Function to auto-create customer account under Accounts Receivable (1102)
CREATE OR REPLACE FUNCTION public.auto_create_customer_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent_account_id UUID;
  new_account_code TEXT;
  new_account_id UUID;
  max_code TEXT;
BEGIN
  -- Find the parent account (1102 - Accounts Receivable / الذمم المدينة)
  SELECT id INTO parent_account_id 
  FROM chart_of_accounts 
  WHERE account_code = '1102';
  
  IF parent_account_id IS NULL THEN
    RAISE EXCEPTION 'Parent account 1102 (Accounts Receivable) not found';
  END IF;
  
  -- Generate next account code (1102XXXX format)
  SELECT MAX(account_code) INTO max_code 
  FROM chart_of_accounts 
  WHERE account_code LIKE '1102%' AND LENGTH(account_code) = 8;
  
  IF max_code IS NULL THEN
    new_account_code := '11020001';
  ELSE
    new_account_code := LPAD((CAST(max_code AS BIGINT) + 1)::TEXT, 8, '0');
  END IF;
  
  -- Create the sub-account for this customer
  INSERT INTO chart_of_accounts (
    account_code,
    account_name,
    account_name_en,
    account_type,
    parent_id,
    is_active,
    is_system,
    description
  ) VALUES (
    new_account_code,
    NEW.full_name,
    NEW.full_name,
    'asset',
    parent_account_id,
    true,
    true,
    'حساب العميل: ' || NEW.customer_code
  )
  RETURNING id INTO new_account_id;
  
  -- Link the account to the customer
  NEW.account_id := new_account_id;
  
  RETURN NEW;
END;
$$;

-- Function to auto-create supplier account under Accounts Payable (2101)
CREATE OR REPLACE FUNCTION public.auto_create_supplier_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent_account_id UUID;
  new_account_code TEXT;
  new_account_id UUID;
  max_code TEXT;
BEGIN
  -- Skip if account_id is already set
  IF NEW.account_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  
  -- Find the parent account (2101 - Accounts Payable / الذمم الدائنة)
  SELECT id INTO parent_account_id 
  FROM chart_of_accounts 
  WHERE account_code = '2101';
  
  IF parent_account_id IS NULL THEN
    RAISE EXCEPTION 'Parent account 2101 (Accounts Payable) not found';
  END IF;
  
  -- Generate next account code (2101XXXX format)
  SELECT MAX(account_code) INTO max_code 
  FROM chart_of_accounts 
  WHERE account_code LIKE '2101%' AND LENGTH(account_code) = 8;
  
  IF max_code IS NULL THEN
    new_account_code := '21010001';
  ELSE
    new_account_code := LPAD((CAST(max_code AS BIGINT) + 1)::TEXT, 8, '0');
  END IF;
  
  -- Create the sub-account for this supplier
  INSERT INTO chart_of_accounts (
    account_code,
    account_name,
    account_name_en,
    account_type,
    parent_id,
    is_active,
    is_system,
    description
  ) VALUES (
    new_account_code,
    NEW.supplier_name,
    NEW.supplier_name,
    'liability',
    parent_account_id,
    true,
    true,
    'حساب المورد: ' || COALESCE(NEW.supplier_code, NEW.id::TEXT)
  )
  RETURNING id INTO new_account_id;
  
  -- Link the account to the supplier
  NEW.account_id := new_account_id;
  
  RETURN NEW;
END;
$$;

-- Create triggers
CREATE TRIGGER auto_create_customer_account_trigger
  BEFORE INSERT ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_create_customer_account();

CREATE TRIGGER auto_create_supplier_account_trigger
  BEFORE INSERT ON public.suppliers
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_create_supplier_account();

-- Update customer account name when customer name changes
CREATE OR REPLACE FUNCTION public.sync_customer_account_name()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.account_id IS NOT NULL AND OLD.full_name IS DISTINCT FROM NEW.full_name THEN
    UPDATE chart_of_accounts 
    SET account_name = NEW.full_name,
        account_name_en = NEW.full_name
    WHERE id = NEW.account_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_customer_account_name_trigger
  AFTER UPDATE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_customer_account_name();

-- Update supplier account name when supplier name changes
CREATE OR REPLACE FUNCTION public.sync_supplier_account_name()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.account_id IS NOT NULL AND OLD.supplier_name IS DISTINCT FROM NEW.supplier_name THEN
    UPDATE chart_of_accounts 
    SET account_name = NEW.supplier_name,
        account_name_en = NEW.supplier_name
    WHERE id = NEW.account_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_supplier_account_name_trigger
  AFTER UPDATE ON public.suppliers
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_supplier_account_name();