-- =====================================================
-- P4-7 Credit Notes Hardening Migration
-- Date: 2026-01-24
-- =====================================================

-- 1) Add void columns
ALTER TABLE public.credit_notes 
ADD COLUMN IF NOT EXISTS voided_at timestamptz,
ADD COLUMN IF NOT EXISTS voided_by uuid,
ADD COLUMN IF NOT EXISTS void_reason text;

-- 2) Status constraint with voided
ALTER TABLE public.credit_notes DROP CONSTRAINT IF EXISTS credit_notes_status_check;
ALTER TABLE public.credit_notes ADD CONSTRAINT credit_notes_status_check 
  CHECK (status IN ('draft', 'pending', 'approved', 'issued', 'posted', 'voided', 'applied'));

-- 3) Posted Lock Trigger
CREATE OR REPLACE FUNCTION public.credit_note_posted_lock()
RETURNS TRIGGER AS $$
DECLARE
  v_je_posted boolean;
BEGIN
  IF NEW.status = 'voided' AND OLD.status != 'voided' THEN
    RETURN NEW;
  END IF;
  
  IF OLD.journal_entry_id IS NOT NULL THEN
    SELECT is_posted INTO v_je_posted FROM journal_entries WHERE id = OLD.journal_entry_id;
    
    IF v_je_posted = true THEN
      IF OLD.total_amount IS DISTINCT FROM NEW.total_amount
        OR OLD.customer_id IS DISTINCT FROM NEW.customer_id
        OR OLD.invoice_id IS DISTINCT FROM NEW.invoice_id
        OR OLD.branch_id IS DISTINCT FROM NEW.branch_id
      THEN
        RAISE EXCEPTION 'POSTED_LOCKED: Cannot modify credit note after journal entry is posted';
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_credit_note_posted_lock ON public.credit_notes;
CREATE TRIGGER trg_credit_note_posted_lock
  BEFORE UPDATE ON public.credit_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.credit_note_posted_lock();

-- 4) Prevent Delete Trigger
CREATE OR REPLACE FUNCTION public.credit_note_prevent_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'DELETE_FORBIDDEN: Only admins can delete credit notes';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_credit_note_prevent_delete ON public.credit_notes;
CREATE TRIGGER trg_credit_note_prevent_delete
  BEFORE DELETE ON public.credit_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.credit_note_prevent_delete();

-- 5) RLS Policies
DROP POLICY IF EXISTS "Users can update credit notes in their branches" ON public.credit_notes;
CREATE POLICY "Users can update credit notes in their branches" ON public.credit_notes
  FOR UPDATE
  USING (has_role(auth.uid(), 'admin') OR branch_id = ANY(get_user_branches(auth.uid())))
  WITH CHECK (has_role(auth.uid(), 'admin') OR branch_id = ANY(get_user_branches(auth.uid())));

DROP POLICY IF EXISTS "Admins can delete credit notes" ON public.credit_notes;
CREATE POLICY "Admins can delete credit notes" ON public.credit_notes
  FOR DELETE
  USING (has_role(auth.uid(), 'admin'));

-- credit_note_items: Branch-scoped
DROP POLICY IF EXISTS "Users can view credit note items" ON public.credit_note_items;
DROP POLICY IF EXISTS "Users can insert credit note items" ON public.credit_note_items;
DROP POLICY IF EXISTS "Users can update credit note items" ON public.credit_note_items;
DROP POLICY IF EXISTS "Users can delete credit note items" ON public.credit_note_items;

CREATE POLICY "Users can view credit note items" ON public.credit_note_items
  FOR SELECT
  USING (has_role(auth.uid(), 'admin') OR EXISTS (
    SELECT 1 FROM credit_notes cn WHERE cn.id = credit_note_items.credit_note_id 
    AND cn.branch_id = ANY(get_user_branches(auth.uid()))
  ));

CREATE POLICY "Users can insert credit note items" ON public.credit_note_items
  FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin') OR EXISTS (
    SELECT 1 FROM credit_notes cn WHERE cn.id = credit_note_items.credit_note_id 
    AND cn.branch_id = ANY(get_user_branches(auth.uid()))
  ));

CREATE POLICY "Users can update credit note items" ON public.credit_note_items
  FOR UPDATE
  USING (has_role(auth.uid(), 'admin') OR EXISTS (
    SELECT 1 FROM credit_notes cn WHERE cn.id = credit_note_items.credit_note_id 
    AND cn.branch_id = ANY(get_user_branches(auth.uid()))
  ))
  WITH CHECK (has_role(auth.uid(), 'admin') OR EXISTS (
    SELECT 1 FROM credit_notes cn WHERE cn.id = credit_note_items.credit_note_id 
    AND cn.branch_id = ANY(get_user_branches(auth.uid()))
  ));

CREATE POLICY "Admins can delete credit note items" ON public.credit_note_items
  FOR DELETE
  USING (has_role(auth.uid(), 'admin'));

-- 6) void_credit_note_atomic RPC (see main migration for full implementation)
GRANT EXECUTE ON FUNCTION public.void_credit_note_atomic(jsonb) TO authenticated;
