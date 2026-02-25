-- 037: Tool renames, skill consolidation, and explicit agent scoping
--
-- 1. Merge post_process + memory_catchup skills -> memory_extraction
-- 2. Give edda agent explicit skills (no more empty = all tools)
-- 3. Update tool references in agents.tools[] for migrated user_cron agents

BEGIN;

-- 1. Merge post_process + memory_catchup skills -> memory_extraction
UPDATE agents
SET skills = array_replace(skills, 'post_process', 'memory_extraction')
WHERE 'post_process' = ANY(skills);

UPDATE agents
SET skills = array_replace(skills, 'memory_catchup', 'memory_extraction')
WHERE 'memory_catchup' = ANY(skills);

-- 2. Give edda agent explicit skills (capture, recall, manage, admin)
-- Only update if skills are still empty (won't override user customization)
UPDATE agents
SET skills = ARRAY['capture', 'recall', 'manage', 'admin']
WHERE name = 'edda' AND skills = '{}';

-- 3. Rename tool references in agents.tools[] for user_cron agents from migration 030
UPDATE agents
SET tools = array_replace(tools, 'get_dashboard', 'get_daily_summary')
WHERE 'get_dashboard' = ANY(tools);

COMMIT;
