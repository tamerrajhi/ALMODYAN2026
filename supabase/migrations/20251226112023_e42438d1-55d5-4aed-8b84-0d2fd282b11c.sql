-- Drop the existing check constraint
ALTER TABLE public.branches DROP CONSTRAINT IF EXISTS branches_branch_type_check;

-- Add updated check constraint that includes gold_jewelry
ALTER TABLE public.branches ADD CONSTRAINT branches_branch_type_check 
CHECK (branch_type IN ('jewelry', 'gold', 'gold_jewelry'));