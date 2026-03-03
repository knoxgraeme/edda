-- Pending actions: tool-level interrupt / confirmation system
CREATE TABLE IF NOT EXISTS pending_actions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name    TEXT NOT NULL,
  tool_name     TEXT NOT NULL,
  tool_input    JSONB NOT NULL DEFAULT '{}',
  description   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected','expired')),
  thread_id     TEXT,
  run_context   JSONB NOT NULL DEFAULT '{}',
  resolved_by   TEXT,
  resolved_at   TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ NOT NULL,
  channel_refs  JSONB NOT NULL DEFAULT '[]',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pending_actions_status ON pending_actions(status) WHERE status = 'pending';
CREATE INDEX idx_pending_actions_agent ON pending_actions(agent_name, status);
CREATE INDEX idx_pending_actions_expires ON pending_actions(expires_at) WHERE status = 'pending';
