-- Create function to check if an account can be deleted (for backend protection)
CREATE OR REPLACE FUNCTION public.check_account_can_be_deleted(p_account_id UUID)
RETURNS TABLE (
  can_delete BOOLEAN,
  can_edit BOOLEAN,
  reason TEXT
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_system BOOLEAN;
  v_has_journal_entries BOOLEAN;
  v_has_children BOOLEAN;
  v_has_balance BOOLEAN;
  v_has_linkages BOOLEAN;
  v_reason TEXT := '';
BEGIN
  -- Check if system account
  SELECT coa.is_system INTO v_is_system 
  FROM chart_of_accounts coa WHERE coa.id = p_account_id;
  
  IF v_is_system THEN
    RETURN QUERY SELECT FALSE, FALSE, 'حساب نظامي - لا يمكن تعديله أو حذفه'::TEXT;
    RETURN;
  END IF;
  
  -- Check for journal entries
  SELECT EXISTS(
    SELECT 1 FROM journal_entry_lines 
    WHERE account_id = p_account_id
  ) INTO v_has_journal_entries;
  
  IF v_has_journal_entries THEN
    v_reason := v_reason || 'يوجد قيود محاسبية مرتبطة، ';
  END IF;
  
  -- Check for children
  SELECT EXISTS(
    SELECT 1 FROM chart_of_accounts 
    WHERE parent_id = p_account_id
  ) INTO v_has_children;
  
  IF v_has_children THEN
    v_reason := v_reason || 'يوجد حسابات فرعية، ';
  END IF;
  
  -- Check for non-zero balance
  SELECT COALESCE(SUM(COALESCE(debit_amount, 0) - COALESCE(credit_amount, 0)), 0) != 0 
  INTO v_has_balance
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  WHERE jel.account_id = p_account_id AND je.is_posted = true;
  
  IF v_has_balance THEN
    v_reason := v_reason || 'رصيد غير صفري، ';
  END IF;
  
  -- Check for linkages to other tables
  SELECT EXISTS(
    SELECT 1 FROM cash_vaults WHERE account_id = p_account_id
    UNION ALL
    SELECT 1 FROM gold_vaults WHERE account_id = p_account_id
    UNION ALL
    SELECT 1 FROM cost_entries WHERE gl_account_id = p_account_id
    UNION ALL
    SELECT 1 FROM jewelry_items WHERE inventory_account_id = p_account_id
    UNION ALL
    SELECT 1 FROM products WHERE inventory_account_id = p_account_id OR expense_account_id = p_account_id
    UNION ALL
    SELECT 1 FROM branch_inventory_accounts WHERE general_inventory_account_id = p_account_id OR imported_pieces_account_id = p_account_id
    UNION ALL
    SELECT 1 FROM suppliers WHERE account_id = p_account_id
    UNION ALL
    SELECT 1 FROM payment_account_settings WHERE cash_account_id = p_account_id OR bank_transfer_account_id = p_account_id OR check_account_id = p_account_id OR credit_card_account_id = p_account_id
    UNION ALL
    SELECT 1 FROM production_account_settings WHERE wip_account_id = p_account_id OR raw_materials_account_id = p_account_id OR finished_goods_account_id = p_account_id OR scrap_loss_account_id = p_account_id
    UNION ALL
    SELECT 1 FROM purchase_invoice_lines WHERE account_id = p_account_id OR inventory_account_id = p_account_id OR expense_account_id = p_account_id
    UNION ALL
    SELECT 1 FROM returns WHERE bank_account_id = p_account_id
  ) INTO v_has_linkages;
  
  IF v_has_linkages THEN
    v_reason := v_reason || 'مرتبط بكيانات أخرى في النظام، ';
  END IF;
  
  -- Trim trailing comma and space
  v_reason := RTRIM(v_reason, '، ');
  
  -- Determine can_edit and can_delete
  IF v_has_journal_entries OR v_has_balance OR v_has_linkages THEN
    RETURN QUERY SELECT FALSE, FALSE, v_reason;
  ELSIF v_has_children THEN
    RETURN QUERY SELECT FALSE, TRUE, v_reason;
  ELSE
    RETURN QUERY SELECT TRUE, TRUE, ''::TEXT;
  END IF;
END;
$$;

-- Create trigger function to prevent deletion of protected accounts
CREATE OR REPLACE FUNCTION public.prevent_protected_account_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_can_delete BOOLEAN;
  v_reason TEXT;
BEGIN
  SELECT can_delete, reason INTO v_can_delete, v_reason 
  FROM check_account_can_be_deleted(OLD.id);
  
  IF NOT v_can_delete THEN
    RAISE EXCEPTION 'لا يمكن حذف هذا الحساب: %. Cannot delete this account: %', v_reason, v_reason;
  END IF;
  
  RETURN OLD;
END;
$$;

-- Create trigger function to prevent update of protected accounts
CREATE OR REPLACE FUNCTION public.prevent_protected_account_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_can_edit BOOLEAN;
  v_reason TEXT;
BEGIN
  -- Only check if critical fields are being changed
  IF OLD.account_code != NEW.account_code 
     OR OLD.account_name != NEW.account_name 
     OR OLD.account_type != NEW.account_type 
     OR OLD.parent_id IS DISTINCT FROM NEW.parent_id THEN
    
    SELECT can_edit, reason INTO v_can_edit, v_reason 
    FROM check_account_can_be_deleted(OLD.id);
    
    IF NOT v_can_edit THEN
      RAISE EXCEPTION 'لا يمكن تعديل هذا الحساب: %. Cannot edit this account: %', v_reason, v_reason;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS prevent_account_deletion_trigger ON chart_of_accounts;
DROP TRIGGER IF EXISTS prevent_account_update_trigger ON chart_of_accounts;

-- Create triggers on chart_of_accounts table
CREATE TRIGGER prevent_account_deletion_trigger
  BEFORE DELETE ON chart_of_accounts
  FOR EACH ROW
  EXECUTE FUNCTION prevent_protected_account_deletion();

CREATE TRIGGER prevent_account_update_trigger
  BEFORE UPDATE ON chart_of_accounts
  FOR EACH ROW
  EXECUTE FUNCTION prevent_protected_account_update();