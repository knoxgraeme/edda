-- Phase 4: Fold self-improvement into weekly_reflect (on digest agent).
--
-- self_reflection was originally a separate skill on the maintenance agent.
-- Now combined into weekly_reflect (Part 3) on the digest agent, saving
-- context/tokens by doing activity analysis + maintenance + self-improvement
-- in a single pass.
--
-- This migration:
-- 1. Removes the standalone self_reflection skill from maintenance (if added)
-- 2. Updates the weekly_reflect schedule prompt to include self-improvement

-- 1. Remove self_reflection from maintenance agent if it was added
UPDATE agents
SET skills = array_remove(skills, 'self_reflection')
WHERE name = 'maintenance'
  AND 'self_reflection' = ANY(skills);

-- 2. Remove standalone self_reflection schedule if it was added
DELETE FROM agent_schedules
WHERE name = 'self_reflection'
  AND agent_id = (SELECT id FROM agents WHERE name = 'maintenance');

-- 3. Update weekly_reflect schedule prompt to include self-improvement pass
UPDATE agent_schedules
SET prompt = 'Perform the weekly reflection. Part 1: Identify themes from the past 7 days, surface the most active entities, detect dropped threads. Part 2: Memory maintenance — merge duplicates, archive stale memories, resolve contradictions, consolidate entity descriptions. Part 3: Self-improvement — review session summaries for corrections and quality signals, update AGENTS.md procedural memory with synthesized insights, optionally refine agent prompts if clear patterns emerge.'
WHERE name = 'weekly_reflect'
  AND agent_id = (SELECT id FROM agents WHERE name = 'digest');
