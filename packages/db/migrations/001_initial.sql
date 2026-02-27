-- Edda — consolidated initial schema
-- Squashed from migrations 001–025 into a single clean baseline.

-- ════════════════════════════════════════════════════════════════
-- Extensions
-- ════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ════════════════════════════════════════════════════════════════
-- Functions
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION safe_date(text) RETURNS date AS $$
BEGIN
  RETURN $1::date;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ════════════════════════════════════════════════════════════════
-- Settings (single-row config)
-- ════════════════════════════════════════════════════════════════

CREATE TABLE settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),

  -- LLM
  llm_provider TEXT DEFAULT 'anthropic'
    CHECK (llm_provider IN ('anthropic', 'openai', 'google', 'groq', 'ollama', 'mistral', 'bedrock')),
  default_model TEXT DEFAULT 'claude-sonnet-4-6',

  -- Embeddings
  embedding_provider TEXT DEFAULT 'voyage'
    CHECK (embedding_provider IN ('voyage', 'openai', 'google')),
  embedding_model TEXT DEFAULT 'voyage-3.5-lite',
  embedding_dimensions INT DEFAULT 1024,

  -- Search
  search_provider TEXT DEFAULT 'duckduckgo'
    CHECK (search_provider IN ('tavily', 'brave', 'serper', 'serpapi', 'duckduckgo')),
  web_search_enabled BOOLEAN DEFAULT true,
  web_search_max_results INT DEFAULT 5,

  -- Checkpointer
  checkpointer_backend TEXT DEFAULT 'postgres'
    CHECK (checkpointer_backend IN ('postgres', 'sqlite', 'memory')),

  -- AGENTS.md budget
  agents_md_token_budget INT DEFAULT 4000,
  agents_md_max_per_category INT DEFAULT 10,
  agents_md_max_versions INT DEFAULT 30,
  agents_md_max_entities INT DEFAULT 15,

  -- Crons
  cron_runner TEXT DEFAULT 'local'
    CHECK (cron_runner IN ('local', 'langgraph')),
  langgraph_platform_url TEXT,

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

  -- Concurrency
  task_max_concurrency INT DEFAULT 3,

  -- Default agent
  default_agent TEXT NOT NULL DEFAULT 'edda',

  -- Sandbox
  sandbox_provider TEXT NOT NULL DEFAULT 'none'
    CHECK (sandbox_provider IN ('none', 'node-vfs', 'daytona', 'deno')),

  -- Meta
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════
-- Item Types
-- ════════════════════════════════════════════════════════════════

