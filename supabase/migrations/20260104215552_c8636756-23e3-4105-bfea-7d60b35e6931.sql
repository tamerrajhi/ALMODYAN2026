-- Fix orphaned journal entries on 2101 by matching supplier names from description
-- شركة المدار الذهبي للصيانة والنظافة -> 971c2c16-6677-431e-86d4-ad9e4504a436
UPDATE journal_entry_lines 
SET account_id = '971c2c16-6677-431e-86d4-ad9e4504a436'
WHERE id IN (
  '27415ff5-b25f-4516-8e6d-80a349f1515d',  -- PAY-20251231-0009
  '6f3f6bec-5eef-4190-bad8-f3734775ffc4',  -- PAY-20251231-0010
  'ffb52a4a-aa8b-4822-b7fd-e4052c568d43',  -- PR-20260101-0003
  '8bcdea60-5705-42d2-b243-05b3d07c52fe'   -- PR-20260101-0004
);

-- شركة مشاعل الهدى للتجارة -> b378e98f-30b9-47ed-9bea-fd3e49da3b94
UPDATE journal_entry_lines 
SET account_id = 'b378e98f-30b9-47ed-9bea-fd3e49da3b94'
WHERE id = '010d960e-9488-4ae6-b9e0-796a005335d8';  -- PR-20251231-0004

-- شركة الحلول الاحترافية للتجارة -> bab6b30d-3354-43ab-babc-2315c0ba26c4
UPDATE journal_entry_lines 
SET account_id = 'bab6b30d-3354-43ab-babc-2315c0ba26c4'
WHERE id IN (
  '9cb13076-1527-47e6-b1c4-c1116c81c46e',  -- PAY-20251231-0001
  'e26fc6c4-cae2-4a87-aa51-1987d66a534a'   -- PR-20260103-0001
);

-- شركة الفن المتجة للتجارة -> 02c36084-ed08-4866-938e-0ac8f1d801c5
UPDATE journal_entry_lines 
SET account_id = '02c36084-ed08-4866-938e-0ac8f1d801c5'
WHERE id IN (
  '31ca726a-7559-4814-b6ae-c48c1638e3d5',  -- PR-20260101-0001
  'f77b6317-a22a-4003-931d-6d3c632f2bba'   -- PR-20260101-0002
);