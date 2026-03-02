-- 006_memory_refactor.sql
--
-- Memory system refactor: per-agent memory config, entity approval,
-- session_note type, agent consolidation, and schedule updates.

-- 1. Agent memory columns
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS memory_capture BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS memory_self_reflect BOOLEAN NOT NULL DEFAULT true;

-- 2. Settings: global extraction model + entity approval
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS memory_extraction_model TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS approval_new_entity TEXT NOT NULL DEFAULT 'auto';

-- 3. New item type: session_note
INSERT INTO item_types (name, icon, description, metadata_schema, classification_hint, agent_internal, decay_half_life_days)
VALUES ('session_note', 'pencil', 'Agent observation about a conversation — corrections, quality signals, user feedback',
  '{"thread_id": "thread UUID", "corrections": "array of corrections observed", "quality_signals": "array of positive/negative signals", "source": "user_feedback or agent_observation"}',
  'Agent-internal. Created during conversations when the agent notices something notable for later self-reflection.',
  true, 30)
ON CONFLICT (name) DO NOTHING;

-- 4. Set memory config per agent
UPDATE agents SET memory_capture = true, memory_self_reflect = true WHERE name = 'edda';
UPDATE agents SET memory_capture = false, memory_self_reflect = false WHERE name IN ('digest', 'maintenance', 'memory');

-- 5. Disable memory agent
UPDATE agents SET enabled = false WHERE name = 'memory';

-- 6. Update skills
-- Remove context_refresh from maintenance
UPDATE agents SET skills = array_remove(skills, 'context_refresh') WHERE name = 'maintenance';
-- Add memory_maintenance to maintenance
UPDATE agents SET skills = array_append(skills, 'memory_maintenance')
  WHERE name = 'maintenance' AND NOT ('memory_maintenance' = ANY(skills));
-- Replace weekly_reflect with weekly_report on digest
UPDATE agents SET skills = array_remove(skills, 'weekly_reflect') WHERE name = 'digest';
UPDATE agents SET skills = array_append(skills, 'weekly_report')
  WHERE name = 'digest' AND NOT ('weekly_report' = ANY(skills));
-- Add self_reflect to edda, remove memory_extraction
UPDATE agents SET skills = array_cat(
  array_remove(skills, 'memory_extraction'),
  ARRAY['self_reflect']
) WHERE name = 'edda' AND NOT ('self_reflect' = ANY(skills));

-- 7. Schedule changes
-- Remove context_refresh schedule
DELETE FROM agent_schedules WHERE name = 'context_refresh';
-- Remove memory_catchup schedule
DELETE FROM agent_schedules WHERE name = 'memory_catchup';
-- Rename weekly_reflect to weekly_report on digest
UPDATE agent_schedules SET name = 'weekly_report',
  prompt = 'Generate the weekly activity report: items by type, completion rates, most active entities, stale items, dropped threads.'
  WHERE name = 'weekly_reflect' AND agent_id = (SELECT id FROM agents WHERE name = 'digest');

-- Add self_reflect schedule on edda (ephemeral thread override)
INSERT INTO agent_schedules (agent_id, name, cron, prompt, thread_lifetime, enabled)
VALUES (
  (SELECT id FROM agents WHERE name = 'edda'),
  'self_reflect', '0 3 * * 0',
  'Run self-reflection on your recent conversations. Search session notes since your last reflection, identify recurring corrections, preferences, and quality signals, then update your operating notes accordingly.',
  'ephemeral', true
)
ON CONFLICT (agent_id, name) DO NOTHING;

-- Add memory_maintenance schedule on maintenance
INSERT INTO agent_schedules (agent_id, name, cron, prompt, thread_lifetime, enabled)
VALUES (
  (SELECT id FROM agents WHERE name = 'maintenance'),
  'memory_maintenance', '0 4 * * 0',
  'Run weekly memory maintenance: merge near-duplicate memories, archive stale items, resolve contradictions, consolidate entity descriptions.',
  'ephemeral', true
)
ON CONFLICT (agent_id, name) DO NOTHING;