CREATE TABLE item_types (
  name TEXT PRIMARY KEY,
  icon TEXT NOT NULL DEFAULT 'memo',
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
-- Lists
-- ════════════════════════════════════════════════════════════════

CREATE TABLE lists (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  normalized_name TEXT UNIQUE NOT NULL,
  summary TEXT,
  icon TEXT DEFAULT 'clipboard',
  list_type TEXT NOT NULL DEFAULT 'rolling'
    CHECK (list_type IN ('rolling', 'one_off')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  embedding vector(1024),
  embedding_model TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_lists_status ON lists(status);
CREATE INDEX idx_lists_normalized_name ON lists(normalized_name);
CREATE INDEX idx_lists_embedding ON lists
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

CREATE TRIGGER lists_updated_at
  BEFORE UPDATE ON lists
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

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
  list_id UUID REFERENCES lists(id) ON DELETE SET NULL,
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
CREATE INDEX idx_items_active_unsuperseded ON items(type, confirmed)
  WHERE superseded_by IS NULL AND confirmed = true;
CREATE INDEX idx_items_metadata_gin ON items USING gin (metadata);
CREATE INDEX idx_items_metadata_created_by ON items((metadata->>'created_by'));
CREATE INDEX idx_items_list ON items(list_id) WHERE list_id IS NOT NULL;

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
CREATE INDEX idx_entities_pending ON entities(created_at DESC) WHERE confirmed = false;

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
  auth_type TEXT NOT NULL DEFAULT 'none'
    CHECK (auth_type IN ('none', 'bearer', 'oauth')),
  auth_status TEXT NOT NULL DEFAULT 'active'
    CHECK (auth_status IN ('active', 'pending_auth', 'error')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════
-- MCP OAuth State
-- ════════════════════════════════════════════════════════════════

CREATE TABLE mcp_oauth_state (
  connection_id UUID PRIMARY KEY REFERENCES mcp_connections(id) ON DELETE CASCADE,
  client_info_encrypted TEXT,
  tokens_encrypted TEXT,
  expires_at TIMESTAMPTZ,
  discovery_state JSONB,
  pending_auth JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_mcp_oauth_state_param
  ON mcp_oauth_state ((pending_auth->>'state_param'))
  WHERE pending_auth IS NOT NULL;

-- ════════════════════════════════════════════════════════════════
-- Thread Metadata
-- ════════════════════════════════════════════════════════════════

CREATE TABLE thread_metadata (
  thread_id TEXT PRIMARY KEY,
  metadata JSONB DEFAULT '{}',
  title TEXT,
  agent_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_thread_metadata_unprocessed ON thread_metadata(updated_at DESC)
  WHERE (metadata->>'processed_by_hook')::boolean IS NOT TRUE;
CREATE INDEX idx_thread_metadata_agent ON thread_metadata(agent_name, updated_at DESC)
  WHERE agent_name IS NOT NULL;

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
  agent_name TEXT NOT NULL DEFAULT 'edda',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_agents_md_agent ON agents_md_versions(agent_name);

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
  thread_lifetime TEXT NOT NULL DEFAULT 'ephemeral'
    CHECK (thread_lifetime IN ('ephemeral', 'daily', 'persistent')),
  thread_scope TEXT NOT NULL DEFAULT 'shared'
    CHECK (thread_scope IN ('shared', 'per_channel')),
  trigger TEXT CHECK (trigger IS NULL OR trigger IN ('schedule', 'on_demand')),
  tools TEXT[] NOT NULL DEFAULT '{}',
  subagents TEXT[] NOT NULL DEFAULT '{}',
  model_provider TEXT
    CHECK (model_provider IS NULL OR model_provider IN ('anthropic', 'openai', 'google', 'groq', 'ollama', 'mistral', 'bedrock')),
  model TEXT,
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
  thread_lifetime TEXT CHECK (thread_lifetime IS NULL OR thread_lifetime IN ('ephemeral', 'daily', 'persistent')),
  notify TEXT[] NOT NULL DEFAULT '{}',
  notify_expires_after INTERVAL DEFAULT '72 hours',
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
-- Notifications
-- ════════════════════════════════════════════════════════════════

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_type TEXT NOT NULL CHECK (source_type IN ('schedule', 'agent', 'system')),
  source_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('inbox', 'agent')),
  target_id TEXT,
  summary TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}',
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  status TEXT NOT NULL DEFAULT 'unread'
    CHECK (status IN ('unread', 'read', 'dismissed', 'scheduled', 'sending', 'sent')),
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '72 hours'),
  scheduled_at TIMESTAMPTZ,
  recurrence TEXT,
  targets TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_target ON notifications(target_type, target_id, status, expires_at);
CREATE INDEX idx_notifications_created ON notifications(created_at);
CREATE INDEX idx_notifications_scheduled ON notifications(scheduled_at) WHERE status = 'scheduled';

-- ════════════════════════════════════════════════════════════════
-- Agent Channels
-- ════════════════════════════════════════════════════════════════

CREATE TABLE agent_channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  external_id TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT true,
  receive_announcements BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, external_id)
);

CREATE INDEX idx_agent_channels_agent ON agent_channels(agent_id);
CREATE INDEX idx_agent_channels_lookup ON agent_channels(platform, external_id) WHERE enabled;

-- ════════════════════════════════════════════════════════════════
-- Telegram Paired Users
-- ════════════════════════════════════════════════════════════════

CREATE TABLE telegram_paired_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  telegram_id BIGINT NOT NULL UNIQUE,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════
-- Seed Data: Item Types
-- ════════════════════════════════════════════════════════════════

INSERT INTO item_types (name, icon, description, metadata_schema, classification_hint, agent_internal, decay_half_life_days) VALUES
  ('note', 'memo', 'General note or thought', '{}',
   'Default type for informational content. Use for observations, recommendations, links, ideas, or anything that doesn''t fit a more specific behavioral type. When the user shares a recommendation, save it as a note with metadata (recommended_by, category). When saving a URL, use a note with metadata (url, title). Prefer a more specific behavioral type (task, reminder, event) when the item has a distinct lifecycle.',
   false, 30),

  ('reminder', 'bell', 'Something to remember at a specific time', '{"due_date": "ISO date", "priority": "low|medium|high"}',
   'Use when the user wants to be alerted at a specific time or before a deadline — the emphasis is on the notification, not the action. Signal phrases: "remind me", "don''t let me forget", "alert me when", combined with a time or date. Prefer reminder over task when the goal is the nudge, not tracking work. Metadata: Extract due_date (ISO date) and priority (low/medium/high) when mentioned.',
   false, 7),

  ('task', 'white_check_mark', 'Action item to complete', '{"priority": "low|medium|high", "due_date": "ISO date"}',
   'Use when the user states something they need to do, complete, or follow up on. Key signal: personal ownership of an action ("I need to", "I have to", "don''t forget to do"). Prefer task over reminder when the emphasis is on the work itself rather than the timing. Prefer task over note when there is a clear next action. Metadata: Extract priority (low/medium/high) and due_date (ISO date) when mentioned.',
   false, 14),

  ('event', 'calendar', 'Calendar event or appointment', '{"date": "ISO date", "time": "HH:MM", "location": "string"}',
   'Use for something happening at a specific future date/time that the user plans to attend or track. Signal phrases: "I have a", "scheduled for", "on [date]", "appointment". Prefer event over meeting when nothing has happened yet — event is future-facing, meeting is retrospective. Metadata: Extract date (ISO date), time (HH:MM), and location when mentioned.',
   false, 30),

  ('decision', 'balance_scale', 'A decision that was made', '{"context": "string"}',
   'Use when a choice between options was made and should be recorded for future reference. Signal: past tense about an outcome ("we decided", "I''m going with", "we agreed on"). Often a child of a meeting item. Not a task (no action required) and not a note (a specific choice was made). Metadata: Extract context — what was decided and why, if stated.',
   false, 90),

  ('meeting', 'handshake', 'Meeting notes or summary', '{"attendees": ["string"], "date": "ISO date"}',
   'Use when the user is logging or summarizing a meeting that already happened or just finished. Often includes attendees, what was discussed, decisions made, or action items. Prefer meeting over event when recording what occurred, not what is upcoming. Metadata: Extract attendees (list of names) and date (ISO date) when mentioned.',
   false, 60),

  ('journal', 'notebook', 'Private reflection or diary entry', '{}',
   'Use when the user is processing feelings, reflecting on their day, or writing something deeply personal. Signal: emotional language, introspection, diary-style writing. Prefer journal over note when the content is about how the user feels, not what they observed. Private — never surface in casual recall.',
   false, 60),

  ('preference', 'gear', 'User preference or setting', '{}',
   'Agent-internal. Use to record how the user prefers things done — communication style, scheduling habits, formatting choices, workflow preferences. These shape future agent behavior. Prefer preference over learned_fact when it describes a habitual choice, not a factual attribute.',
   true, 180),

  ('learned_fact', 'brain', 'Fact about the user', '{}',
   'Agent-internal. Use to record factual attributes about the user — relationships, dietary restrictions, location, professional role, recurring commitments. Prefer learned_fact over preference when it is a fact about who they are, not how they like things done.',
   true, 0),

  ('pattern', 'bar_chart', 'Behavioral pattern observed', '{}',
   'Agent-internal. Use when the agent observes a recurring behavior or tendency across multiple conversations — "always brain-dumps groceries on Thursdays", "tends to schedule meetings in the morning". Require at least 2-3 supporting instances before creating a pattern.',
   true, 90),

  ('notification', 'bell', 'Agent or system notification', '{}',
   'System-internal. Notification from a background agent run. Not user-classified — created programmatically by the notification service.',
   true, 7),

  ('session_summary', 'mirror', 'Extraction retrospective: what the agent learned about user preferences, corrections received, and quality signals from a processing pass',
   '{"thread_id": "UUID of the thread processed", "message_count": "number of messages covered in this pass", "corrections": "array of things user corrected", "preferences_observed": "array of new preferences noted", "quality_signals": "what went well or poorly"}',
   'Agent-internal. Created automatically by the memory_extraction skill after processing a batch of messages. Do NOT create manually or in response to user requests. Contains structured retrospective data — corrections and quality signals are the highest-value fields for self-improvement.',
   true, 30),

  ('daily_digest', 'newspaper', 'Daily summary of user activity, items captured, and notable events',
   '{"date": "ISO date the digest covers", "item_count": "number of items summarized", "highlights": "array of key highlights"}',
   'Agent-internal. Created automatically by the daily_digest skill during scheduled cron runs. Do NOT create manually or in response to user requests.',
   true, 14),

  ('insight', 'bulb', 'Weekly pattern or insight derived from analyzing user activity and behavior trends',
   '{"period": "time period covered", "category": "area of insight", "confidence": "how confident the observation is"}',
   'Agent-internal. Created automatically by the weekly_reflect skill during scheduled cron runs. Do NOT create manually or in response to user requests.',
   true, 60)
ON CONFLICT (name) DO NOTHING;

-- ════════════════════════════════════════════════════════════════
-- Seed Data: System Agents
-- ════════════════════════════════════════════════════════════════

INSERT INTO agents (name, description, skills, trigger, thread_lifetime, tools, enabled, metadata)
VALUES
  ('edda', 'Primary conversational agent', ARRAY['capture', 'recall', 'manage', 'admin', 'self_improvement'],
   'on_demand', 'persistent', ARRAY['web_search'], true, '{"stores": {"*": "read"}}'::jsonb),

  ('digest', 'Daily summaries and weekly reflections', ARRAY['daily_digest', 'weekly_reflect'],
   'schedule', 'daily', '{}', true, '{}'::jsonb),

  ('maintenance', 'System maintenance: context refresh and type evolution', ARRAY['context_refresh', 'type_evolution'],
   'schedule', 'ephemeral', '{}', true, '{}'::jsonb),

  ('memory', 'Extract and persist memories from conversations', ARRAY['memory_extraction'],
   'schedule', 'ephemeral', '{}', true,
   '{"retrieval_context": {"authorship_mode": "boost", "authorship_boost": 1.3}}'::jsonb)
ON CONFLICT (name) DO NOTHING;

-- ════════════════════════════════════════════════════════════════
-- Seed Data: Agent Schedules
-- ════════════════════════════════════════════════════════════════

INSERT INTO agent_schedules (agent_id, name, cron, prompt, notify, notify_expires_after)
SELECT id, 'daily_digest', '0 7 * * *',
  'Generate the daily digest. Summarize yesterday''s activity, surface items due today, and flag anything stale or overdue.',
  '{inbox,agent:edda:active}', '24 hours'
FROM agents WHERE name = 'digest'
ON CONFLICT (agent_id, name) DO NOTHING;

INSERT INTO agent_schedules (agent_id, name, cron, prompt, notify, notify_expires_after)
SELECT id, 'weekly_reflect', '0 3 * * 0',
  'Perform the weekly reflection. Part 1: Identify themes from the past 7 days, surface the most active entities, detect dropped threads. Part 2: Memory maintenance — merge duplicates, archive stale memories, resolve contradictions, consolidate entity descriptions. Part 3: Self-improvement — review session summaries for corrections and quality signals, update AGENTS.md procedural memory with synthesized insights, optionally refine agent prompts if clear patterns emerge.',
  '{inbox,agent:edda:active}', '72 hours'
FROM agents WHERE name = 'digest'
ON CONFLICT (agent_id, name) DO NOTHING;

INSERT INTO agent_schedules (agent_id, name, cron, prompt)
SELECT id, 'context_refresh', '0 5 * * *',
  'Refresh the AGENTS.md context document. Compare the current version against fresh data, make surgical edits to reflect changes, and stay within the token budget.'
FROM agents WHERE name = 'maintenance'
ON CONFLICT (agent_id, name) DO NOTHING;

INSERT INTO agent_schedules (agent_id, name, cron, prompt)
SELECT id, 'type_evolution', '0 6 * * *',
  'Analyze item type usage patterns. Cluster unclassified note items, propose new types if patterns emerge, and reclassify items where appropriate.'
FROM agents WHERE name = 'maintenance'
ON CONFLICT (agent_id, name) DO NOTHING;

INSERT INTO agent_schedules (agent_id, name, cron, prompt)
SELECT id, 'memory_catchup', '0 22 * * *',
  'Process all unprocessed conversation threads. Extract preferences, facts, patterns, and entities. Deduplicate against existing memories using semantic similarity.'
FROM agents WHERE name = 'memory'
ON CONFLICT (agent_id, name) DO NOTHING;
