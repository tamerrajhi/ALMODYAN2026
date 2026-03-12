-- Add registration mode and branch_id columns to zatca_settings
ALTER TABLE zatca_settings 
ADD COLUMN IF NOT EXISTS registration_mode TEXT DEFAULT 'unified' 
CHECK (registration_mode IN ('unified', 'per_branch'));

ALTER TABLE zatca_settings 
ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);

-- Add unique constraint for branch_id (allows multiple NULL values)
CREATE UNIQUE INDEX IF NOT EXISTS unique_branch_zatca ON zatca_settings (branch_id) WHERE branch_id IS NOT NULL;