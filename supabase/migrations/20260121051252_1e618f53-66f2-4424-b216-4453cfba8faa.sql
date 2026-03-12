
-- ================================================================================
-- FIX: Purchase Return Unique Items Atomic - Schema Mismatch Resolution
-- 
-- Root Cause: RPC was using non-existent columns:
--   - v_item_record.total_price (correct: v_item_record.cost)
--   - v_item_record.gold_weight (correct: v_item_record.g_weight) 
--   - INSERT INTO purchase_invoice_lines.total_price (correct: subtotal, total_amount)
--   - INSERT INTO purchase_invoice_lines.gold_weight (column doesn't exist in lines table)
--
-- Changes:
-- 1. Use v_item_record.cost instead of v_item_record.total_price
-- 2. Remove gold_weight from INSERT (column doesn't exist in purchase_invoice_lines)
-- 3. Use subtotal + total_amount columns correctly
-- 4. Add Fail-Fast Guard: RAISE EXCEPTION if v_subtotal <= 0
-- ================================================================================

-- Drop the overloaded version with different signature to avoid conflicts
DROP FUNCTION IF EXISTS public.complete_purchase_return_unique_items_atomic(uuid, jsonb, uuid, text);

CREATE OR REPLACE FUNCTION public.complete_purchase_return_unique_items_atomic(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_return_id UUID;
    v_return_number TEXT;
    v_supplier_id UUID;
    v_branch_id UUID;
    v_linked_invoice_id UUID;
    v_return_date DATE;
    v_total_amount NUMERIC := 0;
    v_tax_amount NUMERIC := 0;
    v_subtotal NUMERIC := 0;
    v_notes TEXT;
    v_reason TEXT;
    v_items JSONB;
    v_item JSONB;
    v_item_id UUID;
    v_item_code TEXT;
    v_unit_price NUMERIC;
    v_line_number INT := 0;
    v_je_id UUID;
    v_je_number TEXT;
    v_inventory_account_id UUID;
    v_supplier_account_id UUID;
    v_user_id UUID;
    v_user_name TEXT;
    v_item_record RECORD;
BEGIN
    -- ================================
    -- Extract header fields from nested 'return' object
    -- Primary: p_payload->'return'->>'field'
    -- Fallback: p_payload->>'field' (backward compatibility)
    -- ================================
    
    v_supplier_id := COALESCE(
        (p_payload->'return'->>'supplier_id')::UUID,
        (p_payload->>'supplier_id')::UUID
    );
    
    v_branch_id := COALESCE(
        (p_payload->'return'->>'branch_id')::UUID,
        (p_payload->>'branch_id')::UUID
    );
    
    v_linked_invoice_id := COALESCE(
        (p_payload->'return'->>'purchase_invoice_id')::UUID,
        (p_payload->'return'->>'linked_invoice_id')::UUID,
        (p_payload->>'linked_invoice_id')::UUID
    );
    
    v_return_date := COALESCE(
        (p_payload->'return'->>'return_date')::DATE,
        (p_payload->>'return_date')::DATE,
        CURRENT_DATE
    );
    
    v_return_number := COALESCE(
        p_payload->'return'->>'return_number',
        p_payload->>'return_number'
    );
    
    v_notes := COALESCE(
        p_payload->'return'->>'notes',
        p_payload->>'notes'
    );
    
    v_reason := COALESCE(
        p_payload->'return'->>'reason',
        p_payload->>'reason'
    );
    
    v_items := p_payload->'items';
    
    -- ================================
    -- User name resolution using raw_user_meta_data
    -- ================================
    v_user_id := auth.uid();
    SELECT COALESCE(
        raw_user_meta_data->>'full_name',
        email,
        'System'
    ) INTO v_user_name
    FROM auth.users 
    WHERE id = v_user_id;
    
    IF v_user_name IS NULL THEN
        v_user_name := 'System';
    END IF;
    
    -- Validate required fields
    IF v_supplier_id IS NULL THEN
        RAISE EXCEPTION 'supplier_id is required';
    END IF;
    
    IF v_branch_id IS NULL THEN
        RAISE EXCEPTION 'branch_id is required';
    END IF;
    
    IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
        RAISE EXCEPTION 'At least one item is required';
    END IF;
    
    -- Generate return number if not provided
    IF v_return_number IS NULL OR v_return_number = '' THEN
        v_return_number := 'PRET-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || 
                          LPAD((EXTRACT(EPOCH FROM NOW())::BIGINT % 10000)::TEXT, 4, '0');
    END IF;
    
    -- Get account IDs
    SELECT id INTO v_inventory_account_id FROM chart_of_accounts 
    WHERE account_code = '1301' AND is_active = true LIMIT 1;
    
    SELECT account_id INTO v_supplier_account_id FROM suppliers 
    WHERE id = v_supplier_id;
    
    IF v_supplier_account_id IS NULL THEN
        SELECT id INTO v_supplier_account_id FROM chart_of_accounts 
        WHERE account_code = '2101' AND is_active = true LIMIT 1;
    END IF;
    
    -- ================================
    -- Calculate totals from items
    -- FIX: Use v_item_record.cost instead of non-existent total_price
    -- ================================
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
        v_item_id := COALESCE(
            (v_item->>'item_id')::UUID,
            (v_item->>'id')::UUID
        );
        
        SELECT * INTO v_item_record FROM jewelry_items WHERE id = v_item_id;
        
        IF v_item_record IS NOT NULL THEN
            -- FIX: Changed from v_item_record.total_price to v_item_record.cost
            v_unit_price := COALESCE((v_item->>'unit_price')::NUMERIC, v_item_record.cost, 0);
            v_subtotal := v_subtotal + v_unit_price;
        END IF;
    END LOOP;
    
    -- ================================
    -- FAIL-FAST GUARD: Prevent zero-value returns
    -- ================================
    IF v_subtotal <= 0 THEN
        RAISE EXCEPTION 'Purchase Return subtotal is zero. Check item unit_price/cost mapping. Items: %', v_items::text;
    END IF;
    
    v_tax_amount := v_subtotal * 0.15;
    v_total_amount := v_subtotal + v_tax_amount;
    
    -- Create return header (as invoice with type purchase_return)
    INSERT INTO invoices (
        invoice_number, invoice_type, invoice_date,
        supplier_id, branch_id, subtotal, tax_amount, total_amount,
        status, notes, created_by, linked_invoice_id
    ) VALUES (
        v_return_number, 'purchase_return', v_return_date,
        v_supplier_id, v_branch_id, v_subtotal, v_tax_amount, v_total_amount,
        'posted', COALESCE(v_reason, '') || COALESCE(' - ' || v_notes, ''), 
        v_user_id, v_linked_invoice_id
    ) RETURNING id INTO v_return_id;
    
    -- Reset line number for second loop
    v_line_number := 0;
    
    -- ================================
    -- Create return lines and update items
    -- FIX: Use correct columns (subtotal, total_amount) 
    --      Remove non-existent gold_weight column
    -- ================================
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
        v_line_number := v_line_number + 1;
        v_item_id := COALESCE(
            (v_item->>'item_id')::UUID,
            (v_item->>'id')::UUID
        );
        v_item_code := v_item->>'item_code';
        
        SELECT * INTO v_item_record FROM jewelry_items WHERE id = v_item_id;
        
        IF v_item_record IS NOT NULL THEN
            -- FIX: Changed from v_item_record.total_price to v_item_record.cost
            v_unit_price := COALESCE((v_item->>'unit_price')::NUMERIC, v_item_record.cost, 0);
            
            -- FIX: Use correct columns (subtotal, total_amount)
            --      Removed gold_weight (column doesn't exist in purchase_invoice_lines)
            INSERT INTO purchase_invoice_lines (
                invoice_id, line_number, product_id, 
                quantity, unit_price, subtotal, total_amount, description
            ) VALUES (
                v_return_id, v_line_number, v_item_id,
                1, v_unit_price, v_unit_price, v_unit_price,
                COALESCE(v_item_code, v_item_record.item_code)
            );
            
            -- Update jewelry item status
            UPDATE jewelry_items 
            SET sale_status = 'returned',
                is_available_for_sale = false,
                updated_at = NOW()
            WHERE id = v_item_id;
        END IF;
    END LOOP;
    
    -- ================================
    -- UNIFIED: Use generate_journal_entry_number()
    -- ================================
    v_je_number := public.generate_journal_entry_number();
    
    INSERT INTO journal_entries (
        entry_number, entry_date, reference_type, reference_id,
        description, total_debit, total_credit, is_posted, created_by
    ) VALUES (
        v_je_number, v_return_date, 'purchase_return', v_return_id,
        'Purchase Return: ' || v_return_number,
        v_total_amount, v_total_amount, true, v_user_id
    ) RETURNING id INTO v_je_id;
    
    -- Debit: Accounts Payable (reduce liability)
    INSERT INTO journal_entry_lines (
        journal_entry_id, account_id, debit_amount, credit_amount, description
    ) VALUES (
        v_je_id, v_supplier_account_id, v_total_amount, 0,
        'Supplier payable reduction - Return ' || v_return_number
    );
    
    -- Credit: Inventory
    INSERT INTO journal_entry_lines (
        journal_entry_id, account_id, debit_amount, credit_amount, description
    ) VALUES (
        v_je_id, v_inventory_account_id, 0, v_subtotal,
        'Inventory reduction - Return ' || v_return_number
    );
    
    -- Credit: VAT Input (if applicable)
    IF v_tax_amount > 0 THEN
        INSERT INTO journal_entry_lines (
            journal_entry_id, account_id, debit_amount, credit_amount, description
        ) SELECT
            v_je_id, id, 0, v_tax_amount,
            'VAT Input reversal - Return ' || v_return_number
        FROM chart_of_accounts 
        WHERE account_code = '1501' AND is_active = true 
        LIMIT 1;
    END IF;
    
    -- Link journal entry to invoice
    UPDATE invoices SET journal_entry_id = v_je_id WHERE id = v_return_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'return_id', v_return_id,
        'return_number', v_return_number,
        'journal_entry_id', v_je_id,
        'journal_entry_number', v_je_number,
        'subtotal', v_subtotal,
        'tax_amount', v_tax_amount,
        'total_amount', v_total_amount
    );
    
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM
    );
END;
$function$;

-- ================================================================================
-- UPDATE: Governance Static Gate Check - Add forbidden column detection
-- 
-- New Rules:
-- RULE 4: Detect usage of non-existent column 'total_price' (should be cost/subtotal/total_amount)
-- RULE 5: Detect usage of non-existent column 'gold_weight' (should be g_weight)
-- ================================================================================

CREATE OR REPLACE FUNCTION public.governance_static_gate_check()
 RETURNS TABLE(function_name text, function_signature text, violation_type text, gate_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_func_def text;
  v_func_name text;
  v_func_sig text;
  v_clean_def text;
  rec record;
BEGIN
  -- Target functions that handle accounting
  FOR rec IN 
    SELECT 
      p.proname::text AS fname,
      p.oid::regprocedure::text AS fsig,
      pg_get_functiondef(p.oid) AS fdef
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'complete_purchase_invoice_atomic',
        'complete_pos_credit_note_atomic',
        'complete_pos_sales_return_atomic',
        'complete_sales_return_atomic',
        'complete_erp_credit_note_atomic',
        'create_customer_receipt_atomic',
        'complete_purchase_return_unique_items_atomic',
        'complete_sales_invoice_atomic',
        'complete_purchase_return_general_items_atomic'
      )
  LOOP
    v_func_name := rec.fname;
    v_func_sig := rec.fsig;
    v_func_def := rec.fdef;
    
    -- Strip single-line comments (-- ...)
    v_clean_def := regexp_replace(v_func_def, '--[^\n]*', '', 'g');
    -- Strip multi-line comments (/* ... */)
    v_clean_def := regexp_replace(v_clean_def, '/\*.*?\*/', '', 'gs');
    
    -- RULE 1: If function INSERTs into journal_entries, 
    --         it MUST use generate_journal_entry_number()
    IF v_clean_def ILIKE '%INSERT INTO journal_entries%' 
       OR v_clean_def ILIKE '%INSERT INTO public.journal_entries%' THEN
      
      -- Check if it uses the approved generator
      IF v_clean_def NOT ILIKE '%generate_journal_entry_number()%' THEN
        function_name := v_func_name;
        function_signature := v_func_sig;
        violation_type := 'MISSING_GENERATOR';
        gate_status := 'FAIL';
        RETURN NEXT;
        CONTINUE;
      END IF;
    END IF;
    
    -- RULE 2: Detect inline JE number literals in executable code
    --         Pattern: 'JE-' || ... (string concatenation)
    IF v_clean_def ~ '''JE-''\s*\|\|' THEN
      function_name := v_func_name;
      function_signature := v_func_sig;
      violation_type := 'INLINE_JE_LITERAL';
      gate_status := 'FAIL';
      RETURN NEXT;
      CONTINUE;
    END IF;
    
    -- RULE 3: Detect direct nextval for JE sequences
    --         Pattern: nextval('journal_entry... or nextval('je_...
    IF v_clean_def ~* 'nextval\s*\(\s*''(journal_entry|je_)' THEN
      function_name := v_func_name;
      function_signature := v_func_sig;
      violation_type := 'DIRECT_NEXTVAL_JE';
      gate_status := 'FAIL';
      RETURN NEXT;
      CONTINUE;
    END IF;
    
    -- RULE 4: Detect usage of non-existent column 'total_price'
    --         Should use: cost (jewelry_items), subtotal/total_amount (invoice_lines)
    --         Pattern: .total_price or total_price, or total_price) in INSERT/SELECT context
    IF v_clean_def ~* '\.total_price\b' 
       OR v_clean_def ~* '\btotal_price\s*,' 
       OR v_clean_def ~* ',\s*total_price\s*\)' THEN
      function_name := v_func_name;
      function_signature := v_func_sig;
      violation_type := 'FORBIDDEN_COLUMN_TOTAL_PRICE';
      gate_status := 'FAIL';
      RETURN NEXT;
      CONTINUE;
    END IF;
    
    -- RULE 5: Detect usage of non-existent column 'gold_weight'
    --         Should use: g_weight (jewelry_items)
    --         purchase_invoice_lines doesn't have this column at all
    IF v_clean_def ~* '\.gold_weight\b' 
       OR v_clean_def ~* '\bgold_weight\s*,' 
       OR v_clean_def ~* ',\s*gold_weight\s*\)' THEN
      function_name := v_func_name;
      function_signature := v_func_sig;
      violation_type := 'FORBIDDEN_COLUMN_GOLD_WEIGHT';
      gate_status := 'FAIL';
      RETURN NEXT;
      CONTINUE;
    END IF;
    
  END LOOP;
  
  RETURN;
END;
$function$;

-- Verify governance gate passes
-- SELECT * FROM governance_static_gate_check();
