-- Phase 3C-2B: Ensure user_branches.is_primary column exists with proper constraints
-- Run date: 2026-02-07

ALTER TABLE user_branches ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE user_branches ALTER COLUMN is_primary SET NOT NULL;
ALTER TABLE user_branches ALTER COLUMN is_primary SET DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_user_branches_user_primary ON user_branches (user_id, is_primary);
