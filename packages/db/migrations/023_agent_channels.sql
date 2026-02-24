-- 023_agent_channels.sql
-- Phase 1: Foundation for agent channels architecture.
-- Creates agent_definitions and task_runs tables, seeds system agents,
-- adds notification item type, per-agent AGENTS.md support, and settings columns.

-- ── agent_definitions ───────────────────────────────────────

CREATE TABLE agent_definitions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  system_prompt TEXT,
  skills TEXT[] NOT NULL DEFAULT '{}',
  schedule TEXT,
  context_mode TEXT NOT NULL DEFAULT 'isolated'
    CHECK (context_mode IN ('isolated', 'daily', 'persistent')),
  output_mode TEXT NOT NULL DEFAULT 'channel'
    CHECK (output_mode IN ('channel', 'items', 'both')),
  scopes TEXT[] NOT NULL DEFAULT '{}',
  scope_mode TEXT NOT NULL DEFAULT 'boost'
    CHECK (scope_mode IN ('boost', 'strict')),
  model_settings_key TEXT,
  built_in BOOLEAN NOT NULL DEFAULT false,
  enabled BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── task_runs ───────────────────────────────────────────────

CREATE TABLE task_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_definition_id UUID REFERENCES agent_definitions(id) ON DELETE SET NULL,
  agent_name TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('cron', 'user', 'orchestrator', 'hook', 'agent')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  thread_id TEXT,
  input_summary TEXT,
  output_summary TEXT,
  model TEXT,
  tokens_used INT,
  duration_ms INT,
  error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_task_runs_agent ON task_runs(agent_name);
CREATE INDEX idx_task_runs_status ON task_runs(status);
CREATE INDEX idx_task_runs_created ON task_runs(created_at DESC);
CREATE INDEX idx_task_runs_agent_def ON task_runs(agent_definition_id);

-- ── Seed system agents ──────────────────────────────────────

INSERT INTO agent_definitions (name, description, built_in, schedule, skills, context_mode, output_mode, model_settings_key, scopes, scope_mode) VALUES
  ('daily_digest', 'Morning summary of activity, due items, and upcoming events', true, '0 7 * * *', '{daily_digest}', 'daily', 'channel', 'daily_digest_model', '{digest}', 'boost'),
  ('memory_extraction', 'Extract implicit knowledge from unprocessed threads', true, '0 22 * * *', '{memory_extraction}', 'isolated', 'items', 'memory_extraction_model', '{memory}', 'boost'),
  ('weekly_reflect', 'Weekly pattern analysis and memory maintenance', true, '0 3 * * 0', '{weekly_reflect}', 'daily', 'both', 'weekly_review_model', '{memory,digest}', 'boost'),
  ('type_evolution', 'Evolve item type system based on usage patterns', true, NULL, '{type_evolution}', 'isolated', 'items', 'type_evolution_model', '{}', 'boost'),
  ('context_refresh', 'Curate AGENTS.md from template changes', true, '0 5 * * *', '{context_refresh}', 'isolated', 'items', 'context_refresh_model', '{}', 'boost'),
  ('post_process', 'Post-conversation memory and entity writer', true, NULL, '{post_process}', 'isolated', 'items', 'memory_extraction_model', '{memory}', 'boost')
ON CONFLICT (name) DO NOTHING;

-- ── Notification item type ──────────────────────────────────

INSERT INTO item_types (name, icon, description, classification_hint, dashboard_section, dashboard_priority, completable, has_due_date, is_list, include_in_recall, private, agent_internal, built_in, confirmed)
VALUES ('notification', '🔔', 'Agent or system notification', 'Notification from a background agent', 'inbox', 1, true, false, false, true, false, true, true, true)
ON CONFLICT (name) DO NOTHING;

-- ── Per-agent AGENTS.md support ─────────────────────────────

ALTER TABLE agents_md_versions ADD COLUMN agent_name TEXT NOT NULL DEFAULT 'orchestrator';
CREATE INDEX idx_agents_md_agent ON agents_md_versions(agent_name);

-- ── updated_at trigger ──────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agent_definitions_updated_at
  BEFORE UPDATE ON agent_definitions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Settings columns ────────────────────────────────────────

ALTER TABLE settings ADD COLUMN IF NOT EXISTS notification_targets TEXT[] DEFAULT '{inbox}';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS task_max_concurrency INT DEFAULT 3;
