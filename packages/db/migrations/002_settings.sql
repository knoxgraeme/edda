-- Settings table — single source of truth for all agent behavior.
-- See cortex-spec-v4.md for full documentation of each field.

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

  -- Memory extraction
  memory_extraction_enabled BOOLEAN DEFAULT true,
  memory_extraction_cron TEXT DEFAULT '0 22 * * *',
  memory_extraction_model TEXT DEFAULT 'claude-haiku-4-5-20251001',

  -- Memory dedup thresholds
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
  user_crons_enabled BOOLEAN DEFAULT true,
  user_cron_check_interval TEXT DEFAULT '*/5 * * * *',
  user_cron_model TEXT DEFAULT 'claude-haiku-4-5-20251001',
  cron_runner TEXT DEFAULT 'standalone'
    CHECK (cron_runner IN ('standalone', 'platform')),
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

  -- Meta
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
