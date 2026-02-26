-- Edda — consolidated initial schema
-- This migration represents the complete database schema as a single file.

-- ════════════════════════════════════════════════════════════════
-- Extensions
-- ════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ════════════════════════════════════════════════════════════════
-- Functions
-- ════════════════════════════════════════════════════════════════

-- Safe date cast for JSONB expression indexes
CREATE OR REPLACE FUNCTION safe_date(text) RETURNS date AS $$
BEGIN
  RETURN $1::date;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ════════════════════════════════════════════════════════════════
-- Settings
-- ════════════════════════════════════════════════════════════════

CREATE TABLE settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),

  -- LLM
  llm_provider TEXT DEFAULT 'anthropic'
    CHECK (llm_provider IN ('anthropic', 'openai', 'google', 'groq', 'ollama', 'mistral', 'bedrock')),
  default_model TEXT DEFAULT 'claude-sonnet-4-5-20250929',

  -- Embeddings
  embedding_provider TEXT DEFAULT 'voyage'
    CHECK (embedding_provider IN ('voyage', 'openai', 'google')),
  embedding_model TEXT DEFAULT 'voyage-3.5-lite',
  embedding_dimensions INT DEFAULT 1024,

  -- Search
  search_provider TEXT DEFAULT 'tavily'
    CHECK (search_provider IN ('tavily', 'brave', 'serper', 'serpapi')),
  web_search_enabled BOOLEAN DEFAULT true,
  web_search_max_results INT DEFAULT 5,

  -- Checkpointer
  checkpointer_backend TEXT DEFAULT 'postgres'
    CHECK (checkpointer_backend IN ('postgres', 'sqlite', 'memory')),

  -- Memory
  memory_catchup_cron TEXT DEFAULT '0 22 * * *',
  memory_catchup_model TEXT DEFAULT 'claude-haiku-4-5-20251001',
  memory_reinforce_threshold FLOAT DEFAULT 0.95,
  memory_update_threshold FLOAT DEFAULT 0.85,
  entity_exact_threshold FLOAT DEFAULT 0.95,
  entity_fuzzy_threshold FLOAT DEFAULT 0.80,

  -- AGENTS.md budget
  agents_md_token_budget INT DEFAULT 1500,
  agents_md_max_per_category INT DEFAULT 10,
  agents_md_max_versions INT DEFAULT 30,
  agents_md_max_entities INT DEFAULT 15,

  -- Tool call limits
  tool_call_limit_global INT DEFAULT 30,
  tool_call_limit_delete INT DEFAULT 10,
  tool_call_limit_archive INT DEFAULT 15,

  -- Crons
  cron_runner TEXT DEFAULT 'standalone'
    CHECK (cron_runner IN ('standalone', 'platform')),
  langgraph_platform_url TEXT,
  daily_digest_cron TEXT DEFAULT '0 7 * * *',
  weekly_review_cron TEXT DEFAULT '0 3 * * 0',
  type_evolution_cron TEXT DEFAULT '0 6 * * *',
  context_refresh_cron TEXT DEFAULT '0 5 * * *',
  context_refresh_model TEXT DEFAULT 'claude-haiku-4-5-20251001',

  -- Approvals
  approval_new_type TEXT DEFAULT 'confirm'
    CHECK (approval_new_type IN ('auto', 'confirm')),
  approval_archive_stale TEXT DEFAULT 'confirm'
    CHECK (approval_archive_stale IN ('auto', 'confirm')),
  approval_merge_entity TEXT DEFAULT 'auto'
    CHECK (approval_merge_entity IN ('auto', 'confirm')),

  -- Personality
  system_prompt_override TEXT,

  -- Setup
  setup_completed BOOLEAN DEFAULT false,
  user_display_name TEXT,
  user_timezone TEXT DEFAULT 'UTC',

  -- Notifications & concurrency
  notification_targets TEXT[] DEFAULT '{inbox}',
  task_max_concurrency INT DEFAULT 3,

  -- Default agent
  default_agent TEXT NOT NULL DEFAULT 'edda',

  -- Meta
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════
-- Item Types
-- ════════════════════════════════════════════════════════════════

