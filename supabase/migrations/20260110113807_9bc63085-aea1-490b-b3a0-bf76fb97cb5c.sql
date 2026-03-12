-- Add index for phone column to improve search performance
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

-- Add index for phone column with text pattern matching for LIKE queries
CREATE INDEX IF NOT EXISTS idx_customers_phone_pattern ON customers(phone text_pattern_ops);