-- Set edda agent core tools for lazy tool injection.
-- Skills-specific tools are now loaded on demand when the agent reads a SKILL.md.
UPDATE agents
SET tools = ARRAY[
  'search_items',
  'get_item_by_id',
  'list_entity_items',
  'get_entity_profile',
  'list_entities',
  'get_daily_summary',
  'get_timeline',
  'get_list_contents',
  'web_search'
]
WHERE name = 'edda';
