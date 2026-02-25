-- Phase 3: Merge user crons into agents, remove special-case settings
--
-- 1. Rename memory_extraction → memory_catchup (update skills array too)
-- 2. Migrate active scheduled_task items → agents rows
-- 3. Drop user cron settings columns
-- 4. Drop memory_extraction_enabled (agent.enabled is the toggle)
--
-- DESTRUCTIVE: Drops 4 settings columns. These are intentionally removed
-- as part of the agent simplification — the agents table replaces them.

BEGIN;

-- Rename memory_extraction → memory_catchup and update skills array
UPDATE agents
SET name = 'memory_catchup',
    skills = ARRAY['memory_catchup']
WHERE name = 'memory_extraction';

-- Migrate active scheduled_task items → agents rows
-- Note: null/missing enabled is treated as enabled (matches old runtime behavior)
INSERT INTO agents (name, description, skills, tools, trigger, schedule, context_mode, metadata, enabled)
SELECT
  'user_cron_' || REPLACE(id::text, '-', '_'),
  content,
  ARRAY[]::text[],
  ARRAY['search_items', 'create_item', 'get_dashboard', 'get_entity_profile', 'get_timeline'],
  'schedule',
  metadata->>'cron',
  'daily',
  jsonb_build_object('migrated_from_item', id, 'action', metadata->>'action'),
  true
FROM items
WHERE type = 'scheduled_task'
  AND status = 'active'
  AND (metadata->>'enabled' IS NULL OR metadata->>'enabled' = 'true')
  AND metadata->>'cron' IS NOT NULL;

-- Drop user cron settings
ALTER TABLE settings DROP COLUMN IF EXISTS user_crons_enabled;
ALTER TABLE settings DROP COLUMN IF EXISTS user_cron_check_interval;
ALTER TABLE settings DROP COLUMN IF EXISTS user_cron_model;

-- Drop memory_extraction_enabled (agent.enabled handles this now)
ALTER TABLE settings DROP COLUMN IF EXISTS memory_extraction_enabled;

COMMIT;
