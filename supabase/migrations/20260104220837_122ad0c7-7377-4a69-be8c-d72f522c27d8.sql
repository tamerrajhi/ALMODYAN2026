-- دالة منع التسجيل على الحسابات الرئيسية AR/AP
CREATE OR REPLACE FUNCTION public.prevent_parent_ar_ap_posting()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  acc_code TEXT;
BEGIN
  -- جلب كود الحساب
  SELECT account_code INTO acc_code
  FROM chart_of_accounts
  WHERE id = NEW.account_id;

  -- التحقق من الحسابات الممنوعة
  IF acc_code IN ('1102', '2101') THEN
    RAISE EXCEPTION 
      'لا يمكن التسجيل مباشرة على حساب الذمم المدينة/الدائنة الرئيسي (%). يجب استخدام حساب العميل أو المورد الفرعي. Posting directly to AR/AP parent account is not allowed.',
      acc_code;
  END IF;

  RETURN NEW;
END;
$$;

-- إنشاء الـ Trigger
DROP TRIGGER IF EXISTS trg_prevent_parent_ar_ap_posting ON journal_entry_lines;

CREATE TRIGGER trg_prevent_parent_ar_ap_posting
BEFORE INSERT OR UPDATE
ON journal_entry_lines
FOR EACH ROW
EXECUTE FUNCTION prevent_parent_ar_ap_posting();

-- إضافة تعليق توضيحي
COMMENT ON TRIGGER trg_prevent_parent_ar_ap_posting ON journal_entry_lines IS 
  'يمنع التسجيل المباشر على الحسابات الرئيسية 1102 (AR) و 2101 (AP). يجب استخدام الحسابات الفرعية للعملاء والموردين.';