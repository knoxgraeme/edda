-- 041: Agent schedules + agent consolidation
--
-- 1. Create agent_schedules table (multiple cron triggers per agent)
-- 2. Add schedule_id to task_runs
-- 3. Consolidate 6 single-purpose agents into 3 multi-skill agents
-- 4. Drop agents.schedule column (schedules now live in agent_schedules)
-- 5. Clean up trigger constraint

BEGIN;

-- ── 1. agent_schedules table ─────────────────────────────────────

CREATE TABLE agent_schedules (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id     UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  cron         TEXT NOT NULL,
  prompt       TEXT NOT NULL,
  context_mode TEXT CHECK (context_mode IS NULL OR context_mode IN ('isolated', 'daily', 'persistent')),
  hooks        JSONB NOT NULL DEFAULT '{}',
  enabled      BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_id, name)
);

CREATE INDEX idx_agent_schedules_agent ON agent_schedules(agent_id);

-- ── 2. Add schedule_id to task_runs ──────────────────────────────

ALTER TABLE task_runs ADD COLUMN schedule_id UUID REFERENCES agent_schedules(id) ON DELETE SET NULL;
CREATE INDEX idx_task_runs_schedule ON task_runs(schedule_id);

-- ── 3. Delete old single-purpose agents (and their task_runs) ────

DELETE FROM task_runs WHERE agent_name IN (
  'daily_digest', 'weekly_reflect', 'context_refresh',
  'type_evolution', 'memory_catchup', 'memory_writer'
);

DELETE FROM agents WHERE name IN (
  'daily_digest', 'weekly_reflect', 'context_refresh',
  'type_evolution', 'memory_catchup', 'memory_writer'
);

-- Clean up agents_md_versions for deleted agents
DELETE FROM agents_md_versions WHERE agent_name IN (
  'daily_digest', 'weekly_reflect', 'context_refresh',
  'type_evolution', 'memory_catchup', 'memory_writer'
);

-- ── 4. Insert consolidated agents ────────────────────────────────

-- digest: daily summaries + weekly reflections
INSERT INTO agents (name, description, skills, trigger, context_mode, model_settings_key, enabled, metadata)
VALUES (
  'digest',
  'Daily summaries and weekly reflections',
  ARRAY['daily_digest', 'weekly_reflect'],
  'schedule',
  'daily',
  'daily_digest_model',
  true,
  '{}'::jsonb
);

-- maintenance: context refresh + type evolution
INSERT INTO agents (name, description, skills, trigger, context_mode, model_settings_key, enabled, metadata)
VALUES (
  'maintenance',
  'System maintenance: context refresh and type evolution',
  ARRAY['context_refresh', 'type_evolution'],
  'schedule',
  'isolated',
  'context_refresh_model',
  true,
  '{}'::jsonb
);

-- memory: nightly memory extraction from unprocessed threads
INSERT INTO agents (name, description, skills, trigger, context_mode, model_settings_key, enabled, metadata)
VALUES (
  'memory',
  'Extract and persist memories from conversations',
  ARRAY['memory_extraction'],
  'schedule',
  'isolated',
  'memory_catchup_model',
  true,
  '{"retrieval_context": {"authorship_mode": "boost", "authorship_boost": 1.3}}'::jsonb
);

-- ── 5. Seed schedule rows ────────────────────────────────────────

-- digest: daily morning briefing
INSERT INTO agent_schedules (agent_id, name, cron, prompt)
SELECT id, 'daily_digest', '0 7 * * *',
  'Generate the daily digest. Summarize yesterday''s activity, surface items due today, and flag anything stale or overdue.'
FROM agents WHERE name = 'digest';

-- digest: weekly reflection (Sundays)
INSERT INTO agent_schedules (agent_id, name, cron, prompt)
SELECT id, 'weekly_reflect', '0 3 * * 0',
  'Perform the weekly reflection. Identify themes from the past 7 days, surface the most active entities, detect dropped threads, consolidate duplicate memories, resolve contradictions, and archive stale knowledge.'
FROM agents WHERE name = 'digest';

-- maintenance: context refresh (daily, with hooks)
INSERT INTO agent_schedules (agent_id, name, cron, prompt, hooks)
SELECT id, 'context_refresh', '0 5 * * *',
  'Refresh the AGENTS.md context document. Compare the current version against fresh data, make surgical edits to reflect changes, and stay within the token budget.',
  '{"pre_invoke": "prepareContextRefreshInput", "post_invoke": "finalizeContextRefresh"}'::jsonb
FROM agents WHERE name = 'maintenance';

-- maintenance: type evolution (daily)
INSERT INTO agent_schedules (agent_id, name, cron, prompt)
SELECT id, 'type_evolution', '0 6 * * *',
  'Analyze item type usage patterns. Cluster unclassified note items, propose new types if patterns emerge, and reclassify items where appropriate.'
FROM agents WHERE name = 'maintenance';

-- memory: nightly catchup
INSERT INTO agent_schedules (agent_id, name, cron, prompt)
SELECT id, 'memory_catchup', '0 22 * * *',
  'Process all unprocessed conversation threads. Extract preferences, facts, patterns, and entities. Deduplicate against existing memories using semantic similarity.'
FROM agents WHERE name = 'memory';

-- ── 6. Drop agents.schedule column ───────────────────────────────

ALTER TABLE agents DROP COLUMN schedule;

-- ── 7. Update trigger constraint (drop post_conversation, not used) ──

ALTER TABLE agents DROP CONSTRAINT agents_trigger_check;
ALTER TABLE agents ADD CONSTRAINT agents_trigger_check
  CHECK (trigger IS NULL OR trigger IN ('schedule', 'on_demand'));

COMMIT;
