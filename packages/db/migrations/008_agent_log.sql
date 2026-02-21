-- Agent log — tracks skill executions, errors, and agent activity

CREATE TABLE IF NOT EXISTS agent_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  skill TEXT NOT NULL,
  trigger TEXT NOT NULL,
  input_summary TEXT,
  output_summary TEXT,
  items_created UUID[] DEFAULT '{}',
  items_retrieved UUID[] DEFAULT '{}',
  entities_created UUID[] DEFAULT '{}',
  model TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_log_skill ON agent_log(skill);
CREATE INDEX IF NOT EXISTS idx_agent_log_created ON agent_log(created_at DESC);
