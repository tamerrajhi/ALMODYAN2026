-- إصلاح خطأ purchase_return_id → return_id في trigger functions
-- المشكلة: الجدول يستخدم return_id لكن الـ triggers تستخدم purchase_return_id

-- إصلاح الدالة الأولى: sync_returned_qty_from_canonical_lines
CREATE OR REPLACE FUNCTION public.sync_returned_qty_from_canonical_lines()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_line_id uuid;
  v_new_returned_qty numeric;
  v_return_record RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_invoice_line_id := OLD.invoice_line_id;
  ELSE
    v_invoice_line_id := NEW.invoice_line_id;
  END IF;

  IF v_invoice_line_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  -- إصلاح: استخدام return_id بدلاً من purchase_return_id
  IF TG_OP = 'DELETE' THEN
    SELECT pr.* INTO v_return_record
    FROM public.purchase_returns pr
    WHERE pr.id = OLD.return_id;
  ELSE
    SELECT pr.* INTO v_return_record
    FROM public.purchase_returns pr
    WHERE pr.id = NEW.return_id;
  END IF;

  IF v_return_record.status IN ('voided', 'cancelled') THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  -- إصلاح: استخدام return_id بدلاً من purchase_return_id
  SELECT COALESCE(SUM(prl.quantity), 0) INTO v_new_returned_qty
  FROM public.purchase_return_lines prl
  JOIN public.purchase_returns pr ON pr.id = prl.return_id
  WHERE prl.invoice_line_id = v_invoice_line_id
    AND pr.status NOT IN ('voided', 'cancelled');

  UPDATE public.purchase_invoice_lines
  SET returned_qty = v_new_returned_qty
  WHERE id = v_invoice_line_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

-- إصلاح الدالة الثانية: recalc_returned_qty_on_general_status_change
CREATE OR REPLACE FUNCTION public.recalc_returned_qty_on_general_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line RECORD;
  v_new_returned_qty numeric;
BEGIN
  IF NEW.status IN ('voided', 'cancelled') AND OLD.status NOT IN ('voided', 'cancelled') THEN
    FOR v_line IN
      SELECT DISTINCT prl.invoice_line_id
      FROM public.purchase_return_lines prl
      WHERE prl.return_id = NEW.id
        AND prl.invoice_line_id IS NOT NULL
    LOOP
      SELECT COALESCE(SUM(prl.quantity), 0) INTO v_new_returned_qty
      FROM public.purchase_return_lines prl
      JOIN public.purchase_returns pr ON pr.id = prl.return_id
      WHERE prl.invoice_line_id = v_line.invoice_line_id
        AND pr.status NOT IN ('voided', 'cancelled');

      UPDATE public.purchase_invoice_lines
      SET returned_qty = v_new_returned_qty
      WHERE id = v_line.invoice_line_id;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;