CREATE TABLE item_types (
  name TEXT PRIMARY KEY,
  icon TEXT NOT NULL DEFAULT '📝',
  description TEXT NOT NULL,
  metadata_schema JSONB DEFAULT '{}',
  classification_hint TEXT NOT NULL,
  agent_internal BOOLEAN DEFAULT false,
  confirmed BOOLEAN DEFAULT true,
  pending_action TEXT,
  decay_half_life_days INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════
-- Items
-- ════════════════════════════════════════════════════════════════

CREATE TABLE items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type TEXT NOT NULL REFERENCES item_types(name),
  content TEXT NOT NULL,
  summary TEXT,
  metadata JSONB DEFAULT '{}',
  status TEXT DEFAULT 'active'
    CHECK (status IN ('active', 'done', 'archived', 'snoozed')),
  source TEXT DEFAULT 'chat'
    CHECK (source IN ('chat', 'cli', 'api', 'cron', 'agent', 'posthook')),
  day DATE DEFAULT CURRENT_DATE,
  confirmed BOOLEAN DEFAULT true,
  parent_id UUID REFERENCES items(id),
  embedding vector(1024),
  embedding_model TEXT,
  superseded_by UUID REFERENCES items(id),
  completed_at TIMESTAMPTZ,
  pending_action TEXT,
  last_reinforced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_items_type ON items(type);
CREATE INDEX idx_items_status ON items(status);
CREATE INDEX idx_items_day ON items(day);
CREATE INDEX idx_items_confirmed ON items(confirmed);
CREATE INDEX idx_items_parent ON items(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_items_embedding ON items USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_items_status_type ON items(status, type) WHERE confirmed = true;
CREATE INDEX idx_items_day_type ON items(day DESC, type) WHERE confirmed = true;
CREATE INDEX idx_items_due_date ON items(safe_date(metadata->>'due_date'))
  WHERE metadata->>'due_date' IS NOT NULL AND confirmed = true;
CREATE INDEX idx_items_pending ON items(created_at DESC) WHERE confirmed = false;
CREATE INDEX idx_items_active_unsuperseded ON items(type, created_at DESC)
  WHERE superseded_by IS NULL AND status = 'active';
CREATE INDEX idx_items_metadata_gin ON items USING gin (metadata);
CREATE INDEX idx_items_list_normalized_name ON items((metadata->>'normalized_name'))
  WHERE type = 'list' AND status = 'active';
CREATE INDEX idx_items_metadata_created_by ON items((metadata->>'created_by'));

-- ════════════════════════════════════════════════════════════════
-- Entities
-- ════════════════════════════════════════════════════════════════

CREATE TABLE entities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL
    CHECK (type IN ('person', 'project', 'company', 'topic', 'place', 'tool', 'concept')),
  aliases TEXT[] DEFAULT '{}',
  description TEXT,
  mention_count INT DEFAULT 1,
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  embedding vector(1024),
  confirmed BOOLEAN DEFAULT true,
  pending_action TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_entities_type ON entities(type);
CREATE INDEX idx_entities_mentions ON entities(mention_count DESC);
CREATE INDEX idx_entities_embedding ON entities USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);
CREATE INDEX idx_entities_pending ON entities(created_at DESC)
  WHERE confirmed = false;

-- ════════════════════════════════════════════════════════════════
-- Item ↔ Entity join table
-- ════════════════════════════════════════════════════════════════

CREATE TABLE item_entities (
  item_id UUID REFERENCES items(id) ON DELETE CASCADE,
  entity_id UUID REFERENCES entities(id) ON DELETE CASCADE,
  relationship TEXT DEFAULT 'mentioned',
  PRIMARY KEY (item_id, entity_id)
);

CREATE INDEX idx_item_entities_entity_id ON item_entities(entity_id);

-- ════════════════════════════════════════════════════════════════
-- MCP Connections
-- ════════════════════════════════════════════════════════════════

CREATE TABLE mcp_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  transport TEXT NOT NULL
    CHECK (transport IN ('stdio', 'sse', 'streamable-http')),
  config JSONB DEFAULT '{}',
  enabled BOOLEAN DEFAULT true,
  discovered_tools TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════
-- Thread Metadata
-- ════════════════════════════════════════════════════════════════

CREATE TABLE thread_metadata (
  thread_id TEXT PRIMARY KEY,
  metadata JSONB DEFAULT '{}',
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_thread_metadata_unprocessed ON thread_metadata(updated_at DESC)
  WHERE (metadata->>'processed_by_hook')::boolean IS NOT TRUE;

-- ════════════════════════════════════════════════════════════════
-- Skills
-- ════════════════════════════════════════════════════════════════

CREATE TABLE skills (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  version INT NOT NULL DEFAULT 1 CHECK (version >= 1),
  is_system BOOLEAN NOT NULL DEFAULT false,
  confirmed BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT NOT NULL DEFAULT 'seed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_skills_confirmed_name ON skills(name) WHERE confirmed = true;

-- ════════════════════════════════════════════════════════════════
-- AGENTS.md Versions
-- ════════════════════════════════════════════════════════════════

CREATE TABLE agents_md_versions (
  id SERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  template TEXT NOT NULL DEFAULT '',
  input_hash TEXT,
  agent_name TEXT NOT NULL DEFAULT 'orchestrator',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_agents_md_agent ON agents_md_versions(agent_name);

-- Seed initial empty version
INSERT INTO agents_md_versions (content, template, input_hash)
SELECT '', '', NULL
WHERE NOT EXISTS (SELECT 1 FROM agents_md_versions);

-- ════════════════════════════════════════════════════════════════
-- Agents
-- ════════════════════════════════════════════════════════════════

CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  system_prompt TEXT,
  skills TEXT[] NOT NULL DEFAULT '{}',
  context_mode TEXT NOT NULL DEFAULT 'isolated'
    CHECK (context_mode IN ('isolated', 'daily', 'persistent')),
  trigger TEXT CHECK (trigger IS NULL OR trigger IN ('schedule', 'on_demand')),
  tools TEXT[] NOT NULL DEFAULT '{}',
  subagents TEXT[] NOT NULL DEFAULT '{}',
  model_settings_key TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER agents_updated_at
  BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════════════════════════════════════════════════════
-- Agent Schedules
-- ════════════════════════════════════════════════════════════════

CREATE TABLE agent_schedules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  cron TEXT NOT NULL,
  prompt TEXT NOT NULL,
  context_mode TEXT CHECK (context_mode IS NULL OR context_mode IN ('isolated', 'daily', 'persistent')),
  hooks JSONB NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_id, name)
);

CREATE INDEX idx_agent_schedules_agent ON agent_schedules(agent_id);

-- ════════════════════════════════════════════════════════════════
-- Task Runs
-- ════════════════════════════════════════════════════════════════

CREATE TABLE task_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  agent_name TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('cron', 'user', 'orchestrator', 'hook', 'agent', 'notification')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  thread_id TEXT,
  schedule_id UUID REFERENCES agent_schedules(id) ON DELETE SET NULL,
  input_summary TEXT,
  output_summary TEXT,
  model TEXT,
  tokens_used INT,
  duration_ms INT,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_task_runs_agent ON task_runs(agent_name);
CREATE INDEX idx_task_runs_status ON task_runs(status);
CREATE INDEX idx_task_runs_created ON task_runs(created_at DESC);
CREATE INDEX idx_task_runs_agent_id ON task_runs(agent_id);
CREATE INDEX idx_task_runs_agent_created ON task_runs(agent_name, created_at DESC);
CREATE INDEX idx_task_runs_schedule ON task_runs(schedule_id);

-- ════════════════════════════════════════════════════════════════
-- Seed Data: Item Types
-- ════════════════════════════════════════════════════════════════

INSERT INTO item_types (name, icon, description, metadata_schema, classification_hint, agent_internal, decay_half_life_days) VALUES
  ('note', '📝', 'General note or thought', '{}',
   'Use when the input is informational, observational, or doesn''t fit a more specific type. Choose note over idea when the user is recording something that happened or exists, not imagining something new. When uncertain between note and any specific type, prefer the specific type.',
   false, 30),

  ('reminder', '🔔', 'Something to remember at a specific time', '{"due_date": "ISO date", "priority": "low|medium|high"}',
   'Use when the user wants to be alerted at a specific time or before a deadline — the emphasis is on the notification, not the action. Signal phrases: "remind me", "don''t let me forget", "alert me when", combined with a time or date. Prefer reminder over task when the goal is the nudge, not tracking work. Metadata: Extract due_date (ISO date) and priority (low/medium/high) when mentioned.',
   false, 7),

  ('task', '✅', 'Action item to complete', '{"priority": "low|medium|high", "due_date": "ISO date"}',
   'Use when the user states something they need to do, complete, or follow up on. Key signal: personal ownership of an action ("I need to", "I have to", "don''t forget to do"). Prefer task over reminder when the emphasis is on the work itself rather than the timing. Prefer task over note when there is a clear next action. Metadata: Extract priority (low/medium/high) and due_date (ISO date) when mentioned.',
   false, 14),

  ('event', '📅', 'Calendar event or appointment', '{"date": "ISO date", "time": "HH:MM", "location": "string"}',
   'Use for something happening at a specific future date/time that the user plans to attend or track. Signal phrases: "I have a", "scheduled for", "on [date]", "appointment". Prefer event over meeting when nothing has happened yet — event is future-facing, meeting is retrospective. Metadata: Extract date (ISO date), time (HH:MM), and location when mentioned.',
   false, 30),

  ('list_item', '🛒', 'Item in a named list', '{"list_name": "string"}',
   'Use for discrete items that belong to a named list — groceries, packing, shopping, reading. Always link to a parent list item via parent_id. If no list exists yet, create one (type=list) first. Do not use for tasks or action items even if they appear in list form.',
   false, 30),

  ('list', '📋', 'A named list that contains list items', '{"list_type": "rolling|one_off", "normalized_name": "string"}',
   'Use when the user creates or references a named collection of items — grocery list, packing list, shopping list, reading list. This is the container; individual entries are list_item type with parent_id pointing here. Prefer list over note when items belong to a named collection. Metadata: list_type is "rolling" for recurring lists (grocery, shopping) or "one_off" for temporary lists (trip packing, moving checklist). normalized_name is the lowercase trimmed list name for dedup.',
   false, 0),

  ('link', '🔗', 'URL to save for later', '{"url": "string", "title": "string"}',
   'Use when the user shares a URL or clearly wants to bookmark something for later. The URL must be present or clearly implied. Prefer link over note even if the user adds commentary — the URL is the primary artifact. Metadata: Extract url and title when present.',
   false, 60),

  ('idea', '💡', 'Creative idea or inspiration', '{}',
   'Use when the user is brainstorming, imagining possibilities, or proposing something that doesn''t exist yet. Signal phrases: "what if", "we could", "I''ve been thinking about", "here''s an idea". Prefer idea over note when the input is generative or speculative rather than observational. Prefer idea over task when there is no concrete next action.',
   false, 60),

  ('decision', '⚖️', 'A decision that was made', '{"context": "string"}',
   'Use when a choice between options was made and should be recorded for future reference. Signal: past tense about an outcome ("we decided", "I''m going with", "we agreed on"). Often a child of a meeting item. Not a task (no action required) and not a note (a specific choice was made). Metadata: Extract context — what was decided and why, if stated.',
   false, 90),

  ('meeting', '🤝', 'Meeting notes or summary', '{"attendees": ["string"], "date": "ISO date"}',
   'Use when the user is logging or summarizing a meeting that already happened or just finished. Often includes attendees, what was discussed, decisions made, or action items. Prefer meeting over event when recording what occurred, not what is upcoming. Metadata: Extract attendees (list of names) and date (ISO date) when mentioned.',
   false, 60),

  ('journal', '📓', 'Private reflection or diary entry', '{}',
   'Use when the user is processing feelings, reflecting on their day, or writing something deeply personal. Signal: emotional language, introspection, diary-style writing. Prefer journal over note when the content is about how the user feels, not what they observed. Private — never surface in casual recall.',
   false, 60),

  ('recommendation', '⭐', 'Something worth trying', '{"category": "string", "recommended_by": "string", "source": "string"}',
   'Use when the user records something worth trying — a movie, book, restaurant, podcast, tool, or product. Signal: "you should check out", "apparently X is great", "someone recommended". Always capture the category. Prefer recommendation over note when a specific thing is being suggested to watch, read, try, visit, or use. Metadata: Extract category (movie, book, restaurant, podcast, tool, etc.), recommended_by (who suggested it), and source (where they heard about it).',
   false, 90),

  ('preference', '⚙️', 'User preference or setting', '{}',
   'Agent-internal. Use to record how the user prefers things done — communication style, scheduling habits, formatting choices, workflow preferences. These shape future agent behavior. Prefer preference over learned_fact when it describes a habitual choice, not a factual attribute.',
   true, 180),

  ('learned_fact', '🧠', 'Fact about the user', '{}',
   'Agent-internal. Use to record factual attributes about the user — relationships, dietary restrictions, location, professional role, recurring commitments. Prefer learned_fact over preference when it is a fact about who they are, not how they like things done.',
   true, 0),

  ('pattern', '📊', 'Behavioral pattern observed', '{}',
   'Agent-internal. Use when the agent observes a recurring behavior or tendency across multiple conversations — "always brain-dumps groceries on Thursdays", "tends to schedule meetings in the morning". Require at least 2-3 supporting instances before creating a pattern.',
   true, 90),

  ('notification', '🔔', 'Agent or system notification', '{}',
   'System-internal. Notification from a background agent run. Not user-classified — created programmatically by the notification service.',
   true, 7)
ON CONFLICT (name) DO NOTHING;

-- ════════════════════════════════════════════════════════════════
-- Seed Data: System Agents
-- ════════════════════════════════════════════════════════════════

-- Primary conversational agent
INSERT INTO agents (name, description, skills, trigger, context_mode, enabled, metadata)
VALUES ('edda', 'Primary orchestrator agent', ARRAY['capture', 'recall', 'manage', 'admin'],
        'on_demand', 'persistent', true, '{"stores": {"*": "read"}}'::jsonb)
ON CONFLICT (name) DO NOTHING;

-- Digest: daily summaries + weekly reflections
INSERT INTO agents (name, description, skills, trigger, context_mode, model_settings_key, enabled, metadata)
VALUES ('digest', 'Daily summaries and weekly reflections', ARRAY['daily_digest', 'weekly_reflect'],
        'schedule', 'daily', 'daily_digest_model', true, '{}'::jsonb)
ON CONFLICT (name) DO NOTHING;

-- Maintenance: context refresh + type evolution
INSERT INTO agents (name, description, skills, trigger, context_mode, model_settings_key, enabled, metadata)
VALUES ('maintenance', 'System maintenance: context refresh and type evolution', ARRAY['context_refresh', 'type_evolution'],
        'schedule', 'isolated', 'context_refresh_model', true, '{}'::jsonb)
ON CONFLICT (name) DO NOTHING;

-- Memory: nightly extraction from unprocessed threads
INSERT INTO agents (name, description, skills, trigger, context_mode, model_settings_key, enabled, metadata)
VALUES ('memory', 'Extract and persist memories from conversations', ARRAY['memory_extraction'],
        'schedule', 'isolated', 'memory_catchup_model', true,
        '{"retrieval_context": {"authorship_mode": "boost", "authorship_boost": 1.3}}'::jsonb)
ON CONFLICT (name) DO NOTHING;

-- ════════════════════════════════════════════════════════════════
-- Seed Data: Agent Schedules
-- ════════════════════════════════════════════════════════════════

-- digest: daily morning briefing
INSERT INTO agent_schedules (agent_id, name, cron, prompt)
SELECT id, 'daily_digest', '0 7 * * *',
  'Generate the daily digest. Summarize yesterday''s activity, surface items due today, and flag anything stale or overdue.'
FROM agents WHERE name = 'digest'
ON CONFLICT (agent_id, name) DO NOTHING;

-- digest: weekly reflection (Sundays)
INSERT INTO agent_schedules (agent_id, name, cron, prompt)
SELECT id, 'weekly_reflect', '0 3 * * 0',
  'Perform the weekly reflection. Identify themes from the past 7 days, surface the most active entities, detect dropped threads, consolidate duplicate memories, resolve contradictions, and archive stale knowledge.'
FROM agents WHERE name = 'digest'
ON CONFLICT (agent_id, name) DO NOTHING;

-- maintenance: context refresh (daily)
INSERT INTO agent_schedules (agent_id, name, cron, prompt)
SELECT id, 'context_refresh', '0 5 * * *',
  'Refresh the AGENTS.md context document. Compare the current version against fresh data, make surgical edits to reflect changes, and stay within the token budget.'
FROM agents WHERE name = 'maintenance'
ON CONFLICT (agent_id, name) DO NOTHING;

-- maintenance: type evolution (daily)
INSERT INTO agent_schedules (agent_id, name, cron, prompt)
SELECT id, 'type_evolution', '0 6 * * *',
  'Analyze item type usage patterns. Cluster unclassified note items, propose new types if patterns emerge, and reclassify items where appropriate.'
FROM agents WHERE name = 'maintenance'
ON CONFLICT (agent_id, name) DO NOTHING;

-- memory: nightly catchup
INSERT INTO agent_schedules (agent_id, name, cron, prompt)
SELECT id, 'memory_catchup', '0 22 * * *',
  'Process all unprocessed conversation threads. Extract preferences, facts, patterns, and entities. Deduplicate against existing memories using semantic similarity.'
FROM agents WHERE name = 'memory'
ON CONFLICT (agent_id, name) DO NOTHING;
