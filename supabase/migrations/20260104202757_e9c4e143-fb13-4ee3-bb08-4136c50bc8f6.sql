-- إضافة عمود branch_id لجدول القيود المحاسبية
ALTER TABLE journal_entries 
ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);

-- إنشاء index للأداء
CREATE INDEX IF NOT EXISTS idx_journal_entries_branch_id ON journal_entries(branch_id);