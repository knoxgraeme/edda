-- Phase 4: Add self_reflection skill to maintenance agent with weekly schedule.
--
-- self_reflection reviews session_summary items from the past week to identify
-- behavioral trends and update AGENTS.md procedural memory. Runs weekly on
-- Sunday evenings (after weekly_reflect cleans the items DB).

-- 1. Add self_reflection to the maintenance agent's skills
UPDATE agents
SET skills = array_append(skills, 'self_reflection')
WHERE name = 'maintenance'
  AND NOT ('self_reflection' = ANY(skills));

-- 2. Add weekly schedule: Sunday at 8pm (after weekly_reflect at 3am and memory_catchup at 10pm the night before)
INSERT INTO agent_schedules (agent_id, name, cron, prompt)
SELECT id, 'self_reflection', '0 20 * * 0',
  'Review session summaries from the past week. Identify recurring corrections, communication preferences, and quality signals. Update AGENTS.md procedural memory with synthesized insights. Only make changes supported by multiple sessions.'
FROM agents WHERE name = 'maintenance'
ON CONFLICT (agent_id, name) DO NOTHING;
