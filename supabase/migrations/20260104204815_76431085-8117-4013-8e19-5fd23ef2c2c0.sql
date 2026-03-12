-- Backfill accounts for existing customers without account_id
DO $$
DECLARE
  customer_rec RECORD;
  parent_account_id UUID;
  new_account_code TEXT;
  new_account_id UUID;
  max_code TEXT;
  code_counter INT := 0;
BEGIN
  -- Find the parent account (1102 - Accounts Receivable)
  SELECT id INTO parent_account_id 
  FROM chart_of_accounts 
  WHERE account_code = '1102';
  
  IF parent_account_id IS NULL THEN
    RAISE NOTICE 'Parent account 1102 not found, skipping customer backfill';
    RETURN;
  END IF;
  
  -- Get current max code
  SELECT MAX(account_code) INTO max_code 
  FROM chart_of_accounts 
  WHERE account_code LIKE '1102%' AND LENGTH(account_code) = 8;
  
  IF max_code IS NULL THEN
    code_counter := 0;
  ELSE
    code_counter := CAST(max_code AS BIGINT) - 11020000;
  END IF;
  
  -- Loop through customers without accounts
  FOR customer_rec IN 
    SELECT id, customer_code, full_name 
    FROM customers 
    WHERE account_id IS NULL
    ORDER BY created_at
  LOOP
    code_counter := code_counter + 1;
    new_account_code := LPAD((11020000 + code_counter)::TEXT, 8, '0');
    
    -- Create the sub-account
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
      customer_rec.full_name,
      customer_rec.full_name,
      'asset',
      parent_account_id,
      true,
      true,
      'حساب العميل: ' || customer_rec.customer_code
    )
    RETURNING id INTO new_account_id;
    
    -- Update the customer
    UPDATE customers SET account_id = new_account_id WHERE id = customer_rec.id;
    
    RAISE NOTICE 'Created account % for customer %', new_account_code, customer_rec.full_name;
  END LOOP;
END $$;

-- Backfill accounts for existing suppliers without account_id
DO $$
DECLARE
  supplier_rec RECORD;
  parent_account_id UUID;
  new_account_code TEXT;
  new_account_id UUID;
  max_code TEXT;
  code_counter INT := 0;
BEGIN
  -- Find the parent account (2101 - Accounts Payable)
  SELECT id INTO parent_account_id 
  FROM chart_of_accounts 
  WHERE account_code = '2101';
  
  IF parent_account_id IS NULL THEN
    RAISE NOTICE 'Parent account 2101 not found, skipping supplier backfill';
    RETURN;
  END IF;
  
  -- Get current max code
  SELECT MAX(account_code) INTO max_code 
  FROM chart_of_accounts 
  WHERE account_code LIKE '2101%' AND LENGTH(account_code) = 8;
  
  IF max_code IS NULL THEN
    code_counter := 0;
  ELSE
    code_counter := CAST(max_code AS BIGINT) - 21010000;
  END IF;
  
  -- Loop through suppliers without accounts
  FOR supplier_rec IN 
    SELECT id, supplier_code, supplier_name 
    FROM suppliers 
    WHERE account_id IS NULL
    ORDER BY created_at
  LOOP
    code_counter := code_counter + 1;
    new_account_code := LPAD((21010000 + code_counter)::TEXT, 8, '0');
    
    -- Create the sub-account
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
      supplier_rec.supplier_name,
      supplier_rec.supplier_name,
      'liability',
      parent_account_id,
      true,
      true,
      'حساب المورد: ' || COALESCE(supplier_rec.supplier_code, supplier_rec.id::TEXT)
    )
    RETURNING id INTO new_account_id;
    
    -- Update the supplier
    UPDATE suppliers SET account_id = new_account_id WHERE id = supplier_rec.id;
    
    RAISE NOTICE 'Created account % for supplier %', new_account_code, supplier_rec.supplier_name;
  END LOOP;
END $$;