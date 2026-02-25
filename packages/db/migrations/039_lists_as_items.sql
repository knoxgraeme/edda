-- 039_lists_as_items.sql
-- Lists become first-class items. List items use parent_id instead of metadata->>'list_name'.

-- 1. Add 'list' item type
INSERT INTO item_types (name, icon, description, metadata_schema, classification_hint, decay_half_life_days)
VALUES (
  'list',
  '📋',
  'A named list that contains list items',
  '{"list_type": "rolling|one_off", "normalized_name": "string"}',
  'Use when the user creates or references a named collection of items — grocery list, packing list, shopping list, reading list. This is the container; individual entries are list_item type with parent_id pointing here. Prefer list over note when items belong to a named collection. Metadata: list_type is "rolling" for recurring lists (grocery, shopping) or "one_off" for temporary lists (trip packing, moving checklist). normalized_name is the lowercase trimmed list name for dedup.',
  0  -- evergreen: list containers should not decay
)
ON CONFLICT (name) DO UPDATE SET
  icon = EXCLUDED.icon,
  description = EXCLUDED.description,
  metadata_schema = EXCLUDED.metadata_schema,
  classification_hint = EXCLUDED.classification_hint,
  decay_half_life_days = EXCLUDED.decay_half_life_days;

-- 2. Update list_item hints to reference parent_id pattern
UPDATE item_types SET
  classification_hint = 'Use for discrete items that belong to a named list — groceries, packing, shopping, reading. Always link to a parent list item via parent_id. If no list exists yet, create one (type=list) first. Do not use for tasks or action items even if they appear in list form.'
WHERE name = 'list_item';

-- 3. Create list items from existing distinct metadata->>'list_name' values
INSERT INTO items (type, content, summary, metadata, status, source, day, confirmed)
SELECT
  'list',
  metadata->>'list_name',
  'List: ' || metadata->>'list_name',
  jsonb_build_object(
    'list_type', 'rolling',
    'normalized_name', lower(trim(metadata->>'list_name'))
  ),
  'active',
  'agent',
  MIN(day),
  true
FROM items
WHERE type = 'list_item'
  AND confirmed = true
  AND status = 'active'
  AND metadata->>'list_name' IS NOT NULL
GROUP BY metadata->>'list_name';

-- 4. Backfill parent_id on existing list_items
UPDATE items li
SET parent_id = p.id
FROM items p
WHERE li.type = 'list_item'
  AND li.parent_id IS NULL
  AND li.metadata->>'list_name' IS NOT NULL
  AND p.type = 'list'
  AND p.content = li.metadata->>'list_name';

-- 5. Drop the old partial index (no longer needed)
DROP INDEX IF EXISTS idx_items_list;
