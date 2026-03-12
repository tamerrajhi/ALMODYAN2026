-- Clean up orphan journal entries (entries without lines)
-- This fixes historical data where journal entry creation failed silently

-- Step 1: Clear journal_entry_id from payments that reference orphan entries
UPDATE payments 
SET journal_entry_id = NULL 
WHERE journal_entry_id IS NOT NULL 
AND journal_entry_id NOT IN (
  SELECT DISTINCT journal_entry_id 
  FROM journal_entry_lines 
  WHERE journal_entry_id IS NOT NULL
);

-- Step 2: Clear journal_entry_id from invoices that reference orphan entries
UPDATE invoices 
SET journal_entry_id = NULL 
WHERE journal_entry_id IS NOT NULL 
AND journal_entry_id NOT IN (
  SELECT DISTINCT journal_entry_id 
  FROM journal_entry_lines 
  WHERE journal_entry_id IS NOT NULL
);

-- Step 3: Delete orphan journal entries (entries without any lines)
DELETE FROM journal_entries 
WHERE id NOT IN (
  SELECT DISTINCT journal_entry_id 
  FROM journal_entry_lines 
  WHERE journal_entry_id IS NOT NULL
);