-- Index on item_code for fast lookup
CREATE INDEX IF NOT EXISTS idx_jewelry_items_item_code ON jewelry_items(item_code);

-- Partial index for unsold items by branch (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_jewelry_items_branch_unsold ON jewelry_items(branch_id, item_code) WHERE sold_at IS NULL;

-- Trigram index on model for ILIKE searches (requires pg_trgm extension)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_jewelry_items_model_trgm ON jewelry_items USING gin(model gin_trgm_ops);